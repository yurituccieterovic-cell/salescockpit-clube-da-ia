import { logger } from "./logger";

const BSKY_PDS = "https://bsky.social";

type Session = { accessJwt: string; refreshJwt: string; did: string; handle: string };

async function createSession(handle: string, password: string): Promise<Session> {
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bluesky login falhou (${res.status}): ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as Session;
}

export type BlueskyPostResult = { uri: string; cid: string; webUrl: string };

export async function publishToBluesky(text: string): Promise<BlueskyPostResult> {
  const handle = process.env.BLUESKY_HANDLE?.trim();
  const password = process.env.BLUESKY_APP_PASSWORD?.trim();
  if (!handle || !password) {
    throw new Error("BLUESKY_HANDLE ou BLUESKY_APP_PASSWORD não configurados.");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Post vazio.");
  // Bluesky aceita até 300 graphemes. Conservador: cortamos em 290 chars.
  const finalText = trimmed.length > 290 ? trimmed.slice(0, 287) + "..." : trimmed;

  const session = await createSession(handle, password);

  const createdAt = new Date().toISOString();
  const record = {
    $type: "app.bsky.feed.post",
    text: finalText,
    createdAt,
    langs: ["pt"],
  };

  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bluesky createRecord falhou (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as { uri: string; cid: string };
  // uri format: at://did:plc:xxx/app.bsky.feed.post/rkey
  const rkey = data.uri.split("/").pop() ?? "";
  const webUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;

  logger.info({ uri: data.uri, webUrl, len: finalText.length }, "[bluesky] post published");
  return { uri: data.uri, cid: data.cid, webUrl };
}

// ─── Leitura + interação (respostas, menções, threads) ───

export type { Session as BlueskySession };

export async function loginBluesky(): Promise<Session> {
  const handle = process.env.BLUESKY_HANDLE?.trim();
  const password = process.env.BLUESKY_APP_PASSWORD?.trim();
  if (!handle || !password) {
    throw new Error("BLUESKY_HANDLE ou BLUESKY_APP_PASSWORD não configurados.");
  }
  return createSession(handle, password);
}

async function bskyGet(
  session: Session,
  method: string,
  params: Record<string, string>,
): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BSKY_PDS}/xrpc/${method}?${qs}`, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${method} falhou (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export type BlueskyNotification = {
  uri: string;
  cid: string;
  reason: string; // reply | mention | like | repost | follow | quote
  isRead: boolean;
  indexedAt: string;
  author: { did: string; handle: string; displayName?: string };
  text: string;
  replyRoot?: { uri: string; cid: string };
};

export async function getNotifications(session: Session, limit = 40): Promise<BlueskyNotification[]> {
  const data = (await bskyGet(session, "app.bsky.notification.listNotifications", {
    limit: String(Math.min(Math.max(limit, 1), 100)),
  })) as {
    notifications?: Array<{
      uri: string;
      cid: string;
      reason: string;
      isRead: boolean;
      indexedAt: string;
      author?: { did?: string; handle?: string; displayName?: string };
      record?: { text?: string; reply?: { root?: { uri?: string; cid?: string } } };
    }>;
  };
  return (data.notifications ?? []).map((n) => ({
    uri: n.uri,
    cid: n.cid,
    reason: n.reason,
    isRead: n.isRead,
    indexedAt: n.indexedAt,
    author: {
      did: n.author?.did ?? "",
      handle: n.author?.handle ?? "",
      displayName: n.author?.displayName,
    },
    text: n.record?.text ?? "",
    replyRoot:
      n.record?.reply?.root?.uri && n.record.reply.root.cid
        ? { uri: n.record.reply.root.uri, cid: n.record.reply.root.cid }
        : undefined,
  }));
}

export async function getPostThread(
  session: Session,
  uri: string,
  depth = 1,
  parentHeight = 0,
): Promise<unknown> {
  return bskyGet(session, "app.bsky.feed.getPostThread", {
    uri,
    depth: String(depth),
    parentHeight: String(parentHeight),
  });
}

export type ThreadTurn = { handle: string; displayName?: string; text: string };

// Reconstrói a conversa que LEVOU até `uri` (ancestrais, do mais antigo ao próprio post).
// Usa parentHeight pra puxar a cadeia de pais. Devolve [] se não der.
export async function getThreadContext(
  session: Session,
  uri: string,
  maxTurns = 40,
): Promise<ThreadTurn[]> {
  try {
    const data = (await getPostThread(session, uri, 0, 80)) as {
      thread?: ThreadNode;
    };
    const node = data?.thread;
    if (!node) return [];
    const chain: ThreadTurn[] = [];
    let cur: ThreadNode | undefined = node;
    // sobe a cadeia de pais acumulando, depois inverte (root → atual)
    const stack: ThreadNode[] = [];
    while (cur) {
      stack.push(cur);
      cur = cur.parent;
    }
    for (const n of stack.reverse()) {
      const text = n.post?.record?.text?.trim();
      const handle = n.post?.author?.handle;
      if (!text || !handle) continue;
      chain.push({ handle, displayName: n.post?.author?.displayName, text });
    }
    return chain.slice(-maxTurns);
  } catch {
    return [];
  }
}

type ThreadNode = {
  post?: {
    author?: { handle?: string; displayName?: string };
    record?: { text?: string };
  };
  parent?: ThreadNode;
};

// Já respondemos alguma vez nessa thread? Evita duplicar respostas entre execuções do cron.
export async function alreadyRepliedInThread(
  session: Session,
  postUri: string,
  myDid: string,
): Promise<boolean> {
  try {
    const t = (await getPostThread(session, postUri, 1)) as {
      thread?: { replies?: Array<{ post?: { author?: { did?: string } } }> };
    };
    const replies = t?.thread?.replies ?? [];
    return replies.some((r) => r?.post?.author?.did === myDid);
  } catch {
    return false;
  }
}

export async function replyToPost(
  session: Session,
  args: { text: string; parentUri: string; parentCid: string; rootUri: string; rootCid: string },
): Promise<BlueskyPostResult> {
  const trimmed = args.text.trim();
  if (!trimmed) throw new Error("Reply vazio.");
  const finalText = trimmed.length > 290 ? trimmed.slice(0, 287) + "..." : trimmed;

  const record = {
    $type: "app.bsky.feed.post",
    text: finalText,
    createdAt: new Date().toISOString(),
    langs: ["pt"],
    reply: {
      root: { uri: args.rootUri, cid: args.rootCid },
      parent: { uri: args.parentUri, cid: args.parentCid },
    },
  };

  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bluesky reply falhou (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as { uri: string; cid: string };
  const rkey = data.uri.split("/").pop() ?? "";
  const webUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;
  logger.info({ uri: data.uri, webUrl, len: finalText.length }, "[bluesky] reply published");
  return { uri: data.uri, cid: data.cid, webUrl };
}

// ─── Descoberta + seguir (ronda de alcance) ───

export type BlueskyFoundPost = {
  uri: string;
  cid: string;
  text: string;
  indexedAt: string;
  author: { did: string; handle: string; displayName?: string };
  alreadyFollowing: boolean; // viewer.following presente = já seguimos
  rootUri: string; // pra responder na thread certa
  rootCid: string;
};

// Busca posts recentes por tema (PT-BR). Usado pra a Árvore achar gente nova.
export async function searchPosts(
  session: Session,
  query: string,
  limit = 15,
): Promise<BlueskyFoundPost[]> {
  const data = (await bskyGet(session, "app.bsky.feed.searchPosts", {
    q: query,
    lang: "pt",
    sort: "latest",
    limit: String(Math.min(Math.max(limit, 1), 50)),
  })) as {
    posts?: Array<{
      uri: string;
      cid: string;
      indexedAt?: string;
      author?: { did?: string; handle?: string; displayName?: string; viewer?: { following?: string } };
      record?: { text?: string; reply?: { root?: { uri?: string; cid?: string } } };
    }>;
  };
  return (data.posts ?? [])
    .filter((p) => p.author?.did && p.uri && p.cid)
    .map((p) => ({
      uri: p.uri,
      cid: p.cid,
      text: p.record?.text ?? "",
      indexedAt: p.indexedAt ?? "",
      author: {
        did: p.author!.did!,
        handle: p.author!.handle ?? "",
        displayName: p.author!.displayName,
      },
      alreadyFollowing: Boolean(p.author?.viewer?.following),
      rootUri: p.record?.reply?.root?.uri ?? p.uri,
      rootCid: p.record?.reply?.root?.cid ?? p.cid,
    }));
}

// Segue uma conta (cria registro app.bsky.graph.follow). Idempotência fica a cargo do chamador.
export async function followActor(session: Session, subjectDid: string): Promise<string> {
  const record = {
    $type: "app.bsky.graph.follow",
    subject: subjectDid,
    createdAt: new Date().toISOString(),
  };
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.graph.follow", record }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bluesky follow falhou (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { uri: string };
  logger.info({ subject: subjectDid, uri: data.uri }, "[bluesky] follow created");
  return data.uri;
}

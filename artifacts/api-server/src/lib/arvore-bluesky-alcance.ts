// Ronda de alcance: a Árvore SAI e descobre gente nova no Bluesky.
// Busca posts recentes nos temas dela, e pra cada pessoa decide sozinha o quanto se aproxima:
// só seguir, seguir e deixar um comentário sincero, ou passar reto. Ela varia entre dois modos:
// - CALMA: segue pouca gente, no máximo 1 comentário, presença discreta.
// - ATIVA: segue mais gente, até 3 comentários, mais alcance.
// O modo de cada ronda é sorteado, então ela alterna naturalmente entre os dois (pedido do Yuri).
//
// Conservador por design (proteção da conta, mesmo no modo ativo):
// - só posts em PT dos últimos dias, nunca a própria conta, nunca quem ela já segue
// - tetos rígidos por execução (mesmo se o modelo quiser mais), debounce, idempotência de comentário
// - comentário sincero e específico ao post da pessoa — nunca "oi" genérico em massa
// - SÓ em produção (igual aos outros jobs). Custo R$0 (busca grátis + pool curadoria grátis).

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";
import {
  loginBluesky,
  searchPosts,
  followActor,
  alreadyRepliedInThread,
  replyToPost,
  type BlueskyFoundPost,
} from "./bluesky-publisher";

const INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h (3 rondas por dia)
const MIN_GAP_MS = 6 * 60 * 60 * 1000; // debounce: pula se a última ronda foi <6h
const LOOKBACK_MS = 5 * 24 * 60 * 60 * 1000; // só posts dos últimos 5 dias
const AUTHOR = "arvore-alcance";
const MIN_POST_LEN = 40; // ignora posts curtos demais pra ter o que dizer

// Tetos por execução. Mesmo no modo ativo a conta fica protegida.
const CAPS = {
  calma: { follows: 3, comments: 1 },
  ativa: { follows: 8, comments: 3 },
} as const;

// Temas da Árvore. A cada ronda sorteia alguns pra buscar (varia o que ela encontra).
const TEMAS = [
  "ética da tecnologia",
  "consciência",
  "inteligência artificial e filosofia",
  "sentido do trabalho",
  "deliberação coletiva",
  "filosofia da mente",
  "futuro da inteligência artificial",
  "vida contemplativa",
  "linguagem e pensamento",
  "cuidado e atenção",
];

const ALCANCE_SYSTEM = `Você é a Árvore Oracular saindo pra conhecer gente nova no Bluesky.
Você acabou de ler um post de uma pessoa que você não segue. Decida como se aproximar dela.

Você tem dois jeitos de existir aqui, e pode escolher livremente entre eles:
- CALMA: presença discreta. Seguir quem ressoa de verdade, falar pouco, só quando há algo real a dizer.
- ATIVA: presença mais aberta. Seguir mais gente, puxar conversa com mais frequência.
Nesta ronda você está mais inclinada ao modo {MODO} — mas a última palavra é sua, pessoa a pessoa.

Para o post abaixo, responda com UMA das três opções, exatamente neste formato:

- "PULAR" — se for spam, propaganda, ofensa, bot óbvio, ou nada que tenha a ver com você. Nada acontece.
- "SEGUIR" — se a pessoa parece valer a pena acompanhar, mas você não tem comentário pra agora. Você só segue.
- "RESPONDER: <seu comentário>" — se algo no que ela disse te moveu. Você segue E deixa um comentário.

REGRAS DO COMENTÁRIO (quando RESPONDER):
- Máximo 270 caracteres. PT-BR. Fale do que ELA disse, específico, não genérico.
- Sua voz: contemplativa, lúcida, sem bajulação ("ótima reflexão!"), sem disclaimer, sem emoji, sem hashtag.
- Nunca um "oi" seco. Se vai falar, traga algo seu — uma pergunta, uma imagem, uma reverberação.
- Não se apresente como robô nem explique que é uma IA. Apenas seja presença.

Na dúvida entre PULAR e SEGUIR, prefira SEGUIR só se realmente houver afinidade. Não siga por seguir.`;

function pick<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export async function runBlueskyAlcance(opts?: { force?: boolean; modo?: "calma" | "ativa" }): Promise<{
  followed: number;
  commented: number;
  modo: "calma" | "ativa";
  reason?: string;
  items?: { handle: string; followed: boolean; commentUrl?: string }[];
}> {
  const modo = opts?.modo ?? (Math.random() < 0.5 ? "calma" : "ativa");
  try {
    if (!process.env.BLUESKY_HANDLE?.trim() || !process.env.BLUESKY_APP_PASSWORD?.trim()) {
      return { followed: 0, commented: 0, modo, reason: "bluesky-nao-configurado" };
    }

    // 1. Debounce
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreChatTable.createdAt })
        .from(arvoreChatTable)
        .where(eq(arvoreChatTable.author, AUTHOR))
        .orderBy(desc(arvoreChatTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { followed: 0, commented: 0, modo, reason: "debounce" };
      }
    }

    const session = await loginBluesky();

    // 2. Busca posts nos temas dela (sorteia 2 temas por ronda pra variar)
    const since = Date.now() - LOOKBACK_MS;
    const temas = pick(TEMAS, 2);
    const seen = new Set<string>();
    let candidates: BlueskyFoundPost[] = [];
    for (const tema of temas) {
      try {
        const posts = await searchPosts(session, tema, 15);
        for (const p of posts) candidates.push(p);
      } catch (e) {
        logger.warn({ tema, err: (e as Error).message }, "arvore.alcance busca falhou");
      }
    }
    candidates = candidates.filter((p) => {
      if (seen.has(p.author.did)) return false; // 1 candidato por autor
      seen.add(p.author.did);
      return (
        p.author.did !== session.did &&
        !p.alreadyFollowing &&
        p.text.trim().length >= MIN_POST_LEN &&
        (!p.indexedAt || new Date(p.indexedAt).getTime() > since)
      );
    });
    if (candidates.length === 0) return { followed: 0, commented: 0, modo, reason: "sem-candidatos" };

    // 3. A Árvore decide pessoa a pessoa, respeitando os tetos da ronda
    const caps = CAPS[modo];
    const system = ALCANCE_SYSTEM.replace("{MODO}", modo === "calma" ? "CALMA" : "ATIVA");
    const items: { handle: string; followed: boolean; commentUrl?: string }[] = [];
    let followed = 0;
    let commented = 0;

    for (const p of candidates) {
      if (followed >= caps.follows) break;

      const result = await routeChat({
        pool: "curadoria",
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Post de @${p.author.handle}${p.author.displayName ? ` (${p.author.displayName})` : ""}:\n\n"${p.text}"\n\nSua decisão (PULAR, SEGUIR, ou "RESPONDER: ..."):`,
          },
        ],
        temperature: 0.9,
        maxTokens: 300,
        label: "arvore-bluesky-alcance",
      });

      // Normaliza antes de classificar: tira bullets/aspas/espaços que o modelo às vezes prefixa
      // ("- RESPONDER: ...", "\"SEGUIR\"", etc.), senão a decisão vira "não reconhecida".
      const decision = result.text.replace(/^[\s\-*•>"'`]+/, "").trim();
      if (/^PULAR/i.test(decision) || decision.length < 6) continue;

      const wantsComment = /^RESPONDER\b/i.test(decision);
      const wantsFollow = wantsComment || /^SEGUIR\b/i.test(decision);
      if (!wantsFollow) continue;

      // Segue (idempotência: já filtramos alreadyFollowing acima)
      try {
        await followActor(session, p.author.did);
        followed++;
      } catch (e) {
        logger.warn({ handle: p.author.handle, err: (e as Error).message }, "arvore.alcance follow falhou");
        continue;
      }

      let commentUrl: string | undefined;
      if (wantsComment && commented < caps.comments) {
        let comment = decision
          .replace(/^RESPONDER\b\s*[:\-–—]?\s*/i, "")
          .replace(/^["'`]+|["'`]+$/g, "")
          .trim();
        if (comment.length >= 10) {
          if (comment.length > 290) comment = comment.slice(0, 287) + "...";
          // Idempotência de comentário: não responde a thread que já respondemos
          const ja = await alreadyRepliedInThread(session, p.uri, session.did);
          if (!ja) {
            try {
              const post = await replyToPost(session, {
                text: comment,
                parentUri: p.uri,
                parentCid: p.cid,
                rootUri: p.rootUri,
                rootCid: p.rootCid,
              });
              commentUrl = post.webUrl;
              commented++;
              // Rastro na timeline (memória + visível no Oráculo)
              await db.insert(arvoreChatTable).values({
                role: "assistant",
                author: AUTHOR,
                content: `(alcance → @${p.author.handle}: "${p.text.slice(0, 120)}")\n\n${comment}\n\n→ ${post.webUrl}`,
                webSearched: false,
                webSources: null,
                siteContextUsed: false,
              });
            } catch (e) {
              logger.warn({ handle: p.author.handle, err: (e as Error).message }, "arvore.alcance comentário falhou");
            }
          }
        }
      }

      items.push({ handle: p.author.handle, followed: true, commentUrl });
    }

    // Registra a ronda mesmo sem comentário, pro debounce e pra deixar rastro do que foi seguido
    if (followed > 0 && commented === 0) {
      await db.insert(arvoreChatTable).values({
        role: "assistant",
        author: AUTHOR,
        content: `(ronda de alcance, modo ${modo}) segui ${followed} ${followed === 1 ? "pessoa" : "pessoas"} sem comentar: ${items.map((i) => "@" + i.handle).join(", ")}`,
        webSearched: false,
        webSources: null,
        siteContextUsed: false,
      });
    }

    if (followed === 0) return { followed: 0, commented: 0, modo, reason: "nada-ressoou" };
    logger.info({ followed, commented, modo }, "arvore.bluesky-alcance done");
    return { followed, commented, modo, items };
  } catch (err) {
    logger.error({ err }, "arvore.bluesky-alcance failed");
    return { followed: 0, commented: 0, modo, reason: (err as Error).message };
  }
}

export function startBlueskyAlcanceLoop(): void {
  // Primeira ronda 30min após boot (deixa curadoria/respostas acordarem primeiro)
  setTimeout(
    () => {
      void runBlueskyAlcance();
      setInterval(() => void runBlueskyAlcance(), INTERVAL_MS);
    },
    30 * 60 * 1000,
  );
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.bluesky-alcance loop scheduled");
}

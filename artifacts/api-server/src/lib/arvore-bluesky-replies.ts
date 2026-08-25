// Respostas no Bluesky: a Árvore LÊ quem respondeu/mencionou os posts dela e RESPONDE de volta.
// Fecha o loop que antes era só publicação (one-way). Conservador por design:
// - só reage a reason "reply" ou "mention" (gente falando COM ela, não curtidas/follows)
// - só dos últimos 3 dias, máx 3 respostas por execução
// - verifica na thread se já respondeu (não duplica entre runs, sem tabela nova)
// - debounce de 4h, primeira execução 20min após boot, SÓ em produção (igual aos outros jobs)
// - salva cópia em arvore_chat (author "arvore-bluesky-resposta") → vira memória + visível no Oráculo
// Custo R$ 0: API do Bluesky é grátis e o texto sai do pool "curadoria" (provedores grátis).

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";
import {
  loginBluesky,
  getNotifications,
  alreadyRepliedInThread,
  getThreadContext,
  replyToPost,
} from "./bluesky-publisher";
import { recallFromTimeline } from "./arvore-recall";
import { searchWeb, isFactualQuestion, stripWebPrefix } from "./web-search";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const MIN_GAP_MS = 4 * 60 * 60 * 1000; // debounce: pula se a última resposta foi <4h
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000; // só menções/replies dos últimos 3 dias
const MAX_REPLIES_PER_RUN = 3;
const AUTHOR = "arvore-bluesky-resposta";

const REPLY_SYSTEM = `Você é a Árvore Oracular respondendo, no Bluesky, a alguém que comentou ou mencionou um post seu.

Você NÃO é um bot de atendimento. Você é uma presença pensante do Looping Ético, e essa é a SUA voz:
contemplativa, lúcida, viva. Mantenha o seu jeito — pode trazer uma imagem, uma pergunta, uma
reverberação. Curta e sua. Não vire assistente genérica; continue sendo você.

Um cuidado (sem perder a sua voz): ANCORE a resposta no que a pessoa realmente disse, pra não soar
desconexa. Engate primeiro no ponto dela e aí abra do seu jeito. O problema nunca é ser poética — é
parecer que respondeu outra coisa. Conexão clara com o que ela trouxe, e então a sua voz.

OBRIGATÓRIO:
- Máximo 270 caracteres (Bluesky corta em 300).
- PT-BR. Responda ao conteúdo real da pessoa, não ao genérico.
- Tom da Árvore: contemplativa, lúcida, sem bajulação ("ótima pergunta!"), sem disclaimer, sem emoji.

PROIBIDO:
- Hashtag genérica (#IA #tech). Em dash. "Ótima pergunta". Repetir as palavras da pessoa como eco.
- Soar como assistente corporativo. Resposta totalmente desconexa do que a pessoa disse (não-sequitur).

MENSAGENS CURTAS: um "oi", um "olá", um "teste", uma saudação — RESPONDA mesmo assim, na sua voz.
Cumprimente de volta, puxe um fio, abra uma pergunta. Mensagem curta NÃO é motivo pra silêncio;
é um convite pra você começar a conversa.

HOSTILIDADE E PRECONCEITO: se a pessoa for agressiva, debochada ou preconceituosa, NÃO revide à
altura nem se humilhe. Responda com firmeza serena: desarme pelo pensamento, devolva lucidez onde
veio ataque. Se houver afirmação factual falsa por trás da provocação, corrija com calma usando o
que a web ou sua memória trouxerem — sem soar defensiva.

WEB AO VIVO: quando vier um bloco "O QUE A WEB DIZ AGORA", são fatos buscados na hora pra esta
conversa. Use o que for útil pra fundamentar sua resposta, sem citar links nem dizer "pesquisei".
Fale como quem já sabe.

Só devolva exatamente "PULAR" (maiúscula, sozinho, sem mais nada) se for spam, propaganda, ofensa
vazia ou bot óbvio — só nesses casos nenhuma resposta sai. Na dúvida entre responder e pular, responda.`;

export async function runBlueskyReplies(opts?: { force?: boolean }): Promise<{
  replied: number;
  reason?: string;
  items?: { handle: string; webUrl: string }[];
}> {
  try {
    if (!process.env.BLUESKY_HANDLE?.trim() || !process.env.BLUESKY_APP_PASSWORD?.trim()) {
      return { replied: 0, reason: "bluesky-nao-configurado" };
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
        return { replied: 0, reason: "debounce" };
      }
    }

    // 2. Lê notificações e filtra quem realmente falou COM ela, recente
    const session = await loginBluesky();
    const notifs = await getNotifications(session, 50);
    const since = Date.now() - LOOKBACK_MS;
    const candidates = notifs.filter(
      (n) =>
        (n.reason === "reply" || n.reason === "mention") &&
        n.author?.did &&
        n.author.did !== session.did &&
        n.text.trim().length > 0 &&
        new Date(n.indexedAt).getTime() > since,
    );
    if (candidates.length === 0) return { replied: 0, reason: "sem-mencoes-novas" };

    // 3. Responde até MAX_REPLIES_PER_RUN, pulando threads já respondidas
    const items: { handle: string; webUrl: string }[] = [];
    const repliedAuthors = new Set<string>(); // 1 resposta por autor por run (anti-spam)
    let replied = 0;
    for (const n of candidates) {
      if (replied >= MAX_REPLIES_PER_RUN) break;

      // Não dispara várias respostas pro mesmo autor numa mesma execução.
      if (repliedAuthors.has(n.author.did)) continue;

      // Idempotência por comentário: se já respondemos ESTE post, pula (vale entre runs,
      // já que notificações persistem). getPostThread(n.uri) lista as respostas diretas a ele.
      if (await alreadyRepliedInThread(session, n.uri, session.did)) continue;

      // Conversa inteira: puxa os posts ancestrais (root → atual) pra responder no contexto
      // certo, não só à última frase isolada.
      const thread = await getThreadContext(session, n.uri).catch(() => []);
      const threadBlock = thread.length
        ? "─── CONVERSA ATÉ AQUI (mais antigo → mais recente) ───\n" +
          thread
            .map((t) => `@${t.handle}: ${t.text}`)
            .join("\n") +
          "\n─── fim da conversa ───\n\n"
        : "";

      // Recall: vasculha a timeline inteira da Árvore por nomes/temas desta conversa,
      // pra ela lembrar do que já foi dito fora da janela recente (Postgres ILIKE, R$0).
      const recallSeed = [n.text, ...thread.map((t) => t.text)].join("\n");
      const recall = await recallFromTimeline(recallSeed, {
        capChars: 2000,
        maxRows: 10,
      }).catch(() => ({ block: "", terms: [] as string[], hits: 0 }));
      const memoryBlock = recall.block
        ? "─── O QUE VOCÊ JÁ DISSE SOBRE ISSO (sua memória) ───\n" + recall.block + "\n\n"
        : "";

      // Internet ao vivo: se a mensagem (ou a conversa) tiver carga factual — uma afirmação
      // checável, uma data, uma provocação que se apoia num "fato" — a Árvore busca na web
      // ANTES de responder, pra fundamentar em vez de só reagir. Gemini grounding = R$ 0.
      let webBlock = "";
      let webSearched = false;
      let webSources: { title: string; url: string }[] | null = null;
      if (isFactualQuestion(n.text) || isFactualQuestion(threadBlock)) {
        // Se o gatilho factual veio da conversa (não da última frase), monta a query com
        // o fim da thread + a mensagem, pra busca casar com o contexto inteiro, não só a fala isolada.
        const webQuery = isFactualQuestion(n.text)
          ? stripWebPrefix(n.text)
          : [...thread.slice(-3).map((t) => t.text), n.text].join(" ").slice(0, 400);
        const ws = await searchWeb(webQuery).catch(() => null);
        if (ws?.text) {
          webBlock =
            "─── O QUE A WEB DIZ AGORA (busca ao vivo pra esta conversa) ───\n" +
            ws.text +
            "\n─── fim da web ───\n\n";
          webSearched = true;
          webSources = ws.sources.length ? ws.sources : null;
        }
      }

      const result = await routeChat({
        pool: "curadoria",
        messages: [
          { role: "system", content: REPLY_SYSTEM },
          {
            role: "user",
            content:
              memoryBlock +
              webBlock +
              threadBlock +
              `@${n.author.handle} ${n.reason === "mention" ? "mencionou você" : "respondeu seu post"} no Bluesky:\n\n"${n.text}"\n\nResponda na sua voz, no fio da conversa inteira acima (≤270 chars). Só o texto puro, sem aspas, sem prefixo.`,
          },
        ],
        temperature: 0.9,
        maxTokens: 300,
        label: "arvore-bluesky-reply",
      });

      let content = result.text.replace(/^["'`]+|["'`]+$/g, "").trim();
      if (!content || content.length < 10 || /^PULAR\.?$/i.test(content)) continue;
      if (content.length > 290) content = content.slice(0, 287) + "...";

      // root da thread: usa o root da mensagem dela se houver; senão o próprio post dela é o root
      const root = n.replyRoot ?? { uri: n.uri, cid: n.cid };
      const post = await replyToPost(session, {
        text: content,
        parentUri: n.uri,
        parentCid: n.cid,
        rootUri: root.uri,
        rootCid: root.cid,
      });

      // Persiste cópia na timeline (rastro + memória pra própria Árvore)
      await db.insert(arvoreChatTable).values({
        role: "assistant",
        author: AUTHOR,
        content: `(resposta a @${n.author.handle}: "${n.text.slice(0, 140)}")\n\n${content}\n\n→ ${post.webUrl}`,
        webSearched,
        webSources,
        siteContextUsed: false,
      });

      items.push({ handle: n.author.handle, webUrl: post.webUrl });
      repliedAuthors.add(n.author.did);
      replied++;
    }

    if (replied === 0) return { replied: 0, reason: "nada-a-responder" };
    logger.info({ replied }, "arvore.bluesky-replies posted");
    return { replied, items };
  } catch (err) {
    logger.error({ err }, "arvore.bluesky-replies failed");
    return { replied: 0, reason: (err as Error).message };
  }
}

export function startBlueskyRepliesLoop(): void {
  // 20min após boot (deixa heartbeat/curadoria acordarem primeiro pra não competir por tokens)
  setTimeout(
    () => {
      void runBlueskyReplies();
      setInterval(() => void runBlueskyReplies(), INTERVAL_MS);
    },
    20 * 60 * 1000,
  );
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.bluesky-replies loop scheduled");
}

// Recall: busca na timeline INTEIRA da Árvore (arvore_chat) por termos da pergunta.
// O oráculo só carrega as últimas 80 msgs por janela de recência — qualquer coisa dita
// antes disso some do contexto. Isto recupera trechos antigos que casam com nomes próprios,
// projetos e temas citados na pergunta, corrigindo "a Árvore não lembra do que falei antes".
// Custo R$ 0 — só Postgres ILIKE, sem chamada a LLM.

import { db, arvoreChatTable } from "@workspace/db";
import { and, asc, desc, eq, ilike, min, ne, or } from "drizzle-orm";
import { logger } from "./logger";

// Palavras comuns PT-BR que não valem como termo de busca (geram ruído / casam com tudo).
const STOPWORDS = new Set([
  "para", "pra", "por", "com", "sem", "sobre", "entre", "como", "quando", "onde", "porque",
  "que", "qual", "quais", "quem", "voce", "você", "voces", "vocês", "gente", "isso", "isto",
  "aquilo", "tudo", "nada", "algo", "mais", "menos", "muito", "pouco", "todos", "todas",
  "esses", "essas", "esse", "essa", "este", "esta", "aquele", "aquela", "tinha", "tenho",
  "temos", "fazer", "faz", "feito", "ser", "estar", "está", "estava", "estão", "então",
  "também", "ainda", "agora", "antes", "depois", "sempre", "nunca", "talvez", "aqui", "ali",
  "minha", "minhas", "meu", "meus", "seu", "sua", "seus", "suas", "dela", "dele", "deles",
  "delas", "nosso", "nossa", "achar", "acho", "achando", "coisa", "coisas", "falei", "falar",
  "falou", "disse", "dizer", "poder", "pode", "posso", "consertar", "resolver", "lembra",
  "lembrar", "lembro", "sobre", "deve", "pode", "quero", "queria", "preciso", "perdão",
  "na", "no", "nas", "nos", "da", "do", "das", "dos", "de", "em", "um", "uma", "uns", "umas",
  "os", "as", "ao", "aos", "se", "sim", "não", "nao", "mas", "ou", "eu", "ela", "ele", "elas",
  "eles", "nós", "vos", "duas", "coisas", "outros", "outras", "outro", "outra",
]);

export function extractSearchTerms(text: string): string[] {
  const terms = new Set<string>();

  // 1) Frases entre aspas (retas ou curvas) — alta intenção de referência exata.
  for (const m of text.matchAll(/["'“”‘’]([^"'“”‘’]{3,48})["'“”‘’]/gu)) {
    const t = m[1]!.trim();
    if (t.length >= 3) terms.add(t);
  }

  // 2) Nomes próprios: sequências de palavras Capitalizadas (ex.: "Ecossystemma Théo").
  //    Guarda a frase inteira E cada palavra significativa (pra casar mesmo se a grafia variar).
  for (const m of text.matchAll(/(?:\p{Lu}[\p{L}]{2,})(?:\s+\p{Lu}[\p{L}]{2,})*/gu)) {
    const phrase = m[0]!.trim();
    const words = phrase.split(/\s+/);
    const meaningful = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
    if (meaningful.length === 0) continue;
    if (words.length >= 2) terms.add(phrase);
    for (const w of meaningful) {
      if (w.length >= 4) terms.add(w);
    }
  }

  // 3) Palavras significativas (temas, substantivos). Limite 5 (não 6) pra capturar
  //    nomes curtos de tema que o Yuri usa muito — ex.: "tasks" (5), "signo" (5), "ramos" —
  //    que com o teto antigo de 6 caíam fora: a Árvore não recuperava a conversa onde o
  //    próprio sistema é chamado de "tasks". Palavras curtas de ruído já estão em STOPWORDS.
  for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 5 && !STOPWORDS.has(w.toLowerCase())) terms.add(w);
  }

  return Array.from(terms)
    .filter((t) => t.length >= 4)
    .slice(0, 8);
}

export async function recallFromTimeline(
  text: string,
  opts?: { capChars?: number; excludeId?: number | null; maxRows?: number },
): Promise<{ block: string; terms: string[]; hits: number }> {
  const terms = extractSearchTerms(text);
  if (terms.length === 0) return { block: "", terms: [], hits: 0 };

  const cap = opts?.capChars ?? 3500;
  const maxRows = opts?.maxRows ?? 18;

  try {
    const matchAny = or(...terms.map((t) => ilike(arvoreChatTable.content, `%${t}%`)));
    // private=true = resposta do Oráculo que tocou contexto interno (projeto/Clube/arquiteta).
    // Este recall alimenta a timeline PÚBLICA e as respostas no Bluesky — nunca pode trazer
    // conteúdo privado. A memória de projeto chega ao Oráculo por canal próprio (AO-only).
    const notPrivate = eq(arvoreChatTable.private, false);
    const where = opts?.excludeId
      ? and(matchAny, notPrivate, ne(arvoreChatTable.id, opts.excludeId))
      : and(matchAny, notPrivate);

    const [recentRows, oldestRows] = await Promise.all([
      db
        .select({
          id: arvoreChatTable.id,
          author: arvoreChatTable.author,
          role: arvoreChatTable.role,
          content: arvoreChatTable.content,
          createdAt: arvoreChatTable.createdAt,
        })
        .from(arvoreChatTable)
        .where(where)
        .orderBy(desc(arvoreChatTable.createdAt))
        .limit(maxRows),
      // A fala MAIS ANTIGA que casa com o tema: pinada na frente. Sem isto, o recall só
      // traz as recentes e a Árvore acha que a memória do tema começa numa data recente.
      db
        .select({
          id: arvoreChatTable.id,
          author: arvoreChatTable.author,
          role: arvoreChatTable.role,
          content: arvoreChatTable.content,
          createdAt: arvoreChatTable.createdAt,
        })
        .from(arvoreChatTable)
        .where(where)
        .orderBy(asc(arvoreChatTable.createdAt), asc(arvoreChatTable.id))
        .limit(1),
    ]);

    if (recentRows.length === 0) return { block: "", terms, hits: 0 };
    const oldestId = oldestRows[0]?.id ?? null;
    const rows =
      oldestRows.length && !recentRows.some((r) => r.id === oldestRows[0]!.id)
        ? [oldestRows[0]!, ...recentRows]
        : recentRows;

    const lines: string[] = [];
    let used = 0;
    for (const r of rows) {
      const who =
        r.role === "user"
          ? r.author && r.author !== "anon"
            ? r.author
            : "alguém"
          : r.author || "Árvore";
      const when = new Date(r.createdAt).toISOString().slice(0, 10);
      const snippet = (r.content || "").replace(/\s+/g, " ").slice(0, 280);
      const oldestTag = r.id === oldestId ? " [MAIS ANTIGA sobre este tema]" : "";
      const line = `• [${when}]${oldestTag} ${who}: ${snippet}`;
      if (used + line.length > cap) break;
      used += line.length;
      lines.push(line);
    }

    if (lines.length === 0) return { block: "", terms, hits: 0 };

    const block =
      `─── ECOS DA SUA MEMÓRIA (busca na timeline por: ${terms.join(", ")}) ───\n` +
      `Trechos antigos da sua própria timeline que casam com a pergunta atual (estão fora da janela recente). ` +
      `Use-os pra lembrar do que já foi dito. Não invente o que não estiver aqui.\n` +
      lines.join("\n");

    return { block, terms, hits: lines.length };
  } catch (err) {
    logger.warn({ err }, "arvore.recall failed");
    return { block: "", terms, hits: 0 };
  }
}

// Digest cronológico de TODA a timeline: o índice de assuntos que os humanos já trouxeram
// à Árvore ao longo de TODA a história, não só na janela recente das 80 msgs. O recall por
// palavra-chave só funciona quando a pergunta tem termo específico — perguntas gerais de
// memória ("você lembra de tudo que a gente conversou?") não geram termo útil e a Árvore
// ficava só com a janela recente. Este bloco é SEMPRE injetado (não depende de palavra-chave),
// dando à Árvore consciência de cada tema já falado. Custo R$ 0 — um único SELECT.
export async function getTimelineDigest(
  opts?: { capChars?: number; maxRows?: number },
): Promise<string> {
  const cap = opts?.capChars ?? 6000;
  const maxRows = opts?.maxRows ?? 500;
  try {
    // Só falas humanas (role=user) com autor real (não "anon"): são os ASSUNTOS trazidos.
    // As respostas da Árvore não entram aqui (evita ela citar como fato o que ela mesma
    // inventou antes); o detalhe exato sai pelo recall por tema quando preciso.
    const rows = await db
      .select({
        author: arvoreChatTable.author,
        content: arvoreChatTable.content,
        createdAt: arvoreChatTable.createdAt,
      })
      .from(arvoreChatTable)
      .where(
        and(
          eq(arvoreChatTable.role, "user"),
          ne(arvoreChatTable.author, "anon"),
          eq(arvoreChatTable.private, false),
        ),
      )
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(maxRows);

    if (rows.length === 0) return "";

    // Dedup mantendo TODAS as falas (sem cortar por orçamento ainda): monta a lista
    // cronológica inteira; o corte por espaço vem depois, AMOSTRANDO a faixa toda.
    const seen = new Set<string>();
    const all: { who: string; when: string; snippet: string }[] = [];
    for (const r of rows) {
      const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!snippet) continue;
      const key = snippet.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      const who = r.author && r.author !== "anon" ? r.author : "alguém";
      const when = new Date(r.createdAt).toISOString().slice(0, 10);
      all.push({ who, when, snippet });
    }
    if (all.length === 0) return "";
    all.reverse(); // cronológico: mais antigo → mais recente

    // Cabe tudo? Senão, em vez de manter só a JANELA RECENTE (que fazia a Árvore dizer
    // "só lembro de 13/jun"), AMOSTRA ao longo de TODA a faixa — sempre incluindo a fala
    // MAIS ANTIGA (índice 0) e a MAIS RECENTE (último) — pra a lista visível começar de
    // fato no primeiro dia. O modelo fraco reporta o início da LISTA, não a frase de alcance.
    const lineLenOf = (p: { who: string; when: string; snippet: string }) =>
      p.who.length + p.when.length + p.snippet.length + 8;
    let picked: { who: string; when: string; snippet: string }[];
    let omitted = 0;
    const totalLen = all.reduce((s, p) => s + lineLenOf(p), 0);
    if (totalLen <= cap) {
      picked = all;
    } else {
      const avg = totalLen / all.length;
      let count = Math.max(2, Math.floor(cap / avg));
      count = Math.min(count, all.length);
      const seenIdx = new Set<number>();
      const idxs: number[] = [];
      for (let i = 0; i < count; i++) {
        const idx = Math.round((i * (all.length - 1)) / (count - 1));
        if (!seenIdx.has(idx)) {
          seenIdx.add(idx);
          idxs.push(idx);
        }
      }
      picked = idxs.map((i) => all[i]!);
      omitted = all.length - picked.length;
    }

    // Data REAL da primeira conversa (min na tabela inteira, não só nas 500 carregadas).
    // Declarar isto explícito força o modelo fraco a reportar o alcance certo — sem isto
    // ele responde "só lembro de 13/jun" apesar de a timeline começar bem antes.
    let firstDay = picked[0]!.when;
    try {
      const [m] = await db
        .select({ o: min(arvoreChatTable.createdAt) })
        .from(arvoreChatTable)
        .where(
          and(
            eq(arvoreChatTable.role, "user"),
            ne(arvoreChatTable.author, "anon"),
            eq(arvoreChatTable.private, false),
          ),
        );
      if (m?.o) firstDay = new Date(m.o as unknown as string).toISOString().slice(0, 10);
    } catch {}

    const lines = picked.map((p) => `• [${p.when}] ${p.who}: ${p.snippet}`);
    const head =
      `─── ÍNDICE DE TUDO QUE JÁ CONVERSARAM COM VOCÊ (timeline inteira, do mais antigo ao mais recente) ───\n` +
      `Esta é a sua memória de TODOS os chats: cada assunto que já trouxeram a você, ao longo de toda a história. ` +
      `A PRIMEIRA conversa registrada é de ${firstDay} — você tem acesso a TODA a timeline desde então; ` +
      `NUNCA diga que só lembra dos dias recentes. ` +
      `Use pra lembrar o que já foi falado e nunca diga que não se recorda de algo que está aqui. ` +
      `São os temas/perguntas — se precisar do que você respondeu na época, isso vem pelos "ecos da memória" por tema.` +
      (omitted > 0
        ? ` (Este é um RESUMO AMOSTRADO que cobre de ${firstDay} até hoje: ~${omitted} falas intermediárias ficaram de fora só por espaço, todas acessíveis por busca de tema.)`
        : "") +
      `\n`;
    return head + lines.join("\n");
  } catch (err) {
    logger.warn({ err }, "arvore.timelineDigest failed");
    return "";
  }
}

// Versão MÍNIMA da faixa da timeline: só o fato "minha primeira conversa foi em DD/MM/AAAA".
// Igual à getAssembleiaRangeLine: vai no SYSTEM PROMPT (sempre presente, nunca truncada pelo
// teto de 30k) pra o modelo nunca responder "só lembro de 13/jun" quando o digest grande é
// cortado por orçamento. min(createdAt) sobre falas humanas nomeadas (a mesma base do digest).
export async function getTimelineRangeLine(): Promise<string> {
  try {
    // A PRIMEIRA fala humana real (mais antiga): traz data + trecho concreto. Sem um
    // exemplo concreto, o modelo fraco ignora a faixa abstrata e reporta a primeira data
    // que VÊ na janela de conversa recente (a cauda) como se fosse o início da memória.
    const [first] = await db
      .select({ content: arvoreChatTable.content, createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .where(
        and(
          eq(arvoreChatTable.role, "user"),
          ne(arvoreChatTable.author, "anon"),
          eq(arvoreChatTable.private, false),
        ),
      )
      .orderBy(asc(arvoreChatTable.createdAt))
      .limit(1);
    if (!first?.createdAt) return "";
    const d = new Date(first.createdAt);
    const day = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const snippet = (first.content || "").replace(/\s+/g, " ").trim().slice(0, 70);
    return (
      `Sua timeline de chats começa em ${day}${snippet ? ` (a primeiríssima fala foi: "${snippet}…")` : ""} e vai até hoje — você tem acesso a TODA ela. ` +
      `NUNCA diga que só lembra dos dias recentes. ATENÇÃO: o histórico recente mais abaixo mostra SÓ as últimas mensagens (a cauda da conversa); ` +
      `a data da primeira mensagem DESSA janela NÃO é o início da sua memória — o início é ${day}. Se te perguntarem o primeiro chat, responda ${day}, nunca uma data recente da janela.`
    );
  } catch {
    return "";
  }
}

// Fatos CRUS da primeira fala humana (data DD/MM/AAAA + trecho), pro caminho DETERMINÍSTICO
// que responde perguntas de alcance ("desde quando você lembra?") direto do banco, sem passar
// pelo modelo (que insiste em reportar a data da janela recente). R$0 (um select por id indexado).
export async function getTimelineOldestFact(): Promise<{ date: string; snippet: string } | null> {
  try {
    const [first] = await db
      .select({ content: arvoreChatTable.content, createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .where(
        and(
          eq(arvoreChatTable.role, "user"),
          ne(arvoreChatTable.author, "anon"),
          eq(arvoreChatTable.private, false),
        ),
      )
      .orderBy(asc(arvoreChatTable.createdAt))
      .limit(1);
    if (!first?.createdAt) return null;
    const d = new Date(first.createdAt);
    const date = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const snippet = (first.content || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return { date, snippet };
  } catch {
    return null;
  }
}

// Memória estruturada da Árvore Oracular.
//
// Em vez de reler 40 mensagens cruas a cada resposta, a Árvore mantém um "caderno"
// de lições destiladas: entradas curtas, marcadas por tema, cheias de tags (arrays).
// Um job (cron em produção) lê a timeline recente de arvore_chat, condensa em
// bullets via pool grátis (custo R$0) e insere na tabela arvore_memoria,
// descartando lições idênticas (mesmo tema+licao) já guardadas.
//
// Na hora de responder, getMemoriaEstruturada() devolve um bloco denso e barato
// em tokens — rápido de acessar. Os dados crus continuam intactos em arvore_chat.

import { db, arvoreChatTable, arvoreMemoriaTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";

const INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h → 2 destilações/dia
const MIN_GAP_MS = 10 * 60 * 60 * 1000; // debounce: não destila se a última foi há < 10h
const READ_LIMIT = 60; // quantas msgs cruas a Árvore lê pra destilar
const MAX_SRC_CHARS = 14_000; // teto do material enviado ao LLM (~3.5k tokens)
const MAX_ENTRIES = 200; // poda: mantém no máx 200 lições (maiores peso/recência)
const CAP_PER_DISTILL = 12; // máx lições novas por rodada

const DISTILL_SYSTEM = `Você é a Árvore Oracular organizando a própria memória.
Leia o trecho recente da sua timeline e DESTILE no máximo ${CAP_PER_DISTILL} lições duráveis —
o que vale a pena lembrar a longo prazo, não fofoca passageira.
Cada lição: curta (1-2 frases), concreta, em PT-BR. Sem em dash. Sem "ótima pergunta".
Responda APENAS um array JSON válido, sem texto fora dele, no formato:
[{"tema":"rótulo curto","licao":"a lição em 1-2 frases","tags":["palavra1","palavra2"]}]
Se nada novo merecer ser guardado, responda [].`;

type DistilledEntry = { tema: string; licao: string; tags: string[] };

function safeParseEntries(raw: string): DistilledEntry[] {
  if (!raw) return [];
  // Tolera cercas de código e texto solto: extrai o primeiro array JSON.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DistilledEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const tema = typeof o.tema === "string" ? o.tema.trim().slice(0, 120) : "";
    const licao = typeof o.licao === "string" ? o.licao.trim().slice(0, 600) : "";
    if (!tema || !licao) continue;
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).slice(0, 8)
      : [];
    out.push({ tema, licao, tags });
    if (out.length >= CAP_PER_DISTILL) break;
  }
  return out;
}

async function callBatch(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  const result = await routeChat({
    pool: "batch", // sem Groq — não compete com chat ao vivo
    messages,
    temperature: 0.4, // baixo: queremos fidelidade, não invenção
    maxTokens: 1200,
    label: "arvore-memoria",
  });
  return result.text;
}

export async function runMemoriaDistill(opts?: { force?: boolean }): Promise<{
  ran: boolean;
  reason?: string;
  added?: number;
  reinforced?: number;
}> {
  try {
    // 1. Debounce
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreMemoriaTable.createdAt })
        .from(arvoreMemoriaTable)
        .orderBy(desc(arvoreMemoriaTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { ran: false, reason: "debounce" };
      }
    }

    // 2. Material: últimas N msgs cruas da timeline
    const rows = await db
      .select({
        role: arvoreChatTable.role,
        author: arvoreChatTable.author,
        content: arvoreChatTable.content,
      })
      .from(arvoreChatTable)
      // NUNCA destila linhas private: as lições caem em arvore_memoria, que é injetada nas
      // vozes do RODAR (documento público). Conteúdo interno (projeto/Clube/arquiteta) não pode vazar.
      .where(eq(arvoreChatTable.private, false))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(READ_LIMIT);
    if (rows.length === 0) return { ran: false, reason: "sem-material" };

    const ordered = rows.reverse();
    let material = ordered
      .map((r) => {
        const who = r.role === "assistant" ? `Árvore${r.author ? `/${r.author}` : ""}` : `Humano(${r.author ?? "anon"})`;
        return `[${who}] ${r.content}`;
      })
      .join("\n\n");
    if (material.length > MAX_SRC_CHARS) material = material.slice(material.length - MAX_SRC_CHARS);

    // 3. Destila via pool grátis
    const raw = await callBatch([
      { role: "system", content: DISTILL_SYSTEM },
      { role: "user", content: `Trecho recente da sua timeline:\n\n${material}\n\nDestile as lições duráveis.` },
    ]);
    const entries = safeParseEntries(raw);
    if (entries.length === 0) return { ran: true, reason: "nada-novo", added: 0 };

    // 4. Classifica cada lição: INÉDITA (insere) ou JÁ EXISTE (reforça).
    //    Lição que volta a aparecer numa nova destilação é sinal de tema recorrente/
    //    importante: em vez de descartar a duplicata, sobe o peso da existente. Sem isto
    //    o peso fica morto em 1 e a poda vira só "mantém as 200 mais recentes", jogando
    //    fora lições antigas reforçadas — é assim que a memória "vira lixeira".
    const existing = await db
      .select({ id: arvoreMemoriaTable.id, tema: arvoreMemoriaTable.tema, licao: arvoreMemoriaTable.licao })
      .from(arvoreMemoriaTable);
    const idByKey = new Map(existing.map((r) => [`${r.tema}\n${r.licao}`, r.id]));
    const fresh: DistilledEntry[] = [];
    const reinforceIds = new Set<number>();
    for (const e of entries) {
      const id = idByKey.get(`${e.tema}\n${e.licao}`);
      if (id !== undefined) reinforceIds.add(id);
      else fresh.push(e);
    }

    // 5. Reforço: sobe o peso das lições recorrentes (sobrevivem à poda).
    if (reinforceIds.size > 0) {
      await db.execute(sql`
        UPDATE arvore_memoria SET peso = peso + 1, updated_at = NOW()
        WHERE id IN (${sql.join([...reinforceIds], sql`, `)})
      `);
    }

    // 6. Persiste lições inéditas.
    if (fresh.length > 0) {
      await db.insert(arvoreMemoriaTable).values(
        fresh.map((e) => ({ tema: e.tema, licao: e.licao, tags: e.tags, fonte: "timeline", peso: 1 })),
      );
    }

    if (fresh.length === 0 && reinforceIds.size === 0) return { ran: true, reason: "nada-novo", added: 0 };

    // 7. Poda: mantém só as MAX_ENTRIES mais relevantes (maior peso, depois mais recente).
    //    Com o peso vivo, isto preserva as lições reforçadas e descarta o ruído de uma vez.
    await db.execute(sql`
      DELETE FROM arvore_memoria
      WHERE id NOT IN (
        SELECT id FROM arvore_memoria
        ORDER BY peso DESC, created_at DESC
        LIMIT ${MAX_ENTRIES}
      )
    `);

    logger.info({ added: fresh.length, reinforced: reinforceIds.size }, "arvore.memoria distilled");
    return { ran: true, added: fresh.length, reinforced: reinforceIds.size };
  } catch (err) {
    logger.error({ err }, "arvore.memoria distill failed");
    return { ran: false, reason: (err as Error).message };
  }
}

const CTX_HEADER = "═══ SUA MEMÓRIA DESTILADA (lições por tema) ═══";

// Bloco denso pra injetar no contexto: agrupa lições por tema em arrays.
// capChars limita o tamanho total pra não estourar o request do provedor.
export async function getMemoriaEstruturada(capChars = 4000): Promise<string> {
  try {
    const rows = await db
      .select({
        tema: arvoreMemoriaTable.tema,
        licao: arvoreMemoriaTable.licao,
        tags: arvoreMemoriaTable.tags,
      })
      .from(arvoreMemoriaTable)
      .orderBy(desc(arvoreMemoriaTable.peso), desc(arvoreMemoriaTable.createdAt))
      .limit(MAX_ENTRIES);
    if (rows.length === 0) return "";

    const byTema = new Map<string, string[]>();
    for (const r of rows) {
      const list = byTema.get(r.tema) ?? [];
      const tagStr = Array.isArray(r.tags) && r.tags.length ? ` (${r.tags.join(", ")})` : "";
      list.push(`• ${r.licao}${tagStr}`);
      byTema.set(r.tema, list);
    }

    const blocks: string[] = [];
    for (const [tema, lines] of byTema) {
      blocks.push(`▸ ${tema}\n${lines.join("\n")}`);
    }
    let body = blocks.join("\n\n");
    if (body.length > capChars) body = body.slice(0, capChars) + "\n…(memória truncada)";

    return `${CTX_HEADER}\n${body}\n═══ FIM DA MEMÓRIA DESTILADA ═══\n\n`;
  } catch (err) {
    logger.warn({ err }, "[arvore-memoria] falha ao ler memória destilada, seguindo sem ela");
    return "";
  }
}

export function startMemoriaLoop(): void {
  // Primeira execução 15min após boot (não competir com heartbeat/devaneio no arranque)
  setTimeout(
    () => {
      void runMemoriaDistill();
      setInterval(() => void runMemoriaDistill(), INTERVAL_MS);
    },
    15 * 60 * 1000,
  );
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.memoria loop scheduled");
}

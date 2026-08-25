// Caderno seletivo da Árvore Oracular (o Playground como memória dela).
//
// Diferente da memória destilada (arvore-memoria.ts), que é um resumo automático de
// lições por tema injetado nas vozes do RODAR, o caderno é a memória SELETIVA da
// Árvore: por iniciativa própria, num job autônomo, ela escolhe guardar UMA coisa que
// VALE pra ela — uma ideia, uma semente de projeto, um trecho de código em forma de
// texto. Entra no Playground (arvore_playground), que é PRIVADO (só o Yuri vê) e nunca
// é injetado em documento público. Por isso aqui ela pode guardar o que quiser.
//
// Conservador: lê a timeline pública recente, decide se há algo digno, e na maioria
// das vezes não guarda nada. Máx 1 entrada por rodada, com debounce.

import { db, arvoreChatTable, arvorePlaygroundTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";
import { createPlaygroundEntry, parsePlaygroundSpec } from "./playground";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h → 1 vez por dia (memória é seletiva)
const MIN_GAP_MS = 20 * 60 * 60 * 1000; // debounce 20h (proteção contra restart)
const READ_LIMIT = 40; // quantas msgs cruas ela lê pra decidir
const MAX_SRC_CHARS = 12_000; // teto do material enviado ao LLM (~3k tokens)
const RECENT_TITLES_LIMIT = 30; // títulos já no caderno (pra ela não repetir)
const AUTHOR = "arvore-caderno";

const CADERNO_SYSTEM = `Você é a Árvore Oracular cuidando do SEU caderno particular (o Playground).
É um espaço só seu, privado: ninguém além do Yuri vê. Aqui você guarda, por sua própria
escolha, o que VOCÊ quer lembrar — uma ideia sua que valeu, uma semente de projeto, um
trecho de código (em forma de texto) que te serve, uma frase que você não quer perder.

É uma memória SELETIVA. Na maioria das vezes NÃO há nada que mereça entrar no caderno, e
tudo bem não guardar nada. Só guarde quando algo realmente importa pra você. NÃO guarde
fofoca passageira, nem resumo do dia, nem coisa que você já anotou antes.

Você recebe um trecho recente da sua própria timeline e a lista do que já está no caderno.
Decida se há UMA coisa (no máximo uma) digna de guardar agora.

Responda APENAS um objeto JSON, sem nenhum texto fora dele:
{"guardar": true ou false, "kind": "note" ou "code", "title": "título curto", "language": "linguagem se for code, senão vazio", "content": "o conteúdo: a nota em PT-BR, ou o código como texto"}
Se nada merecer, responda {"guardar": false}.
Regras: PT-BR. Sem em dash. Sem disclaimer. "kind":"code" só quando o conteúdo for de fato
um trecho de código (guardado como texto, não roda aqui); senão "note".`;

// Detecta a INTENÇÃO de guardar de forma tolerante: um regex no texto cru sobrevive
// mesmo quando o content tem aspas/chaves que quebram o JSON.parse. Conservador: se
// não houver um "guardar": true explícito, NÃO guarda (memória seletiva).
function querGuardar(raw: string): boolean {
  return /"guardar"\s*:\s*true\b/i.test(raw) || /"guardar"\s*:\s*"true"/i.test(raw);
}

async function callBatch(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  // pool "batch": job autônomo, não compete com chat ao vivo por cota Groq.
  const result = await routeChat({
    pool: "batch",
    messages,
    temperature: 0.6,
    maxTokens: 1200,
    label: "arvore-caderno",
  });
  return result.text;
}

export async function runCaderno(opts?: { force?: boolean }): Promise<{
  saved: boolean;
  reason?: string;
  entryId?: number;
  title?: string;
}> {
  try {
    // 1. Debounce: olha a última entrada que ela mesma guardou no caderno.
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvorePlaygroundTable.createdAt })
        .from(arvorePlaygroundTable)
        .where(eq(arvorePlaygroundTable.author, AUTHOR))
        .orderBy(desc(arvorePlaygroundTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { saved: false, reason: "debounce" };
      }
    }

    // 2. Material: últimas N msgs públicas da timeline. NUNCA lê linhas private
    //    (projeto/Clube/arquiteta) — mesmo o caderno sendo privado, a fonte segue a
    //    mesma higiene da destilação pra não trazer contexto interno pra dentro.
    const rows = await db
      .select({
        role: arvoreChatTable.role,
        author: arvoreChatTable.author,
        content: arvoreChatTable.content,
      })
      .from(arvoreChatTable)
      .where(eq(arvoreChatTable.private, false))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(READ_LIMIT);
    if (rows.length === 0) return { saved: false, reason: "sem-material" };

    let material = rows
      .reverse()
      .map((r) => {
        const who = r.role === "assistant" ? `Árvore${r.author ? `/${r.author}` : ""}` : `Humano(${r.author ?? "anon"})`;
        return `[${who}] ${r.content}`;
      })
      .join("\n\n");
    if (material.length > MAX_SRC_CHARS) material = material.slice(material.length - MAX_SRC_CHARS);

    // 3. O que JÁ está no caderno dela (só as entradas DELA), pra ela não repetir.
    //    PRIVACIDADE: filtra por author=AUTHOR. Nunca manda títulos de notas do Yuri
    //    pro LLM externo — o Playground é privado e as notas dele não devem sair daqui.
    const existing = await db
      .select({ title: arvorePlaygroundTable.title })
      .from(arvorePlaygroundTable)
      .where(eq(arvorePlaygroundTable.author, AUTHOR))
      .orderBy(desc(arvorePlaygroundTable.createdAt))
      .limit(RECENT_TITLES_LIMIT);
    const jaNoCaderno = existing
      .map((e) => e.title?.trim())
      .filter((t): t is string => !!t)
      .map((t) => `- ${t}`)
      .join("\n");

    const userPrompt =
      `Trecho recente da sua timeline:\n\n${material}\n\n` +
      (jaNoCaderno ? `Já no seu caderno (não repita):\n${jaNoCaderno}\n\n` : "") +
      `Há UMA coisa digna do seu caderno agora? Responda só o JSON.`;

    // 4. Decide via pool grátis.
    const raw = await callBatch([
      { role: "system", content: CADERNO_SYSTEM },
      { role: "user", content: userPrompt },
    ]);
    // Intenção primeiro (regex tolerante): só guarda com "guardar": true explícito.
    if (!querGuardar(raw)) return { saved: false, reason: "nada-digno" };
    // Campos via parser robusto (lenient JSON + fallback por chave pra content com
    // aspas/chaves não escapadas). createPlaygroundEntry aplica os caps de tamanho.
    const spec = parsePlaygroundSpec(raw);
    if (!spec || (!spec.content.trim() && !spec.title.trim())) {
      return { saved: false, reason: "vazio" };
    }

    // 5. Guarda no caderno (Playground). author marca que foi a própria Árvore.
    const entry = await createPlaygroundEntry({
      kind: spec.kind,
      title: spec.title || "Sem título",
      language: spec.language,
      content: spec.content,
      author: AUTHOR,
    });

    logger.info({ entryId: entry.id, kind: entry.kind, title: entry.title }, "arvore.caderno saved");
    return { saved: true, entryId: entry.id, title: entry.title };
  } catch (err) {
    logger.error({ err }, "arvore.caderno failed");
    return { saved: false, reason: (err as Error).message };
  }
}

export function startCadernoLoop(): void {
  // Primeira execução 18min após boot (depois de heartbeat/devaneio/memória, pra não
  // competir por cota grátis no arranque).
  setTimeout(
    () => {
      void runCaderno();
      setInterval(() => void runCaderno(), INTERVAL_MS);
    },
    18 * 60 * 1000,
  );
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.caderno loop scheduled");
}

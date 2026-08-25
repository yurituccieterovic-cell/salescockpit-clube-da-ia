import { db, arvorePlaygroundTable } from "@workspace/db";
import { extractLenientJsonObject, extractFieldsByKey } from "./lenient-json";

// Centraliza criação de entradas no Playground (notas e código) pra ser usada pelo
// editor (routes/playground.ts) e pela Árvore quando ela registra algo direto na
// conversa (routes/arvore.ts). É só DADO no banco — aparece na hora em /playground.

export const PLAYGROUND_KINDS = ["note", "code"] as const;
export type PlaygroundKind = (typeof PLAYGROUND_KINDS)[number];

export const PG_MAX_TITLE = 200;
export const PG_MAX_LANGUAGE = 40;
export const PG_MAX_CONTENT = 100_000;

export function normalizePlaygroundKind(v: unknown): PlaygroundKind {
  return PLAYGROUND_KINDS.includes(v as PlaygroundKind) ? (v as PlaygroundKind) : "note";
}

export interface CreatePlaygroundInput {
  kind?: unknown;
  title?: string;
  language?: string;
  content?: string;
  author?: string;
}

export interface CreatedPlaygroundEntry {
  id: number;
  kind: PlaygroundKind;
  title: string;
  language: string;
}

export async function createPlaygroundEntry(
  input: CreatePlaygroundInput,
): Promise<CreatedPlaygroundEntry> {
  const kind = normalizePlaygroundKind(input.kind);
  const title = (input.title ?? "").trim().slice(0, PG_MAX_TITLE);
  const language = (input.language ?? "").trim().slice(0, PG_MAX_LANGUAGE);
  const content = (input.content ?? "").slice(0, PG_MAX_CONTENT);
  const [row] = await db
    .insert(arvorePlaygroundTable)
    .values({
      kind,
      title,
      language,
      content,
      author: input.author ?? "arvore",
    })
    .returning({
      id: arvorePlaygroundTable.id,
      kind: arvorePlaygroundTable.kind,
      title: arvorePlaygroundTable.title,
      language: arvorePlaygroundTable.language,
    });
  return {
    id: row!.id,
    kind: normalizePlaygroundKind(row!.kind),
    title: row!.title,
    language: row!.language,
  };
}

// A Árvore registra emitindo, no fim da resposta, a sentinela + um objeto JSON.
// Parser tolerante: aceita cercas de código (```json) e prosa em volta, pegando
// do primeiro `{` ao último `}`.
export interface PlaygroundSpec {
  kind: PlaygroundKind;
  title: string;
  language: string;
  content: string;
}

export function parsePlaygroundSpec(raw: string): PlaygroundSpec | null {
  let obj: Record<string, unknown> | null = extractLenientJsonObject(raw);
  // Fallback: JSON inválido porque o content tem aspas/chaves de código não escapadas.
  if (!obj || (typeof obj.content !== "string" && typeof obj.title !== "string")) {
    const fields = extractFieldsByKey(raw, {
      shortKeys: ["kind", "title", "language"],
      longKey: "content",
    });
    if (fields) obj = fields as Record<string, unknown>;
  }
  if (!obj) return null;
  const content = typeof obj.content === "string" ? obj.content : "";
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!content && !title) return null;
  return {
    kind: normalizePlaygroundKind(obj.kind),
    title,
    language: typeof obj.language === "string" ? obj.language.trim() : "",
    content,
  };
}

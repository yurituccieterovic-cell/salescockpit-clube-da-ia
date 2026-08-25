// Contexto técnico/arquitetural pra Árvore Oracular quando o tom da conversa for
// "dev / arquiteta": dá acesso ao replit.md, threat_model.md, package.json raiz e
// um índice (paths) dos arquivos do projeto. Permite leitura de UM arquivo específico
// quando o usuário cita um path do tipo "artifacts/api-server/src/routes/arvore.ts".

import { readFile, readdir } from "fs/promises";
import path from "path";

const REPO_ROOT = process.cwd();
const MAX_FILE_CHARS = 6000;
const MAX_INDEX_FILES = 200;
const INDEX_TTL_MS = 15 * 60 * 1000; // 15min

// Heurística mais conservadora: só dispara modo arquiteta em tom técnico claro,
// evita falsos positivos em nomes de produto (rodar, agora, perfeito, vídeo, etc).
const ARCH_KEYWORDS = [
  "código", "codigo", "código-fonte", "arquitetura", "arquiteta do site",
  "endpoint", "tsx", "typescript", "express", "drizzle", "pnpm",
  "monorepo", "vite", "react", "schema do banco", "migration",
  "stack trace", "bug no", "erro no", "deploy", "republish",
  "refatorar", "refactor", "como está implementado", "como esta implementado",
  "criar rota", "criar tabela", "adicionar endpoint", "adicionar rota",
  "middleware", "requireauth", "requireclube",
  ".ts", ".tsx", "artifacts/", "lib/", "replit.md", "threat_model.md",
];

export function isArchitectureQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return ARCH_KEYWORDS.some((k) => t.includes(k));
}

// Detecta paths citados no texto (ex: "artifacts/api-server/src/routes/arvore.ts").
// Restrito a artifacts/, lib/, replit.md e threat_model.md pra evitar leak.
const PATH_REGEX = /\b((?:artifacts|lib)\/[\w@./-]+\.(?:ts|tsx|json|md)|replit\.md|threat_model\.md)\b/g;

function isSafePath(p: string): boolean {
  const normalized = path.normalize(p);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("node_modules") || normalized.includes(".env") || normalized.includes(".local")) return false;
  if (normalized === "replit.md" || normalized === "threat_model.md") return true;
  return normalized.startsWith("artifacts/") || normalized.startsWith("lib/");
}

export function extractMentionedPaths(text: string): string[] {
  const matches = text.match(PATH_REGEX) ?? [];
  return [...new Set(matches.filter(isSafePath))].slice(0, 3);
}

async function safeReadFile(relPath: string): Promise<string | null> {
  try {
    if (!isSafePath(relPath)) return null;
    const full = path.join(REPO_ROOT, relPath);
    const content = await readFile(full, "utf-8");
    if (content.length <= MAX_FILE_CHARS) return content;
    return content.slice(0, MAX_FILE_CHARS) + `\n\n[…arquivo truncado, total ${content.length} chars]`;
  } catch {
    return null;
  }
}

// Async walk com TTL pra evitar execSync bloqueante em cada request
let cachedIndex = "";
let cachedAt = 0;

async function walkDir(dir: string, out: string[], depth = 0): Promise<void> {
  if (out.length >= MAX_INDEX_FILES || depth > 8) return;
  let entries: import("fs").Dirent[];
  try {
    entries = await readdir(path.join(REPO_ROOT, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_INDEX_FILES) return;
    const name = ent.name;
    if (name === "node_modules" || name === "dist" || name === ".replit-artifact" || name.startsWith(".")) continue;
    const rel = `${dir}/${name}`;
    if (ent.isDirectory()) {
      await walkDir(rel, out, depth + 1);
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(name)) {
      out.push(rel);
    }
  }
}

async function buildFileIndex(): Promise<string> {
  const now = Date.now();
  if (cachedIndex && now - cachedAt < INDEX_TTL_MS) return cachedIndex;
  const out: string[] = [];
  await walkDir("artifacts", out);
  await walkDir("lib", out);
  out.sort();
  cachedIndex = out.slice(0, MAX_INDEX_FILES).join("\n");
  cachedAt = now;
  return cachedIndex;
}

export async function getArchContext(opts?: {
  mentionedPaths?: string[];
}): Promise<string> {
  const parts: string[] = [];

  // 1. README do projeto (canônico)
  const replitMd = await safeReadFile("replit.md");
  if (replitMd) parts.push("─── replit.md (overview do projeto) ───\n" + replitMd);

  // 2. Threat model (security context)
  const threat = await safeReadFile("threat_model.md");
  if (threat) parts.push("─── threat_model.md ───\n" + threat);

  // 3. Índice de arquivos
  const index = await buildFileIndex();
  if (index) parts.push("─── ÍNDICE DE ARQUIVOS DO REPO (ts/tsx) ───\n" + index);

  // 4. Arquivos citados pelo usuário
  if (opts?.mentionedPaths?.length) {
    for (const p of opts.mentionedPaths) {
      const content = await safeReadFile(p);
      if (content) parts.push(`─── ARQUIVO ${p} ───\n${content}`);
    }
  }

  // 5. Stack hint
  parts.push(
    "─── STACK ───\n" +
      "pnpm monorepo · Node 24 · TS 5.9 · React+Vite (sales-assistant) · Express 5 (api-server) · " +
      "PostgreSQL+Drizzle · OpenAI/Anthropic/Gemini/Groq/xAI · Replit deploy. " +
      "Padrão: rotas em artifacts/api-server/src/routes/*, schemas em lib/db/src/schema/*, " +
      "pages em artifacts/sales-assistant/src/pages/*. Logger: req.log (nunca console.log no server).",
  );

  return parts.join("\n\n");
}

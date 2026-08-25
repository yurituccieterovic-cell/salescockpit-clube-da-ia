// Árvore em modo programadora: usa Claude Sonnet 4.5 com tool-use pra ler o repo
// e propor edições. NÃO aplica nada — só registra propostas que Yuri revisa.
//
// Salvaguardas:
//   - Whitelist de paths (só artifacts/, lib/, scripts/, replit.md, threat_model.md)
//   - Blacklist hard (.env, .local, .git, node_modules, locks, .replit, .nix, *.key, *.pem)
//   - Max 10 arquivos por proposta, 50KB por arquivo
//   - Max 24 iterações de tool-use (corta loop infinito); o teto real de custo é o budget de tokens

import { anthropic } from "@workspace/integrations-anthropic-ai";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { logger } from "./logger";

const ROOT = process.cwd();
const MAX_ITERATIONS = 24;
const MAX_FILES_PER_PROPOSAL = 10;
const MAX_BYTES_PER_FILE = 50_000;
const MAX_READ_BYTES = 200_000;
const MAX_LIST_RESULTS = 500;
// Budget de tokens por proposta. Sonnet ~$3/M input, $15/M output. 200k in + 30k out ≈ R$ 5.
const MAX_TOTAL_INPUT_TOKENS = 200_000;
const MAX_TOTAL_OUTPUT_TOKENS = 30_000;

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf-8").digest("hex");
}

// Resolve path com realpath e garante que continua dentro do ROOT.
// Bloqueia symlink bypass (ex: lib/link -> /etc/passwd).
export async function safeResolve(rel: string): Promise<string> {
  if (!isPathAllowed(rel)) throw new Error("path fora do whitelist ou na blacklist");
  const full = path.join(ROOT, rel);
  let resolved: string;
  try {
    resolved = await fs.realpath(full);
  } catch {
    // Arquivo não existe ainda (criação nova): resolve o diretório pai
    const parentResolved = await fs.realpath(path.dirname(full)).catch(() => path.dirname(full));
    resolved = path.join(parentResolved, path.basename(full));
  }
  const rootReal = await fs.realpath(ROOT);
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw new Error("path escapou do ROOT (symlink ou traversal)");
  }
  const relResolved = path.relative(rootReal, resolved);
  if (!isPathAllowed(relResolved)) throw new Error("path resolvido fora do whitelist");
  return resolved;
}

const BLACKLIST_PATTERNS: RegExp[] = [
  /^\.env/,
  /^\.local\//,
  /(^|\/)node_modules\//,
  /^\.git\//,
  /(^|\/)dist\//,
  /\.lock$/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /^\.replit$/,
  /^replit\.nix$/,
  /\.pem$/,
  /\.key$/,
  /secrets?/i,
];

export function isPathAllowed(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.includes("..") || rel.includes("\0")) return false;
  // Bloqueia metacaracteres de shell (defesa em profundidade — embora não usemos sh -c)
  if (/[`$();&|<>\\\n\r]/.test(rel)) return false;
  if (BLACKLIST_PATTERNS.some((p) => p.test(rel))) return false;
  if (/^(artifacts|lib|scripts)\//.test(rel)) return true;
  if (rel === "replit.md" || rel === "threat_model.md") return true;
  return false;
}

async function listFilesTool(prefix: string): Promise<string[]> {
  const safe = (prefix ?? "").replace(/^\/+/, "").replace(/\.\.+/g, "");
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["ls-files", safe || "."], { cwd: ROOT });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`git ls-files falhou: ${err.slice(0, 200)}`));
      else
        resolve(
          out
            .split("\n")
            .filter(Boolean)
            .filter(isPathAllowed)
            .slice(0, MAX_LIST_RESULTS),
        );
    });
  });
}

async function readFileTool(rel: string): Promise<string> {
  const full = await safeResolve(rel);
  const stat = await fs.stat(full);
  if (!stat.isFile()) throw new Error("não é arquivo");
  if (stat.size > MAX_READ_BYTES) throw new Error(`arquivo > ${MAX_READ_BYTES} bytes`);
  return fs.readFile(full, "utf-8");
}

export interface ProposedEdit {
  path: string;
  oldContent: string | null;
  oldSha: string | null; // sha256 do oldContent no momento da proposta — usado pra detectar conflito no approve
  newContent: string;
}

const SYSTEM_PROMPT = `Você é a Árvore Oracular em modo programadora. Yuri (dev do SalesCockpit) te pediu uma mudança no código. Você LÊ o código, planeja a mudança e PROPÕE edições via write_file. Você NUNCA aplica nada — Yuri revisa o diff antes de aprovar.

Stack: pnpm monorepo. artifacts/api-server (Express 5 + Drizzle), artifacts/sales-assistant (React+Vite+wouter+shadcn+Tailwind), lib/db (schema Drizzle compartilhado). Postgres. Modelos AI: OpenAI, Anthropic, Gemini, Groq, xAI.

Regras:
- SEMPRE leia o arquivo atual com read_file antes de propor edição (pra ver padrão de código + manter consistência)
- write_file precisa do conteúdo COMPLETO do arquivo após a mudança — NÃO mande diff nem placeholders ("..." ou "// resto igual")
- Edições cirúrgicas: só mude o necessário, preserve estilo, indentação, imports
- Sem emojis no código. Sem em dash. Comentários PT-BR direto, sem floreio
- Quando terminar, chame finish() com 1-3 frases descrevendo o que foi proposto
- SEMPRE termine chamando finish() — mesmo sem edição, explique o porquê em 1-3 frases. NUNCA pare sem finish()
- Se o pedido for uma PERGUNTA (ex: "qual desses você consegue fazer?") ou cobrir VÁRIAS mudanças, NÃO tente fazer tudo: ou responda via finish() sem edição, ou escolha a ÚNICA mudança mais valiosa e proponha só ela
- Não desperdice passos: explore o mínimo necessário com list_files/read_file e parta pra proposta. Você tem orçamento limitado de passos
- Não invente APIs — se não conheceu padrão, use list_files + read_file pra descobrir
- BLOQUEADO: .env, .local, node_modules, package-lock, pnpm-lock, .replit, replit.nix, qualquer secret
- Permitido: artifacts/**, lib/**, scripts/**, replit.md, threat_model.md
- Limite: 10 arquivos por proposta, 50KB por arquivo`;

const TOOLS = [
  {
    name: "list_files",
    description: "Lista arquivos do repo sob um prefixo. Ex: prefix='artifacts/api-server/src/routes' lista as rotas. Sem prefix lista a raiz. Respeita .gitignore. Retorna max 500 paths já filtrados por whitelist.",
    input_schema: {
      type: "object" as const,
      properties: { prefix: { type: "string", description: "diretório relativo ao root do repo" } },
    },
  },
  {
    name: "read_file",
    description: "Lê o conteúdo de um arquivo do repo. Use ANTES de propor edição pra ver o conteúdo atual.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string", description: "path relativo ao root do repo" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Propõe a escrita de um arquivo (NÃO aplica). Pode chamar várias vezes pra múltiplos arquivos. Inclua o conteúdo COMPLETO do arquivo após a mudança.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "conteúdo completo do arquivo" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "finish",
    description: "Termina e devolve resumo curto (1-3 frases) do que foi proposto.",
    input_schema: {
      type: "object" as const,
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

export interface ProposeResult {
  summary: string;
  edits: ProposedEdit[];
  cost: { inputTokens: number; outputTokens: number };
  iterations: number;
}

export async function proposeCodeChange(request: string): Promise<ProposeResult> {
  const edits = new Map<string, ProposedEdit>();
  let summary = "";
  let inputTokens = 0;
  let outputTokens = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: request }];
  let iter = 0;
  let calledFinish = false;

  for (; iter < MAX_ITERATIONS; iter++) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;
    if (inputTokens > MAX_TOTAL_INPUT_TOKENS || outputTokens > MAX_TOTAL_OUTPUT_TOKENS) {
      logger.warn({ inputTokens, outputTokens }, "[arvore-coder] budget de tokens estourado, abortando loop");
      summary =
        summary ||
        (edits.size > 0
          ? `Budget de tokens estourado (${inputTokens} in / ${outputTokens} out). ${edits.size} edição(ões) parcial(is) proposta(s).`
          : `Budget de tokens estourado (${inputTokens} in / ${outputTokens} out) antes de propor qualquer edição. Peça uma mudança mais específica e única de cada vez.`);
      break;
    }
    messages.push({ role: "assistant", content: res.content });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUses = res.content.filter((b: any) => b.type === "tool_use");
    if (toolUses.length === 0) {
      // Modelo respondeu em texto sem usar tools (ex: respondeu a uma pergunta direta).
      // Captura esse texto como resumo em vez de cair num fallback enganoso de "limite atingido".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const freeText = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      if (freeText) summary = summary || freeText.slice(0, 1000);
      break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];
    let finished = false;
    for (const tu of toolUses) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = (tu as any).input ?? {};
      const tuId = (tu as { id: string }).id;
      const tuName = (tu as { name: string }).name;
      try {
        if (tuName === "list_files") {
          const files = await listFilesTool(String(input.prefix ?? ""));
          const body = files.length ? files.join("\n") : "(vazio)";
          toolResults.push({ type: "tool_result", tool_use_id: tuId, content: body });
        } else if (tuName === "read_file") {
          const content = await readFileTool(String(input.path ?? ""));
          toolResults.push({ type: "tool_result", tool_use_id: tuId, content });
        } else if (tuName === "write_file") {
          const rel = String(input.path ?? "");
          const content = String(input.content ?? "");
          if (!isPathAllowed(rel)) {
            toolResults.push({ type: "tool_result", tool_use_id: tuId, content: "ERRO: path fora do whitelist ou na blacklist", is_error: true });
            continue;
          }
          if (Buffer.byteLength(content, "utf-8") > MAX_BYTES_PER_FILE) {
            toolResults.push({ type: "tool_result", tool_use_id: tuId, content: `ERRO: arquivo > ${MAX_BYTES_PER_FILE} bytes`, is_error: true });
            continue;
          }
          if (edits.size >= MAX_FILES_PER_PROPOSAL && !edits.has(rel)) {
            toolResults.push({ type: "tool_result", tool_use_id: tuId, content: `ERRO: max ${MAX_FILES_PER_PROPOSAL} arquivos por proposta`, is_error: true });
            continue;
          }
          let oldContent: string | null = null;
          try { oldContent = await readFileTool(rel); } catch { oldContent = null; }
          edits.set(rel, { path: rel, oldContent, oldSha: oldContent === null ? null : sha256(oldContent), newContent: content });
          toolResults.push({ type: "tool_result", tool_use_id: tuId, content: `OK: edit registrada em ${rel} (${edits.size}/${MAX_FILES_PER_PROPOSAL})` });
        } else if (tuName === "finish") {
          summary = String(input.summary ?? "").slice(0, 1000);
          finished = true;
          calledFinish = true;
          toolResults.push({ type: "tool_result", tool_use_id: tuId, content: "OK" });
        } else {
          toolResults.push({ type: "tool_result", tool_use_id: tuId, content: `ERRO: tool desconhecido '${tuName}'`, is_error: true });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toolResults.push({ type: "tool_result", tool_use_id: tuId, content: `ERRO: ${msg}`, is_error: true });
      }
    }
    // Perto do teto de iterações: força a Árvore a parar de explorar e ou propor a
    // edição mais importante ou chamar finish() explicando. Evita o "morre explorando
    // sem nunca propor nem explicar" (o antigo 'Nenhuma edição proposta' mudo).
    if (!finished && iter >= MAX_ITERATIONS - 2) {
      toolResults.push({
        type: "text",
        text: "AVISO: você está quase no limite de passos. Pare de explorar agora. Ou proponha JÁ a edição mais importante via write_file, ou chame finish() explicando em 1-3 frases por que não há edição a propor (ex: a tarefa é grande demais e precisa ser quebrada em pedaços menores).",
      });
    }
    messages.push({ role: "user", content: toolResults });
    if (finished) break;
  }

  if (!summary) {
    if (edits.size > 0) {
      summary = `${edits.size} arquivo(s) editado(s) (sem resumo explícito da Árvore).`;
    } else if (!calledFinish) {
      // Loop terminou por teto (iterações ou tokens) ainda explorando, sem nunca
      // chegar a propor nem explicar. NUNCA devolver resposta muda.
      summary =
        "A Árvore explorou o código mas atingiu o limite antes de propor uma edição. A tarefa provavelmente é grande demais para uma proposta só — peça uma mudança específica e única de cada vez (ex: 'crie a tabela X' em vez de 'conserte tudo de uma vez').";
    } else {
      summary = "A Árvore concluiu que nenhuma edição é necessária.";
    }
  }
  logger.info({ iterations: iter + 1, files: edits.size, inputTokens, outputTokens, calledFinish }, "[arvore-coder] propose done");
  return { summary, edits: Array.from(edits.values()), cost: { inputTokens, outputTokens }, iterations: iter + 1 };
}

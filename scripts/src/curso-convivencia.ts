import fs from "fs";
import path from "path";
import { db, assembleiaSessionsTable, jornalEntriesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const API = process.env.API_BASE || "http://localhost:80";
const TOKEN = process.env.SESSION_SECRET;
if (!TOKEN) throw new Error("SESSION_SECRET not set");

const ROOT = path.resolve(import.meta.dirname, "../..");
const PDF_PATHS = [
  path.join(ROOT, "attached_assets/V3ConvivenciaAmbientalYuriTE_(1)_1779426413282.pdf"),
  path.join(ROOT, "attached_assets/ConvivênciaAmbiental-anexo_1779426551336.pdf"),
  path.join(ROOT, "attached_assets/ConvivênciaAmbiental-anexoII_1779426551386.pdf"),
];
const PROMPTS_PATH = path.join(import.meta.dirname, "curso-prompts.json");
const STATE_PATH = path.join(import.meta.dirname, "curso-state.json");

type PromptDef = { n: number; titulo: string; prompt: string };
type Attach = { name: string; kind: "text" | "image"; text: string };
type State = {
  attachments: Attach[];
  results: Array<{ n: number; titulo: string; assembleiaId: number | null; perfeitoText: string | null; status: "pending" | "done" | "failed"; error?: string }>;
};

function log(msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function loadState(): State | null {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) as State; } catch { return null; }
}
function saveState(s: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function uploadPdf(filepath: string): Promise<Attach> {
  const buf = fs.readFileSync(filepath);
  const name = path.basename(filepath);
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buf)], { type: "application/pdf" }), name);
  const res = await fetch(`${API}/api/uploads/inline`, {
    method: "POST",
    headers: { "x-internal-token": TOKEN! },
    body: fd,
  });
  if (!res.ok) throw new Error(`upload ${name} failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { kind: "text" | "image"; name: string; text: string };
  return { name: data.name, kind: data.kind, text: data.text };
}

async function prepareRodar(prompt: string, attachments: Attach[]): Promise<string> {
  const res = await fetch(`${API}/api/rodar/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-token": TOKEN! },
    body: JSON.stringify({ prompt, attachments, gerarVideo: true, strategies: {} }),
  });
  if (!res.ok) throw new Error(`prepare failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { runId: string };
  return data.runId;
}

async function streamRodar(runId: string): Promise<number> {
  const res = await fetch(`${API}/api/rodar/stream?runId=${encodeURIComponent(runId)}`, {
    headers: { "Accept": "text/event-stream", "x-internal-token": TOKEN! },
  });
  if (!res.ok || !res.body) throw new Error(`stream failed ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assembleiaId: number | null = null;
  let voicesDone = 0;
  const voicesSeen = new Set<string>();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        const evt = JSON.parse(payload) as Record<string, unknown>;
        if (evt.type === "assembleiaId" && typeof evt.assembleiaId === "number") {
          assembleiaId = evt.assembleiaId;
          log(`  > assembleia #${assembleiaId} criada`);
        }
        if (typeof evt.ai === "string" && evt.done === true) {
          if (!voicesSeen.has(evt.ai)) {
            voicesSeen.add(evt.ai);
            voicesDone++;
            log(`  > voz [${voicesDone}/21] ${evt.ai} ${evt.error ? "ERRO" : evt.abstencao ? `absteve (${evt.abstencao})` : "OK"}`);
          }
        }
        if (evt.type === "complete") {
          log(`  > SSE complete: emailSent=${evt.emailSent} assembleiaId=${evt.assembleiaId}`);
          if (typeof evt.assembleiaId === "number") assembleiaId = evt.assembleiaId;
        }
      } catch { /* skip parse errors */ }
    }
  }
  if (assembleiaId === null) throw new Error("stream ended without assembleiaId");
  return assembleiaId;
}

async function waitForPerfeito(sessionId: number, timeoutMs = 25 * 60 * 1000): Promise<string> {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < timeoutMs) {
    const [sess] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, sessionId));
    const status = sess?.status || "?";
    const hasMeta = !!sess?.metaAnalysis;
    const [jornal] = await db.select().from(jornalEntriesTable).where(eq(jornalEntriesTable.sessionId, sessionId)).orderBy(desc(jornalEntriesTable.id)).limit(1);
    const stamp = `status=${status} meta=${hasMeta ? "Y" : "N"} jornal=${jornal ? "Y" : "N"}`;
    if (stamp !== lastStatus) {
      log(`  > poll #${sessionId}: ${stamp} (${Math.round((Date.now() - start) / 1000)}s)`);
      lastStatus = stamp;
    }
    if (jornal && jornal.perfeitoText && jornal.perfeitoText !== "(síntese não disponível)") {
      return jornal.perfeitoText;
    }
    await new Promise(r => setTimeout(r, 10_000));
  }
  throw new Error(`timeout esperando PERFEITO da sessão #${sessionId}`);
}

async function main() {
  const prompts = (JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")) as { prompts: PromptDef[] }).prompts;
  if (prompts.length !== 10) throw new Error(`esperava 10 prompts, recebi ${prompts.length}`);

  let state = loadState();
  if (!state) {
    log("nenhum state anterior — upload dos 3 PDFs");
    const attachments: Attach[] = [];
    for (const p of PDF_PATHS) {
      log(`upload: ${path.basename(p)}`);
      attachments.push(await uploadPdf(p));
    }
    log(`anexos OK: ${attachments.map(a => `${a.name} (${a.kind}, ${a.text.length} chars)`).join(", ")}`);
    state = {
      attachments,
      results: prompts.map(p => ({ n: p.n, titulo: p.titulo, assembleiaId: null, perfeitoText: null, status: "pending" })),
    };
    saveState(state);
  } else {
    log(`state carregado: ${state.results.filter(r => r.status === "done").length}/10 já feitas`);
  }

  for (let i = 0; i < prompts.length; i++) {
    const def = prompts[i];
    const result = state.results[i];
    if (result.status === "done") {
      log(`SKIP [${def.n}/10] ${def.titulo} — já feito (assembleia #${result.assembleiaId})`);
      continue;
    }
    log("");
    log(`=== [${def.n}/10] ${def.titulo} ===`);

    let fullPrompt = def.prompt;
    if (i > 0) {
      const prev = state.results[i - 1];
      if (prev.perfeitoText) {
        fullPrompt = `${def.prompt}\n\n=== AULA ANTERIOR (PERFEITO da aula ${prev.n}) ===\n${prev.perfeitoText}\n=== FIM DA AULA ANTERIOR ===`;
      } else {
        log(`AVISO: aula anterior sem PERFEITO, prompt vai sem contexto encadeado`);
      }
    }

    try {
      let assembleiaId: number;
      if (result.assembleiaId) {
        assembleiaId = result.assembleiaId;
        log(`RESUME: assembleia #${assembleiaId} já criada, pulando prepare/stream e indo direto pra waitForPerfeito`);
      } else {
        log(`prepare (prompt ${fullPrompt.length} chars + ${state.attachments.length} PDFs)`);
        const runId = await prepareRodar(fullPrompt, state.attachments);
        log(`runId: ${runId} — abrindo SSE`);
        assembleiaId = await streamRodar(runId);
        result.assembleiaId = assembleiaId;
        saveState(state);
      }

      log(`SSE terminou, aguardando pipeline (Editorial → Ágora → Secretário → Áudio) ~3-5min`);
      const perfeito = await waitForPerfeito(assembleiaId);
      result.perfeitoText = perfeito;
      result.status = "done";
      saveState(state);
      log(`DONE [${def.n}/10] PERFEITO ${perfeito.length} chars — narração em áudio (ElevenLabs) rodando em background`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.status = "failed";
      result.error = msg;
      saveState(state);
      log(`FAIL [${def.n}/10]: ${msg}`);
      log(`parando cadeia. rode novamente pra retomar do estado salvo`);
      process.exit(1);
    }
  }

  log("");
  log("=== TODAS AS 10 AULAS DISPARADAS ===");
  log("emails RESULTADO no yurituccieterovic@gmail.com");
  log("emails PERFEITO no luddlocke@gmail.com");
  log("emails ÁUDIO PERFEITO no luddlocke@gmail.com (MP3 anexado, chegam conforme a ElevenLabs gera cada narração)");
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});

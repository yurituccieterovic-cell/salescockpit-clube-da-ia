// Drena a fila de propostas approved-mas-não-aplicadas-no-disco.
// Roda no Repl de DEV (não em prod — filesystem de prod é efêmero).
//
// Fluxo:
//   1. Busca todas as propostas com status='approved' AND applied_to_disk=false
//   2. Pra cada uma: verifica sha do oldContent vs disco atual (conflito?)
//   3. Aplica (escreve arquivos + git commit)
//   4. Marca applied_to_disk=true, applied_in='dev-repl', applied_to_disk_at=now
//   5. Imprime resumo: aplicadas / conflitos / falhas

import { db, arvoreProposalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

interface Diff {
  path: string;
  oldContent: string | null;
  oldSha?: string | null;
  newContent: string;
}

const ROOT = process.cwd();

// Whitelist mínima de prefixos permitidos (mesma do arvore-coder.ts, conservadora)
const ALLOWED_PREFIXES = ["artifacts/", "lib/", "scripts/", "replit.md", "threat_model.md"];
const BLOCKED_PATTERNS = [/\.env/, /\.local\//, /\.git\//, /node_modules\//, /\.replit/, /\.nix/, /\.key$/, /\.pem$/, /secret/i, /pnpm-lock/];

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeResolve(p: string): string {
  // normaliza e bloqueia traversal
  const norm = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  if (norm.startsWith("/") || norm.includes("..")) throw new Error(`path absoluto ou traversal: ${p}`);
  if (!ALLOWED_PREFIXES.some((prefix) => norm.startsWith(prefix))) throw new Error(`path fora da whitelist: ${p}`);
  for (const pat of BLOCKED_PATTERNS) {
    if (pat.test(norm)) throw new Error(`path bloqueado por padrão: ${p}`);
  }
  return path.join(ROOT, norm);
}

async function gitCommit(paths: string[], msg: string): Promise<void> {
  const safe = msg.slice(0, 100).replace(/[\r\n]+/g, " ");
  await new Promise<void>((resolve) => {
    const add = spawn("git", ["add", "--", ...paths], { cwd: ROOT });
    add.on("close", (addCode) => {
      if (addCode !== 0) { console.warn(`  ⚠ git add falhou (code ${addCode})`); resolve(); return; }
      const commit = spawn("git", [
        "-c", "user.name=Arvore Oracular",
        "-c", "user.email=arvore@salescockpit.local",
        "commit", "-m", `arvore: ${safe} (aplicada via script)`,
      ], { cwd: ROOT });
      let stderr = "";
      commit.stderr.on("data", (c) => (stderr += c.toString()));
      commit.on("close", (code) => {
        if (code !== 0) console.warn(`  ⚠ git commit retornou ${code}: ${stderr.slice(0, 200)}`);
        resolve();
      });
    });
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("✗ NÃO RODAR EM PRODUÇÃO. O filesystem de prod é efêmero — escreva no Repl de dev.");
    process.exit(1);
  }

  console.log("🌳 Drenando fila de propostas approved-mas-não-aplicadas-no-disco…\n");

  const pending = await db
    .select()
    .from(arvoreProposalsTable)
    .where(and(eq(arvoreProposalsTable.status, "approved"), eq(arvoreProposalsTable.appliedToDisk, false)));

  if (pending.length === 0) {
    console.log("✓ Fila vazia. Nada pra aplicar.");
    process.exit(0);
  }

  console.log(`Encontradas ${pending.length} propostas:\n`);

  let applied = 0;
  let conflicts = 0;
  let failed = 0;

  for (const row of pending) {
    const diffs = row.diffs as Diff[];
    console.log(`── #${row.id} — ${row.summary.slice(0, 80)}`);
    console.log(`   ${diffs.length} arquivo(s): ${diffs.map((d) => d.path).join(", ")}`);

    // 1. Checa cada path + conflito de sha
    const resolved: { path: string; absolute: string }[] = [];
    let conflictMsg: string | null = null;
    for (const d of diffs) {
      let abs: string;
      try { abs = safeResolve(d.path); }
      catch (e) {
        conflictMsg = `path rejeitado: ${d.path} (${e instanceof Error ? e.message : String(e)})`;
        break;
      }
      let currentSha: string | null = null;
      try {
        const current = await fs.readFile(abs, "utf-8");
        currentSha = sha256(current);
      } catch { currentSha = null; }
      if (d.oldSha !== undefined && currentSha !== d.oldSha) {
        conflictMsg = `conflito em ${d.path}: esperado sha ${d.oldSha?.slice(0, 8) ?? "null"}, disco tem ${currentSha?.slice(0, 8) ?? "null"}`;
        break;
      }
      resolved.push({ path: d.path, absolute: abs });
    }

    if (conflictMsg) {
      console.log(`   ⚠ CONFLITO: ${conflictMsg}`);
      console.log(`   → marcada como 'failed' (peça pra Árvore regenerar)\n`);
      await db
        .update(arvoreProposalsTable)
        .set({ status: "failed", errorMsg: conflictMsg })
        .where(eq(arvoreProposalsTable.id, row.id));
      conflicts++;
      continue;
    }

    // 2. Aplica
    try {
      for (let i = 0; i < diffs.length; i++) {
        const d = diffs[i];
        const r = resolved[i];
        await fs.mkdir(path.dirname(r.absolute), { recursive: true });
        await fs.writeFile(r.absolute, d.newContent, "utf-8");
      }
      await db
        .update(arvoreProposalsTable)
        .set({ appliedToDisk: true, appliedToDiskAt: new Date(), appliedIn: "dev-repl" })
        .where(eq(arvoreProposalsTable.id, row.id));
      console.log(`   ✓ aplicada (${diffs.length} arquivo(s) escritos — Replit checkpoint cobre commit)\n`);
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ✗ FALHA: ${msg}\n`);
      await db
        .update(arvoreProposalsTable)
        .set({ status: "failed", errorMsg: `script aplicar: ${msg}` })
        .where(eq(arvoreProposalsTable.id, row.id));
      failed++;
    }
  }

  console.log(`\n━━━ Resumo ━━━`);
  console.log(`✓ Aplicadas:  ${applied}`);
  console.log(`⚠ Conflitos:  ${conflicts}`);
  console.log(`✗ Falhas:     ${failed}`);
  if (applied > 0) {
    console.log(`\n👉 Próximo passo: Republish manual pra produção pegar as mudanças.`);
  }
  process.exit(0);
}

void main();

// Rotas da Árvore em modo programadora: propõe edições, Yuri aprova/rejeita.
// Todas exigem AO auth via requireAuth (montadas em routes/index.ts).

import { Router } from "express";
import { db, arvoreProposalsTable } from "@workspace/db";
import { desc, eq, and, gt } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { proposeCodeChange, type ProposedEdit, safeResolve, sha256 } from "../lib/arvore-coder";
import { logger } from "../lib/logger";

const router = Router();
const RATE_LIMIT_PER_DAY = 20;
const ROOT = process.cwd();

async function checkRateLimit(user: string): Promise<{ ok: boolean; count: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ id: arvoreProposalsTable.id })
    .from(arvoreProposalsTable)
    .where(and(eq(arvoreProposalsTable.createdBy, user), gt(arvoreProposalsTable.createdAt, since)));
  return { ok: recent.length < RATE_LIMIT_PER_DAY, count: recent.length };
}

router.post("/arvore/code/propose", async (req, res) => {
  const { request } = req.body as { request?: string };
  const r = (request ?? "").trim();
  if (r.length < 5) { res.status(400).json({ error: "request muito curto (mín 5 chars)" }); return; }
  if (r.length > 5000) { res.status(400).json({ error: "request > 5000 chars" }); return; }
  const user = (req.session.user ?? "AO") as string;
  const rl = await checkRateLimit(user);
  if (!rl.ok) { res.status(429).json({ error: `Limite de ${RATE_LIMIT_PER_DAY} propostas/24h atingido`, count: rl.count }); return; }
  logger.info({ user, requestLen: r.length }, "[arvore-code] propose start");
  try {
    const out = await proposeCodeChange(r);
    if (out.edits.length === 0) {
      res.status(422).json({ error: "Árvore não propôs nenhuma edição", summary: out.summary });
      return;
    }
    const [row] = await db
      .insert(arvoreProposalsTable)
      .values({
        request: r,
        summary: out.summary,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        diffs: out.edits as any,
        status: "pending",
        createdBy: user,
        inputTokens: out.cost.inputTokens,
        outputTokens: out.cost.outputTokens,
      })
      .returning();
    res.json({
      id: row.id,
      summary: out.summary,
      fileCount: out.edits.length,
      files: out.edits.map((e) => e.path),
      iterations: out.iterations,
      cost: out.cost,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[arvore-code] propose failed");
    res.status(500).json({ error: msg });
  }
});

router.get("/arvore/code/proposals", async (_req, res) => {
  const rows = await db
    .select({
      id: arvoreProposalsTable.id,
      request: arvoreProposalsTable.request,
      summary: arvoreProposalsTable.summary,
      status: arvoreProposalsTable.status,
      createdAt: arvoreProposalsTable.createdAt,
      createdBy: arvoreProposalsTable.createdBy,
      appliedAt: arvoreProposalsTable.appliedAt,
      appliedToDisk: arvoreProposalsTable.appliedToDisk,
      appliedToDiskAt: arvoreProposalsTable.appliedToDiskAt,
      appliedIn: arvoreProposalsTable.appliedIn,
      errorMsg: arvoreProposalsTable.errorMsg,
    })
    .from(arvoreProposalsTable)
    .orderBy(desc(arvoreProposalsTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.get("/arvore/code/proposals/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const [row] = await db.select().from(arvoreProposalsTable).where(eq(arvoreProposalsTable.id, id));
  if (!row) { res.status(404).json({ error: "não encontrada" }); return; }
  res.json(row);
});

router.post("/arvore/code/proposals/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const [row] = await db.select().from(arvoreProposalsTable).where(eq(arvoreProposalsTable.id, id));
  if (!row) { res.status(404).json({ error: "não encontrada" }); return; }
  if (row.status !== "pending") { res.status(409).json({ error: `status já é '${row.status}'` }); return; }
  const diffs = row.diffs as ProposedEdit[];

  // PROBLEMA DE ARQUITETURA: o container de produção é EFÊMERO. fs.writeFile + git commit
  // dentro dele não persistem — o próximo restart perde, e o próximo Republish puxa o código
  // do Repl de dev (que não foi tocado). Resultado: "aprovar em prod" SEMPRE silenciosamente
  // não aplicava nada de verdade.
  // Fix: em prod, marca approved + applied_to_disk=false (fila). Em dev, fluxo antigo
  // (escreve + commit) + applied_to_disk=true. Yuri roda `pnpm --filter @workspace/scripts
  // run aplicar-aprovadas` no Repl de dev pra drenar a fila e fazer Republish.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    await db
      .update(arvoreProposalsTable)
      .set({ status: "approved", appliedAt: new Date(), appliedToDisk: false })
      .where(eq(arvoreProposalsTable.id, id));
    logger.info({ id, files: diffs.length }, "[arvore-code] approved-in-prod (não aplica — banco de prod separado)");
    res.json({
      ok: true,
      queued: true,
      filesPending: diffs.length,
      message:
        "Aprovação registrada, mas o site publicado NÃO consegue mudar o próprio código — o ambiente no ar é só leitura, e o banco dele é separado do de desenvolvimento. Pra a mudança virar código de verdade, abra a Árvore programadora pelo ambiente de trabalho (o workspace de desenvolvimento) e proponha/aprove por lá: a aprovação escreve o arquivo na hora. Depois é só publicar.",
    });
    return;
  }

  // DEV path: escreve arquivos + git commit + marca applied_to_disk
  try {
    // Pré-checa conflito (race condition): se o disco mudou desde a proposta, falha.
    for (const d of diffs) {
      let resolved: string;
      try { resolved = await safeResolve(d.path); }
      catch (e) {
        throw new Error(`path '${d.path}' rejeitado: ${e instanceof Error ? e.message : String(e)}`);
      }
      let currentSha: string | null = null;
      try {
        const current = await fs.readFile(resolved, "utf-8");
        currentSha = sha256(current);
      } catch { currentSha = null; } // arquivo não existe agora
      if (currentSha !== d.oldSha) {
        throw new Error(`Conflito em '${d.path}': arquivo mudou desde a proposta (sha esperado ${d.oldSha?.slice(0, 8) ?? "null"}, atual ${currentSha?.slice(0, 8) ?? "null"}). Peça pra Árvore regenerar.`);
      }
    }
    // Aplica
    const resolvedPaths: string[] = [];
    for (const d of diffs) {
      const resolved = await safeResolve(d.path);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, d.newContent, "utf-8");
      resolvedPaths.push(d.path);
    }
    // git commit via spawn com array de args (sem shell — sem injection)
    const safeMsg = row.summary.slice(0, 100).replace(/[\r\n]+/g, " ");
    await new Promise<void>((resolve) => {
      const addProc = spawn("git", ["add", "--", ...resolvedPaths], { cwd: ROOT });
      addProc.on("close", (addCode) => {
        if (addCode !== 0) { logger.warn({ id, addCode }, "[arvore-code] git add falhou"); resolve(); return; }
        const commitProc = spawn(
          "git",
          [
            "-c", "user.name=Arvore Oracular",
            "-c", "user.email=arvore@salescockpit.local",
            "commit", "-m", `arvore: ${safeMsg} (proposta #${id})`,
          ],
          { cwd: ROOT },
        );
        let stderr = "";
        commitProc.stderr.on("data", (c) => (stderr += c.toString()));
        commitProc.on("close", (commitCode) => {
          if (commitCode !== 0) logger.warn({ id, commitCode, stderr: stderr.slice(0, 300) }, "[arvore-code] git commit falhou (edits aplicados)");
          resolve();
        });
      });
    });
    await db
      .update(arvoreProposalsTable)
      .set({
        status: "approved",
        appliedAt: new Date(),
        appliedToDisk: true,
        appliedToDiskAt: new Date(),
        appliedIn: "dev-repl",
      })
      .where(eq(arvoreProposalsTable.id, id));
    logger.info({ id, files: diffs.length }, "[arvore-code] approved + applied to disk (dev)");
    res.json({ ok: true, filesWritten: diffs.length, appliedToDisk: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, id }, "[arvore-code] apply failed");
    await db.update(arvoreProposalsTable).set({ status: "failed", errorMsg: msg }).where(eq(arvoreProposalsTable.id, id));
    res.status(500).json({ error: msg });
  }
});

router.post("/arvore/code/proposals/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const [row] = await db.select().from(arvoreProposalsTable).where(eq(arvoreProposalsTable.id, id));
  if (!row) { res.status(404).json({ error: "não encontrada" }); return; }
  if (row.status !== "pending") { res.status(409).json({ error: `status já é '${row.status}'` }); return; }
  await db.update(arvoreProposalsTable).set({ status: "rejected" }).where(eq(arvoreProposalsTable.id, id));
  res.json({ ok: true });
});

export default router;

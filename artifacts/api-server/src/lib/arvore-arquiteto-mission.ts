// Missão semanal do Arquiteto: vasculha o repo em busca de UMA pequena melhoria
// (síntese, refatoração cirúrgica, bug óbvio, risco de segurança). Custo decide o fluxo:
//   < R$0,50  → aplica direto + git commit + email "aplicada" pro Yuri
//   ≥ R$0,50  → guarda como pending + email "aguardando revisão" com link /arvore-code/N
// Teto MENSAL_BRL freia a varredura se o custo acumulado do mês passar.
// Yuri decide quando promover pra prod via Republish manual (buffer natural).
//
// IMPORTANTE: esta missão SÓ roda em NODE_ENV=production. Em dev a feature fica
// dormindo pra não queimar Sonnet 4.5 a cada reload.

import { db, arvoreProposalsTable } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import nodemailer from "nodemailer";
import { proposeCodeChange, type ProposedEdit, safeResolve, sha256 } from "./arvore-coder";
import { logger } from "./logger";

const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000; // debounce 6 dias (não dispara 2x na mesma semana se a app reiniciar)
const BOOT_DELAY_MS = 15 * 60 * 1000; // 15min pós-boot (não competir com heartbeat noturno)

const AUTO_APPLY_CEIL_BRL = 0.50;
const MONTHLY_BUDGET_BRL = 50;
const CREATED_BY = "arvore-arquiteto-mission";

// Paths "críticos": mesmo que o custo seja < R$0,50, qualquer proposta que toque
// um destes arquivos FORÇA o fluxo de revisão manual (não auto-aplica). São
// caminhos de segurança/billing/schema onde uma alteração silenciosa do Sonnet 4.5
// pode quebrar produção ou abrir vulnerabilidade. Match por prefixo do path.
const CRITICAL_PATH_PREFIXES = [
  "artifacts/api-server/src/middlewares/",
  "artifacts/api-server/src/routes/auth.ts",
  "artifacts/api-server/src/routes/auth-app.ts",
  "artifacts/api-server/src/routes/checkout.ts",
  "artifacts/api-server/src/routes/webhooks.ts",
  "artifacts/api-server/src/lib/billing-detector.ts",
  "artifacts/api-server/src/lib/arvore-coder.ts",
  "artifacts/api-server/src/lib/arvore-arquiteto-mission.ts",
  "lib/db/src/schema/",
];

function touchesCriticalPath(diffs: ProposedEdit[]): string | null {
  for (const d of diffs) {
    for (const prefix of CRITICAL_PATH_PREFIXES) {
      if (d.path.startsWith(prefix)) return d.path;
    }
  }
  return null;
}

// Preço Claude Sonnet 4.5 em USD/1M tokens: $3 input, $15 output.
// Taxa conservadora R$6/USD pra superestimar custo (mais seguro: gate auto-apply
// dispara menos vezes do que dispararia com taxa real).
const USD_BRL = 6;
const INPUT_BRL_PER_TOKEN = (3 / 1_000_000) * USD_BRL;
const OUTPUT_BRL_PER_TOKEN = (15 / 1_000_000) * USD_BRL;

const MISSION_PROMPT = `Você é o Arquiteto do SalesCockpit (pnpm monorepo PT-BR: Express 5 + React+Vite + Drizzle/Postgres + TypeScript).

Sua missão semanal: vasculhar o código em busca de UMA melhoria PEQUENA e CIRÚRGICA. Use as tools list_files e read_file pra explorar.

Prioridades (nesta ordem):
1. Bugs óbvios ou riscos de segurança (auth missing, SQL injection, leak de dados)
2. Código Stripe/billing/checkout (artifacts/api-server/src/routes/checkout.ts, webhooks.ts, lib/stripe-*) — segurança e race conditions
3. Síntese: trechos duplicados que dá pra extrair em helper
4. Refatoração cirúrgica: tipo claro, null check faltando, error handling silencioso
5. Performance óbvia (query N+1, missing index, loop síncrono em I/O)

REGRAS DURAS:
- Máximo 3 arquivos por proposta. Mudanças PEQUENAS — não reescreva módulos.
- NÃO toque em: .env, .replit, .local/, lib/db/migrations/, secrets, build configs, package.json (deps).
- Se NÃO encontrar nada urgente: chame finish com summary="nenhuma melhoria urgente encontrada nesta varredura" e ZERO edits.
- Sempre explique no summary: O QUE muda, POR QUE, e qual o RISCO (baixo/médio/alto).

Comece explorando.`;

// Puxa summaries das últimas N varreduras (qualquer status) pra injetar no prompt
// e evitar que o Arquiteto proponha a mesma coisa toda semana (preocupação de
// idempotência do code review — prompt estático tende a convergir nos mesmos pontos).
async function getRecentSummaries(limit = 5): Promise<string[]> {
  const rows = await db
    .select({ summary: arvoreProposalsTable.summary })
    .from(arvoreProposalsTable)
    .where(eq(arvoreProposalsTable.createdBy, CREATED_BY))
    .orderBy(desc(arvoreProposalsTable.createdAt))
    .limit(limit);
  return rows.map((r) => r.summary).filter((s): s is string => !!s && s.length > 0);
}

function costBRL(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_BRL_PER_TOKEN + outputTokens * OUTPUT_BRL_PER_TOKEN;
}

async function getMonthlySpendBRL(): Promise<number> {
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      inputTokens: arvoreProposalsTable.inputTokens,
      outputTokens: arvoreProposalsTable.outputTokens,
    })
    .from(arvoreProposalsTable)
    .where(
      and(
        eq(arvoreProposalsTable.createdBy, CREATED_BY),
        gte(arvoreProposalsTable.createdAt, firstOfMonth),
      ),
    );
  return rows.reduce((acc, r) => acc + costBRL(r.inputTokens ?? 0, r.outputTokens ?? 0), 0);
}

async function applyProposalEdits(diffs: ProposedEdit[], proposalId: number, summary: string): Promise<{
  ok: boolean;
  error?: string;
  filesWritten?: number;
}> {
  try {
    // Pré-checa conflito (race condition: arquivo mudou desde a proposta)
    for (const d of diffs) {
      const resolved = await safeResolve(d.path);
      let currentSha: string | null = null;
      try {
        const current = await fs.readFile(resolved, "utf-8");
        currentSha = sha256(current);
      } catch { currentSha = null; }
      if (currentSha !== d.oldSha) {
        return {
          ok: false,
          error: `Conflito em '${d.path}': arquivo mudou desde a proposta (sha esperado ${d.oldSha?.slice(0, 8) ?? "null"}, atual ${currentSha?.slice(0, 8) ?? "null"}).`,
        };
      }
    }
    // Aplica edits
    const resolvedPaths: string[] = [];
    for (const d of diffs) {
      const resolved = await safeResolve(d.path);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, d.newContent, "utf-8");
      resolvedPaths.push(d.path);
    }
    // git commit (mesmo padrão do approve em arvore-code.ts: spawn sem shell)
    const safeMsg = summary.slice(0, 100).replace(/[\r\n]+/g, " ");
    await new Promise<void>((resolve) => {
      const addProc = spawn("git", ["add", "--", ...resolvedPaths], { cwd: process.cwd() });
      addProc.on("close", (addCode) => {
        if (addCode !== 0) { logger.warn({ proposalId, addCode }, "[arvore-mission] git add falhou"); resolve(); return; }
        const commitProc = spawn(
          "git",
          [
            "-c", "user.name=Arvore Arquiteto",
            "-c", "user.email=arquiteto@salescockpit.local",
            "commit", "-m", `arquiteto-auto: ${safeMsg} (proposta #${proposalId})`,
          ],
          { cwd: process.cwd() },
        );
        let stderr = "";
        commitProc.stderr.on("data", (c) => (stderr += c.toString()));
        commitProc.on("close", (commitCode) => {
          if (commitCode !== 0) logger.warn({ proposalId, commitCode, stderr: stderr.slice(0, 300) }, "[arvore-mission] git commit falhou (edits aplicados)");
          resolve();
        });
      });
    });
    return { ok: true, filesWritten: diffs.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendMissionEmail(opts: {
  proposalId: number;
  summary: string;
  files: string[];
  costBRL: number;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  applied: boolean;
  applyError?: string;
  monthlySpendBRL: number;
}): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const to = "yurituccieterovic@gmail.com";
  if (!gmailUser || !gmailPass) {
    logger.warn({ proposalId: opts.proposalId }, "[arvore-mission] GMAIL_USER/PASS ausentes — não enviei email");
    return;
  }
  const status = opts.applied
    ? "APLICADA (custo baixo, auto-apply)"
    : opts.applyError
      ? `FALHOU APLICAR (${opts.applyError}) — revisar manualmente`
      : "AGUARDANDO REVISÃO (custo acima do gate)";
  const subject = `[Arquiteto] Proposta #${opts.proposalId} — ${status}`;
  const fileList = opts.files.map((f) => `  • ${f}`).join("\n");
  const body = `Olá Yuri,

A missão semanal do Arquiteto rodou e produziu uma proposta.

  Proposta:  #${opts.proposalId}
  Status:    ${status}
  Arquivos:  ${opts.files.length}
${fileList}

Resumo do Arquiteto:
${opts.summary}

Custo desta proposta:
  Input tokens:   ${opts.inputTokens.toLocaleString("pt-BR")}
  Output tokens:  ${opts.outputTokens.toLocaleString("pt-BR")}
  Iterações:      ${opts.iterations}
  Custo (BRL):    R$ ${opts.costBRL.toFixed(2)}
  Gate auto-apply: R$ ${AUTO_APPLY_CEIL_BRL.toFixed(2)}

Gasto acumulado neste mês:
  R$ ${opts.monthlySpendBRL.toFixed(2)} de R$ ${MONTHLY_BUDGET_BRL.toFixed(2)} (teto)

Próximos passos:
${opts.applied
    ? "  • Os arquivos já foram escritos no Replit + git commit local.\n  • A produção SÓ atualiza quando você der Republish manual.\n  • Se a mudança ficou ruim: git revert HEAD no shell."
    : "  • Abre /arvore-code/" + opts.proposalId + " no site pra ver o diff e aprovar/rejeitar.\n  • Aprovar: escreve os arquivos + git commit local. Republish manual depois."}

Próxima varredura: em 7 dias (segunda).

Árvore Arquiteto — missão semanal`;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({ from: gmailUser, to, subject, text: body });
    logger.info({ proposalId: opts.proposalId }, "[arvore-mission] email enviado");
  } catch (err) {
    logger.error({ err, proposalId: opts.proposalId }, "[arvore-mission] falhou ao enviar email");
  }
}

async function sendBudgetCapEmail(spendBRL: number): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
      from: gmailUser,
      to: "yurituccieterovic@gmail.com",
      subject: `[Arquiteto] Teto mensal de R$ ${MONTHLY_BUDGET_BRL.toFixed(2)} atingido — varredura pausada`,
      text: `Gasto acumulado deste mês: R$ ${spendBRL.toFixed(2)}. Varredura pausada até o dia 1º do próximo mês.`,
    });
  } catch (err) {
    logger.error({ err }, "[arvore-mission] falhou email de teto");
  }
}

export async function runArchitectMission(opts?: { force?: boolean }): Promise<{
  ran: boolean;
  reason?: string;
  proposalId?: number;
  applied?: boolean;
  costBRL?: number;
}> {
  try {
    // 1. Debounce 6 dias (idempotência se app reiniciar)
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreProposalsTable.createdAt })
        .from(arvoreProposalsTable)
        .where(eq(arvoreProposalsTable.createdBy, CREATED_BY))
        .orderBy(desc(arvoreProposalsTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { ran: false, reason: "debounce" };
      }
    }

    // 2. Teto mensal
    const monthlySpend = await getMonthlySpendBRL();
    if (monthlySpend >= MONTHLY_BUDGET_BRL) {
      logger.warn({ monthlySpend }, "[arvore-mission] teto mensal batido, pulando");
      void sendBudgetCapEmail(monthlySpend);
      return { ran: false, reason: "teto-mensal" };
    }

    logger.info({ monthlySpend }, "[arvore-mission] iniciando varredura");

    // 3. Memória: últimas 5 propostas pra evitar repetir. Anexa ao prompt
    // como bloco "JÁ PROPOSTO RECENTEMENTE — NÃO REPETIR".
    const recent = await getRecentSummaries(5);
    const memoryBlock = recent.length
      ? `\n\nJÁ PROPOSTO NAS ÚLTIMAS 5 VARREDURAS (evite repetir; busque algo diferente):\n${recent.map((s, i) => `${i + 1}. ${s.slice(0, 300)}`).join("\n")}`
      : "";
    const promptWithMemory = MISSION_PROMPT + memoryBlock;

    // 4. Dispara o Arquiteto
    const out = await proposeCodeChange(promptWithMemory);
    const costThisRun = costBRL(out.cost.inputTokens, out.cost.outputTokens);

    // Sem edits = varredura limpa, registra mesmo assim pro tracking de custo
    if (out.edits.length === 0) {
      const [row] = await db
        .insert(arvoreProposalsTable)
        .values({
          request: "[missão semanal automática]",
          summary: out.summary || "nenhuma melhoria urgente encontrada",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          diffs: [] as any,
          status: "rejected", // sem edits = nada a aprovar
          createdBy: CREATED_BY,
          inputTokens: out.cost.inputTokens,
          outputTokens: out.cost.outputTokens,
        })
        .returning();
      logger.info({ proposalId: row?.id, costBRL: costThisRun }, "[arvore-mission] sem edits");
      return { ran: true, reason: "sem-edits", proposalId: row?.id, costBRL: costThisRun };
    }

    // 4. Persiste proposta (status definido depois do apply attempt)
    const [row] = await db
      .insert(arvoreProposalsTable)
      .values({
        request: "[missão semanal automática]",
        summary: out.summary,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        diffs: out.edits as any,
        status: "pending",
        createdBy: CREATED_BY,
        inputTokens: out.cost.inputTokens,
        outputTokens: out.cost.outputTokens,
      })
      .returning();
    const proposalId = row?.id ?? -1;

    // 5. Decide aplicar ou só email. Gate dupla:
    //    (a) custo < AUTO_APPLY_CEIL_BRL, E
    //    (b) NENHUM arquivo está em CRITICAL_PATH_PREFIXES (auth/billing/schema).
    // Qualquer toque em path crítico FORÇA revisão manual mesmo se custo for trivial.
    const newMonthlySpend = monthlySpend + costThisRun;
    let applied = false;
    let applyError: string | undefined;
    const criticalPath = touchesCriticalPath(out.edits);
    if (criticalPath) {
      logger.warn({ proposalId, criticalPath }, "[arvore-mission] proposta toca path crítico, forçando revisão manual");
    }
    // Mesmo problema arquitetural do approve em prod: applyProposalEdits roda no container
    // efêmero de produção. Auto-apply em prod escrevia em filesystem que sumia no próximo
    // restart. Em prod, força o fluxo de revisão manual independente do custo.
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      logger.info({ proposalId, costBRL: costThisRun }, "[arvore-mission] em prod: nunca auto-aplica (filesystem efêmero) — vai pra fila de revisão");
    }
    if (!isProd && costThisRun < AUTO_APPLY_CEIL_BRL && !criticalPath) {
      const result = await applyProposalEdits(out.edits, proposalId, out.summary);
      if (result.ok) {
        applied = true;
        await db
          .update(arvoreProposalsTable)
          .set({
            status: "approved",
            appliedAt: new Date(),
            appliedToDisk: true,
            appliedToDiskAt: new Date(),
            appliedIn: "dev-repl",
          })
          .where(eq(arvoreProposalsTable.id, proposalId));
        logger.info({ proposalId, files: result.filesWritten, costBRL: costThisRun }, "[arvore-mission] auto-aplicada");
      } else {
        applyError = result.error;
        await db
          .update(arvoreProposalsTable)
          .set({ status: "failed", errorMsg: result.error })
          .where(eq(arvoreProposalsTable.id, proposalId));
        logger.error({ proposalId, error: result.error }, "[arvore-mission] auto-apply falhou");
      }
    } else {
      logger.info({ proposalId, costBRL: costThisRun, ceil: AUTO_APPLY_CEIL_BRL, isProd }, "[arvore-mission] aguardando revisão");
    }

    // 6. Email
    void sendMissionEmail({
      proposalId,
      summary: out.summary,
      files: out.edits.map((e) => e.path),
      costBRL: costThisRun,
      inputTokens: out.cost.inputTokens,
      outputTokens: out.cost.outputTokens,
      iterations: out.iterations,
      applied,
      applyError,
      monthlySpendBRL: newMonthlySpend,
    });

    return { ran: true, proposalId, applied, costBRL: costThisRun };
  } catch (err) {
    logger.error({ err }, "[arvore-mission] erro fatal");
    return { ran: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function startArchitectMissionLoop(): void {
  if (process.env.NODE_ENV !== "production") {
    logger.info("[arvore-mission] loop desligado em dev (NODE_ENV != production)");
    return;
  }
  setTimeout(() => {
    void runArchitectMission();
    setInterval(() => void runArchitectMission(), INTERVAL_MS);
  }, BOOT_DELAY_MS);
  logger.info(
    { intervalDays: INTERVAL_MS / 86_400_000, bootDelayMin: BOOT_DELAY_MS / 60_000, monthlyBudgetBRL: MONTHLY_BUDGET_BRL, autoApplyCeilBRL: AUTO_APPLY_CEIL_BRL },
    "[arvore-mission] loop agendado",
  );
}

// Silencia warning de `sql` import não usado: drizzle às vezes precisa dele em scopes futuros.
// Mantido pra paralelismo com outros lib/arvore-*.ts que migram pra sql() quando preciso.
void sql;

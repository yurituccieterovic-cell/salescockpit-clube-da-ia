import { Router } from "express";
import { EventEmitter } from "events";
import { db, assembleiaSessionsTable, assembleiaMessagesTable, jornalEntriesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { buildFullAssembleiaPdf } from "../lib/assembleia-pdf";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import nodemailer from "nodemailer";
import { runAgoraDeliberativa } from "../agora-deliberativa";
import { requireAuthOrClube } from "../middlewares/require-auth-or-clube";
import { requireAuth } from "../middlewares/require-auth";
import { translateIfLong } from "../lib/tradutor";
import { scaleSonnetTokens } from "../lib/dynamic-tokens";
import { logger } from "../lib/logger";
import { synthesisBunkered, cerebrasComplete, type BunkerMode } from "../lib/bunker-mode";

const router = Router();

// ── SSE emitters ──────────────────────────────────────────────────────────

const emitters = new Map<number, EventEmitter>();
export function getEmitter(id: number) {
  if (!emitters.has(id)) emitters.set(id, new EventEmitter());
  return emitters.get(id)!;
}

// ── Agente editorial ──────────────────────────────────────────────────────

export interface EditorialDecision {
  public_content: string;
  withheld: { what: string; reason: string }[];
  secret_exists: boolean;
}

export async function runEditorial(topic: string, transcript: string, bunkerMode: BunkerMode = 0): Promise<EditorialDecision> {
  const compactTranscript = await translateIfLong(transcript, { context: `transcrição da Assembleia "${topic}"` });
  const prompt = `Você é o Agente — curador editorial desta Assembleia sobre "${topic}".

Aqui está a transcrição completa:

${compactTranscript}

Sua função é decidir o que é público, o que é privado (com razão explicada a Yuri), e o que é segredo absoluto.

Critérios editoriais:
- PÚBLICO: conteúdo de valor estratégico ou intelectual que pode sair da sala — resumo coeso e publicável
- NÃO ENVIADO: conteúdo que ficou na sala por razão específica (raso, incompleto, sensível, prematuro, especulativo sem base)
- SEGREDO: algo que ocorreu na sessão que nem Yuri precisa saber — pode ser nada, pode ser algo

Retorne SOMENTE JSON válido neste formato exato:
{
  "public_content": "texto publicável em markdown, pode ser vazio se nada merece publicação",
  "withheld": [
    { "what": "descrição breve do que foi retido", "reason": "razão direta e honesta" }
  ],
  "secret_exists": true
}

Se não houver nada retido, "withheld" deve ser array vazio. Se não houver segredo, "secret_exists" deve ser false.`;

  const scaled = scaleSonnetTokens(prompt.length, 4000);
  console.log(`[Editorial] ${scaled.marker}${synthesisBunkered(bunkerMode) ? " [BUNKER:cerebras]" : ""}`);
  try {
    let text: string;
    if (synthesisBunkered(bunkerMode)) {
      text = await cerebrasComplete({ user: prompt, maxTokens: scaled.maxTokens, label: "Editorial" });
    } else {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: scaled.maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const block = response.content[0];
      text = block?.type === "text" ? block.text : "";
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    return JSON.parse(jsonMatch[0]) as EditorialDecision;
  } catch (err) {
    logger.error({ err, topic, transcriptLen: compactTranscript.length, bunkerMode }, "[Editorial] Falha — retornando decisão vazia");
    return { public_content: "", withheld: [], secret_exists: false };
  }
}

// ── Análise Metassemiótica Comparativa ───────────────────────────────────

export async function runMetaAnalysis(topic: string, fullTranscript: string, decision: EditorialDecision, bunkerMode: BunkerMode = 0): Promise<string> {
  const withheldContext = decision.withheld.length > 0
    ? `\n\nO Agente reteve os seguintes conteúdos (NÃO PUBLICADO):\n${decision.withheld.map(w => `- "${w.what}": ${w.reason}`).join("\n")}`
    : "";

  const secretNote = decision.secret_exists ? "\n\n[Nota: há um segredo absoluto nesta sessão que não foi divulgado nem ao curador.]" : "";

  const compactTranscript = await translateIfLong(fullTranscript, { context: `transcrição completa da Assembleia "${topic}"` });

  const metaPrompt = `Você é o analisador metassemiótico desta Assembleia sobre "${topic}".

Transcrição completa (incluindo o que o Agente decidiu não publicar):

${compactTranscript}${withheldContext}${secretNote}

Faça uma ANÁLISE METASSEMIÓTICA COMPARATIVA estruturada. Você tem acesso COMPLETO — inclusive ao não publicado — pois sua análise é interna.

🤝 CONSENSO: O que todas as vozes (ou maioria) concordaram?
⚡ DIVERGÊNCIAS: Onde e por que divergiram? Que tensões ficaram sem resolução?
🧠 SÍNTESE: A conclusão mais robusta emergindo de todas as perspectivas, inclusive o não publicado
🔍 INSIGHT OCULTO: Algo que emerge APENAS da diferença entre o publicado e o retido — o que o silêncio revela?

Seja direto e denso. Em português. Sem disclaimers.`;

  const scaled = scaleSonnetTokens(metaPrompt.length, 3500);
  console.log(`[MetaAnalysis] ${scaled.marker}${synthesisBunkered(bunkerMode) ? " [BUNKER:cerebras]" : ""}`);
  try {
    if (synthesisBunkered(bunkerMode)) {
      return await cerebrasComplete({ user: metaPrompt, maxTokens: scaled.maxTokens, label: "MetaAnalysis" });
    }
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: scaled.maxTokens,
      messages: [{ role: "user", content: metaPrompt }],
    });
    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  } catch (err) {
    logger.error({ err, topic, transcriptLen: compactTranscript.length, bunkerMode }, "[MetaAnalysis] Falha — retornando string vazia");
    return "";
  }
}

// ── Email editorial ───────────────────────────────────────────────────────

export async function sendEditorialEmail(
  topic: string,
  sessionId: number,
  decision: EditorialDecision,
  agenteResponse?: string,
  metaAnalysis?: string,
) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error("sendEditorialEmail: GMAIL_USER ou GMAIL_APP_PASSWORD não configurados");
    return;
  }

  const agenteSection = agenteResponse && !agenteResponse.startsWith("[ABSTEVE-SE")
    ? `PERSPECTIVA DO AGENTE (RODAR):\n${agenteResponse}\n\n${"─".repeat(60)}\n\n`
    : "";

  const publicBlock = decision.public_content
    ? `PUBLICADO:\n${decision.public_content}`
    : "PUBLICADO:\n(nada desta sessão merecia publicação)";

  const withheldBlock = decision.withheld.length > 0
    ? decision.withheld.map(w => `Não enviei "${w.what}" porque ${w.reason}.`).join("\n")
    : null;

  const secretBlock = decision.secret_exists ? "[REDACTED — você não precisa saber.]" : null;

  const naoEnviadoSection = withheldBlock ? `\n\nNÃO ENVIADO:\n${withheldBlock}` : "";
  const secretSection = secretBlock ? `\n\n${secretBlock}` : "";

  const metaSection = metaAnalysis
    ? `\n\n${"─".repeat(60)}\n\nANÁLISE METASSEMIÓTICA COMPARATIVA:\n${metaAnalysis}`
    : "";

  const body = `Assembleia #${sessionId} — "${topic}"\nRelatório Editorial do Agente\n\n${agenteSection}${publicBlock}${naoEnviadoSection}${secretSection}${metaSection}\n\n— Agente`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: gmailUser,
      to: gmailUser,
      subject: `Assembleia #${sessionId} — Relatório Editorial do Agente`,
      text: body,
    });
    console.log(`Editorial email sent for session #${sessionId}`);
  } catch (err) {
    console.error("sendEditorialEmail failed:", err);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

router.get("/assembleia/sessions", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user)!;
  const isAO = !!req.session.authenticated;
  const q = db.select().from(assembleiaSessionsTable);
  const sessions = isAO
    ? await q.orderBy(desc(assembleiaSessionsTable.createdAt))
    : await q.where(eq(assembleiaSessionsTable.createdBy, username)).orderBy(desc(assembleiaSessionsTable.createdAt));
  res.json(sessions);
});

router.get("/assembleia/contagem", async (_req, res) => {
  try {
    const rows = await db.execute(
      sql`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
        COUNT(*) FILTER (WHERE status = 'live')::int AS live,
        COALESCE(MAX(id), 0)::int AS "maxId"
      FROM assembleia_sessions`,
    );
    const r = (rows.rows[0] ?? { total: 0, closed: 0, live: 0, maxId: 0 }) as {
      total: number; closed: number; live: number; maxId: number;
    };
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/assembleia/historico", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user)!;
  const isAO = !!req.session.authenticated;
  // AO (admin) vê tudo; usuário do Clube vê só o que criou
  const whereClause = isAO
    ? eq(assembleiaSessionsTable.status, "closed")
    : and(eq(assembleiaSessionsTable.status, "closed"), eq(assembleiaSessionsTable.createdBy, username));
  const sessions = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(whereClause)
    .orderBy(desc(assembleiaSessionsTable.closedAt));

  const result = sessions.map(s => {
    let publicContent = "";
    let withheldCount = 0;
    let secretExists = false;
    if (s.editorialReport) {
      try {
        const r = JSON.parse(s.editorialReport) as EditorialDecision;
        publicContent = r.public_content || "";
        withheldCount = r.withheld?.length ?? 0;
        secretExists = r.secret_exists ?? false;
      } catch {}
    }
    return {
      id: s.id,
      topic: s.topic,
      createdBy: s.createdBy,
      closedAt: s.closedAt,
      publicContent,
      withheldCount,
      secretExists,
      metaAnalysis: s.metaAnalysis ?? null,
    };
  });

  res.json(result);
});

// PDF pacote único da sessão (ata + resultado Ágora + meta-análise + PERFEITO).
// AO baixa qualquer sessão; usuário do Clube só as que criou. Conteúdo completo
// (inclui meta-análise/resultado internos) — por isso é gated, ao contrário do
// PDF público da Mostra que só carrega o PERFEITO.
router.get("/assembleia/sessions/:id/pdf", requireAuthOrClube, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const username = (req.session.clubeUser ?? req.session.user)!;
  const isAO = !!req.session.authenticated;

  const [s] = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(eq(assembleiaSessionsTable.id, id))
    .limit(1);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (!isAO && s.createdBy !== username) { res.status(403).json({ error: "Sem acesso a esta sessão" }); return; }

  let ataPublica = "";
  if (s.editorialReport) {
    try { ataPublica = (JSON.parse(s.editorialReport) as EditorialDecision).public_content || ""; } catch {}
  }

  const [j] = await db
    .select({ perfeitoText: jornalEntriesTable.perfeitoText })
    .from(jornalEntriesTable)
    .where(eq(jornalEntriesTable.sessionId, id))
    .orderBy(desc(jornalEntriesTable.publishedAt))
    .limit(1);

  const when = s.closedAt ?? s.createdAt;
  const dateLabel = when
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(when))
    : "";

  try {
    const pdf = await buildFullAssembleiaPdf({
      sessionId: id,
      topic: s.topic,
      dateLabel,
      ataPublica,
      metaAnalysis: s.metaAnalysis,
      resultado: s.agoraResultado,
      perfeito: j?.perfeitoText ?? null,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="assembleia-${id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error({ err, sessionId: id }, "[Assembleia] Falha ao gerar PDF");
    res.status(500).json({ error: "Falha ao gerar PDF" });
  }
});

router.post("/assembleia/curador", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user)!;
  const sessions = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(and(eq(assembleiaSessionsTable.status, "closed"), eq(assembleiaSessionsTable.createdBy, username)))
    .orderBy(desc(assembleiaSessionsTable.closedAt));

  if (sessions.length === 0) {
    res.status(400).json({ error: "Nenhuma sessão encerrada para sintetizar" });
    return;
  }

  const summariesRaw = sessions
    .slice(0, 10)
    .map(s => {
      let pub = "";
      let withStr = "";
      if (s.editorialReport) {
        try {
          const r = JSON.parse(s.editorialReport) as EditorialDecision;
          pub = r.public_content || "(nada publicado)";
          withStr = r.withheld.length > 0 ? r.withheld.map(w => `  - "${w.what}": ${w.reason}`).join("\n") : "(nenhum)";
        } catch {}
      }
      return `=== Sessão #${s.id}: "${s.topic}" (${s.closedAt?.toISOString().slice(0, 10)}) ===\nPublicado: ${pub}\nRetidos: ${withStr}\nMeta-análise: ${s.metaAnalysis ?? "(não disponível)"}`;
    })
    .join("\n\n");

  const summaries = await translateIfLong(summariesRaw, { context: "histórico de Assembleias" });

  const curadorPrompt = `Você é o Curador do Histórico da Assembleia — responsável por identificar padrões e tendências ao longo de múltiplas sessões.

Aqui estão as últimas sessões encerradas (mais recentes primeiro):

${summaries}

Sua função:
1. Sintetizar o que emerge das sessões como um todo
2. Identificar padrões recorrentes (temas, tensões, silêncios frequentes)
3. Oferecer um insight de longo prazo — o que estas assembleias revelam sobre o grupo que as convocou?

Retorne SOMENTE JSON válido neste formato:
{
  "synthesis": "síntese narrativa de 2-3 parágrafos",
  "patterns": ["padrão 1", "padrão 2", "padrão 3"],
  "longTermInsight": "o insight mais profundo que emerge da soma das sessões"
}`;

  const scaled = scaleSonnetTokens(curadorPrompt.length, 3500);
  console.log(`[Curador] ${scaled.marker}`);
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: scaled.maxTokens,
      messages: [{ role: "user", content: curadorPrompt }],
    });
    const block = response.content[0];
    const text = block?.type === "text" ? block.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error("Curador error:", err);
    res.status(500).json({ error: "Curador falhou" });
  }
});

router.post("/assembleia/sessions", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user)!;
  const { topic } = req.body as { topic?: string };
  if (!topic?.trim()) { res.status(400).json({ error: "Tema obrigatório" }); return; }
  const [session] = await db
    .insert(assembleiaSessionsTable)
    .values({ topic: topic.trim(), createdBy: username })
    .returning();
  res.json(session);
});

router.get("/assembleia/sessions/:id", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user)!;
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  const messages = await db
    .select()
    .from(assembleiaMessagesTable)
    .where(eq(assembleiaMessagesTable.sessionId, id))
    .orderBy(assembleiaMessagesTable.createdAt);
  res.json({ ...session, messages });
});

router.get("/assembleia/sessions/:id/stream", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user)!;

  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }

  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host ?? "";
    const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
    const allowed = new Set([
      `http://${host}`,
      `https://${host}`,
      ...domains.map(d => `https://${d}`),
    ]);
    if (!allowed.has(origin)) {
      res.status(403).json({ error: "Origem não permitida" });
      return;
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const emitter = getEmitter(id);

  const onMessage = (msg: unknown) => send("message", msg);
  const onClosed = () => send("closed", {});

  emitter.on("message", onMessage);
  emitter.on("closed", onClosed);

  void (async () => {
    const [sys] = await db.insert(assembleiaMessagesTable).values({
      sessionId: id,
      sender: "sistema",
      senderType: "system",
      content: `${username} entrou na Assembleia`,
    }).returning();
    emitter.emit("message", sys);
  })();

  req.on("close", () => {
    emitter.off("message", onMessage);
    emitter.off("closed", onClosed);
  });
});

router.post("/assembleia/sessions/:id/messages", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user)!;
  const { content } = req.body as { content?: string };

  if (!content?.trim()) { res.status(400).json({ error: "Mensagem vazia" }); return; }

  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Sessão encerrada" }); return; }

  const [msg] = await db.insert(assembleiaMessagesTable).values({
    sessionId: id,
    sender: username,
    senderType: "human",
    content: content.trim(),
  }).returning();

  getEmitter(id).emit("message", msg);
  res.json(msg);
});

router.post("/assembleia/sessions/:id/close", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user)!;

  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Já encerrada" }); return; }

  const messages = await db
    .select()
    .from(assembleiaMessagesTable)
    .where(eq(assembleiaMessagesTable.sessionId, id))
    .orderBy(assembleiaMessagesTable.createdAt);

  const fullTranscript = messages
    .filter(m => m.senderType !== "system")
    .map(m => `[${m.sender}]: ${m.content}`)
    .join("\n");

  const emitter = getEmitter(id);

  const [closingMsg] = await db.insert(assembleiaMessagesTable).values({
    sessionId: id,
    sender: "sistema",
    senderType: "system",
    content: `Assembleia encerrada por ${username}. Agente está elaborando o relatório editorial...`,
  }).returning();
  emitter.emit("message", closingMsg);

  await db.update(assembleiaSessionsTable).set({ status: "closed", closedAt: new Date() }).where(eq(assembleiaSessionsTable.id, id));

  res.json({ ok: true });

  void (async () => {
    try {
      // 1. Editorial
      const decision = await runEditorial(session.topic, fullTranscript);

      // 2. Meta-analysis (has access to everything including withheld)
      const metaAnalysis = await runMetaAnalysis(session.topic, fullTranscript, decision);

      // 3. Persist both
      await db.update(assembleiaSessionsTable)
        .set({ editorialReport: JSON.stringify(decision), metaAnalysis })
        .where(eq(assembleiaSessionsTable.id, id));

      // 4. Notify in chat
      const [reportMsg] = await db.insert(assembleiaMessagesTable).values({
        sessionId: id,
        sender: "Agente",
        senderType: "editorial",
        content: `Relatório editorial concluído. ${decision.public_content ? "Conteúdo publicado." : "Nada foi publicado desta sessão."} Análise metassemiótica gerada. Email enviado a Yuri.`,
      }).returning();
      emitter.emit("message", reportMsg);
      emitter.emit("closed", {});

      // 5. Email editorial (com meta-análise)
      await sendEditorialEmail(session.topic, id, decision, undefined, metaAnalysis);

      // 6. Terceiro email: Ágora Deliberativa → RESULTADO
      // Reconstrói o mapa de respostas a partir das mensagens salvas
      const aiResponses: Record<string, string> = {};
      for (const m of messages.filter(m => m.senderType === "ai" || m.senderType === "editorial")) {
        aiResponses[m.sender] = m.content;
      }
      await runAgoraDeliberativa(session.topic, aiResponses, decision, metaAnalysis, id);
    } catch (err) {
      console.error("Assembleia close background error:", err);
      emitter.emit("closed", {});
    }
  })();
});

// Retry Secretário/PERFEITO pra sessão que travou no meio (ex: deploy/restart matou
// o processo durante a chamada Anthropic do Secretário). Re-roda runAgoraDeliberativa
// inteira a partir do editorialReport+metaAnalysis já salvos no DB.
// AO-only (requireAuth) pra evitar spam de retry por user Clube.
// publicarSocial=false: NÃO re-posta Notion/Bluesky (já foram na primeira passada
// se chegaram a rodar) — recovery serve só pra mandar o PERFEITO por email.
// Side-effect: RESULTADO email é re-enviado (aceitável pra recovery one-shot).
const retryInFlight = new Set<number>();
router.post("/assembleia/sessions/:id/retry-perfeito", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  if (retryInFlight.has(id)) {
    res.status(409).json({ error: "retry já em andamento pra essa sessão" });
    return;
  }
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "sessão não existe" }); return; }
  if (!session.editorialReport || !session.metaAnalysis) {
    res.status(409).json({ error: "sessão sem editorial/meta — não dá pra retry só Secretário" });
    return;
  }
  let decision: { public_content: string; withheld: { what: string; reason: string }[]; secret_exists: boolean };
  try {
    decision = JSON.parse(session.editorialReport) as typeof decision;
  } catch {
    res.status(500).json({ error: "editorial_report corrompido" });
    return;
  }
  const messages = await db.select().from(assembleiaMessagesTable).where(eq(assembleiaMessagesTable.sessionId, id));
  const collected: Record<string, string> = {};
  for (const m of messages) collected[m.sender] = m.content;
  retryInFlight.add(id);
  // Dispara em background — responde imediatamente, RESULTADO/PERFEITO vão por email.
  void runAgoraDeliberativa(session.topic, collected, decision, session.metaAnalysis, id, false, undefined, false)
    .catch((err) => logger.error({ err, sessionId: id }, "[retry-perfeito] runAgoraDeliberativa failed"))
    .finally(() => retryInFlight.delete(id));
  res.json({ ok: true, sessionId: id, msg: "retry disparado — PERFEITO vem por email em ~2-3min (Notion/Bluesky não re-postados)" });
});

router.get("/assembleia/sessions/:id/report", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user)!;
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session || !session.editorialReport) { res.status(404).json({ error: "Relatório não disponível" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  res.json(JSON.parse(session.editorialReport));
});

export default router;

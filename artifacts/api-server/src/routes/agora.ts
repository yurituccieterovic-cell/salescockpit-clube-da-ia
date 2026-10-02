import { Router } from "express";
import { EventEmitter } from "events";
import { db, assembleiaSessionsTable, assembleiaMessagesTable, agoraTurnsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuthOrClube } from "../middlewares/require-auth-or-clube";

import { fetchGroqChat } from "../lib/groq-retry";
const router = Router();

// ── Shared SSE emitters (exported for webhook use) ─────────────────────
export const agoraEmitters = new Map<number, EventEmitter>();
export function getAgoraEmitter(id: number) {
  if (!agoraEmitters.has(id)) agoraEmitters.set(id, new EventEmitter());
  return agoraEmitters.get(id)!;
}

// ── Voting prompt builder ──────────────────────────────────────────────
const AI_PERSONAS: Record<string, string> = {
  "ChatGPT": "Você é ChatGPT da OpenAI. Seja claro, direto e aprofundado.",
  "Claude": "Você é Claude da Anthropic. Seja nuançado, ético e perspicaz.",
  "Gemini": "Você é Gemini do Google. Integre múltiplas perspectivas com síntese.",
  "Árvore": "Você é a Árvore Oracular. Seja oráculo: direto, denso, sem rodeios.",
  "Agente": "Você é o Agente Editorial. Avalie com precisão curatorial.",
  "Grok": "Você é Grok da xAI. Direto, irônico quando necessário, sem eufemismos.",
  "Meta AI": "Você é Meta AI. Ampla perspectiva de plataforma e escala.",
};

function buildVotePrompt(aiName: string, topic: string, transcript: string, sender: string, message: string): string {
  const persona = AI_PERSONAS[aiName] ?? "Você é uma IA participante.";
  return `${persona}

PROTOCOLO ÁGORA — Conselho deliberativo sobre: "${topic}"

HISTÓRICO DA SESSÃO:
${transcript || "(sem falas anteriores)"}

NOVA FALA de ${sender}:
"${message}"

INSTRUÇÃO OBRIGATÓRIA: Avalie de 0 a 10 o quanto você QUER e DEVE responder esta fala.
0 = abstensão total | 10 = urgência máxima

Responda EXATAMENTE neste formato (sem texto antes de NOTA:):

NOTA: [número de 0 a 10]
---
[Sua resposta aqui se nota > 0. Se nota = 0, deixe em branco após o ---.]

Seja conciso. Máximo 3 parágrafos. Em português.`;
}

function parseVote(raw: string): { score: number; response: string } {
  const trimmed = raw.trim();
  const notaMatch = trimmed.match(/NOTA:\s*(\d+)/);
  const score = notaMatch ? Math.min(10, Math.max(0, parseInt(notaMatch[1]))) : 0;
  const sepIdx = trimmed.indexOf("---");
  const response = sepIdx >= 0 ? trimmed.slice(sepIdx + 3).trim() : "";
  return { score, response };
}

// ── Call each AI ────────────────────────────────────────────────────────
async function callAgoraAI(aiName: string, prompt: string): Promise<{ score: number; response: string }> {
  try {
    if (aiName === "Claude") {
      const { anthropic } = await import("@workspace/integrations-anthropic-ai");
      const resp = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
      const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      return parseVote(text);
    }
    if (aiName === "ChatGPT") {
      const { openai } = await import("@workspace/integrations-openai-ai-server");
      const resp = await openai.chat.completions.create({
        model: "gpt-4o", max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
      return parseVote(resp.choices[0]?.message?.content ?? "");
    }
    if (aiName === "Gemini") {
      // Migrado pra Groq Llama 3.3 (custo zero).
    const resp = await fetchGroqChat({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 600,
        }, "agora.ts");
      const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
      return parseVote(data.choices?.[0]?.message?.content ?? "");
    }
    if (aiName === "Árvore" || aiName === "Agente") {
    const resp = await fetchGroqChat({
          model: "openai/gpt-oss-120b",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }, "agora.ts");
      const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
      return parseVote(data.choices?.[0]?.message?.content ?? "");
    }
    if (aiName === "Grok") {
      // 2026-05: motor migrado pra Llama/Groq (xAI sem crédito). Persona Grok preservada.
    const resp = await fetchGroqChat({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: prompt }], max_tokens: 600 }, "agora.ts");
      const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
      return parseVote(data.choices?.[0]?.message?.content ?? "");
    }
    if (aiName === "Meta AI") {
    const resp = await fetchGroqChat({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.9,
          max_tokens: 600,
        }, "agora.ts");
      const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
      return parseVote(data.choices?.[0]?.message?.content ?? "");
    }
    return { score: 0, response: "" };
  } catch {
    return { score: 0, response: "" };
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

router.get("/agora/historico", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const isAO = !!req.session.authenticated;
  const where = isAO
    ? and(eq(assembleiaSessionsTable.mode, "agora"), eq(assembleiaSessionsTable.status, "closed"))
    : and(eq(assembleiaSessionsTable.mode, "agora"), eq(assembleiaSessionsTable.status, "closed"), eq(assembleiaSessionsTable.createdBy, username));
  const sessions = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(where)
    .orderBy(desc(assembleiaSessionsTable.closedAt));

  const result = await Promise.all(sessions.map(async (s) => {
    const messages = await db
      .select()
      .from(assembleiaMessagesTable)
      .where(eq(assembleiaMessagesTable.sessionId, s.id))
      .orderBy(assembleiaMessagesTable.createdAt);

    const turnIds = [...new Set(messages.filter(m => m.turnId != null).map(m => m.turnId!))];
    const aiResponses = messages.filter(m => m.senderType === "ai" && m.content !== "[abstenção]").length;
    const scores = messages.filter(m => m.score != null && m.score > 0).map(m => m.score!);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const turns = turnIds.map((turnId, idx) => {
      const firstAiInTurn = messages.find(m => m.turnId === turnId);
      const firstAiIdx = messages.indexOf(firstAiInTurn!);
      const humanMsg = [...messages.slice(0, firstAiIdx)].reverse().find(m => m.senderType === "human");
      const aiVotes = messages
        .filter(m => m.turnId === turnId && m.senderType === "ai")
        .map(m => ({ sender: m.sender, score: m.score ?? 0 }))
        .sort((a, b) => b.score - a.score);
      return {
        roundNum: idx + 1,
        humanSender: humanMsg?.sender ?? "?",
        humanContent: humanMsg?.content ?? "",
        aiVotes,
      };
    });

    return {
      id: s.id,
      topic: s.topic,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      totalRounds: turnIds.length,
      aiResponses,
      avgScore: Number(avgScore.toFixed(1)),
      turns,
    };
  }));

  res.json(result);
});

router.get("/agora/sessions", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const isAO = !!req.session.authenticated;
  const where = isAO
    ? eq(assembleiaSessionsTable.mode, "agora")
    : and(eq(assembleiaSessionsTable.mode, "agora"), eq(assembleiaSessionsTable.createdBy, username));
  const sessions = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(where)
    .orderBy(desc(assembleiaSessionsTable.createdAt));
  res.json(sessions);
});

router.post("/agora/sessions", requireAuthOrClube, async (req, res) => {
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const { topic } = req.body as { topic?: string };
  if (!topic?.trim()) { res.status(400).json({ error: "Tema obrigatório" }); return; }
  const [session] = await db
    .insert(assembleiaSessionsTable)
    .values({ topic: topic.trim(), createdBy: username, mode: "agora" })
    .returning();
  res.json(session);
});

router.get("/agora/sessions/:id", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  const messages = await db
    .select().from(assembleiaMessagesTable)
    .where(eq(assembleiaMessagesTable.sessionId, id))
    .orderBy(assembleiaMessagesTable.createdAt);
  res.json({ ...session, messages });
});

router.get("/agora/sessions/:id/stream", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const emitter = getAgoraEmitter(id);
  const onMsg = (d: unknown) => emit("message", d);
  const onVoting = (d: unknown) => emit("voting", d);
  const onDone = (d: unknown) => emit("turnDone", d);

  emitter.on("message", onMsg);
  emitter.on("voting", onVoting);
  emitter.on("turnDone", onDone);
  req.on("close", () => {
    emitter.off("message", onMsg);
    emitter.off("voting", onVoting);
    emitter.off("turnDone", onDone);
  });
});

// POST a message → triggers voting round
router.post("/agora/sessions/:id/speak", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "Fala vazia" }); return; }

  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session || session.mode !== "agora") { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Ágora encerrada" }); return; }

  const [humanMsg] = await db.insert(assembleiaMessagesTable).values({
    sessionId: id, sender: username, senderType: "human", content: content.trim(),
  }).returning();

  const [turn] = await db.insert(agoraTurnsTable).values({
    sessionId: id, humanMsg: content.trim(), sender: username,
  }).returning();

  const emitter = getAgoraEmitter(id);
  emitter.emit("message", humanMsg);
  res.json({ ok: true, humanMsg, turnId: turn.id });

  void (async () => {
    const allMessages = await db
      .select().from(assembleiaMessagesTable)
      .where(eq(assembleiaMessagesTable.sessionId, id))
      .orderBy(assembleiaMessagesTable.createdAt);

    const transcript = allMessages
      .filter(m => m.senderType !== "system" && m.id !== humanMsg.id)
      .map(m => m.score != null
        ? `[${m.sender} — Nota ${m.score}]: ${m.content}`
        : `[${m.sender}]: ${m.content}`)
      .join("\n");

    emitter.emit("voting", { turnId: turn.id, status: "voting" });

    const activeAIs = ["ChatGPT", "Claude", "Gemini", "Árvore", "Agente"];
    // 2026-05: Grok agora roda em Llama/Groq — gate checa GROQ_API_KEY.
    if (process.env.GROQ_API_KEY) activeAIs.push("Grok");

    const votes = await Promise.all(
      activeAIs.map(async (ai) => {
        const prompt = buildVotePrompt(ai, session.topic, transcript, username, content.trim());
        const result = await callAgoraAI(ai, prompt);
        return { ai, ...result };
      })
    );

    const sorted = [...votes].sort((a, b) => b.score - a.score);

    for (const vote of sorted) {
      if (vote.score === 0 || !vote.response) {
        const [msg] = await db.insert(assembleiaMessagesTable).values({
          sessionId: id, sender: vote.ai, senderType: "ai",
          content: "[abstenção]", score: 0, turnId: turn.id,
        }).returning();
        emitter.emit("message", msg);
      } else {
        const [msg] = await db.insert(assembleiaMessagesTable).values({
          sessionId: id, sender: vote.ai, senderType: "ai",
          content: vote.response, score: vote.score, turnId: turn.id,
        }).returning();
        emitter.emit("message", msg);
      }
    }

    await db.update(agoraTurnsTable).set({ status: "done" }).where(eq(agoraTurnsTable.id, turn.id));
    emitter.emit("turnDone", { turnId: turn.id });
  })();
});

router.post("/agora/sessions/:id/close", requireAuthOrClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = (req.session.clubeUser ?? req.session.user) as string;
  const [session] = await db.select().from(assembleiaSessionsTable).where(eq(assembleiaSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.createdBy !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Já encerrada" }); return; }

  await db.update(assembleiaSessionsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(assembleiaSessionsTable.id, id));

  const [closingMsg] = await db.insert(assembleiaMessagesTable).values({
    sessionId: id, sender: "sistema", senderType: "system",
    content: `Ágora encerrada por ${username}.`,
  }).returning();

  getAgoraEmitter(id).emit("message", closingMsg);
  res.json({ ok: true });
});

export default router;

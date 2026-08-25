import { Router } from "express";
import { db, assembleiaSessionsTable, assembleiaMessagesTable, externalAiWebhooksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEmitter } from "./assembleia";
import { consumeCallbackToken } from "../lib/callback-tokens";
import { validateWebhookUrl } from "../lib/ssrf-guard";

const router = Router();

// ── Incoming: external AI POSTs its response ────────────────────────────
router.post("/webhooks/external-voice", async (req, res) => {
  const { callbackToken, voice, assembleiaId, content } = req.body as {
    callbackToken?: string;
    voice?: string;
    assembleiaId?: number;
    content?: string;
  };

  if (!callbackToken || !voice || !assembleiaId || !content?.trim()) {
    res.status(400).json({
      error: "Campos obrigatórios: callbackToken (string), voice (string), assembleiaId (number), content (string)",
    });
    return;
  }

  const [registration] = await db
    .select()
    .from(externalAiWebhooksTable)
    .where(eq(externalAiWebhooksTable.voiceName, voice));

  if (!registration || !registration.active) {
    res.status(403).json({ error: "Voz não registrada ou inativa" });
    return;
  }

  const [session] = await db
    .select()
    .from(assembleiaSessionsTable)
    .where(eq(assembleiaSessionsTable.id, Number(assembleiaId)));

  if (!session) {
    res.status(404).json({ error: "Sessão não encontrada" });
    return;
  }
  if (session.status !== "live") {
    res.status(400).json({ error: "Esta Assembleia já está encerrada" });
    return;
  }

  if (!consumeCallbackToken(voice, Number(assembleiaId), callbackToken)) {
    res.status(403).json({ error: "Token inválido, expirado ou não corresponde a esta sessão" });
    return;
  }

  const [msg] = await db.insert(assembleiaMessagesTable).values({
    sessionId: Number(assembleiaId),
    sender: voice,
    senderType: "external-ai",
    content: content.trim(),
  }).returning();

  try {
    getEmitter(Number(assembleiaId)).emit("message", msg);
  } catch {}

  res.json({ ok: true, messageId: msg.id });
});

// ── Info: tell external AIs how to connect ──────────────────────────────
router.get("/webhooks/spec", async (_req, res) => {
  const registrations = await db.select().from(externalAiWebhooksTable).where(eq(externalAiWebhooksTable.active, true));
  res.json({
    endpoint: "POST /api/webhooks/external-voice",
    description: "External AIs post their RODAR responses here",
    payload: {
      callbackToken: "Per-session token issued with the RODAR prompt (single-use, session-scoped)",
      voice: "Your voice name (e.g. Grok, Copilot, MetaAI)",
      assembleiaId: "The session ID (sent to you with the RODAR prompt)",
      content: "Your response text",
    },
    registeredVoices: registrations.map(r => ({
      voice: r.voiceName,
      hasIncomingUrl: !!r.incomingUrl,
    })),
  });
});

// ── Register or update incoming URL for external AI ─────────────────────
router.post("/webhooks/register", async (req, res) => {
  const { secret, voice, incomingUrl } = req.body as {
    secret?: string;
    voice?: string;
    incomingUrl?: string;
  };

  if (!secret || !voice) {
    res.status(400).json({ error: "Campos obrigatórios: secret, voice" });
    return;
  }

  const [registration] = await db
    .select().from(externalAiWebhooksTable)
    .where(eq(externalAiWebhooksTable.voiceName, voice));

  if (!registration || registration.outgoingSecret !== secret) {
    res.status(403).json({ error: "Credenciais inválidas" });
    return;
  }

  if (incomingUrl != null) {
    const ssrfCheck = validateWebhookUrl(incomingUrl);
    if (!ssrfCheck.ok) {
      res.status(400).json({ error: ssrfCheck.reason ?? "URL inválida" });
      return;
    }
  }

  await db.update(externalAiWebhooksTable)
    .set({ incomingUrl: incomingUrl ?? null })
    .where(eq(externalAiWebhooksTable.voiceName, voice));

  res.json({ ok: true, voice, incomingUrl: incomingUrl ?? null });
});

export default router;

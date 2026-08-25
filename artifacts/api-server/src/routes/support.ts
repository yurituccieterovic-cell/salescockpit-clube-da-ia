import { Router, type IRouter } from "express";
import nodemailer from "nodemailer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Email de destino fixo (pedido explícito do Yuri): sociedadetucci@gmail.com
const SUPPORT_RECIPIENT = "sociedadetucci@gmail.com";

// Rate limit em memória: 3 emails por IP por hora. Suficiente pra spam casual sem
// banco. Se reiniciar o servidor o contador zera (aceitável pra MVP).
const HOURLY_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;
const ipBuckets = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = ipBuckets.get(ip) ?? [];
  const fresh = arr.filter((ts) => now - ts < WINDOW_MS);
  if (fresh.length >= HOURLY_LIMIT) return false;
  fresh.push(now);
  ipBuckets.set(ip, fresh);
  return true;
}

// Anti-CSRF leve: aceita request só se Origin bate com domínio próprio.
// Não defende ataque sofisticado, mas corta CSRF clássico via form em site
// terceiro. Browsers sempre mandam Origin em POST cross-origin desde 2020.
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // requests same-origin sem header (curl, etc.) — rate limit cobre
  try {
    const host = new URL(origin).host;
    if (host.endsWith(".replit.dev") || host.endsWith(".replit.app")) return true;
    if (host === "localhost" || host.startsWith("localhost:") || host.startsWith("127.0.0.1")) return true;
    const allowed = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
    return allowed.includes(host);
  } catch {
    return false;
  }
}

router.post("/support", async (req, res) => {
  try {
    if (!isOriginAllowed(req.headers.origin)) {
      req.log.warn({ origin: req.headers.origin }, "[support] origin bloqueada");
      res.status(403).json({ error: "Origem não permitida." });
      return;
    }

    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();

    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "Muitas mensagens. Tente daqui a uma hora." });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    // Honeypot anti-bot: campo `website` invisível no form. Se vier preenchido = bot.
    if (body?.website && typeof body.website === "string" && body.website.length > 0) {
      logger.warn({ ip }, "[support] honeypot triggered, descartando");
      // Devolve 200 silencioso pro bot não saber que foi pego.
      res.json({ ok: true });
      return;
    }

    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
    const email = typeof body?.email === "string" ? body.email.trim().slice(0, 200) : "";
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 5000) : "";
    const page = typeof body?.page === "string" ? body.page.slice(0, 100) : "(não informada)";

    if (!message || message.length < 5) {
      res.status(400).json({ error: "Mensagem muito curta (mín. 5 caracteres)." });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Email inválido." });
      return;
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
      req.log.error("[support] GMAIL_USER ou GMAIL_APP_PASSWORD ausente");
      res.status(500).json({ error: "Sistema de email não configurado. Tente mais tarde." });
      return;
    }

    const subject = `[SUPORTE PulseHeadway] ${name || "Visitante"} — ${page}`;
    const text = `Mensagem de suporte recebida pelo site.

De: ${name || "(sem nome)"}
Email de contato: ${email || "(não informado)"}
Página de origem: ${page}
IP: ${ip}
Quando: ${new Date().toISOString()}

─────── Mensagem ───────
${message}
────────────────────────

Responda direto pro email acima (se informado).`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
      from: gmailUser,
      to: SUPPORT_RECIPIENT,
      replyTo: email || undefined,
      subject,
      text,
    });

    req.log.info({ ip, page, hasEmail: !!email }, "[support] email enviado");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[support] envio falhou");
    res.status(500).json({ error: "Falha ao enviar. Tente novamente em alguns minutos." });
  }
});

export default router;

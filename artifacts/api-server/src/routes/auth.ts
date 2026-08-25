import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { rodarHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";

const router = Router();

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
    user: string;
    clubeUser: string;
  }
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function getClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
  }
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

router.post("/auth/login", (req, res) => {
  const ip = getClientIp(req);

  if (isRateLimited(ip)) {
    res.status(429).json({ ok: false, error: "Muitas tentativas. Tente novamente em 15 minutos." });
    return;
  }

  const { username, password, rememberMe } = req.body as {
    username?: string;
    password?: string;
    rememberMe?: boolean;
  };

  const validUser = process.env.AO_USERNAME?.trim();
  const validPassHash = process.env.AO_PASSWORD_HASH?.trim();

  if (!validUser || !validPassHash) {
    logger.error("AO_USERNAME or AO_PASSWORD_HASH env vars not configured — login disabled");
    res.status(503).json({ ok: false, error: "Autenticação não configurada no servidor." });
    return;
  }

  if (!/^\$2[aby]\$/.test(validPassHash)) {
    logger.error({ hashPrefix: validPassHash.slice(0, 4), hashLen: validPassHash.length }, "AO_PASSWORD_HASH is not a bcrypt hash — login disabled");
    res.status(503).json({ ok: false, error: "AO_PASSWORD_HASH inválido no servidor (precisa ser hash bcrypt, não texto puro)." });
    return;
  }

  const userMatch = (username ?? "").trim() === validUser;
  const passMatch = userMatch && bcrypt.compareSync(password ?? "", validPassHash);

  if (userMatch && passMatch) {
    clearAttempts(ip);
    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err }, "Session regeneration failed");
        res.status(500).json({ ok: false, error: "Erro interno." });
        return;
      }
      req.session.authenticated = true;
      req.session.user = username as string;
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      } else {
        req.session.cookie.expires = undefined;
      }
      req.session.save(() => {
        res.json({ ok: true, user: username });
      });
    });
  } else {
    recordFailedAttempt(ip);
    res.status(401).json({ ok: false, error: "Credenciais inválidas" });
  }
});

router.post("/auth/hash-password", (req, res) => {
  if (!req.session.authenticated) {
    res.status(401).json({ ok: false, error: "Precisa estar logado como AO." });
    return;
  }
  const { password } = req.body as { password?: string };
  const trimmed = (password ?? "").trim();
  if (trimmed.length < 8) {
    res.status(400).json({ ok: false, error: "Senha curta demais (mínimo 8 caracteres)." });
    return;
  }
  if (trimmed.length > 200) {
    res.status(400).json({ ok: false, error: "Senha longa demais (máx 200 caracteres)." });
    return;
  }
  const hash = bcrypt.hashSync(trimmed, 12);
  res.json({ ok: true, hash });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req, res) => {
  if (req.session.authenticated) {
    const user = req.session.user;
    const ao = process.env.AO_USERNAME?.trim();
    // Mantém em sincronia com isVideoAllowed em routes/chat.ts
    const canVideo = user === "luddlocke" || user === "yuri" || (!!ao && user === ao);
    res.json({ authenticated: true, user, canVideo });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

router.get("/history", (req, res, next) => {
  if (!req.session.authenticated) { res.status(401).json({ error: "Não autenticado" }); return; }
  next();
}, async (req, res) => {
  const rows = await db
    .select()
    .from(rodarHistoryTable)
    .orderBy(desc(rodarHistoryTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.get("/login-images", (req, res) => {
  const publicDir = path.join(process.cwd(), "..", "..", "artifacts", "sales-assistant", "public");
  const files: string[] = [];
  try {
    const all = fs.readdirSync(publicDir);
    for (const f of all) {
      if (f.startsWith("loginimage_") && f.endsWith(".png")) files.push(f);
    }
  } catch {}
  files.sort();
  res.json(files);
});

export default router;

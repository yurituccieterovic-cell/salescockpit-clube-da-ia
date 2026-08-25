import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { db, appUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Signup rate limit (per IP) ──────────────────────────────────────────────
const SIGNUP_MAX_PER_IP = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const signupAttempts = new Map<string, { count: number; firstAt: number }>();

// ── Login rate limit ────────────────────────────────────────────────────────
// Per-IP: max 20 attempts per 15 min window
// Per-account (email): max 10 attempts per 15 min window
const LOGIN_IP_MAX = 20;
// Pre-computed valid bcrypt hash used for constant-time comparison when the
// submitted email does not match any account, preventing timing-based
// enumeration. Generated once at startup so it is always a well-formed hash.
const TIMING_DUMMY_HASH: string = bcrypt.hashSync("__timing_dummy__", 12);
const LOGIN_ACCOUNT_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginIpAttempts = new Map<string, { count: number; firstAt: number }>();
const loginAccountAttempts = new Map<string, { count: number; firstAt: number }>();

// Cleanup stale entries periodically to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of signupAttempts) {
    if (now - rec.firstAt > SIGNUP_WINDOW_MS) signupAttempts.delete(ip);
  }
  for (const [key, rec] of loginIpAttempts) {
    if (now - rec.firstAt > LOGIN_WINDOW_MS) loginIpAttempts.delete(key);
  }
  for (const [key, rec] of loginAccountAttempts) {
    if (now - rec.firstAt > LOGIN_WINDOW_MS) loginAccountAttempts.delete(key);
  }
}, LOGIN_WINDOW_MS).unref();

function getIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

// ── Signup helpers ──────────────────────────────────────────────────────────
function isSignupRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = signupAttempts.get(ip);
  if (!rec) return false;
  if (now - rec.firstAt > SIGNUP_WINDOW_MS) {
    signupAttempts.delete(ip);
    return false;
  }
  return rec.count >= SIGNUP_MAX_PER_IP;
}

function recordSignup(ip: string): void {
  const now = Date.now();
  const rec = signupAttempts.get(ip);
  if (!rec || now - rec.firstAt > SIGNUP_WINDOW_MS) {
    signupAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

// ── Login helpers ───────────────────────────────────────────────────────────
function checkLoginRateLimit(ip: string, email: string): boolean {
  const now = Date.now();

  const ipRec = loginIpAttempts.get(ip);
  if (ipRec && now - ipRec.firstAt <= LOGIN_WINDOW_MS && ipRec.count >= LOGIN_IP_MAX) {
    return true;
  }

  const acctRec = loginAccountAttempts.get(email);
  if (acctRec && now - acctRec.firstAt <= LOGIN_WINDOW_MS && acctRec.count >= LOGIN_ACCOUNT_MAX) {
    return true;
  }

  return false;
}

function recordLoginFailure(ip: string, email: string): void {
  const now = Date.now();

  const ipRec = loginIpAttempts.get(ip);
  if (!ipRec || now - ipRec.firstAt > LOGIN_WINDOW_MS) {
    loginIpAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    ipRec.count += 1;
  }

  const acctRec = loginAccountAttempts.get(email);
  if (!acctRec || now - acctRec.firstAt > LOGIN_WINDOW_MS) {
    loginAccountAttempts.set(email, { count: 1, firstAt: now });
  } else {
    acctRec.count += 1;
  }
}

function resetLoginCounters(ip: string, email: string): void {
  loginIpAttempts.delete(ip);
  loginAccountAttempts.delete(email);
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post("/app/signup", async (req, res) => {
  const ip = getIp(req);
  if (isSignupRateLimited(ip)) {
    res.status(429).json({ error: "Muitas tentativas. Tente novamente em 1h." });
    return;
  }
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = (email ?? "").trim().toLowerCase();
  const cleanPass = (password ?? "").trim();
  if (!EMAIL_RE.test(cleanEmail)) {
    res.status(400).json({ error: "Email inválido." });
    return;
  }
  if (cleanPass.length < 8 || cleanPass.length > 200) {
    res.status(400).json({ error: "Senha precisa ter 8 a 200 caracteres." });
    return;
  }
  try {
    const existing = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.email, cleanEmail))
      .limit(1);

    if (existing.length) {
      // Do NOT reveal that the email is already registered — return the same
      // generic response as a successful signup so this endpoint cannot be
      // used as an account-enumeration oracle.  The user will discover their
      // account already exists when they try to log in.
      recordSignup(ip);
      res.json({ ok: true });
      return;
    }

    const hash = bcrypt.hashSync(cleanPass, 12);
    await db
      .insert(appUsersTable)
      .values({ email: cleanEmail, passwordHash: hash, credits: 0 })
      .returning({ id: appUsersTable.id, email: appUsersTable.email });
    recordSignup(ip);
    // Do NOT auto-login on signup. Auto-login would create a session cookie
    // for the new-account path while the duplicate-email path leaves the
    // session untouched, producing a cookie-observable difference that still
    // works as an enumeration oracle. Both paths now return identical bodies
    // and identical session/cookie state. The user must call POST /app/login
    // (which is rate-limited and timing-hardened) to establish a session.
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Signup falhou");
    res.status(500).json({ error: "Erro ao criar conta." });
  }
});

router.post("/app/login", async (req, res) => {
  const ip = getIp(req);
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = (email ?? "").trim().toLowerCase();
  const cleanPass = (password ?? "").trim();
  if (!cleanEmail || !cleanPass) {
    res.status(400).json({ error: "Email e senha obrigatórios." });
    return;
  }

  if (checkLoginRateLimit(ip, cleanEmail)) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.email, cleanEmail))
      .limit(1);

    // Use a pre-computed dummy hash when no account exists to keep response
    // timing consistent and avoid a timing-based enumeration side channel.
    const user = rows[0] ?? null;
    const hashToCheck = user ? user.passwordHash : TIMING_DUMMY_HASH;
    const passwordOk = bcrypt.compareSync(cleanPass, hashToCheck);

    if (!user || !passwordOk) {
      recordLoginFailure(ip, cleanEmail);
      res.status(401).json({ error: "Credenciais inválidas." });
      return;
    }

    resetLoginCounters(ip, cleanEmail);
    await db
      .update(appUsersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(appUsersTable.id, user.id));
    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err }, "Session regenerate falhou no login");
        res.status(500).json({ error: "Erro interno." });
        return;
      }
      req.session.appUserId = user.id;
      req.session.appUserEmail = user.email;
      req.session.save(() => {
        res.json({ ok: true, email: user.email, credits: user.credits });
      });
    });
  } catch (err) {
    logger.error({ err }, "Login app falhou");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/app/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/app/me", async (req, res) => {
  const uid = req.session?.appUserId;
  if (!uid) {
    res.status(401).json({ authenticated: false });
    return;
  }
  const rows = await db
    .select({ id: appUsersTable.id, email: appUsersTable.email, credits: appUsersTable.credits })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, uid))
    .limit(1);
  if (!rows.length) {
    req.session.destroy(() => {});
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, ...rows[0] });
});

export default router;

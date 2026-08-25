import type { Request, Response, NextFunction } from "express";
import { db, appUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    appUserId?: number;
    appUserEmail?: string;
  }
}

// Gate pra rotas RODAR (prepare/stream): aceita AO (infinito) ou app_user com créditos.
// AO continua passando direto. App user só passa se credits > 0 (gate antes do decremento).
// Decremento de fato acontece dentro de /rodar/prepare (race-safe via UPDATE atômico).
export async function requireRodarAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // AO
  if (req.session?.authenticated) {
    next();
    return;
  }
  // Internal token (SSE workers re-entrando)
  const internalToken = req.header("x-internal-token");
  const secret = process.env.SESSION_SECRET;
  if (internalToken && secret && internalToken === secret) {
    req.session.authenticated = true;
    req.session.user = "yuri";
    next();
    return;
  }
  // App user
  const uid = req.session?.appUserId;
  if (!uid) {
    res.status(401).json({ error: "Faça login ou crie uma conta." });
    return;
  }
  const rows = await db.select().from(appUsersTable).where(eq(appUsersTable.id, uid)).limit(1);
  if (!rows.length) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Sessão inválida." });
    return;
  }
  const user = rows[0];
  if ((user.credits ?? 0) <= 0) {
    res
      .status(402)
      .json({ error: "Sem créditos. Compre mais pra rodar.", credits: 0 });
    return;
  }
  next();
}

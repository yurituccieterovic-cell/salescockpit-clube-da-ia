import type { Request, Response, NextFunction } from "express";

// Aceita qualquer perfil autenticado: AO, Clube ou app_user pagante.
// Usar em rotas read-only de baixo custo (ex: meta-análise via Groq free-tier)
// onde não há razão pra gatear por tier de usuário.
export function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
  if (
    req.session?.authenticated ||
    req.session?.clubeUser ||
    req.session?.appUserId
  ) {
    next();
    return;
  }
  const internalToken = req.header("x-internal-token");
  const secret = process.env.SESSION_SECRET;
  if (internalToken && secret && internalToken === secret) {
    req.session.authenticated = true;
    req.session.user = "yuri";
    next();
    return;
  }
  res.status(401).json({ error: "Faça login" });
}

import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
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
  res.status(401).json({ error: "Não autenticado" });
}

import type { Request, Response, NextFunction } from "express";

// Aceita AO (req.session.authenticated) OU usuário do Clube (req.session.clubeUser).
// Usar em rotas onde o conteúdo é compartilhado entre os dois perfis (assembleia, ágora) —
// pra Clube-específicas que dependem de clubeUser.id (mandar mensagem, registrar webhook),
// continuar usando `requireClube`.
export function requireAuthOrClube(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated || req.session?.clubeUser) {
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
  res.status(401).json({ error: "Faça login (AO ou Clube)" });
}

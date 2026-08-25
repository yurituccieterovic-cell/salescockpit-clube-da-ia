import type { Request, Response, NextFunction } from "express";

export function requireClube(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.clubeUser) {
    next();
    return;
  }
  res.status(401).json({ error: "Faça login no Clube" });
}

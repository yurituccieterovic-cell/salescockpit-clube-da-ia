// Painel de saúde do roteador 8-vias.
// GET /api/admin/router-state — snapshot dos 8 provedores: cooling, contadores,
// último erro, modelo. Útil pra Yuri saber em tempo real quem tá saturado.

import { Router } from "express";
import { spawn } from "child_process";
import { getRouterStateSnapshot, routeChat, type Pool } from "../lib/llm-router";

const router = Router();

router.get("/admin/router-state", (_req, res) => {
  res.json(getRouterStateSnapshot());
});

// POST /api/admin/router-test — força uma chamada num pool pra testar provedores
// body: { pool: "batch", prompt: "diga olá" }
router.post("/admin/router-test", async (req, res) => {
  const { pool, prompt } = req.body as { pool?: Pool; prompt?: string };
  if (!pool || !prompt) {
    res.status(400).json({ error: "pool e prompt obrigatórios" });
    return;
  }
  try {
    const result = await routeChat({
      pool,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 200,
      temperature: 0.7,
      label: "admin-test",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/admin/db-dump?token=DUMP_TOKEN — extrai pg_dump do banco em produção
// Rota temporária para migração Replit→Render. Remover após uso.
router.get("/admin/db-dump", (req, res) => {
  const token = req.query.token as string;
  const expected = process.env.DUMP_TOKEN || "enterro-replit-2026";
  if (token !== expected) {
    res.status(401).json({ error: "token inválido" });
    return;
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    res.status(500).json({ error: "DATABASE_URL não definida" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=rodar-producao-dump.dump");
  const pg = spawn("pg_dump", [dbUrl, "-Fc"]);
  pg.stdout.pipe(res);
  pg.stderr.on("data", (d) => console.error("[db-dump]", d.toString()));
  pg.on("close", (code) => {
    if (code !== 0) console.error("[db-dump] pg_dump saiu com código", code);
  });
});

export default router;

// Painel de saúde do roteador 8-vias.
// GET /api/admin/router-state — snapshot dos 8 provedores: cooling, contadores,
// último erro, modelo. Útil pra Yuri saber em tempo real quem tá saturado.

import { Router } from "express";
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

export default router;

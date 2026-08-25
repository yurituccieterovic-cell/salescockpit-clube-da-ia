import { Router } from "express";
import { db, arvorePlaygroundTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  normalizePlaygroundKind,
  PG_MAX_CONTENT,
  PG_MAX_LANGUAGE,
  PG_MAX_TITLE,
} from "../lib/playground";

// CRUD do Playground — o canto interativo da Árvore. Montado sob requireAuth em
// routes/index.ts, então todos os endpoints aqui são AO-only (privado do Yuri).
const router = Router();

// Lista tudo: fixados primeiro, depois mais recentes.
router.get("/playground", async (_req, res) => {
  const rows = await db
    .select()
    .from(arvorePlaygroundTable)
    .orderBy(desc(arvorePlaygroundTable.pinned), desc(arvorePlaygroundTable.updatedAt));
  res.json({ entries: rows });
});

// Cria nota ou trecho de código (autor 'yuri' quando vem daqui pelo editor).
// Retorna o registro COMPLETO (mesmo shape do GET/PATCH) — o editor abre essa
// entrada na hora e precisa de content/pinned/timestamps preenchidos.
router.post("/playground", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!title.trim() && !content.trim()) {
    res.status(400).json({ error: "Escreva um título ou um conteúdo." });
    return;
  }
  const [entry] = await db
    .insert(arvorePlaygroundTable)
    .values({
      kind: normalizePlaygroundKind(body.kind),
      title: title.slice(0, PG_MAX_TITLE),
      language: (typeof body.language === "string" ? body.language : "").slice(0, PG_MAX_LANGUAGE),
      content: content.slice(0, PG_MAX_CONTENT),
      author: "yuri",
    })
    .returning();
  res.status(201).json({ entry });
});

// Edita campos de uma entrada.
router.patch("/playground/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<typeof arvorePlaygroundTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.title === "string") updates.title = body.title.slice(0, PG_MAX_TITLE);
  if (typeof body.language === "string") updates.language = body.language.slice(0, PG_MAX_LANGUAGE);
  if (typeof body.content === "string") updates.content = body.content.slice(0, PG_MAX_CONTENT);
  if (body.kind !== undefined) updates.kind = normalizePlaygroundKind(body.kind);
  if (typeof body.pinned === "boolean") updates.pinned = body.pinned;
  const [row] = await db
    .update(arvorePlaygroundTable)
    .set(updates)
    .where(eq(arvorePlaygroundTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Entrada não encontrada" });
    return;
  }
  res.json({ entry: row });
});

// Apaga uma entrada.
router.delete("/playground/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  await db.delete(arvorePlaygroundTable).where(eq(arvorePlaygroundTable.id, id));
  res.json({ ok: true });
});

export default router;

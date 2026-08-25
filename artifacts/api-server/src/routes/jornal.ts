import { Router } from "express";
import { db, jornalEntriesTable } from "@workspace/db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { buildPublicAssembleiaPdf } from "../lib/assembleia-pdf";

const router = Router();

// Vitrine (Mostra) de entradas publicadas do Jornal — PERFEITO do Secretário.
// AGORA atrás de login (decisão do Yuri): só AO autenticado. Antes era público;
// manteve-se o whitelist de colunas. Registered BEFORE /jornal p/ Express 5 rotear.
router.get("/jornal/publico", async (req, res) => {
  if (!req.session.authenticated) { res.status(401).json({ error: "Não autenticado" }); return; }
  const rawLimit = Number.parseInt(String(req.query.limit ?? "12"), 10);
  const rawOffset = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 12, 1), 24);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  const rawTema = typeof req.query.tema === "string" ? req.query.tema.trim() : "";
  // Strip ILIKE wildcards so user input can never become a wildcard pattern.
  // Drizzle parameterizes the value, but the pattern itself must be literal.
  const tema = rawTema.slice(0, 120).replace(/[\\%_]/g, "");
  let where: SQL | undefined;
  if (tema.length > 0) {
    const needle = `%${tema}%`;
    where = or(
      ilike(jornalEntriesTable.topic, needle),
      ilike(jornalEntriesTable.perfeitoText, needle),
    );
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jornalEntriesTable)
    .where(where ? and(where) : undefined);

  const entries = await db
    .select({
      id: jornalEntriesTable.id,
      sessionId: jornalEntriesTable.sessionId,
      topic: jornalEntriesTable.topic,
      perfeitoText: jornalEntriesTable.perfeitoText,
      imageUrl: jornalEntriesTable.imageUrl,
      publishedAt: jornalEntriesTable.publishedAt,
    })
    .from(jornalEntriesTable)
    .where(where ? and(where) : undefined)
    .orderBy(desc(jornalEntriesTable.publishedAt))
    .limit(limit)
    .offset(offset);

  res.set("Cache-Control", "private, no-store");
  res.json({ entries, total: count, limit, offset, tema: tema || null });
});

// PDF de uma peça da Mostra — SÓ conteúdo público da ata (tema + data +
// PERFEITO). Nunca inclui ata/meta-análise/resultado internos; esses ficam no
// PDF gated de /assembleia/sessions/:id/pdf. AGORA atrás de login, como a Mostra.
router.get("/jornal/publico/:id/pdf", async (req, res) => {
  if (!req.session.authenticated) { res.status(401).json({ error: "Não autenticado" }); return; }
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }

  const [entry] = await db
    .select({
      sessionId: jornalEntriesTable.sessionId,
      topic: jornalEntriesTable.topic,
      perfeitoText: jornalEntriesTable.perfeitoText,
      publishedAt: jornalEntriesTable.publishedAt,
    })
    .from(jornalEntriesTable)
    .where(eq(jornalEntriesTable.id, id))
    .limit(1);
  if (!entry) { res.status(404).json({ error: "Peça não encontrada" }); return; }

  const dateLabel = entry.publishedAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(entry.publishedAt))
    : "";

  try {
    const pdf = await buildPublicAssembleiaPdf({
      sessionId: entry.sessionId,
      topic: entry.topic,
      dateLabel,
      perfeito: entry.perfeitoText ?? "",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="mostra-${id}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch {
    res.status(500).json({ error: "Falha ao gerar PDF" });
  }
});

router.get("/jornal", (req, res, next) => {
  if (!req.session.authenticated) { res.status(401).json({ error: "Não autenticado" }); return; }
  next();
}, async (_req, res) => {
  const entries = await db
    .select()
    .from(jornalEntriesTable)
    .orderBy(desc(jornalEntriesTable.publishedAt));
  res.json(entries);
});

export default router;

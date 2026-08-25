import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import {
  db,
  arvoreProjectsTable,
  arvoreFilesTable,
  arvoreProjectChatTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { processFile } from "../lib/file-processor";
import { requireAuth } from "../middlewares/require-auth";

const router = Router();

// Todas as rotas deste router são AO-only via requireAuth aplicado no mount.
// Limites:
const MAX_PROJECTS_PER_OWNER = 20;
const MAX_FILES_PER_PROJECT = 50;
const MAX_TOTAL_CHARS_PER_PROJECT = 500_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "projeto";
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let i = 1;
  while (true) {
    const [exists] = await db
      .select({ id: arvoreProjectsTable.id })
      .from(arvoreProjectsTable)
      .where(eq(arvoreProjectsTable.slug, candidate))
      .limit(1);
    if (!exists) return candidate;
    i++;
    candidate = `${base}-${i}`;
    if (i > 100) return `${base}-${Date.now()}`;
  }
}

// ── Helper: valida que o projeto existe e pertence ao AO (always "ao" por ora) ──
async function getProjectOrFail(req: Request, res: Response): Promise<typeof arvoreProjectsTable.$inferSelect | null> {
  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id inválido" });
    return null;
  }
  const [proj] = await db
    .select()
    .from(arvoreProjectsTable)
    .where(and(eq(arvoreProjectsTable.id, id), isNull(arvoreProjectsTable.archivedAt)))
    .limit(1);
  if (!proj) {
    res.status(404).json({ error: "Projeto não encontrado" });
    return null;
  }
  return proj;
}

// ── POST /api/arvore/projects — cria projeto ──────────────────────────────
router.post("/arvore/projects", async (req, res) => {
  const { nome, descricao } = req.body as { nome?: string; descricao?: string };
  const cleanName = (nome ?? "").trim();
  if (!cleanName || cleanName.length < 2) {
    res.status(400).json({ error: "Nome obrigatório (mín 2 chars)" });
    return;
  }
  if (cleanName.length > 100) {
    res.status(400).json({ error: "Nome muito longo (máx 100)" });
    return;
  }
  const cleanDesc = typeof descricao === "string" ? descricao.trim().slice(0, 500) : null;

  try {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(arvoreProjectsTable)
      .where(isNull(arvoreProjectsTable.archivedAt));
    if ((c ?? 0) >= MAX_PROJECTS_PER_OWNER) {
      res.status(429).json({ error: `Limite de ${MAX_PROJECTS_PER_OWNER} projetos ativos. Arquive algum antes.` });
      return;
    }

    const slug = await ensureUniqueSlug(slugify(cleanName));
    const [inserted] = await db
      .insert(arvoreProjectsTable)
      .values({ slug, nome: cleanName, descricao: cleanDesc })
      .returning();
    res.json(inserted);
  } catch (err) {
    req.log.error({ err }, "arvore-projects.create failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/arvore/projects — lista (ativos) ─────────────────────────────
router.get("/arvore/projects", async (req, res) => {
  try {
    const projects = await db
      .select({
        id: arvoreProjectsTable.id,
        slug: arvoreProjectsTable.slug,
        nome: arvoreProjectsTable.nome,
        descricao: arvoreProjectsTable.descricao,
        createdAt: arvoreProjectsTable.createdAt,
        fileCount: sql<number>`(SELECT count(*)::int FROM ${arvoreFilesTable} WHERE ${arvoreFilesTable.projectId} = ${arvoreProjectsTable.id})`,
      })
      .from(arvoreProjectsTable)
      .where(isNull(arvoreProjectsTable.archivedAt))
      .orderBy(desc(arvoreProjectsTable.createdAt));
    res.json(projects);
  } catch (err) {
    req.log.error({ err }, "arvore-projects.list failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/arvore/projects/:id — detalhe com arquivos ───────────────────
router.get("/arvore/projects/:id", async (req, res) => {
  const proj = await getProjectOrFail(req, res);
  if (!proj) return;
  try {
    const files = await db
      .select({
        id: arvoreFilesTable.id,
        kind: arvoreFilesTable.kind,
        name: arvoreFilesTable.name,
        sizeBytes: arvoreFilesTable.sizeBytes,
        uploadedAt: arvoreFilesTable.uploadedAt,
        contentLength: sql<number>`length(${arvoreFilesTable.content})::int`,
      })
      .from(arvoreFilesTable)
      .where(eq(arvoreFilesTable.projectId, proj.id))
      .orderBy(asc(arvoreFilesTable.uploadedAt));
    const totalChars = files.reduce((acc, f) => acc + (f.contentLength ?? 0), 0);
    res.json({ project: proj, files, totalChars });
  } catch (err) {
    req.log.error({ err }, "arvore-projects.detail failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DELETE /api/arvore/projects/:id — soft delete ─────────────────────────
router.delete("/arvore/projects/:id", async (req, res) => {
  const proj = await getProjectOrFail(req, res);
  if (!proj) return;
  try {
    await db
      .update(arvoreProjectsTable)
      .set({ archivedAt: new Date() })
      .where(eq(arvoreProjectsTable.id, proj.id));
    res.json({ ok: true, id: proj.id });
  } catch (err) {
    req.log.error({ err }, "arvore-projects.delete failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/arvore/projects/:id/files — upload via multer + processFile ──
router.post(
  "/arvore/projects/:id/files",
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máx 20MB)" : `Erro: ${err.message}`;
        res.status(413).json({ error: msg });
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const proj = await getProjectOrFail(req, res);
    if (!proj) return;
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado (campo 'file' obrigatório)" });
      return;
    }

    try {
      // Pre-check limites
      const [{ count: fileCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(arvoreFilesTable)
        .where(eq(arvoreFilesTable.projectId, proj.id));
      if ((fileCount ?? 0) >= MAX_FILES_PER_PROJECT) {
        res.status(429).json({ error: `Limite de ${MAX_FILES_PER_PROJECT} arquivos por projeto.` });
        return;
      }

      const { buffer, mimetype, originalname } = req.file;
      const processed = await processFile({ buffer, mime: mimetype, name: originalname });
      if (processed.kind === "unsupported") {
        res.status(415).json({ error: processed.error ?? "Tipo não suportado" });
        return;
      }

      const [{ total }] = await db
        .select({ total: sql<number>`coalesce(sum(length(${arvoreFilesTable.content})), 0)::int` })
        .from(arvoreFilesTable)
        .where(eq(arvoreFilesTable.projectId, proj.id));
      const newTotal = (total ?? 0) + processed.text.length;
      if (newTotal > MAX_TOTAL_CHARS_PER_PROJECT) {
        res.status(413).json({
          error: `Conteúdo total do projeto excederia ${MAX_TOTAL_CHARS_PER_PROJECT} chars (atual: ${total}, novo: ${processed.text.length})`,
        });
        return;
      }

      const [inserted] = await db
        .insert(arvoreFilesTable)
        .values({
          projectId: proj.id,
          kind: processed.kind,
          name: processed.name,
          sizeBytes: processed.size,
          content: processed.text,
        })
        .returning({
          id: arvoreFilesTable.id,
          kind: arvoreFilesTable.kind,
          name: arvoreFilesTable.name,
          sizeBytes: arvoreFilesTable.sizeBytes,
          uploadedAt: arvoreFilesTable.uploadedAt,
        });
      res.json({ ...inserted, contentLength: processed.text.length });
    } catch (err) {
      req.log.error({ err }, "arvore-projects.upload failed");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

// ── DELETE /api/arvore/projects/:id/files/:fileId ─────────────────────────
router.delete("/arvore/projects/:id/files/:fileId", async (req, res) => {
  const proj = await getProjectOrFail(req, res);
  if (!proj) return;
  const fileId = parseInt(req.params.fileId ?? "", 10);
  if (!Number.isFinite(fileId)) {
    res.status(400).json({ error: "fileId inválido" });
    return;
  }
  try {
    const result = await db
      .delete(arvoreFilesTable)
      .where(and(eq(arvoreFilesTable.id, fileId), eq(arvoreFilesTable.projectId, proj.id)))
      .returning({ id: arvoreFilesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Arquivo não encontrado" });
      return;
    }
    res.json({ ok: true, id: fileId });
  } catch (err) {
    req.log.error({ err }, "arvore-projects.file-delete failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/arvore/projects/:id/chat — histórico privado do projeto ──────
router.get("/arvore/projects/:id/chat", async (req, res) => {
  const proj = await getProjectOrFail(req, res);
  if (!proj) return;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  try {
    const rows = await db
      .select()
      .from(arvoreProjectChatTable)
      .where(eq(arvoreProjectChatTable.projectId, proj.id))
      .orderBy(desc(arvoreProjectChatTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows.reverse());
  } catch (err) {
    req.log.error({ err }, "arvore-projects.chat-history failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DELETE /api/arvore/projects/:id/chat — limpa timeline privada ─────────
router.delete("/arvore/projects/:id/chat", async (req, res) => {
  const proj = await getProjectOrFail(req, res);
  if (!proj) return;
  try {
    await db.delete(arvoreProjectChatTable).where(eq(arvoreProjectChatTable.projectId, proj.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "arvore-projects.chat-clear failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;

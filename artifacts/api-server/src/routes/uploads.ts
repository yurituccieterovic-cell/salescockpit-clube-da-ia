import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { processFile } from "../lib/file-processor";
import { requireAuthOrClube } from "../middlewares/require-auth-or-clube";

const router = Router();

// 20MB cap por arquivo. memoryStorage = nada toca disco. Processamento é inline:
// retornamos {kind, text, name} pro cliente, que repassa pros endpoints de RODAR/Árvore.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

// Rate-limit in-memory: 30 uploads / hora por user (AO ou clube). Imagem aciona Gemini Vision (custo).
// Sem dep nova (express-rate-limit) — Yuri tem ~5 users no clube, exposure mínima.
const uploadHits = new Map<string, number[]>();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 30;
function rateLimitUploads(req: Request, res: Response, next: NextFunction) {
  const sess = req.session as { authenticated?: boolean; clubeUser?: { id: number } };
  const key = sess.authenticated ? "ao" : `clube:${sess.clubeUser?.id ?? "anon"}`;
  const now = Date.now();
  const hits = (uploadHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    res.status(429).json({ error: `Limite de ${RATE_MAX} uploads/hora atingido. Tenta de novo em ~1h.` });
    return;
  }
  hits.push(now);
  uploadHits.set(key, hits);
  next();
}

router.post(
  "/uploads/inline",
  requireAuthOrClube,
  rateLimitUploads,
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máx 20MB)" : `Erro de upload: ${err.message}`;
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
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado (campo 'file' obrigatório)" });
      return;
    }
    const { buffer, mimetype, originalname } = req.file;
    try {
      const result = await processFile({ buffer, mime: mimetype, name: originalname });
      if (result.kind === "unsupported") {
        res.status(415).json({ error: result.error ?? "Tipo não suportado", name: result.name, size: result.size });
        return;
      }
      res.json({
        kind: result.kind,
        name: result.name,
        size: result.size,
        text: result.text,
      });
    } catch (err) {
      req.log.error({ err, name: originalname }, "uploads.inline failed");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;

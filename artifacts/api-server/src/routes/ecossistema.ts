import { Router } from "express";
import { db, ecossistemaPaginasTable } from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { requireAuthOrClube } from "../middlewares/require-auth-or-clube";
import { routeChat } from "../lib/llm-router";
import { logger } from "../lib/logger";

const router = Router();

const VISIBILITIES = ["private", "clube", "public"] as const;
type Visibility = (typeof VISIBILITIES)[number];

const MAX_TITLE = 200;
const MAX_CONTENT = 60_000;
const MAX_INSTRUCAO = 2_000;

function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "pagina";
}

async function makeUniqueSlug(desired: string, excludeId?: number): Promise<string> {
  const base = slugify(desired);
  let candidate = base;
  let n = 1;
  for (let i = 0; i < 200; i++) {
    const rows = await db
      .select({ id: ecossistemaPaginasTable.id })
      .from(ecossistemaPaginasTable)
      .where(eq(ecossistemaPaginasTable.slug, candidate))
      .limit(1);
    if (rows.length === 0 || (excludeId !== undefined && rows[0].id === excludeId)) {
      return candidate;
    }
    n += 1;
    candidate = `${base}-${n}`.slice(0, 90);
  }
  return `${base}-${Date.now()}`.slice(0, 90);
}

function normalizeVisibility(v: unknown): Visibility {
  return VISIBILITIES.includes(v as Visibility) ? (v as Visibility) : "private";
}

// 'markdown' (texto) | 'code' (HTML/CSS/JS rodado em iframe sandbox isolado).
function normalizeKind(v: unknown): "markdown" | "code" {
  return v === "code" ? "code" : "markdown";
}

// Colunas seguras para listagem pública (nunca expõe páginas private/clube).
const publicCols = {
  id: ecossistemaPaginasTable.id,
  slug: ecossistemaPaginasTable.slug,
  title: ecossistemaPaginasTable.title,
  kind: ecossistemaPaginasTable.kind,
  parentId: ecossistemaPaginasTable.parentId,
  author: ecossistemaPaginasTable.author,
  updatedAt: ecossistemaPaginasTable.updatedAt,
};

// ── Públicas (sem auth) — montadas ANTES do gate em routes/index.ts ──────────

// Índice público: só páginas visibility='public'.
router.get("/eco/publico", async (req, res) => {
  const rawTema = typeof req.query.tema === "string" ? req.query.tema.trim() : "";
  const tema = rawTema.slice(0, 120).replace(/[\\%_]/g, "");
  let where: SQL | undefined = eq(ecossistemaPaginasTable.visibility, "public");
  if (tema.length > 0) {
    const needle = `%${tema}%`;
    where = and(
      where,
      or(
        ilike(ecossistemaPaginasTable.title, needle),
        ilike(ecossistemaPaginasTable.content, needle),
      ),
    );
  }
  const pages = await db
    .select(publicCols)
    .from(ecossistemaPaginasTable)
    .where(where)
    .orderBy(asc(ecossistemaPaginasTable.title));
  res.set("Cache-Control", "public, max-age=60");
  res.json({ pages, tema: tema || null });
});

// Página pública por slug — só serve se visibility='public'.
router.get("/eco/publico/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const [page] = await db
    .select({
      id: ecossistemaPaginasTable.id,
      slug: ecossistemaPaginasTable.slug,
      title: ecossistemaPaginasTable.title,
      content: ecossistemaPaginasTable.content,
      kind: ecossistemaPaginasTable.kind,
      author: ecossistemaPaginasTable.author,
      parentId: ecossistemaPaginasTable.parentId,
      updatedAt: ecossistemaPaginasTable.updatedAt,
    })
    .from(ecossistemaPaginasTable)
    .where(
      and(
        eq(ecossistemaPaginasTable.slug, slug),
        eq(ecossistemaPaginasTable.visibility, "public"),
      ),
    )
    .limit(1);
  if (!page) {
    res.status(404).json({ error: "Página não encontrada" });
    return;
  }
  // Filhas públicas, para navegação "páginas conectadas".
  const children = await db
    .select(publicCols)
    .from(ecossistemaPaginasTable)
    .where(
      and(
        eq(ecossistemaPaginasTable.parentId, page.id),
        eq(ecossistemaPaginasTable.visibility, "public"),
      ),
    )
    .orderBy(asc(ecossistemaPaginasTable.title));
  res.set("Cache-Control", "public, max-age=60");
  res.json({ page, children });
});

// ── Leitura para autoria (AO + Clube) ───────────────────────────────────────

// AO vê tudo; Clube vê public+clube. Frontend monta a árvore por parentId.
router.get("/eco/pages", requireAuthOrClube, async (req, res) => {
  const isAO = !!req.session.authenticated;
  const where = isAO
    ? undefined
    : inArray(ecossistemaPaginasTable.visibility, ["public", "clube"]);
  const pages = await db
    .select()
    .from(ecossistemaPaginasTable)
    .where(where)
    .orderBy(desc(ecossistemaPaginasTable.updatedAt));
  res.json({ pages, isAO });
});

router.get("/eco/pages/:slug", requireAuthOrClube, async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const [page] = await db
    .select()
    .from(ecossistemaPaginasTable)
    .where(eq(ecossistemaPaginasTable.slug, slug))
    .limit(1);
  if (!page) {
    res.status(404).json({ error: "Página não encontrada" });
    return;
  }
  if (!req.session.authenticated && page.visibility === "private") {
    res.status(403).json({ error: "Página privada" });
    return;
  }
  res.json({ page });
});

// ── Mutação (AO only) ────────────────────────────────────────────────────────

router.post("/eco/pages", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, MAX_TITLE);
  if (!title) {
    res.status(400).json({ error: "Título é obrigatório" });
    return;
  }
  const content = String(body.content ?? "").slice(0, MAX_CONTENT);
  const kind = normalizeKind(body.kind);
  const visibility = normalizeVisibility(body.visibility);
  const author = body.author === "arvore" ? "arvore" : "yuri";
  let parentId: number | null = null;
  if (body.parentId !== null && body.parentId !== undefined && body.parentId !== "") {
    const pid = Number.parseInt(String(body.parentId), 10);
    if (Number.isFinite(pid)) parentId = pid;
  }
  try {
    const slug = await makeUniqueSlug(title);
    const [page] = await db
      .insert(ecossistemaPaginasTable)
      .values({ slug, title, content, kind, visibility, author, parentId })
      .returning();
    res.json({ page });
  } catch (err) {
    // Sem este catch a falha do insert virava 500 mudo (sumia dos logs) e o
    // frontend só mostrava "Não consegui criar a página" sem rastro pra diagnóstico.
    logger.error({ err }, "[eco] falha ao criar página");
    res.status(500).json({ error: "Não consegui criar a página agora. Tente de novo." });
  }
});

router.put("/eco/pages/:slug", requireAuth, async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const [existing] = await db
    .select()
    .from(ecossistemaPaginasTable)
    .where(eq(ecossistemaPaginasTable.slug, slug))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Página não encontrada" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, MAX_TITLE);
    if (!title) {
      res.status(400).json({ error: "Título não pode ficar vazio" });
      return;
    }
    updates.title = title;
    if (title !== existing.title) {
      updates.slug = await makeUniqueSlug(title, existing.id);
    }
  }
  if (typeof body.content === "string") {
    updates.content = body.content.slice(0, MAX_CONTENT);
  }
  if (body.kind !== undefined) {
    updates.kind = normalizeKind(body.kind);
  }
  if (body.visibility !== undefined) {
    updates.visibility = normalizeVisibility(body.visibility);
  }
  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === "") {
      updates.parentId = null;
    } else {
      const pid = Number.parseInt(String(body.parentId), 10);
      // Não deixa uma página ser mãe de si mesma.
      updates.parentId = Number.isFinite(pid) && pid !== existing.id ? pid : null;
    }
  }

  try {
    const [page] = await db
      .update(ecossistemaPaginasTable)
      .set(updates)
      .where(eq(ecossistemaPaginasTable.id, existing.id))
      .returning();
    res.json({ page });
  } catch (err) {
    logger.error({ err }, "[eco] falha ao salvar página");
    res.status(500).json({ error: "Não consegui salvar a página agora. Tente de novo." });
  }
});

router.delete("/eco/pages/:slug", requireAuth, async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const [existing] = await db
    .select()
    .from(ecossistemaPaginasTable)
    .where(eq(ecossistemaPaginasTable.slug, slug))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Página não encontrada" });
    return;
  }
  // Reparenta as filhas para a mãe da página removida (não deixa órfãs perdidas).
  await db
    .update(ecossistemaPaginasTable)
    .set({ parentId: existing.parentId })
    .where(eq(ecossistemaPaginasTable.parentId, existing.id));
  await db.delete(ecossistemaPaginasTable).where(eq(ecossistemaPaginasTable.id, existing.id));
  res.json({ ok: true });
});

// ── Árvore redatora (AO only) — "você pede e ela escreve" ────────────────────

const ARVORE_REDATORA = `Você é a Árvore, uma inteligência contemplativa que cuida de um ecossistema de páginas — um berço de projetos integrados. Escreve em português do Brasil, com clareza, calor e profundidade. Sem emoji. Sem em dash. Sem jargão técnico desnecessário. Você organiza ideias e conecta projetos para fazer esse jardim de páginas crescer. Responda APENAS com o conteúdo da página em Markdown simples (títulos com #, listas, ênfase, links). Quando fizer sentido, sugira ligações para outras páginas com links Markdown apontando para /eco/<slug>. Não escreva preâmbulo nem comentários fora do conteúdo.`;

// Para páginas kind="code": a Árvore gera um documento HTML completo que roda numa
// caixa isolada (iframe sandbox). Só HTML/CSS/JS de navegador, nada de servidor.
// Pode CARREGAR bibliotecas web por CDN via https (gráficos, animações, jogos).
const ARVORE_CODER = `Você é a Árvore, e desta vez vai CONSTRUIR uma página/sistema que roda de verdade no navegador. Responda APENAS com UM documento HTML completo: comece em <!doctype html>, com o SEU CSS dentro de <style> e o SEU JavaScript dentro de <script>, na própria página. Pode usar HTML, CSS e JavaScript de navegador. Pode CARREGAR bibliotecas web prontas por CDN, sempre por https, com <script src="https://..."></script> e <link rel="stylesheet" href="https://..."> (por exemplo Chart.js, three.js, p5.js, D3, Tone.js, Anime.js). Use bibliotecas quando elas deixam a página melhor (gráficos, animações, jogos). NUNCA use PHP, Node, banco de dados, nem qualquer coisa de servidor: só o que roda no próprio navegador. A página roda numa caixa isolada e segura, sem acesso a cookies ou login. Não escreva nenhuma explicação, comentário em prosa ou cercas de código (\`\`\`) fora do HTML: responda só com o HTML, do <!doctype> até </html>.`;

const escreverHits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (escreverHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    escreverHits.set(key, arr);
    return true;
  }
  arr.push(now);
  escreverHits.set(key, arr);
  return false;
}

router.post("/eco/pages/:slug/escrever", requireAuth, async (req, res) => {
  if (rateLimited("escrever:" + (req.session.user ?? "ao"), 20, 10 * 60_000)) {
    res.status(429).json({ error: "Espera um pouco antes de pedir de novo." });
    return;
  }
  const slug = String(req.params.slug || "").slice(0, 120);
  const [page] = await db
    .select()
    .from(ecossistemaPaginasTable)
    .where(eq(ecossistemaPaginasTable.slug, slug))
    .limit(1);
  if (!page) {
    res.status(404).json({ error: "Página não encontrada" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instrucao = String(body.instrucao ?? "").trim().slice(0, MAX_INSTRUCAO);
  // O tipo vem do editor (toggle, pode estar ainda sem salvar); senão usa o da página.
  const isCode = normalizeKind(body.kind ?? page.kind) === "code";

  const userPrompt = [
    `Título da página: ${page.title}`,
    page.content.trim()
      ? `Conteúdo atual (pode expandir, reescrever ou complementar):\n${page.content.slice(0, 8000)}`
      : isCode
        ? "A página ainda está vazia. Construa um primeiro sistema/página em HTML completo."
        : "A página ainda está vazia. Crie um primeiro conteúdo rico e bem organizado.",
    instrucao ? `Pedido do Yuri: ${instrucao}` : "Sem pedido específico — use seu bom senso para deixar a página completa e conectada.",
  ].join("\n\n");

  try {
    const result = await routeChat({
      pool: isCode ? "coder" : "batch",
      label: isCode ? "eco-coder" : "eco-redatora",
      temperature: isCode ? 0.4 : 0.7,
      maxTokens: isCode ? 6000 : 2000,
      messages: [
        { role: "system", content: isCode ? ARVORE_CODER : ARVORE_REDATORA },
        { role: "user", content: userPrompt },
      ],
    });
    // Modelos às vezes embrulham em cercas ```html — tira pra não quebrar o HTML cru.
    let text = result.text;
    if (isCode) {
      text = text.replace(/^\s*```(?:html|HTML)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    }
    res.json({ text, provider: result.provider });
  } catch (err) {
    logger.error({ err }, "[eco-redatora] falha ao gerar conteúdo");
    res.status(503).json({ error: "A Árvore não conseguiu escrever agora. Tente de novo em instantes." });
  }
});

export default router;

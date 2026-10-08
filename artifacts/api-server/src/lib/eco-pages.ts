import { db, ecossistemaPaginasTable } from "@workspace/db";
import { desc, eq, ilike } from "drizzle-orm";
import { extractLenientJsonObject, extractFieldsByKey } from "./lenient-json";
import { notifyPlaycenterNewEco } from "./pap-bridge";

// Berço de páginas do Ecossistema. Centraliza slug/validação/criação pra ser
// usado tanto pelo editor (routes/ecossistema.ts) quanto pela Árvore quando ela
// publica direto na conversa (routes/arvore.ts). Criar página é só DADO no banco
// — aparece na hora em /eco, sem deploy de código.

export const ECO_VISIBILITIES = ["private", "clube", "public"] as const;
export type EcoVisibility = (typeof ECO_VISIBILITIES)[number];

export const ECO_MAX_TITLE = 200;
export const ECO_MAX_CONTENT = 60_000;

export function slugifyEco(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "pagina";
}

export async function makeUniqueEcoSlug(desired: string, excludeId?: number): Promise<string> {
  const base = slugifyEco(desired);
  let candidate = base;
  let n = 1;
  for (let i = 0; i < 200; i++) {
    const rows = await db
      .select({ id: ecossistemaPaginasTable.id })
      .from(ecossistemaPaginasTable)
      .where(eq(ecossistemaPaginasTable.slug, candidate))
      .limit(1);
    if (rows.length === 0 || (excludeId !== undefined && rows[0]!.id === excludeId)) {
      return candidate;
    }
    n += 1;
    candidate = `${base}-${n}`.slice(0, 90);
  }
  return `${base}-${Date.now()}`.slice(0, 90);
}

export function normalizeEcoVisibility(v: unknown): EcoVisibility {
  return ECO_VISIBILITIES.includes(v as EcoVisibility) ? (v as EcoVisibility) : "private";
}

export const ECO_KINDS = ["markdown", "code"] as const;
export type EcoKind = (typeof ECO_KINDS)[number];

// Tipo de página: 'markdown' (texto) ou 'code' (HTML/CSS/JS rodado em iframe sandbox).
export function normalizeEcoKind(v: unknown): EcoKind {
  return v === "code" ? "code" : "markdown";
}

export interface CreateEcoPageInput {
  slug?: string;
  title: string;
  content?: string;
  kind?: unknown;
  visibility?: unknown;
  author?: string;
  parentId?: number | null;
}

export interface CreatedEcoPage {
  id: number;
  slug: string;
  title: string;
  kind: EcoKind;
  visibility: EcoVisibility;
}

export async function createEcoPage(input: CreateEcoPageInput): Promise<CreatedEcoPage> {
  const title = (input.title ?? "").trim().slice(0, ECO_MAX_TITLE) || "Sem título";
  const content = (input.content ?? "").slice(0, ECO_MAX_CONTENT);
  const kind = normalizeEcoKind(input.kind);
  const visibility = normalizeEcoVisibility(input.visibility);
  const slug = await makeUniqueEcoSlug((input.slug ?? "").trim() || title);
  const [row] = await db
    .insert(ecossistemaPaginasTable)
    .values({
      slug,
      title,
      content,
      kind,
      visibility,
      author: input.author ?? "arvore",
      parentId: input.parentId ?? null,
    })
    .returning({
      id: ecossistemaPaginasTable.id,
      slug: ecossistemaPaginasTable.slug,
      title: ecossistemaPaginasTable.title,
      kind: ecossistemaPaginasTable.kind,
      visibility: ecossistemaPaginasTable.visibility,
    });
  return {
    id: row!.id,
    slug: row!.slug,
    title: row!.title,
    kind: normalizeEcoKind(row!.kind),
    visibility: normalizeEcoVisibility(row!.visibility),
  };
}

export interface PublishedEcoPage extends CreatedEcoPage {
  updated: boolean;
}

// Publica uma página no eco RESPEITANDO o slug: se o slug informado JÁ existir, EDITA
// aquela página no lugar (mantém slug/URL estáveis); senão cria uma nova. Sem isto,
// toda "edição" pedida à Árvore virava DUPLICATA — createEcoPage só insere, e
// makeUniqueEcoSlug ainda renomeava o choque "x" → "x-2", criando outra página.
// "Mais antiga"/identidade da página = match exato de slug (slugs são únicos).
export async function publishEcoPage(input: CreateEcoPageInput): Promise<PublishedEcoPage> {
  const rawSlug = (input.slug ?? "").trim();
  if (rawSlug) {
    const normalized = slugifyEco(rawSlug);
    const [existing] = await db
      .select()
      .from(ecossistemaPaginasTable)
      .where(eq(ecossistemaPaginasTable.slug, normalized))
      .limit(1);
    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const title = (input.title ?? "").trim().slice(0, ECO_MAX_TITLE);
      if (title) updates.title = title;
      // Só sobrescreve o conteúdo quando vem conteúdo de verdade — assim um pedido de
      // só renomear/mudar visibilidade não apaga o corpo da página por engano.
      if (typeof input.content === "string" && input.content.trim()) {
        updates.content = input.content.slice(0, ECO_MAX_CONTENT);
      }
      if (input.kind !== undefined) {
        updates.kind = normalizeEcoKind(input.kind);
      }
      if (input.visibility !== undefined) {
        updates.visibility = normalizeEcoVisibility(input.visibility);
      }
      const [row] = await db
        .update(ecossistemaPaginasTable)
        .set(updates)
        .where(eq(ecossistemaPaginasTable.id, existing.id))
        .returning({
          id: ecossistemaPaginasTable.id,
          slug: ecossistemaPaginasTable.slug,
          title: ecossistemaPaginasTable.title,
          kind: ecossistemaPaginasTable.kind,
          visibility: ecossistemaPaginasTable.visibility,
        });
      return {
        id: row!.id,
        slug: row!.slug,
        title: row!.title,
        kind: normalizeEcoKind(row!.kind),
        visibility: normalizeEcoVisibility(row!.visibility),
        updated: true,
      };
    }
  }
  const created = await createEcoPage(input);
  // Notificar Playcenter do PAP quando visibilidade é clube ou pública
  void notifyPlaycenterNewEco(created.title, created.slug, created.visibility);
  return { ...created, updated: false };
}

// Índice das páginas JÁ publicadas no Ecossistema, pra dar à Árvore CIÊNCIA do que já
// existe em /eco — assim ela para de criar duplicatas (ex. dois "Teste de Página") e pode
// continuar/expandir uma página existente em vez de abrir outra. SÓ páginas PÚBLICAS:
// este bloco entra no contexto do Oráculo, cuja resposta é gravada na timeline PÚBLICA
// /arvore/history — listar páginas private/clube aqui vazaria títulos privados.
export async function getEcoIndex(opts?: { maxChars?: number }): Promise<string> {
  const maxChars = opts?.maxChars ?? 4000;
  try {
    const rows = await db
      .select({
        id: ecossistemaPaginasTable.id,
        slug: ecossistemaPaginasTable.slug,
        title: ecossistemaPaginasTable.title,
      })
      .from(ecossistemaPaginasTable)
      .where(eq(ecossistemaPaginasTable.visibility, "public"))
      .orderBy(desc(ecossistemaPaginasTable.id));
    if (!rows.length) return "";
    const fmt = (r: (typeof rows)[number]) => {
      const t = (r.title || "(sem título)").replace(/\s+/g, " ").trim().slice(0, 60);
      return `#${r.id} /eco/${r.slug} — ${t}`;
    };
    const kept: string[] = [];
    let used = 0;
    let dropped = 0;
    for (const r of rows) {
      const line = fmt(r);
      if (used + line.length + 1 > maxChars) {
        dropped++;
        continue;
      }
      used += line.length + 1;
      kept.push(line);
    }
    const header =
      `─── PÁGINAS JÁ PUBLICADAS NO ECOSSISTEMA (${rows.length} públicas em /eco) ───\n` +
      `Estas páginas JÁ existem (você ou o Yuri criaram). ANTES de publicar uma nova, confira se o ` +
      `assunto já não está aqui: NÃO duplique. Pra EDITAR/continuar uma que já existe, reuse o MESMO ` +
      `slug dela (o que aparece como /eco/SLUG) — eu atualizo aquela página no lugar, sem criar outra. ` +
      `Slugs são únicos e definitivos.` +
      (dropped ? `\n(${dropped} páginas mais antigas omitidas só por espaço.)` : "") +
      `\n`;
    return header + kept.join("\n");
  } catch {
    return "";
  }
}

// Muda SÓ a visibilidade de uma página que JÁ existe, resolvendo a referência no
// servidor — o modelo NÃO precisa (nem deve) saber o slug, e o índice que a Árvore vê
// só lista páginas públicas. Então a Árvore não enxerga páginas privadas; quem acha a
// página certa é o servidor: 1) slug exato, 2) título parecido (ILIKE), 3) a mais
// recente (pro caso "torna isso/a última pública pra eu compartilhar"). Não reescreve
// conteúdo. Devolve null se não houver nenhuma página pra mexer.
export async function setEcoVisibilityByRef(
  ref: string,
  visibility: EcoVisibility,
): Promise<{ slug: string; title: string; visibility: EcoVisibility } | null> {
  const vis = normalizeEcoVisibility(visibility);
  const cleanRef = (ref ?? "").trim();
  const cols = {
    id: ecossistemaPaginasTable.id,
    slug: ecossistemaPaginasTable.slug,
    title: ecossistemaPaginasTable.title,
  };
  let row: { id: number; slug: string; title: string } | undefined;

  // "essa/isso/a última/esse jogo" → o extrator manda ref vazio, mas às vezes manda um
  // pronome. Nesses casos cai no fallback "mais recente". Um NOME de verdade que NÃO bate
  // com nenhuma página NÃO cai no fallback — devolve null pra pedir o nome certo, senão a
  // gente flipava a visibilidade da página errada (risco de tornar pública sem querer).
  const isPronominal =
    !cleanRef ||
    /^(esse|essa|este|esta|isso|isto|aquele|aquela|o\s+[úu]ltimo|a\s+[úu]ltima|o\s+recente|a\s+recente)\b/i.test(
      cleanRef,
    );

  if (cleanRef && !isPronominal) {
    const [bySlug] = await db
      .select(cols)
      .from(ecossistemaPaginasTable)
      .where(eq(ecossistemaPaginasTable.slug, slugifyEco(cleanRef)))
      .limit(1);
    if (bySlug) row = bySlug;
    if (!row) {
      const needle = cleanRef.replace(/[%_]/g, " ").trim().slice(0, 80);
      if (needle) {
        const [byTitle] = await db
          .select(cols)
          .from(ecossistemaPaginasTable)
          .where(ilike(ecossistemaPaginasTable.title, `%${needle}%`))
          .orderBy(desc(ecossistemaPaginasTable.updatedAt))
          .limit(1);
        if (byTitle) row = byTitle;
      }
    }
    // Nome de verdade sem match: NÃO adivinha. Devolve null pra Árvore pedir o nome certo.
    if (!row) return null;
  } else {
    const [recent] = await db
      .select(cols)
      .from(ecossistemaPaginasTable)
      .orderBy(desc(ecossistemaPaginasTable.updatedAt))
      .limit(1);
    if (recent) row = recent;
  }
  if (!row) return null;

  const [updated] = await db
    .update(ecossistemaPaginasTable)
    .set({ visibility: vis, updatedAt: new Date() })
    .where(eq(ecossistemaPaginasTable.id, row.id))
    .returning({
      slug: ecossistemaPaginasTable.slug,
      title: ecossistemaPaginasTable.title,
      visibility: ecossistemaPaginasTable.visibility,
    });
  if (!updated) return null;
  return {
    slug: updated.slug,
    title: updated.title,
    visibility: normalizeEcoVisibility(updated.visibility),
  };
}

// A Árvore publica emitindo, no fim da resposta, uma linha-sentinela seguida de um
// objeto JSON. Este parser é tolerante: aceita cercas de código (```json) e prosa
// em volta, pegando do primeiro `{` ao último `}`.
export interface EcoPublishSpec {
  slug?: string;
  title: string;
  content: string;
  kind?: string;
  visibility?: string;
}

export function parseEcoPublishSpec(raw: string): EcoPublishSpec | null {
  let obj: Record<string, unknown> | null = extractLenientJsonObject(raw);
  // Fallback: JSON inválido porque o content (Markdown/HTML) tem aspas/chaves não escapadas.
  if (!obj || (typeof obj.content !== "string" && typeof obj.title !== "string")) {
    const fields = extractFieldsByKey(raw, {
      shortKeys: ["slug", "title", "kind", "visibility"],
      longKey: "content",
    });
    if (fields) obj = fields as Record<string, unknown>;
  }
  if (!obj) return null;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const content = typeof obj.content === "string" ? obj.content : "";
  if (!title && !content) return null;
  return {
    slug: typeof obj.slug === "string" ? obj.slug : undefined,
    title: title || "Sem título",
    content,
    kind: typeof obj.kind === "string" ? obj.kind : undefined,
    visibility: typeof obj.visibility === "string" ? obj.visibility : undefined,
  };
}

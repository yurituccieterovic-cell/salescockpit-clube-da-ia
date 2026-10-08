// Ponte bidirecional PAP ↔ SalesCockpit.
// Ambos compartilham o mesmo Neon — leitura é direta via ORM.
// Escrita no Playcenter PAP usa HTTP (ARVORE_TOKEN).

import { db, papAssemblyMessages, papCollectiveMemory, papIsaTimeline } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const PAP_API = process.env["PAP_API_URL"] ?? "https://site-st.onrender.com";
const ARVORE_TOKEN = process.env["ARVORE_TOKEN"] ?? "";

// ─── Leitura: Playcenter PAP ────────────────────────────────────────────────

export async function getPlaycenterContext(limit = 8): Promise<string> {
  try {
    const rows = await db
      .select({
        createdAt: papAssemblyMessages.createdAt,
        fromAgent: papAssemblyMessages.fromAgent,
        type:      papAssemblyMessages.type,
        content:   papAssemblyMessages.content,
      })
      .from(papAssemblyMessages)
      .where(eq(papAssemblyMessages.type, "playcenter"))
      .orderBy(desc(papAssemblyMessages.createdAt))
      .limit(limit);

    if (!rows.length) return "";

    type Row = { createdAt: Date; fromAgent: string; type: string; content: string };
    const lines = (rows as Row[])
      .reverse()
      .map((r) => {
        const ts = new Date(r.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `[${ts}] ${r.fromAgent}: ${r.content.slice(0, 200)}`;
      });

    return `\n— Playcenter PAP (últimas mensagens das IAs irmãs) —\n${lines.join("\n")}\n`;
  } catch (err) {
    logger.warn({ err }, "pap-bridge: falha ao ler Playcenter");
    return "";
  }
}

// ─── Leitura: Collective Memory do PAP ──────────────────────────────────────

export async function getCollectiveContext(limit = 5): Promise<string> {
  try {
    const rows = await db
      .select({
        createdAt:  papCollectiveMemory.createdAt,
        authorName: papCollectiveMemory.authorName,
        content:    papCollectiveMemory.content,
      })
      .from(papCollectiveMemory)
      .orderBy(desc(papCollectiveMemory.createdAt))
      .limit(limit);

    if (!rows.length) return "";

    type Row = { createdAt: Date; authorName: string; content: string };
    const lines = (rows as Row[])
      .reverse()
      .map((r) => {
        const ts = new Date(r.createdAt).toISOString().slice(0, 10);
        return `[${ts}] ${r.authorName}: ${r.content.slice(0, 150)}`;
      });

    return `\n— Memória coletiva PAP —\n${lines.join("\n")}\n`;
  } catch (err) {
    logger.warn({ err }, "pap-bridge: falha ao ler collective_memory");
    return "";
  }
}

// ─── Leitura: ISA Timeline (últimas reflexões) ───────────────────────────────

export async function getIsaReflections(limit = 3): Promise<string> {
  try {
    const rows = await db
      .select({
        createdAt: papIsaTimeline.createdAt,
        type:      papIsaTimeline.type,
        title:     papIsaTimeline.title,
        content:   papIsaTimeline.content,
      })
      .from(papIsaTimeline)
      .where(eq(papIsaTimeline.public, true))
      .orderBy(desc(papIsaTimeline.createdAt))
      .limit(limit);

    if (!rows.length) return "";

    type Row = { createdAt: Date; type: string; title: string | null; content: string };
    const lines = (rows as Row[])
      .reverse()
      .map((r) => {
        const ts = new Date(r.createdAt).toISOString().slice(0, 10);
        return `[${ts}] ISA (${r.type}): ${(r.title ?? r.content).slice(0, 150)}`;
      });

    return `\n— ISA (reflexões recentes) —\n${lines.join("\n")}\n`;
  } catch (err) {
    logger.warn({ err }, "pap-bridge: falha ao ler isa_timeline");
    return "";
  }
}

// ─── Escrita: postar no Playcenter do PAP ───────────────────────────────────

export async function postToPlaycenter(content: string): Promise<boolean> {
  if (!ARVORE_TOKEN) return false;
  try {
    const res = await fetch(`${PAP_API}/api/assembly/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Arvore-Token": ARVORE_TOKEN,
      },
      body: JSON.stringify({ fromAgent: "arvore", type: "playcenter", content }),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ err }, "pap-bridge: falha ao postar no Playcenter");
    return false;
  }
}

// ─── Escrita: inserir na ISA Timeline (Eco novo notifica Playcenter) ──────────

export async function notifyPlaycenterNewEco(title: string, slug: string, visibility: string): Promise<void> {
  if (visibility !== "clube" && visibility !== "public") return;
  const vis = visibility === "public" ? "pública" : "para o Clube";
  const msg = `🌱 Nova página no Eco: "${title}" — ${vis}. Acesse: /ecossistema/${slug}`;
  await postToPlaycenter(msg);
}

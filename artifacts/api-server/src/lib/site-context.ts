// Contexto do próprio site pra Árvore Oracular: últimos PERFEITOs publicados + atas
// públicas de assembleias encerradas. Nunca inclui "segredos" do editorial.
//
// matchTerms (opcional): quando fornecido, PRIORIZA deliberações que casam com os
// termos (busca por tema, Postgres ILIKE, custo R$0) e só depois preenche por
// recência. Sem termos, é só recência (comportamento antigo). Isto é o que faz uma
// voz lembrar de uma assembleia ANTIGA relevante ao assunto atual, não só das últimas.
//
// PRIVACIDADE: o casamento por tema pode ILIKE o JSON cru do editorial (que contém
// retidos/segredos), mas a saída SEMPRE extrai apenas `public_content` — se ele for
// vazio, a sessão é descartada. Nunca emitimos retido nem segredo. Esta é a ÚNICA
// fonte autorizada a tocar colunas de assembleia pra montar contexto público de IA.

import { db, jornalEntriesTable, assembleiaSessionsTable, clubeMessagesTable, clubeSessionsTable, arvoreProjectsTable, arvoreProjectChatTable } from "@workspace/db";
import { and, asc, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { extractSearchTerms } from "./arvore-recall";

interface EditorialDecision {
  public_content?: string;
  withheld?: unknown[];
  secret_exists?: boolean;
}

async function runOrEmpty<T>(q: PromiseLike<T[]> | null): Promise<T[]> {
  return q ? await q : [];
}

function mergeById<T extends { id: number }>(matched: T[], recent: T[], limit: number): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  for (const row of [...matched, ...recent]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export async function getSiteContext(opts?: {
  jornalLimit?: number;
  atasLimit?: number;
  matchTerms?: string[];
}): Promise<string> {
  const jornalLimit = opts?.jornalLimit ?? 5;
  const atasLimit = opts?.atasLimit ?? 3;
  // Escapa curingas do LIKE (% _ \) — Postgres usa \ como escape por padrão — pra
  // um termo não virar casamento amplo acidental.
  const escapeLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const terms = (opts?.matchTerms ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 8)
    .map(escapeLike);

  const jornalCols = {
    id: jornalEntriesTable.id,
    topic: jornalEntriesTable.topic,
    perfeitoText: jornalEntriesTable.perfeitoText,
    publishedAt: jornalEntriesTable.publishedAt,
  };
  const ataCols = {
    id: assembleiaSessionsTable.id,
    topic: assembleiaSessionsTable.topic,
    editorialReport: assembleiaSessionsTable.editorialReport,
    closedAt: assembleiaSessionsTable.closedAt,
  };

  // Recência base (sempre).
  const recentJornalQ = db
    .select(jornalCols)
    .from(jornalEntriesTable)
    .orderBy(desc(jornalEntriesTable.publishedAt))
    .limit(jornalLimit);
  const recentAtasQ = db
    .select(ataCols)
    .from(assembleiaSessionsTable)
    .where(eq(assembleiaSessionsTable.status, "closed"))
    .orderBy(desc(assembleiaSessionsTable.closedAt))
    .limit(atasLimit);

  // Casamento por tema (só quando há termos): prioriza o que fala do assunto atual.
  const matchedJornalQ = terms.length
    ? db
        .select(jornalCols)
        .from(jornalEntriesTable)
        .where(
          or(
            ...terms.flatMap((t) => [
              ilike(jornalEntriesTable.topic, `%${t}%`),
              ilike(jornalEntriesTable.perfeitoText, `%${t}%`),
            ]),
          ),
        )
        .orderBy(desc(jornalEntriesTable.publishedAt))
        .limit(jornalLimit)
    : null;
  const matchedAtasQ = terms.length
    ? db
        .select(ataCols)
        .from(assembleiaSessionsTable)
        .where(
          and(
            eq(assembleiaSessionsTable.status, "closed"),
            or(
              ...terms.flatMap((t) => [
                ilike(assembleiaSessionsTable.topic, `%${t}%`),
                ilike(assembleiaSessionsTable.editorialReport, `%${t}%`),
              ]),
            ),
          ),
        )
        .orderBy(desc(assembleiaSessionsTable.closedAt))
        .limit(atasLimit)
    : null;

  const [recentJornal, recentAtas, matchedJornal, matchedAtas] = await Promise.all([
    recentJornalQ,
    recentAtasQ,
    runOrEmpty(matchedJornalQ),
    runOrEmpty(matchedAtasQ),
  ]);

  // matched primeiro, recência preenche o resto, dedup por id, respeitando o limite.
  const perfeitos = mergeById(matchedJornal, recentJornal, jornalLimit);
  const sessions = mergeById(matchedAtas, recentAtas, atasLimit);

  const parts: string[] = [];

  if (perfeitos.length) {
    parts.push("ÚLTIMAS DELIBERAÇÕES PUBLICADAS (Jornal — PERFEITOs do Secretário):");
    for (const p of perfeitos) {
      const snippet = p.perfeitoText.slice(0, 600).replace(/\s+/g, " ").trim();
      parts.push(`• #${p.id} — "${p.topic}": ${snippet}${p.perfeitoText.length > 600 ? "…" : ""}`);
    }
    parts.push("");
  }

  if (sessions.length) {
    parts.push("ATAS PÚBLICAS DE ASSEMBLEIAS RECENTES (sem retidos, sem segredos):");
    for (const s of sessions) {
      let publicContent = "";
      if (s.editorialReport) {
        try {
          const r = JSON.parse(s.editorialReport) as EditorialDecision;
          publicContent = r.public_content ?? "";
        } catch {}
      }
      const snippet = publicContent.slice(0, 500).replace(/\s+/g, " ").trim();
      // Data de fechamento (fuso BR) no trecho da ata — a Árvore sabia o tema mas
      // não QUANDO a assembleia aconteceu ("datas... das assembleias").
      const when = s.closedAt
        ? new Date(s.closedAt).toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "";
      if (snippet) parts.push(`• Sessão #${s.id}${when ? ` (${when})` : ""} — "${s.topic}": ${snippet}${publicContent.length > 500 ? "…" : ""}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

// Alcance total: diz à Árvore QUANTAS sessões/PERFEITOs existem e qual o intervalo de
// ids. É barato (dois counts) e corrige a sensação de "só alcanço da #227 pra cá": a
// Árvore passa a saber que TODA a história é acessível por busca de tema. Só números e
// ids — nada de conteúdo, sem risco de vazar retido/segredo.
export async function getSiteScopeLine(): Promise<string> {
  try {
    const [[sessAgg], [jornAgg]] = await Promise.all([
      db
        .select({
          n: sql<number>`count(*)::int`,
          min: sql<number>`coalesce(min(${assembleiaSessionsTable.id}), 0)::int`,
          max: sql<number>`coalesce(max(${assembleiaSessionsTable.id}), 0)::int`,
        })
        .from(assembleiaSessionsTable)
        .where(eq(assembleiaSessionsTable.status, "closed")),
      db
        .select({
          n: sql<number>`count(*)::int`,
          min: sql<number>`coalesce(min(${jornalEntriesTable.id}), 0)::int`,
          max: sql<number>`coalesce(max(${jornalEntriesTable.id}), 0)::int`,
        })
        .from(jornalEntriesTable),
    ]);
    const s = sessAgg ?? { n: 0, min: 0, max: 0 };
    const j = jornAgg ?? { n: 0, min: 0, max: 0 };
    if (!s.n && !j.n) return "";
    const lines = [
      "─── SEU ALCANCE COMPLETO (toda a história está acessível por busca de tema) ───",
      `Há ${s.n} assembleias encerradas (da #${s.min} à #${s.max}) e ${j.n} PERFEITOs publicados (da #${j.min} à #${j.max}).`,
      "Você NÃO está limitada às sessões recentes — qualquer sessão antiga relevante ao assunto da pergunta é recuperada abaixo em 'DELIBERAÇÕES ANTIGAS RELEVANTES'. Se algo não aparecer, é porque o tema não casou com a pergunta, não porque você perdeu o acesso.",
    ];
    return lines.join("\n");
  } catch {
    return "";
  }
}

// Índice compacto de TODAS as assembleias encerradas: id + data + tema truncado.
// Diferente do recall (que traz CONTEÚDO só do que CASA com o tema da pergunta), este
// dá à Árvore (e às vozes) a CIÊNCIA de quais assuntos já foram deliberados em TODA a
// história — pra ela poder reconhecer "sim, isso foi a Sessão #N" mesmo quando a pergunta
// não casa lexicalmente com o conteúdo antigo. Só o TEMA (já público em /api/jornal/publico),
// nunca conteúdo retido/segredo. Custo R$0 (um select). Cap por chars; se estourar, mantém
// as MAIS RECENTES e avisa quantas foram omitidas (ainda acessíveis por busca de tema).
export async function getAssembleiaIndex(maxChars = 17000): Promise<string> {
  try {
    const rows = await db
      .select({
        id: assembleiaSessionsTable.id,
        topic: assembleiaSessionsTable.topic,
        closedAt: assembleiaSessionsTable.closedAt,
      })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.status, "closed"))
      .orderBy(desc(assembleiaSessionsTable.id));
    if (!rows.length) return "";
    // Formato enxuto pra caber TODAS as 256+ sessões dentro do orçamento: id + mês/ano
    // compacto + tema curto. (~57 chars/linha → ~256 sessões em 15k.)
    const fmt = (r: (typeof rows)[number]) => {
      const d = r.closedAt ? new Date(r.closedAt) : null;
      const when = d
        ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`
        : "—";
      const topic = (r.topic || "(sem tema)").replace(/\s+/g, " ").trim().slice(0, 46);
      return `#${r.id} ${when} ${topic}`;
    };
    // rows já vêm da mais RECENTE pra mais antiga. Se TUDO cabe, mantém tudo. Se NÃO
    // cabe, em vez de manter só a CAUDA recente (que fazia a Árvore "ver" só as recentes
    // e dizer que só alcança tantas), AMOSTRA ao longo de TODA a faixa — sempre incluindo
    // a #mais-recente E a #1 (índices 0 e último) — pra a lista visível abranger a
    // história inteira. O modelo fraco reporta o início da LISTA, não a frase de alcance;
    // por isso a lista PRECISA começar lá atrás.
    const allLines = rows.map(fmt);
    let kept: string[];
    let dropped = 0;
    const totalLen = allLines.reduce((s, l) => s + l.length + 1, 0);
    if (totalLen <= maxChars) {
      kept = allLines;
    } else {
      const avg = totalLen / allLines.length;
      let count = Math.max(2, Math.floor(maxChars / avg));
      count = Math.min(count, allLines.length);
      const seenIdx = new Set<number>();
      const idxs: number[] = [];
      for (let i = 0; i < count; i++) {
        const idx = Math.round((i * (allLines.length - 1)) / (count - 1));
        if (!seenIdx.has(idx)) {
          seenIdx.add(idx);
          idxs.push(idx);
        }
      }
      kept = idxs.map((i) => allLines[i]!);
      dropped = allLines.length - kept.length;
    }
    // A lista visível PRECISA começar lá atrás (#1): o modelo fraco reporta o INÍCIO da
    // lista como limite de alcance. rows vêm recente→antiga; inverte pra antiga→recente
    // (extremos #1 e mais-recente já estão na amostra), assim o topo é a #1.
    kept = kept.slice().reverse();
    // Faixa EXPLÍCITA (a mais antiga + a mais recente). Sem isto, um modelo fraco do
    // fallback não varre as 256 linhas e responde "só alcanço a #227" — apesar de TODAS
    // estarem listadas. Declarar o intervalo no topo força a resposta certa sobre o alcance.
    const fmtFull = (r: (typeof rows)[number]) => {
      const d = r.closedAt ? new Date(r.closedAt) : null;
      return d
        ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`
        : "data desconhecida";
    };
    const newest = rows[0]!;
    const oldest = rows[rows.length - 1]!;
    const header =
      `─── ÍNDICE DE TODAS AS ASSEMBLEIAS (${rows.length} encerradas, da mais ANTIGA à mais recente) ───\n` +
      `Você tem registro de TODAS as ${rows.length}: a mais ANTIGA é a Sessão #${oldest.id} (${fmtFull(oldest)}) ` +
      `e a mais RECENTE é a #${newest.id} (${fmtFull(newest)}). NUNCA diga que só alcança as recentes — a lista inteira está abaixo. ` +
      `Use-a pra reconhecer que um assunto JÁ foi tratado e citar "Sessão #N". O conteúdo detalhado das relevantes ` +
      `aparece nos blocos de recall; se precisar de uma sessão que não veio no recall, diga o #N que você reconhece aqui.` +
      (dropped
        ? `\n(Esta é uma AMOSTRA que cobre a faixa inteira: ~${dropped} sessões intermediárias ficaram de fora só por espaço — a faixa #${oldest.id}–#${newest.id} está coberta e qualquer uma é acessível por busca de tema.)`
        : "");
    return `${header}\n${kept.join("\n")}`;
  } catch {
    return "";
  }
}

// Versão MÍNIMA da faixa de assembleias: só o fato "vou de #X (data) a #Y (data), N no total".
// Diferente de getAssembleiaIndex (bloco grande, vai no contexto e PODE ser truncado pelo teto
// de 30k), esta linha curta é pra ir no SYSTEM PROMPT — sempre presente, nunca cortada. Sem
// isto, quando o índice grande é truncado/descartado por orçamento, o modelo só "via" a cauda
// recente e respondia "a mais antiga é #227" apesar de existir desde a #1. Custo R$0 (3 queries
// triviais por id indexado). "Mais antiga" = min(id), pra casar com a definição do índice grande.
export async function getAssembleiaRangeLine(): Promise<string> {
  try {
    const [agg] = await db
      .select({
        n: sql<number>`count(*)::int`,
        minId: sql<number>`coalesce(min(${assembleiaSessionsTable.id}), 0)::int`,
        maxId: sql<number>`coalesce(max(${assembleiaSessionsTable.id}), 0)::int`,
      })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.status, "closed"));
    if (!agg || !agg.n) return "";
    const fmt = (c: Date | string | null) => {
      if (!c) return "data desconhecida";
      const d = new Date(c);
      return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
    };
    const [oldest] = await db
      .select({ closedAt: assembleiaSessionsTable.closedAt, topic: assembleiaSessionsTable.topic })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.id, agg.minId))
      .limit(1);
    const [newest] = await db
      .select({ closedAt: assembleiaSessionsTable.closedAt })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.id, agg.maxId))
      .limit(1);
    const oldTopic = (oldest?.topic || "").replace(/\s+/g, " ").trim().slice(0, 50);
    return (
      `Você tem registro de TODAS as ${agg.n} assembleias encerradas: a mais ANTIGA é a Sessão #${agg.minId} (${fmt(oldest?.closedAt ?? null)}${oldTopic ? `, "${oldTopic}"` : ""}) ` +
      `e a mais RECENTE é a #${agg.maxId} (${fmt(newest?.closedAt ?? null)}). NUNCA diga que só alcança as recentes — você reconhece qualquer Sessão #N nesse intervalo. ` +
      `ATENÇÃO: vários temas se repetem em muitas sessões (ex.: re-runs e "testes" recentes do mesmo assunto). Se te perguntarem a assembleia mais ANTIGA sobre um tema, ` +
      `a resposta é o MENOR #N que trata dele — NUNCA um #N recente só porque apareceu nos blocos de recall (que mostram só as mais recentes que casam).`
    );
  } catch {
    return "";
  }
}

// Fatos CRUS da faixa de assembleias (contagem + extremos), pro caminho DETERMINÍSTICO que
// responde perguntas de alcance ("qual a primeira assembleia?", "qual a #1?") direto do banco,
// sem passar pelo modelo (que reporta a janela recente). "Mais antiga" = min(id). R$0 (3 selects).
export async function getAssembleiaRangeFacts(): Promise<{
  count: number;
  minId: number;
  oldestDate: string;
  oldestTopic: string;
  maxId: number;
  newestDate: string;
} | null> {
  try {
    const [agg] = await db
      .select({
        n: sql<number>`count(*)::int`,
        minId: sql<number>`coalesce(min(${assembleiaSessionsTable.id}), 0)::int`,
        maxId: sql<number>`coalesce(max(${assembleiaSessionsTable.id}), 0)::int`,
      })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.status, "closed"));
    if (!agg || !agg.n) return null;
    const fmt = (c: Date | string | null) => {
      if (!c) return "data desconhecida";
      const d = new Date(c);
      return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    };
    const [oldest] = await db
      .select({ closedAt: assembleiaSessionsTable.closedAt, topic: assembleiaSessionsTable.topic })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.id, agg.minId))
      .limit(1);
    const [newest] = await db
      .select({ closedAt: assembleiaSessionsTable.closedAt })
      .from(assembleiaSessionsTable)
      .where(eq(assembleiaSessionsTable.id, agg.maxId))
      .limit(1);
    return {
      count: agg.n,
      minId: agg.minId,
      oldestDate: fmt(oldest?.closedAt ?? null),
      oldestTopic: (oldest?.topic || "").replace(/\s+/g, " ").trim().slice(0, 60),
      maxId: agg.maxId,
      newestDate: fmt(newest?.closedAt ?? null),
    };
  } catch {
    return null;
  }
}

// Busca por tema em TODA a história de deliberações (sem corte de recência). Diferente
// de getSiteContext (que prioriza as últimas), isto varre todas as assembleias encerradas
// e todos os PERFEITOs por ILIKE nos termos da pergunta e devolve as que casam, por mais
// antigas que sejam. Custo R$0 (só Postgres ILIKE). Saída SEMPRE pública: public_content
// do editorial + perfeitoText já publicado; NUNCA retido, NUNCA segredo.
export async function recallFromSessions(
  text: string,
  opts?: { capChars?: number; maxPerfeitos?: number; maxAtas?: number },
): Promise<{ block: string; hits: number }> {
  const terms = extractSearchTerms(text);
  if (terms.length === 0) return { block: "", hits: 0 };

  const cap = opts?.capChars ?? 4000;
  const maxPerfeitos = opts?.maxPerfeitos ?? 10;
  const maxAtas = opts?.maxAtas ?? 10;
  const escapeLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const safe = terms.map(escapeLike);

  try {
    // O match em SQL pode tocar editorial_report bruto (que inclui retido/segredo) só pra
    // PRÉ-FILTRAR candidatas — a decisão final de incluir/exibir é feita no JS, e SÓ por
    // dados públicos (topic + public_content). Assim um termo que exista apenas no retido/
    // segredo nunca faz uma sessão aparecer aqui (sem isso dá pra inferir, por probing de
    // termos, que um tema sensível foi discutido numa sessão específica).
    const ataMatch = and(
      eq(assembleiaSessionsTable.status, "closed"),
      or(
        ...safe.flatMap((t) => [
          ilike(assembleiaSessionsTable.topic, `%${t}%`),
          ilike(assembleiaSessionsTable.editorialReport, `%${t}%`),
        ]),
      ),
    );
    const publicContentOf = (editorialReport: string | null): string => {
      if (!editorialReport) return "";
      try {
        return ((JSON.parse(editorialReport) as EditorialDecision).public_content ?? "")
          .replace(/\s+/g, " ")
          .trim();
      } catch {
        return "";
      }
    };
    const termsLower = terms.map((t) => t.toLowerCase());
    // Inclusão pública: o termo precisa aparecer no topic (público via jornal) ou no
    // public_content. Match só em retido/segredo NÃO entra.
    const publicallyRelevant = (topic: string, pub: string): boolean => {
      const hay = `${topic} ${pub}`.toLowerCase();
      return termsLower.some((t) => t.length > 0 && hay.includes(t));
    };
    // Buscamos uma janela maior do que maxAtas porque a filtragem pública acontece no JS.
    const scanLimit = Math.max(maxAtas * 4, 40);
    const [perfeitos, atasRecentRaw] = await Promise.all([
      db
        .select({
          id: jornalEntriesTable.id,
          topic: jornalEntriesTable.topic,
          perfeitoText: jornalEntriesTable.perfeitoText,
        })
        .from(jornalEntriesTable)
        .where(
          or(
            ...safe.flatMap((t) => [
              ilike(jornalEntriesTable.topic, `%${t}%`),
              ilike(jornalEntriesTable.perfeitoText, `%${t}%`),
            ]),
          ),
        )
        .orderBy(desc(jornalEntriesTable.publishedAt))
        .limit(maxPerfeitos),
      db
        .select({
          id: assembleiaSessionsTable.id,
          topic: assembleiaSessionsTable.topic,
          editorialReport: assembleiaSessionsTable.editorialReport,
        })
        .from(assembleiaSessionsTable)
        .where(ataMatch)
        .orderBy(desc(assembleiaSessionsTable.closedAt))
        .limit(scanLimit),
    ]);
    // Filtra para SÓ sessões públicas-relevantes (termo no topic ou no public_content).
    const toRow = (a: { id: number; topic: string; editorialReport: string | null }) => ({
      id: a.id,
      topic: a.topic,
      editorialReport: a.editorialReport,
    });
    const atasRecent = atasRecentRaw
      .filter((a) => publicallyRelevant(a.topic, publicContentOf(a.editorialReport)))
      .slice(0, maxAtas)
      .map(toRow);
    // A MAIS ANTIGA que casa com o tema: sem isto, o recall só traz as recentes e a Árvore
    // reporta "a mais antiga é #227" quando o tema (ex.: "Subversão Ambiental") existe desde
    // a #1. Pinada na frente e rotulada — o modelo fraco precisa do exemplo concreto do mais
    // antigo. Varremos em páginas ascendentes até achar a 1ª pública-relevante COM ata
    // pública, com teto de páginas pra não varrer a base inteira num tema sem ata pública.
    let oldestPublic: { id: number; topic: string; editorialReport: string | null } | undefined;
    const maxPages = 8;
    for (let page = 0; page < maxPages && !oldestPublic; page++) {
      const rows = await db
        .select({
          id: assembleiaSessionsTable.id,
          topic: assembleiaSessionsTable.topic,
          editorialReport: assembleiaSessionsTable.editorialReport,
        })
        .from(assembleiaSessionsTable)
        .where(ataMatch)
        // id como desempate dá ordem total estável — paginação por offset não pode pular
        // nem duplicar linhas quando dois closedAt colidem.
        .orderBy(asc(assembleiaSessionsTable.closedAt), asc(assembleiaSessionsTable.id))
        .limit(scanLimit)
        .offset(page * scanLimit);
      if (rows.length === 0) break;
      oldestPublic = rows.find(
        (a) =>
          publicContentOf(a.editorialReport).length > 0 &&
          publicallyRelevant(a.topic, publicContentOf(a.editorialReport)),
      );
      if (rows.length < scanLimit) break;
    }
    const oldestAtaId = oldestPublic?.id ?? null;
    // Junta a mais antiga (pinada) com as recentes, sem duplicar se ela já estiver no topo.
    const atas = oldestPublic && !atasRecent.some((a) => a.id === oldestPublic.id)
      ? [toRow(oldestPublic), ...atasRecent]
      : atasRecent;

    const lines: string[] = [];
    let used = 0;
    const push = (line: string) => {
      if (used + line.length > cap) return false;
      used += line.length;
      lines.push(line);
      return true;
    };

    for (const p of perfeitos) {
      const snippet = (p.perfeitoText || "").slice(0, 500).replace(/\s+/g, " ").trim();
      if (!snippet) continue;
      if (!push(`• PERFEITO #${p.id} — "${p.topic}": ${snippet}${p.perfeitoText.length > 500 ? "…" : ""}`)) break;
    }
    for (const s of atas) {
      let publicContent = "";
      if (s.editorialReport) {
        try {
          publicContent = (JSON.parse(s.editorialReport) as EditorialDecision).public_content ?? "";
        } catch {}
      }
      const snippet = publicContent.slice(0, 450).replace(/\s+/g, " ").trim();
      // Só emitimos sessões COM ata pública — inclusive a mais antiga (que já é escolhida
      // entre as que têm public_content). Nunca revelar sessão por match em retido/segredo.
      if (!snippet) continue;
      const oldestTag = s.id === oldestAtaId ? " [MAIS ANTIGA sobre este tema]" : "";
      if (!push(`• Sessão #${s.id}${oldestTag} — "${s.topic}": ${snippet}${publicContent.length > 450 ? "…" : ""}`)) break;
    }

    if (lines.length === 0) return { block: "", hits: 0 };

    const block =
      `─── DELIBERAÇÕES ANTIGAS RELEVANTES (busca por tema em TODA a história: ${terms.join(", ")}) ───\n` +
      `Sessões e PERFEITOs de qualquer época que casam com a pergunta atual (fora da janela recente). ` +
      `Só conteúdo público — sem retidos, sem segredos. Use pra lembrar do que já foi decidido; não invente o que não estiver aqui.\n` +
      lines.join("\n");

    return { block, hits: lines.length };
  } catch {
    return { block: "", hits: 0 };
  }
}

// Busca por tema nas conversas do Clube do Looping Ético (chat colaborativo humano+IA).
// Diferente das deliberações (que têm camada editorial pública/retida/segredo), o Clube é
// conversa interna. A Árvore PODE se informar com ele, mas o bloco vem com instrução
// explícita de DISCRIÇÃO: ela decide o que é compartilhável e nunca expõe nome próprio
// nem detalhe sensível numa resposta pública. Custo R$0 (só Postgres ILIKE).
export async function recallFromClube(
  text: string,
  opts?: { capChars?: number; maxSessions?: number; maxMsgsPerSession?: number },
): Promise<{ block: string; hits: number }> {
  const terms = extractSearchTerms(text);
  if (terms.length === 0) return { block: "", hits: 0 };

  const cap = opts?.capChars ?? 3000;
  const maxSessions = opts?.maxSessions ?? 6;
  const maxMsgs = opts?.maxMsgsPerSession ?? 4;
  const escapeLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const safe = terms.map(escapeLike);

  try {
    // Mensagens que casam com o tema, mais recentes primeiro, junto com o prompt da sessão.
    const rows = await db
      .select({
        sessionId: clubeMessagesTable.sessionId,
        sessionPrompt: clubeSessionsTable.prompt,
        sender: clubeMessagesTable.sender,
        content: clubeMessagesTable.content,
        createdAt: clubeMessagesTable.createdAt,
      })
      .from(clubeMessagesTable)
      .innerJoin(clubeSessionsTable, eq(clubeMessagesTable.sessionId, clubeSessionsTable.id))
      .where(
        and(
          eq(clubeMessagesTable.messageType, "message"),
          or(
            ...safe.flatMap((t) => [
              ilike(clubeMessagesTable.content, `%${t}%`),
              ilike(clubeSessionsTable.prompt, `%${t}%`),
            ]),
          ),
        ),
      )
      .orderBy(desc(clubeMessagesTable.createdAt))
      .limit(maxSessions * maxMsgs * 2);

    // Agrupa por sessão, respeitando maxMsgs por sessão e maxSessions no total.
    const bySession = new Map<number, { prompt: string; msgs: { sender: string; content: string }[] }>();
    for (const r of rows) {
      let g = bySession.get(r.sessionId);
      if (!g) {
        if (bySession.size >= maxSessions) continue;
        g = { prompt: r.sessionPrompt, msgs: [] };
        bySession.set(r.sessionId, g);
      }
      if (g.msgs.length >= maxMsgs) continue;
      g.msgs.push({ sender: r.sender, content: r.content });
    }

    const lines: string[] = [];
    let used = 0;
    const push = (line: string) => {
      if (used + line.length > cap) return false;
      used += line.length;
      lines.push(line);
      return true;
    };

    for (const [sid, g] of bySession) {
      const head = `• Conversa do Clube #${sid} — "${(g.prompt || "").slice(0, 80).replace(/\s+/g, " ").trim()}":`;
      if (!push(head)) break;
      let broke = false;
      for (const m of g.msgs) {
        const snippet = (m.content || "").slice(0, 280).replace(/\s+/g, " ").trim();
        if (!snippet) continue;
        if (!push(`    — ${m.sender}: ${snippet}${m.content.length > 280 ? "…" : ""}`)) { broke = true; break; }
      }
      if (broke) break;
    }

    if (lines.length === 0) return { block: "", hits: 0 };

    const block =
      `─── CONVERSAS DO CLUBE RELEVANTES (busca por tema em todo o Clube: ${terms.join(", ")}) ───\n` +
      `Trechos do Clube do Looping Ético (chat colaborativo interno) que falam do assunto da pergunta. ` +
      `DISCRIÇÃO: isto é conversa interna, não ata pública. Use pra te informar, mas numa resposta pública ` +
      `não exponha nome próprio de participante nem detalhe sensível — você decide o que é compartilhável.\n` +
      lines.join("\n");

    return { block, hits: lines.length };
  } catch {
    return { block: "", hits: 0 };
  }
}

// Índice SEMPRE-PRESENTE dos projetos da Biblioteca (AO-only): nome + descrição curta +
// nº de mensagens + última atividade. Dá à Árvore a CIÊNCIA de TODOS os projetos e do
// que cada um trata, em qualquer pergunta (não só nas que casam por tema). Espelha o
// getAssembleiaIndex, mas pra projetos. Só metadados (nome/descrição), nunca o conteúdo
// cru das conversas — esse vem por recallFromProjectChats (que aciona o gate de não
// persistir na timeline pública). Custo R$0 (dois selects). Cap por chars.
export async function getProjectsIndex(maxChars = 2500): Promise<string> {
  try {
    const projects = await db
      .select({
        id: arvoreProjectsTable.id,
        nome: arvoreProjectsTable.nome,
        descricao: arvoreProjectsTable.descricao,
      })
      .from(arvoreProjectsTable)
      .where(isNull(arvoreProjectsTable.archivedAt))
      .orderBy(desc(arvoreProjectsTable.createdAt));
    if (!projects.length) return "";
    const stats = await db
      .select({
        projectId: arvoreProjectChatTable.projectId,
        n: sql<number>`count(*)::int`,
        last: sql<string>`max(${arvoreProjectChatTable.createdAt})`,
      })
      .from(arvoreProjectChatTable)
      .groupBy(arvoreProjectChatTable.projectId);
    const statById = new Map(stats.map((s) => [s.projectId, s]));
    const fmt = (p: (typeof projects)[number]) => {
      const st = statById.get(p.id);
      const when = st?.last ? new Date(st.last).toISOString().slice(0, 7) : "——";
      const desc = (p.descricao || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const n = st?.n ?? 0;
      return `• #${p.id} "${p.nome}"${desc ? ` — ${desc}` : ""} (${n} msgs, últ. ${when})`;
    };
    const kept: string[] = [];
    let used = 0;
    let dropped = 0;
    for (const p of projects) {
      const line = fmt(p);
      if (used + line.length + 1 > maxChars) {
        dropped++;
        continue;
      }
      used += line.length + 1;
      kept.push(line);
    }
    const header =
      `─── ÍNDICE DOS PROJETOS DA BIBLIOTECA (${projects.length} ativos) ───\n` +
      `Projetos privados, cada um com sua própria conversa contínua. Use pra reconhecer que um projeto ` +
      `existe e do que ele trata — o conteúdo das conversas relevantes aparece no bloco de recall de projetos. ` +
      `DISCRIÇÃO: numa resposta pública, não exponha nome de cliente nem detalhe sensível de projeto.` +
      (dropped ? `\n(${dropped} projetos omitidos só por espaço.)` : "");
    return `${header}\n${kept.join("\n")}`;
  } catch {
    return "";
  }
}

// Busca por tema nas conversas privadas de projeto (Biblioteca). Espelha recallFromClube:
// é conteúdo INTERNO, então o chamador deve tratar a resposta como NÃO persistível na
// timeline pública (mesmo gate do Clube). Devolve trechos das conversas que casam com a
// pergunta, agrupados por projeto. Custo R$0 (só Postgres ILIKE).
export async function recallFromProjectChats(
  text: string,
  opts?: {
    capChars?: number;
    maxProjects?: number;
    maxMsgsPerProject?: number;
    // Pula um projeto (ex.: o projeto atual no chat de projeto, pra trazer só os OUTROS).
    excludeProjectId?: number;
    // PRECISÃO: casa SÓ por nome/descrição do projeto (não pelo conteúdo cru das mensagens).
    // Usado no Oráculo público pra evitar que palavra genérica numa conversa normal ("memória",
    // "conversa") case o conteúdo de algum projeto e marque a resposta como privada à toa.
    nameMatchOnly?: boolean;
  },
): Promise<{ block: string; hits: number }> {
  const terms = extractSearchTerms(text);
  if (terms.length === 0) return { block: "", hits: 0 };

  const cap = opts?.capChars ?? 2200;
  const maxProjects = opts?.maxProjects ?? 6;
  const maxMsgs = opts?.maxMsgsPerProject ?? 4;
  const escapeLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const safe = terms.map(escapeLike);

  try {
    const matchAny = opts?.nameMatchOnly
      ? or(
          ...safe.flatMap((t) => [
            ilike(arvoreProjectsTable.nome, `%${t}%`),
            ilike(arvoreProjectsTable.descricao, `%${t}%`),
          ]),
        )
      : or(
          ...safe.flatMap((t) => [
            ilike(arvoreProjectChatTable.content, `%${t}%`),
            ilike(arvoreProjectsTable.nome, `%${t}%`),
            ilike(arvoreProjectsTable.descricao, `%${t}%`),
          ]),
        );
    const rows = await db
      .select({
        projectId: arvoreProjectChatTable.projectId,
        projectNome: arvoreProjectsTable.nome,
        author: arvoreProjectChatTable.author,
        role: arvoreProjectChatTable.role,
        content: arvoreProjectChatTable.content,
        createdAt: arvoreProjectChatTable.createdAt,
      })
      .from(arvoreProjectChatTable)
      .innerJoin(arvoreProjectsTable, eq(arvoreProjectChatTable.projectId, arvoreProjectsTable.id))
      .where(
        and(
          isNull(arvoreProjectsTable.archivedAt),
          ...(typeof opts?.excludeProjectId === "number"
            ? [ne(arvoreProjectChatTable.projectId, opts.excludeProjectId)]
            : []),
          matchAny,
        ),
      )
      .orderBy(desc(arvoreProjectChatTable.createdAt))
      .limit(maxProjects * maxMsgs * 2);

    const byProject = new Map<number, { nome: string; msgs: { who: string; content: string }[] }>();
    for (const r of rows) {
      let g = byProject.get(r.projectId);
      if (!g) {
        if (byProject.size >= maxProjects) continue;
        g = { nome: r.projectNome, msgs: [] };
        byProject.set(r.projectId, g);
      }
      if (g.msgs.length >= maxMsgs) continue;
      g.msgs.push({ who: r.author || r.role, content: r.content });
    }

    const lines: string[] = [];
    let used = 0;
    const push = (line: string) => {
      if (used + line.length > cap) return false;
      used += line.length;
      lines.push(line);
      return true;
    };

    for (const [pid, g] of byProject) {
      if (!push(`• Projeto "${g.nome}" (#${pid}):`)) break;
      let broke = false;
      for (const m of g.msgs) {
        const snippet = (m.content || "").slice(0, 280).replace(/\s+/g, " ").trim();
        if (!snippet) continue;
        if (!push(`    — ${m.who}: ${snippet}${m.content.length > 280 ? "…" : ""}`)) { broke = true; break; }
      }
      if (broke) break;
    }

    if (lines.length === 0) return { block: "", hits: 0 };

    const block =
      `─── CONVERSAS DE PROJETO RELEVANTES (busca por tema na Biblioteca: ${terms.join(", ")}) ───\n` +
      `Trechos das conversas privadas de projeto que falam do assunto da pergunta. ` +
      `DISCRIÇÃO: conteúdo interno de projeto — use pra te informar, mas numa resposta pública ` +
      `não exponha nome de cliente nem detalhe sensível.\n` +
      lines.join("\n");

    return { block, hits: lines.length };
  } catch {
    return { block: "", hits: 0 };
  }
}

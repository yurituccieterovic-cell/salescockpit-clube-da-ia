// 2026-06: conecta as vozes do conselho RODAR à memória das ASSEMBLEIAS passadas.
// Antes desta correção, a memória que as vozes recebiam vinha só da timeline do
// Oráculo (arvore_chat) — direta (voz Árvore) e destilada (getMemoriaEstruturada,
// todas com fonte="timeline"). As deliberações das assembleias nunca chegavam às
// vozes, então elas não "lembravam" do que já tinha sido decidido em sessões
// anteriores.
//
// RECALL POR TEMA (2026-06): só recência não bastava — uma assembleia ANTIGA
// relevante ao tema atual nunca aparecia (só as últimas ~4-5). Agora extraímos os
// termos do tema do RODAR (extractSearchTerms, o mesmo do recall do Oráculo) e
// pedimos a getSiteContext que PRIORIZE as deliberações que casam com o assunto,
// preenchendo o resto por recência. Custo R$0 (Postgres ILIKE, sem LLM).
//
// FONTE SEGURA: reusa getSiteContext — a MESMA fonte canônica (e a ÚNICA autorizada
// a tocar colunas de assembleia). Ela traz apenas o que é PÚBLICO: PERFEITOs já
// publicados no Jornal + `public_content` do editorial de assembleias ENCERRADAS
// (NUNCA retidos, NUNCA segredos). Assim a memória injetada nas vozes não vaza
// conteúdo sensível nem privado de outras sessões.
//
// SÓ LÊ — não grava nada. Entra apenas no `prompt` das vozes (nunca no
// cleanTopic/topic salvo), então não vaza pro jornal.

import { getSiteContext } from "./site-context";
import { extractSearchTerms } from "./arvore-recall";
import { logger } from "./logger";

const HEADER = "═══ MEMÓRIA DAS ASSEMBLEIAS (deliberações já publicadas) ═══";

export async function getAssembleiaMemoryContext(topic = "", capChars = 3000): Promise<string> {
  try {
    const terms = topic.trim() ? extractSearchTerms(topic) : [];
    const ctx = (await getSiteContext({ jornalLimit: 8, atasLimit: 8, matchTerms: terms })).trim();
    if (!ctx) return "";
    const body = ctx.length > capChars ? ctx.slice(0, capChars) + "…" : ctx;
    return `${HEADER}\n${body}\n═══ FIM DA MEMÓRIA DAS ASSEMBLEIAS ═══\n\n`;
  } catch (err) {
    logger.warn({ err }, "[arvore-assembleia-memory] falha ao ler assembleias publicadas, seguindo sem memória");
    return "";
  }
}

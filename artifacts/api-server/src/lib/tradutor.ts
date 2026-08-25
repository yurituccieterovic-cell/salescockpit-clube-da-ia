import { anthropic } from "@workspace/integrations-anthropic-ai";

export const TRADUTOR_THRESHOLD = 100000;

const TRADUTOR_SYSTEM = `Você é o Tradutor — sintetizador denso do pipeline RODAR/Assembleia/Ágora.
Sua função: produzir uma síntese fiel e densa de um texto longo, sem perda de nuance.
Preserve: intenção central, dados relevantes, paradoxos, tensões, vozes distintas e seus papéis.
Quando o texto contiver várias seções/falas/votos, mantenha a estrutura visível (títulos curtos).
Em português. Sem disclaimer, sem meta-comentários, sem "neste texto".
Seja o texto destilado — não o seu obituário.`;

export interface TranslateOpts {
  threshold?: number;
  context?: string;
  maxTokens?: number;
}

export async function translateIfLong(
  text: string,
  opts: TranslateOpts = {},
): Promise<string> {
  const threshold = opts.threshold ?? TRADUTOR_THRESHOLD;
  if (!text || text.length <= threshold) return text;

  const ctx = opts.context ? ` (${opts.context})` : "";
  const userMsg =
    `TEXTO ORIGINAL${ctx} — ${text.length} caracteres:\n\n${text}\n\n---\n` +
    `Produza uma síntese densa e fiel deste texto, preservando vozes distintas, dados, tensões e a ordem original.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: opts.maxTokens ?? 4000,
      system: TRADUTOR_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    const block = response.content[0];
    const out = block?.type === "text" ? block.text : "";
    if (!out) return text;
    return `[Tradutor sintetizou ${text.length} chars → ${out.length} chars]\n\n${out}`;
  } catch (err) {
    console.error("[Tradutor] Falha na síntese, retornando texto original:", err);
    return text;
  }
}

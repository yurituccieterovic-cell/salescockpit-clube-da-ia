export interface ScaledTokens {
  maxTokens: number;
  isSpecial: boolean;
  marker: string;
  costEstimateBRL: number;
}

const SONNET_BASELINE_CAP = 8000;
const SONNET_HARD_CAP = 16000;
const CHARS_PER_OUTPUT_TOKEN = 6;
const SONNET_OUTPUT_USD_PER_1K = 0.015;
const USD_TO_BRL = 5.4;

export function scaleSonnetTokens(inputChars: number, baseline: number): ScaledTokens {
  const projected = Math.max(baseline, Math.ceil(inputChars / CHARS_PER_OUTPUT_TOKEN));
  const capped = Math.min(projected, SONNET_HARD_CAP);
  const isSpecial = capped > SONNET_BASELINE_CAP;
  const costUSD = (capped / 1000) * SONNET_OUTPUT_USD_PER_1K;
  const costEstimateBRL = costUSD * USD_TO_BRL;
  const marker = isSpecial
    ? `[SESSAO ESPECIAL] Sonnet 4.5: input ${inputChars} chars -> output ate ${capped} tokens (~R$ ${costEstimateBRL.toFixed(2)})`
    : `[modo padrao] Sonnet 4.5: input ${inputChars} chars -> output ate ${capped} tokens (~R$ ${costEstimateBRL.toFixed(2)})`;
  return { maxTokens: capped, isSpecial, marker, costEstimateBRL };
}

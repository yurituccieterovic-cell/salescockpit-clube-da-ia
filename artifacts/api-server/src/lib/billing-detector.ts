import nodemailer from "nodemailer";
import { logger } from "./logger";

const VOICE_TO_PROVIDER: Record<string, string> = {
  ChatGPT: "OpenAI",
  Metassemiótico: "OpenAI",
  Nébula: "OpenAI",
  Psicólogo: "OpenAI",
  Escrevente: "OpenAI",
  Tradutor: "Anthropic",
  Claude: "Anthropic",
  Agente: "Anthropic",
  Arquiteto: "Anthropic",
  Gemini: "Google",
  Grok: "xAI",
  // 2026-05: motor trocado pra Llama/Groq (xAI sem crédito). Persona preservada.
  // Mapa de provedor segue o que o código realmente chama (chat.ts linhas 402, 550, 718).
  Segurança: "Groq",
  Juíz: "Groq",
  "Chefe do Olheiro": "Groq",
  Árvore: "Groq",
  Pacifista: "Groq",
  Sustentabilista: "Groq",
  Artista: "Groq",
  Professora: "Groq",
  Médico: "Groq",
  Promotor: "Groq",
  Defensor: "Groq",
  "Meta AI": "Groq",
  Olheiro: "Groq",
  Perplexity: "Perplexity",
};

export function mapVoiceToProvider(label: string): string {
  return VOICE_TO_PROVIDER[label] ?? "Desconhecido";
}

export interface ClassifiedError {
  errString: string;
  isBilling: boolean;
  rawMessage: string;
}

const FREE_TIER_PROVIDERS = new Set(["Groq", "Together", "Google"]);

export function classifyError(err: unknown, provider: string): ClassifiedError {
  const rawMessage = err instanceof Error ? err.message : String(err);

  const isNotConfigured = /(not configured|não configurad[ao]|n[ãa]o configurad[ao]|api key (not set|missing|invalid)|chave n[aã]o configurada)/i.test(rawMessage);
  if (isNotConfigured) {
    return { errString: rawMessage, isBilling: false, rawMessage };
  }

  const strongBillingKw = /(insufficient_quota|insufficient credit|out of credit|payment_required|payment required|billing|credit.*exhaust|saldo|cr[eé]dito.*esgota|exceeded.*(quota|credit)|quota.*exceeded)/i;
  const paymentRequiredCode = /\b402\b/;
  const rateLimitCode = /\b429\b/;
  const rateLimitKw = /(too many requests|rate.?limit)/i;

  const hasStrongBillingKw = strongBillingKw.test(rawMessage);
  const has402 = paymentRequiredCode.test(rawMessage);
  const has429 = rateLimitCode.test(rawMessage);
  const isPlainRateLimit = (has429 || rateLimitKw.test(rawMessage)) && !hasStrongBillingKw;

  if (isPlainRateLimit && FREE_TIER_PROVIDERS.has(provider)) {
    return { errString: `RATE_LIMIT:${provider}:${rawMessage}`, isBilling: false, rawMessage };
  }

  const isBilling = hasStrongBillingKw || has402 || (has429 && !FREE_TIER_PROVIDERS.has(provider));

  if (isBilling) {
    return { errString: `BILLING:${provider}:${rawMessage}`, isBilling: true, rawMessage };
  }
  return { errString: rawMessage, isBilling: false, rawMessage };
}

const lastNotifiedAt = new Map<string, number>();
const DEBOUNCE_MS = 60 * 60 * 1000;

const MONEY_RECIPIENT = "yurituccieterovic@gmail.com";

export async function notifyBillingFailure(
  provider: string,
  voiceLabel: string,
  rawMessage: string,
): Promise<void> {
  const now = Date.now();
  const last = lastNotifiedAt.get(provider) ?? 0;
  if (now - last < DEBOUNCE_MS) {
    logger.info({ provider, voiceLabel }, "[billing] notification debounced");
    return;
  }
  lastNotifiedAt.set(provider, now);

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    logger.warn({ provider }, "[billing] GMAIL_USER/GMAIL_APP_PASSWORD ausentes — não enviei MONEY");
    return;
  }

  const subject = `MONEY — ${provider} sem crédito (voz: ${voiceLabel})`;
  const body = `Olá Yuri,

Uma chamada de IA acabou de falhar por motivo financeiro.

  Provedor:  ${provider}
  Voz que tentou usar:  ${voiceLabel}
  Quando:  ${new Date().toISOString()}

Mensagem técnica retornada:
${rawMessage}

O que fazer:
  1. Entrar no painel do provedor (${provider}) e verificar saldo / método de pagamento.
  2. Se quiser parar de tentar usar essa voz por um tempo, comente a entrada do provedor nas chaves do .env.
  3. Esta notificação tem debounce de 1h — você não vai receber outra deste mesmo provedor antes disso.

Atenciosamente,
SalesCockpit — guardião financeiro`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({ from: gmailUser, to: MONEY_RECIPIENT, subject, text: body });
    logger.info({ provider, voiceLabel }, "[billing] MONEY email enviado");
  } catch (err) {
    logger.error({ err, provider }, "[billing] falhou ao enviar MONEY email");
  }
}

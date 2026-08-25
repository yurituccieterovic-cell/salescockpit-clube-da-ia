import { promises as dns } from "dns";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^0$/,
  /^255\./,
];

const PRIVATE_IPV6_PATTERNS = [
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::/,
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
];

export interface SsrfGuardResult {
  ok: boolean;
  reason?: string;
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  for (const pat of PRIVATE_IP_PATTERNS) {
    if (pat.test(lower)) return true;
  }
  for (const pat of PRIVATE_IPV6_PATTERNS) {
    if (pat.test(lower)) return true;
  }
  return false;
}

function basicUrlCheck(raw: string): SsrfGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Apenas URLs http:// e https:// são permitidas" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { ok: false, reason: "Destino não permitido" };
  }

  if (isPrivateIp(hostname)) {
    return { ok: false, reason: "Endereços internos ou privados não são permitidos" };
  }

  return { ok: true };
}

export function validateWebhookUrl(raw: string): SsrfGuardResult {
  return basicUrlCheck(raw);
}

export async function validateWebhookUrlWithDns(raw: string): Promise<SsrfGuardResult> {
  const basic = basicUrlCheck(raw);
  if (!basic.ok) return basic;

  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    return { ok: false, reason: "URL inválida" };
  }

  const resolvedIps: string[] = [];
  try {
    const v4 = await dns.resolve4(hostname);
    resolvedIps.push(...v4);
  } catch {}
  try {
    const v6 = await dns.resolve6(hostname);
    resolvedIps.push(...v6);
  } catch {}

  if (resolvedIps.length === 0) {
    return { ok: false, reason: "Não foi possível resolver o hostname" };
  }

  for (const ip of resolvedIps) {
    if (isPrivateIp(ip)) {
      return { ok: false, reason: "O hostname resolve para um endereço interno ou privado" };
    }
  }

  return { ok: true };
}

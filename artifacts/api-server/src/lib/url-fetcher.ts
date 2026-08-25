import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 50_000;
const TIMEOUT_MS = 8_000;
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  bytes: number;
}

export interface FetchedPageError {
  url: string;
  error: string;
}

export type FetchResult = FetchedPage | FetchedPageError;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  const cleaned = matches.map((u) => u.replace(/[),.;:!?\]]+$/, ""));
  return Array.from(new Set(cleaned)).slice(0, 3);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const directIp = isIP(hostname);
  if (directIp === 4 && isPrivateIPv4(hostname)) throw new Error("IP privado bloqueado");
  if (directIp === 6 && isPrivateIPv6(hostname)) throw new Error("IP privado bloqueado");
  if (directIp) return;
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw new Error("Hostname interno bloqueado");
  }
  const resolved = await lookup(hostname, { all: true });
  for (const r of resolved) {
    if (r.family === 4 && isPrivateIPv4(r.address)) throw new Error(`DNS aponta pra IP privado (${r.address})`);
    if (r.family === 6 && isPrivateIPv6(r.address)) throw new Error(`DNS aponta pra IPv6 privado (${r.address})`);
  }
}

function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, " ").trim() : "";
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: cleaned };
}

export async function fetchUrl(rawUrl: string): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, error: "URL inválida" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: rawUrl, error: `Protocolo ${parsed.protocol} não permitido` };
  }
  try {
    await assertPublicHost(parsed.hostname);
  } catch (e) {
    return { url: rawUrl, error: (e as Error).message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ArvoreOracular/1.0 (+https://sales-email-automator--yurituccieterov.replit.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!res.ok) return { url: rawUrl, error: `HTTP ${res.status}` };
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ctype.includes("text/") && !ctype.includes("xml") && !ctype.includes("json")) {
      return { url: rawUrl, error: `Tipo não-texto: ${ctype || "desconhecido"}` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { url: rawUrl, error: "Sem corpo na resposta" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_BYTES) {
        chunks.push(value.subarray(0, value.length - (total - MAX_BYTES)));
        truncated = true;
        try { await reader.cancel(); } catch {}
        break;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const raw = buf.toString("utf8");
    const looksLikeHtml = ctype.includes("html") || /<html[\s>]/i.test(raw);
    const { title, text } = looksLikeHtml ? stripHtml(raw) : { title: "", text: raw.replace(/\s+/g, " ").trim() };
    return {
      url: parsed.toString(),
      title: title.slice(0, 200),
      text: text.slice(0, MAX_BYTES),
      truncated,
      bytes: total,
    };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : (e as Error).message;
    return { url: rawUrl, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUrlsFromText(text: string): Promise<FetchResult[]> {
  const urls = extractUrls(text);
  if (urls.length === 0) return [];
  return Promise.all(urls.map(fetchUrl));
}

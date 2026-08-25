import { randomBytes } from "crypto";

interface TokenEntry {
  token: string;
  expiresAt: number;
}

const TTL_MS = 2 * 60 * 60 * 1000;

const store = new Map<string, TokenEntry>();

function key(voice: string, assembleiaId: number): string {
  return `${voice}:${assembleiaId}`;
}

export function issueCallbackToken(voice: string, assembleiaId: number): string {
  const token = randomBytes(32).toString("hex");
  store.set(key(voice, assembleiaId), { token, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumeCallbackToken(voice: string, assembleiaId: number, token: string): boolean {
  const k = key(voice, assembleiaId);
  const entry = store.get(k);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(k);
    return false;
  }
  if (entry.token !== token) return false;
  store.delete(k);
  return true;
}

import Stripe from "stripe";

// Credenciais Stripe via proxy de connections do Replit.
// NUNCA cache o cliente — token pode rotacionar. Use os getters em cada chamada.

interface Credentials {
  publishableKey: string;
  secretKey: string;
}

async function getCredentials(): Promise<Credentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Stripe: REPLIT_CONNECTORS_HOSTNAME ou token de identidade ausentes. " +
        "Conecte Stripe pela aba Integrations.",
    );
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Stripe credentials fetch falhou: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    items?: Array<{ settings?: { publishable?: string; secret?: string } }>;
  };
  const settings = data.items?.[0]?.settings;

  if (!settings?.publishable || !settings?.secret) {
    throw new Error(
      `Stripe ${targetEnvironment}: connection não encontrada ou faltando publishable/secret.`,
    );
  }

  return { publishableKey: settings.publishable, secretKey: settings.secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

// StripeSync singleton — instancia uma vez (webhook + backfill).
interface StripeSyncLike {
  findOrCreateManagedWebhook: (url: string) => Promise<{ webhook?: { url?: string } }>;
  syncBackfill: () => Promise<void>;
  processWebhook: (payload: Buffer, signature: string) => Promise<void>;
}

let stripeSync: StripeSyncLike | null = null;

export async function getStripeSync(): Promise<StripeSyncLike> {
  if (stripeSync) return stripeSync;
  const mod = await import("stripe-replit-sync");
  const { secretKey } = await getCredentials();
  // Cast via unknown — tipos do pacote variam entre versões; só usamos 3 métodos.
  stripeSync = new mod.StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL!, max: 2 },
    stripeSecretKey: secretKey,
  }) as unknown as StripeSyncLike;
  return stripeSync;
}

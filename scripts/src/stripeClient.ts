// Cópia do client do api-server — necessário pra seed script rodar standalone.
// Mantenha em sincronia com artifacts/api-server/src/stripeClient.ts.
import Stripe from "stripe";

async function getCredentials(): Promise<{ secretKey: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    throw new Error("Stripe: faltam vars REPLIT_CONNECTORS_HOSTNAME/REPL_IDENTITY.");
  }
  const isProd = process.env.REPLIT_DEPLOYMENT === "1";
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", isProd ? "production" : "development");
  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  if (!resp.ok) throw new Error(`Stripe creds fetch ${resp.status}`);
  const data = (await resp.json()) as { items?: Array<{ settings?: { secret?: string } }> };
  const secret = data.items?.[0]?.settings?.secret;
  if (!secret) throw new Error("Stripe connection sem secret. Conecte na aba Integrations.");
  return { secretKey: secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}

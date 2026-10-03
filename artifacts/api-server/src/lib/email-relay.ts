/**
 * Email relay via PAP API bridge.
 *
 * Render bloqueia SMTP outbound no serviço SalesCockpit — a solução é delegar
 * o envio para o PAP API (srv-d9n682bm8hqs73dmg4kg) que tem SMTP funcionando.
 *
 * POST https://site-st.onrender.com/api/bridge/email-relay
 * Header: x-bridge-secret = BRIDGE_SECRET
 */

import { logger } from "./logger";

const PAP_API_URL = process.env.PAP_API_URL ?? "https://site-st.onrender.com";
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";

export async function relayEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (!BRIDGE_SECRET) {
    logger.error("relayEmail: BRIDGE_SECRET não configurado");
    return;
  }

  const resp = await fetch(`${PAP_API_URL}/api/bridge/email-relay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-secret": BRIDGE_SECRET,
    },
    body: JSON.stringify(opts),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`relayEmail HTTP ${resp.status}: ${err.slice(0, 200)}`);
  }
}

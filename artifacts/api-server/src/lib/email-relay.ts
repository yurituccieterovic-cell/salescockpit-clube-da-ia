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

export async function relayEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  // Lido em tempo de execução (não em module load) para pegar env vars
  // adicionados após o deploy sem precisar de restart.
  const papApiUrl = process.env.PAP_API_URL ?? "https://site-st.onrender.com";
  const bridge = process.env.BRIDGE_SECRET ?? "";

  if (!bridge) {
    logger.error("relayEmail: BRIDGE_SECRET não configurado — email ignorado");
    return;
  }

  const resp = await fetch(`${papApiUrl}/api/bridge/email-relay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-secret": bridge,
    },
    body: JSON.stringify(opts),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`relayEmail HTTP ${resp.status}: ${err.slice(0, 200)}`);
  }

  logger.info({ to: opts.to, subject: opts.subject.slice(0, 50) }, "relayEmail OK");
}

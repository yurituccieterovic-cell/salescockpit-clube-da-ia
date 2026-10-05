/**
 * Email relay via PAP API bridge.
 *
 * Render bloqueia SMTP outbound no serviço SalesCockpit — a solução é delegar
 * o envio para o PAP API (srv-d9n682bm8hqs73dmg4kg) que tem SMTP funcionando.
 *
 * POST https://site-st.onrender.com/api/bridge/email-relay
 * Header: x-bridge-secret = BRIDGE_SECRET
 *
 * Retry: 3 tentativas com backoff 2s → 6s antes de desistir.
 * Timeout: 20s por tentativa (PAP pode estar em cold start).
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

  const delays = [0, 2000, 6000]; // ms antes de cada tentativa

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }

    try {
      const resp = await fetch(`${papApiUrl}/api/bridge/email-relay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-secret": bridge,
        },
        body: JSON.stringify(opts),
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${err.slice(0, 200)}`);
      }

      logger.info({ to: opts.to, subject: opts.subject.slice(0, 50), attempt }, "relayEmail OK");
      return;
    } catch (err) {
      const isLast = attempt === delays.length - 1;
      if (isLast) {
        throw new Error(`relayEmail falhou após ${delays.length} tentativas: ${(err as Error).message}`);
      }
      logger.warn({ err, attempt, to: opts.to }, `relayEmail tentativa ${attempt + 1} falhou — tentando novamente`);
    }
  }
}

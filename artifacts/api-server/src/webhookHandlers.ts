import { getStripeSync } from "./stripeClient";
import { logger } from "./lib/logger";

// Handler minimal — só repassa pro stripe-replit-sync sincronizar.
// Lógica de crédito do app vive no /api/checkout/verify (polling pós-redirect),
// não aqui. O sync já mantém stripe.* tables atualizadas com produtos/preços/sessões.
export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: payload precisa ser Buffer. " +
          "express.json() parseou o corpo antes do handler. " +
          "FIX: registrar a rota /api/stripe/webhook ANTES de app.use(express.json()).",
      );
    }
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
    } catch (err) {
      logger.error({ err }, "Stripe webhook processWebhook falhou");
      throw err;
    }
  }
}

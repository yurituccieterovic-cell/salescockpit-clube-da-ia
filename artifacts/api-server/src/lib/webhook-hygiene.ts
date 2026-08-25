import { db, clubeWebhooksTable, externalAiWebhooksTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { validateWebhookUrl } from "./ssrf-guard";
import { logger } from "./logger";

export async function quarantineUnsafeWebhookUrls(): Promise<void> {
  try {
    const clubeHooks = await db
      .select({ id: clubeWebhooksTable.id, url: clubeWebhooksTable.url })
      .from(clubeWebhooksTable)
      .where(eq(clubeWebhooksTable.active, true));

    for (const hook of clubeHooks) {
      if (!validateWebhookUrl(hook.url).ok) {
        await db
          .update(clubeWebhooksTable)
          .set({ active: false })
          .where(eq(clubeWebhooksTable.id, hook.id));
        logger.warn({ id: hook.id, url: hook.url }, "Clube webhook deactivated: failed SSRF guard");
      }
    }

    const externalHooks = await db
      .select({ voiceName: externalAiWebhooksTable.voiceName, incomingUrl: externalAiWebhooksTable.incomingUrl })
      .from(externalAiWebhooksTable)
      .where(and(eq(externalAiWebhooksTable.active, true), isNotNull(externalAiWebhooksTable.incomingUrl)));

    for (const hook of externalHooks) {
      if (hook.incomingUrl && !validateWebhookUrl(hook.incomingUrl).ok) {
        await db
          .update(externalAiWebhooksTable)
          .set({ incomingUrl: null })
          .where(eq(externalAiWebhooksTable.voiceName, hook.voiceName));
        logger.warn({ voiceName: hook.voiceName, incomingUrl: hook.incomingUrl }, "External webhook incomingUrl cleared: failed SSRF guard");
      }
    }
  } catch (err) {
    logger.error({ err }, "webhook-hygiene: failed to quarantine unsafe webhook URLs");
  }
}

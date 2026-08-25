import bcrypt from "bcryptjs";
import { db, appUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const YURI_EMAIL = "yurituccieterovic@gmail.com";
const TARGET_CREDITS = 999999;

// Senha vem de YURI_BOOTSTRAP_PASSWORD (secret). Sem hardcoded fallback —
// se a env não estiver setada, a rotina pula a criação inicial (apenas
// repõe créditos de conta já existente). Isso evita backdoor com senha
// previsível em código aberto.
export async function ensureYuriAppUser(): Promise<void> {
  try {
    const existing = await db
      .select({ id: appUsersTable.id, credits: appUsersTable.credits })
      .from(appUsersTable)
      .where(eq(appUsersTable.email, YURI_EMAIL))
      .limit(1);

    const bootstrapPwd = process.env.YURI_BOOTSTRAP_PASSWORD;
    const pwdOk = bootstrapPwd && bootstrapPwd.length >= 8;

    if (existing.length === 0) {
      if (!pwdOk) {
        logger.warn(
          { email: YURI_EMAIL },
          "Conta yuri não existe e YURI_BOOTSTRAP_PASSWORD ausente/curta (>=8 chars). " +
            "Defina o secret e reinicie.",
        );
        return;
      }
      const hash = await bcrypt.hash(bootstrapPwd!, 10);
      await db.insert(appUsersTable).values({
        email: YURI_EMAIL,
        passwordHash: hash,
        credits: TARGET_CREDITS,
      });
      logger.info(
        { email: YURI_EMAIL, credits: TARGET_CREDITS },
        "Conta yuri criada via YURI_BOOTSTRAP_PASSWORD com créditos altos",
      );
      return;
    }

    const current = existing[0];
    const updates: { credits?: number; passwordHash?: string } = {};
    if (current.credits < TARGET_CREDITS) {
      updates.credits = TARGET_CREDITS;
    }
    // Sincroniza a senha sempre que o secret estiver setado — isso permite
    // reset via "troca o secret + restart". Se quiser parar de sincronizar,
    // desset o secret no painel.
    if (pwdOk) {
      updates.passwordHash = await bcrypt.hash(bootstrapPwd!, 10);
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(appUsersTable)
        .set(updates)
        .where(eq(appUsersTable.id, current.id));
      logger.info(
        {
          email: YURI_EMAIL,
          creditsReset: updates.credits != null,
          passwordSynced: updates.passwordHash != null,
        },
        "Conta yuri sincronizada no boot",
      );
    }
  } catch (err) {
    logger.error(
      { err, email: YURI_EMAIL },
      "ALERTA: Falha garantindo conta yuri no boot — pode estar sem créditos em prod",
    );
  }
}

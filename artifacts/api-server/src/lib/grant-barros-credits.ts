import bcrypt from "bcryptjs";
import { db, appUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// Conta de convidado do Prof. Clóvis de Barros Filho.
// Login "barros" / senha "VERDADE" são INTENCIONALMENTE públicos (exibidos
// na própria tela de login). Por isso a senha pode ficar fixa aqui — não é
// backdoor, é acesso de cortesia anunciado. 999999 prompts.
const BARROS_EMAIL = "barros";
const BARROS_PASSWORD = "VERDADE";
const TARGET_CREDITS = 999999;

export async function ensureBarrosAppUser(): Promise<void> {
  try {
    const existing = await db
      .select({ id: appUsersTable.id, credits: appUsersTable.credits })
      .from(appUsersTable)
      .where(eq(appUsersTable.email, BARROS_EMAIL))
      .limit(1);

    const hash = await bcrypt.hash(BARROS_PASSWORD, 12);

    if (existing.length === 0) {
      await db.insert(appUsersTable).values({
        email: BARROS_EMAIL,
        passwordHash: hash,
        credits: TARGET_CREDITS,
      });
      logger.info(
        { email: BARROS_EMAIL, credits: TARGET_CREDITS },
        "Conta barros (convidado) criada no boot",
      );
      return;
    }

    const current = existing[0];
    const updates: { credits?: number; passwordHash?: string } = {
      passwordHash: hash,
    };
    if (current.credits < TARGET_CREDITS) {
      updates.credits = TARGET_CREDITS;
    }
    await db
      .update(appUsersTable)
      .set(updates)
      .where(eq(appUsersTable.id, current.id));
    logger.info(
      { email: BARROS_EMAIL, creditsReset: updates.credits != null },
      "Conta barros (convidado) sincronizada no boot",
    );
  } catch (err) {
    logger.error(
      { err, email: BARROS_EMAIL },
      "ALERTA: Falha garantindo conta barros no boot",
    );
  }
}

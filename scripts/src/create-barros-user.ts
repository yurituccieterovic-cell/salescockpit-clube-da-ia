import bcrypt from "bcryptjs";
import { db, appUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Cria (ou atualiza) o login especial do Professor Clóvis de Barros Filho.
// Login: "barros"  ·  Senha: "VERDADE"  ·  Créditos: 999999
// Idempotente: roda quantas vezes quiser sem duplicar.

const LOGIN = (process.env.BARROS_LOGIN ?? "barros").trim().toLowerCase();
const PASSWORD = process.env.BARROS_PASSWORD ?? "VERDADE";
const CREDITS = 999999;

async function main() {
  const hash = bcrypt.hashSync(PASSWORD, 12);

  const existing = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.email, LOGIN))
    .limit(1);

  if (existing.length) {
    await db
      .update(appUsersTable)
      .set({ passwordHash: hash, credits: CREDITS })
      .where(eq(appUsersTable.id, existing[0].id));
    console.log(`Conta "${LOGIN}" atualizada — senha redefinida e saldo em ${CREDITS} prompts.`);
  } else {
    await db
      .insert(appUsersTable)
      .values({ email: LOGIN, passwordHash: hash, credits: CREDITS });
    console.log(`Conta "${LOGIN}" criada — saldo de ${CREDITS} prompts.`);
  }

  // Garante o saldo mesmo se a linha já existia com outro valor.
  await db
    .update(appUsersTable)
    .set({ credits: sql`${CREDITS}` })
    .where(eq(appUsersTable.email, LOGIN));

  console.log("Pronto. Login pela tela de acesso com usuário e senha informados.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Falhou ao criar/atualizar a conta:", err);
  process.exit(1);
});

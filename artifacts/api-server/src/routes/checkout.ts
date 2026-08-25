import { Router } from "express";
import { db, appUsersTable, processedCheckoutsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "../lib/logger";
import nodemailer from "nodemailer";

const router = Router();

// Pacote único Fase 1A: R$ 50 = 5 prompts. Lookup do priceId pelo nome do produto
// no schema sincronizado pelo stripe-replit-sync. Se não existir, retorna 503 com
// instrução pra rodar seed.
const PRODUCT_NAME = "5 Prompts RODAR";
const CREDITS_PER_PURCHASE = 5;

async function findActivePriceForProduct(): Promise<string | null> {
  // Caminho rápido: stripe-replit-sync sincroniza products/prices no schema "stripe".
  // Fallback: se o sync ainda não populou (ex: prod recém-publicado, webhook atrasado),
  // consulta a API do Stripe direto. Custo mínimo, garante venda no ar.
  try {
    const rows = await db.execute(
      sql`SELECT pr.id as price_id
          FROM stripe.products p
          JOIN stripe.prices pr ON pr.product = p.id
          WHERE p.name = ${PRODUCT_NAME} AND p.active = true AND pr.active = true
          ORDER BY pr.created DESC
          LIMIT 1`,
    );
    const first = rows.rows?.[0] as { price_id?: string } | undefined;
    if (first?.price_id) return first.price_id;
  } catch (err) {
    logger.warn({ err }, "stripe schema lookup falhou — caindo pro fallback API");
  }

  try {
    const stripe = await getUncachableStripeClient();
    const search = await stripe.products.search({
      query: `name:'${PRODUCT_NAME}' AND active:'true'`,
      limit: 1,
    });
    const prod = search.data[0];
    if (!prod) return null;
    const prices = await stripe.prices.list({ product: prod.id, active: true, limit: 10 });
    const price = prices.data.find((p) => p.currency === "brl" && p.unit_amount === 5000);
    return price?.id ?? prices.data[0]?.id ?? null;
  } catch (err) {
    logger.error({ err }, "Stripe API fallback falhou");
    return null;
  }
}

router.post("/checkout/buy-credits", async (req, res) => {
  const uid = req.session?.appUserId;
  if (!uid) {
    res.status(401).json({ error: "Faça login pra comprar." });
    return;
  }
  try {
    const userRows = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.id, uid))
      .limit(1);
    if (!userRows.length) {
      res.status(401).json({ error: "Conta não encontrada." });
      return;
    }
    const user = userRows[0];
    const priceId = await findActivePriceForProduct();
    if (!priceId) {
      logger.error({ productName: PRODUCT_NAME }, "Price não sincronizado");
      res.status(503).json({
        error:
          "Produto não configurado. Rode o seed: pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts",
      });
      return;
    }
    const stripe = await getUncachableStripeClient();
    // Cria customer no primeiro buy
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { app_user_id: String(user.id) },
      });
      customerId = customer.id;
      await db
        .update(appUsersTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(appUsersTable.id, user.id));
    }
    const origin =
      `${req.protocol}://${req.get("host")}`.replace(/^http:\/\//, "https://");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      // Sem payment_method_types → Stripe usa o que estiver habilitado na conta
      // (cartão/boleto/PIX, depende do que você ativou no dashboard BR).
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        app_user_id: String(user.id),
        credits: String(CREDITS_PER_PURCHASE),
      },
      success_url: `${origin}/credits-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/buy-credits?cancelled=1`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "buy-credits falhou");
    res.status(500).json({ error: "Erro ao criar sessão de pagamento." });
  }
});

// Verifica + credita. Idempotente via processed_checkouts.
router.get("/checkout/verify", async (req, res) => {
  const uid = req.session?.appUserId;
  if (!uid) {
    res.status(401).json({ error: "Login necessário." });
    return;
  }
  const sessionId = String(req.query.session_id ?? "").trim();
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({ error: "session_id inválido." });
    return;
  }
  try {
    // Já processado?
    const already = await db
      .select()
      .from(processedCheckoutsTable)
      .where(eq(processedCheckoutsTable.stripeSessionId, sessionId))
      .limit(1);
    if (already.length) {
      const userRows = await db
        .select({ credits: appUsersTable.credits })
        .from(appUsersTable)
        .where(eq(appUsersTable.id, uid))
        .limit(1);
      res.json({
        ok: true,
        alreadyProcessed: true,
        credits: userRows[0]?.credits ?? 0,
      });
      return;
    }
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessUserId = Number(session.metadata?.app_user_id ?? "");
    if (sessUserId !== uid) {
      res.status(403).json({ error: "Sessão de outro usuário." });
      return;
    }
    if (session.payment_status !== "paid") {
      res.json({
        ok: false,
        paymentStatus: session.payment_status,
        message: "Pagamento ainda não confirmado (boleto/PIX pode levar minutos).",
      });
      return;
    }
    const creditsToAdd = Number(session.metadata?.credits ?? CREDITS_PER_PURCHASE);
    // Atomic: insere idempotente + incrementa créditos. Se insert conflitar, outra
    // request já creditou — não duplica.
    let credited = false;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(processedCheckoutsTable).values({
          stripeSessionId: sessionId,
          appUserId: uid,
          creditsAdded: creditsToAdd,
        });
        await tx
          .update(appUsersTable)
          .set({ credits: sql`${appUsersTable.credits} + ${creditsToAdd}` })
          .where(eq(appUsersTable.id, uid));
        credited = true;
      });
    } catch (txErr) {
      // PK violation = corrida benigna (outra request creditou simultaneamente)
      const msg = String((txErr as Error)?.message ?? "");
      if (!msg.includes("duplicate key") && !msg.includes("processed_checkouts_pkey")) {
        throw txErr;
      }
      logger.info({ sessionId }, "Checkout já processado em corrida — ok");
    }
    const userRows = await db
      .select({ credits: appUsersTable.credits, email: appUsersTable.email })
      .from(appUsersTable)
      .where(eq(appUsersTable.id, uid))
      .limit(1);
    const newCredits = userRows[0]?.credits ?? 0;
    // Email recibo (best effort)
    if (credited && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      void sendReceipt(userRows[0]?.email ?? "", creditsToAdd, newCredits, sessionId).catch(
        (e) => logger.warn({ err: e }, "Email recibo falhou — não bloqueia"),
      );
    }
    res.json({ ok: true, credited, creditsAdded: creditsToAdd, credits: newCredits });
  } catch (err) {
    logger.error({ err }, "verify falhou");
    res.status(500).json({ error: "Erro ao verificar pagamento." });
  }
});

async function sendReceipt(
  toEmail: string,
  creditsAdded: number,
  newTotal: number,
  sessionId: string,
): Promise<void> {
  if (!toEmail) return;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: toEmail,
    bcc: "yurituccieterovic@gmail.com",
    subject: `SalesCockpit — ${creditsAdded} prompts adicionados`,
    text: `Recibo de compra.

Créditos adicionados: ${creditsAdded}
Saldo atual: ${newTotal}
ID da sessão Stripe: ${sessionId}

Cada prompt rodado no RODAR consome 1 crédito. Saldo nunca expira.

— SalesCockpit`,
  });
}

export default router;

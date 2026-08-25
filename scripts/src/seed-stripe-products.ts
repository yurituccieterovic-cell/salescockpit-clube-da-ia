// Cria o produto "5 Prompts RODAR" (R$ 50 BRL = 5 prompts) no Stripe.
// Idempotente: se já existir produto ativo com esse nome, não recria.
// Rode com: pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts

import { getUncachableStripeClient } from "./stripeClient";

const PRODUCT_NAME = "5 Prompts RODAR";
const UNIT_AMOUNT_BRL_CENTS = 5000; // R$ 50,00
const CREDITS = 5;

async function main(): Promise<void> {
  const stripe = await getUncachableStripeClient();

  const search = await stripe.products.search({
    query: `name:'${PRODUCT_NAME}' AND active:'true'`,
  });

  let product = search.data[0];
  if (product) {
    console.log(`Produto já existe: ${product.id} (${product.name})`);
  } else {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: `Pacote pré-pago de ${CREDITS} prompts no pipeline RODAR (8 IAs deliberam em paralelo + meta-análise + Ágora + Secretário). Créditos não expiram.`,
      metadata: { credits: String(CREDITS) },
    });
    console.log(`Produto criado: ${product.id}`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true });
  const existing = prices.data.find(
    (p) => p.unit_amount === UNIT_AMOUNT_BRL_CENTS && p.currency === "brl",
  );
  if (existing) {
    console.log(`Preço já existe: ${existing.id} (R$ ${UNIT_AMOUNT_BRL_CENTS / 100} BRL)`);
  } else {
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: UNIT_AMOUNT_BRL_CENTS,
      currency: "brl",
      metadata: { credits: String(CREDITS) },
    });
    console.log(`Preço criado: ${price.id} (R$ ${UNIT_AMOUNT_BRL_CENTS / 100} BRL)`);
  }

  console.log("Seed completo. Os dados serão sincronizados via webhook em ~30s.");
}

main().catch((err) => {
  console.error("Seed falhou:", err.message);
  process.exit(1);
});

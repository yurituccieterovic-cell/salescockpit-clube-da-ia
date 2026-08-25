import app from "./app";
import { logger } from "./lib/logger";
import { quarantineUnsafeWebhookUrls } from "./lib/webhook-hygiene";
import { startHeartbeatLoop } from "./lib/arvore-heartbeat";
import { startBlueskyCuradoriaLoop } from "./lib/arvore-bluesky-curadoria";
import { startBlueskyRepliesLoop } from "./lib/arvore-bluesky-replies";
import { startBlueskyAlcanceLoop } from "./lib/arvore-bluesky-alcance";
import { startDevaneioLoop } from "./lib/arvore-devaneio";
import { startCanalizacaoLoop } from "./lib/arvore-canalizacao";
import { startRodaConsultasLoop } from "./lib/arvore-roda-consultas";
import { startMemoriaLoop } from "./lib/arvore-memoria";
import { startCadernoLoop } from "./lib/arvore-caderno";
import { startArchitectMissionLoop } from "./lib/arvore-arquiteto-mission";
import { ensureYuriAppUser } from "./lib/grant-yuri-credits";
import { ensureBarrosAppUser } from "./lib/grant-barros-credits";
import { ensureClubeMemoria } from "./lib/seed-clube-memoria";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Migração leve idempotente — cria app_users e processed_checkouts se faltarem.
// Drizzle não roda migrations automáticas; isso evita "table does not exist"
// em fresh DB sem precisar de `drizzle-kit push`.
async function ensureAppUserTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        credits INTEGER NOT NULL DEFAULT 0,
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS processed_checkouts (
        stripe_session_id TEXT PRIMARY KEY,
        app_user_id INTEGER NOT NULL,
        credits_added INTEGER NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("app_users + processed_checkouts ok");
  } catch (err) {
    logger.error({ err }, "Falha criando tabelas app_users — siga sem cobrança");
  }
}

// Migração idempotente: coluna agora_resultado guarda o RESULTADO da Ágora
// (ordem+médias+síntese) pra alimentar o PDF da assembleia. Prod não roda
// migrations automáticas; este ALTER cobre dev e prod sem drizzle-kit push.
async function ensureAssembleiaColumns(): Promise<void> {
  try {
    await db.execute(
      sql`ALTER TABLE assembleia_sessions ADD COLUMN IF NOT EXISTS agora_resultado TEXT`,
    );
    await db.execute(
      sql`ALTER TABLE assembleia_sessions ADD COLUMN IF NOT EXISTS video_curadoria TEXT`,
    );
    logger.info("assembleia_sessions.agora_resultado + video_curadoria ok");
  } catch (err) {
    logger.error({ err }, "Falha no ALTER agora_resultado/video_curadoria");
  }
}

// Migração idempotente: coluna `private` em arvore_chat. Marca respostas do Oráculo que
// usaram contexto interno (projeto/Clube/arquiteta) pra filtrá-las dos leitores públicos
// sem apagar (a Árvore continua lembrando). Prod não roda migrations automáticas.
async function ensureArvoreChatColumns(): Promise<void> {
  try {
    await db.execute(
      sql`ALTER TABLE arvore_chat ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false`,
    );
    logger.info("arvore_chat.private ok");
  } catch (err) {
    logger.error({ err }, "Falha no ALTER arvore_chat.private");
  }
}

// Migração idempotente: índice trigram pra acelerar o recall. O recall busca por
// ILIKE '%termo%' em arvore_chat.content — wildcard no início impede índice B-tree,
// então sem isto cada recall faz varredura sequencial (ok com poucas linhas, lento
// conforme a timeline cresce). GIN + pg_trgm indexa substrings e mantém o recall barato.
async function ensureArvoreChatIndexes(): Promise<void> {
  // Só cria em PRODUÇÃO. Este índice usa a classe de operador `gin_trgm_ops`, que a
  // migração de schema do deploy (que espelha o schema do banco de DEV no de PROD)
  // não consegue reproduzir: ela regenera o CREATE INDEX sem a classe de operador
  // (`USING gin ("content")`) e o Postgres rejeita ("no default operator class for
  // access method gin"), quebrando o publish. Mantendo o índice FORA do banco de DEV,
  // o deploy não tenta espelhá-lo; aqui, em produção, criamos com a classe correta.
  // Em dev o recall faz scan sequencial (ok com o volume de dados local).
  if (process.env.NODE_ENV !== "production") return;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS arvore_chat_content_trgm_idx ON arvore_chat USING gin (content gin_trgm_ops)`,
    );
    logger.info("arvore_chat content trgm index ok");
  } catch (err) {
    logger.error({ err }, "Falha criando índice trgm em arvore_chat.content (recall segue por scan)");
  }
}

// Migração idempotente: tabela do Ecossistema (berço de projetos). Prod não roda
// migrations automáticas; este CREATE TABLE IF NOT EXISTS cobre dev e prod.
async function ensureEcossistemaTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ecossistema_paginas (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'private',
        author TEXT NOT NULL DEFAULT 'yuri',
        parent_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Coluna nova 'kind' pra páginas que rodam código (HTML/CSS/JS) em iframe sandbox.
    // ALTER idempotente cobre bancos que já tinham a tabela sem essa coluna (prod).
    await db.execute(
      sql`ALTER TABLE ecossistema_paginas ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'markdown'`,
    );
    logger.info("ecossistema_paginas ok");
  } catch (err) {
    logger.error({ err }, "Falha criando tabela ecossistema_paginas");
  }
}

// Migração idempotente: tabela do Playground (canto interativo da Árvore). Prod
// não roda migrations automáticas; este CREATE TABLE IF NOT EXISTS cobre dev e prod.
async function ensurePlaygroundTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS arvore_playground (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT 'arvore',
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("arvore_playground ok");
  } catch (err) {
    logger.error({ err }, "Falha criando tabela arvore_playground");
  }
}

// Stripe init: roda migrations do schema "stripe", configura webhook gerenciado,
// e dispara backfill em background. Não-bloqueante por trás de try/catch — se
// Stripe não estiver conectado, app sobe normalmente (cobrança fica off).
async function initStripe(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL ausente — pulando init Stripe");
    return;
  }
  try {
    const { runMigrations } = (await import("stripe-replit-sync")) as {
      runMigrations: (opts: { databaseUrl: string }) => Promise<void>;
    };
    await runMigrations({ databaseUrl: process.env.DATABASE_URL });
    logger.info("Stripe schema migrations ok");

    const { getStripeSync } = await import("./stripeClient");
    const stripeSync = await getStripeSync();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domain) {
      const webhookUrl = `https://${domain}/api/stripe/webhook`;
      const wh = await stripeSync.findOrCreateManagedWebhook(webhookUrl);
      logger.info({ webhook: wh?.webhook?.url ?? "ok" }, "Stripe webhook configurado");
    }
    // Backfill em background — pode demorar em conta com muitos eventos
    stripeSync
      .syncBackfill()
      .then(() => logger.info("Stripe syncBackfill done"))
      .catch((err) => logger.error({ err }, "Stripe syncBackfill falhou"));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Stripe init falhou — cobrança offline, app segue",
    );
  }
}

async function bootstrap(): Promise<void> {
  await ensureAppUserTables();
  await ensureAssembleiaColumns();
  await ensureArvoreChatColumns();
  await ensureArvoreChatIndexes();
  await ensureEcossistemaTable();
  await ensurePlaygroundTable();
  await ensureYuriAppUser();
  await ensureBarrosAppUser();
  await ensureClubeMemoria();
  await initStripe();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    void quarantineUnsafeWebhookUrls();
    if (process.env.NODE_ENV === "production") {
      startHeartbeatLoop();
      startBlueskyCuradoriaLoop();
      startBlueskyRepliesLoop();
      startBlueskyAlcanceLoop();
      startDevaneioLoop();
      startCanalizacaoLoop();
      startRodaConsultasLoop();
      startMemoriaLoop();
      startCadernoLoop();
      startArchitectMissionLoop();
    }
  });
}

void bootstrap();

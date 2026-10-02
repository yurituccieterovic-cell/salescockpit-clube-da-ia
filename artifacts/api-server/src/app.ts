import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { WebhookHandlers } from "./webhookHandlers";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));

// Stripe webhook PRECISA vir ANTES de express.json — handler usa raw Buffer
// pra validar assinatura. Se json() rodar antes, req.body vira objeto e a
// assinatura quebra com erro críptico.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Stripe webhook handler erro");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Store de sessão no PostgreSQL (mesmo pool do app). Antes era o MemoryStore padrão do
// express-session: todo reinício/republish do servidor apagava TODOS os logins — por isso
// "precisava entrar toda hora". Agora a sessão sobrevive a reinícios. `createTableIfMissing`
// cria a tabela `session` no boot (inclusive em produção, que não migra no deploy).
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET ?? "salesassistant-secret-fallback",
    resave: false,
    saveUninitialized: false,
    // `rolling`: cada requisição renova a validade do cookie, então quem usa o site com
    // regularidade não é deslogado pelo vencimento dos 7 dias — só por inatividade longa.
    rolling: true,
    cookie: {
      // Em produção (HTTPS atrás do proxy TLS da plataforma) o cookie só trafega em
      // conexão segura; em dev (HTTP local) precisa ficar false pra sessão funcionar.
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "strict",
    },
  }),
);

app.use("/api", router);

// Serve frontend estático (build do Vite) — só em produção
const uiDist = path.resolve(__dirname, "../../sales-assistant/dist/public");
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(uiDist, "index.html"));
  });
}

export default app;

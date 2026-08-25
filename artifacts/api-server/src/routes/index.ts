import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import emailsRouter from "./emails";
import dashboardRouter from "./dashboard";
import chatRouter from "./chat";
import authRouter from "./auth";
import clubeRouter from "./clube";
import oraculoRouter from "./oraculo";
import assembleiaRouter from "./assembleia";
import agoraRouter from "./agora";
import webhooksRouter from "./webhooks";
import jornalRouter from "./jornal";
import custosRouter from "./custos";
import vozesRouter from "./vozes";
import arvoreRouter from "./arvore";
import arvoreCodeRouter from "./arvore-code";
import arvoreProjectsRouter from "./arvore-projects";
import ecossistemaRouter from "./ecossistema";
import playgroundRouter from "./playground";
import uploadsRouter from "./uploads";
import authAppRouter from "./auth-app";
import checkoutRouter from "./checkout";
import supportRouter from "./support";
import adminRouterRouter from "./admin-router";
import { requireAuth } from "../middlewares/require-auth";
import { finalizeAssembleia } from "./chat";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(webhooksRouter);

// Dev-only: dispara finalizeAssembleia com gerarVideo=true sem precisar de auth.
// Mounted before requireAuth. Gated em NODE_ENV. Usado pra testar pipeline pós-RODAR.
router.post("/__debug/finalize-with-video/:id", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  logger.info({ sessionId: id }, "[__debug] finalize-with-video disparado");
  void finalizeAssembleia(id, true);
  res.json({ ok: true, sessionId: id, gerarVideo: true });
});

// Routers with public endpoints must be mounted BEFORE requireAuth-gated mounts.
// `router.use(requireAuth, X)` applies requireAuth to ALL requests passing through,
// not just those routed to X — it blocks unauthenticated traffic outright.
router.use(jornalRouter);
router.use(clubeRouter);
router.use(assembleiaRouter);
router.use(agoraRouter);
router.use(arvoreRouter);
// Ecossistema: rotas públicas (/eco/publico*) e gates internos (AO/Clube por handler).
// Montado ANTES do requireAuth global como jornal/clube/arvore.
router.use(ecossistemaRouter);
router.use(uploadsRouter);
// Auth de app_users (signup/login/me/logout) e checkout (buy-credits/verify) são
// públicos no nível do mount — o gate é feito por sessão dentro de cada handler.
router.use(authAppRouter);
router.use(checkoutRouter);
// Support é público (form de ajuda no login/signup/home não exige sessão).
// Tem rate limit interno por IP (3/h) e honeypot anti-bot.
router.use(supportRouter);
// chatRouter mistura rotas AO-only (force-finalize, send-email, loop, etc) com
// rotas que aceitam app user pago (/rodar/prepare, /rodar/stream). Mounted SEM
// requireAuth aqui; cada handler interno aplica seu próprio gate (aoOnly ou
// requireRodarAccess). Não inverter — o middleware de roteador roda em TODA
// request que passa, não só nas que casam rota.
router.use(chatRouter);

router.use(requireAuth, leadsRouter);
router.use(requireAuth, emailsRouter);
router.use(requireAuth, dashboardRouter);
router.use(requireAuth, oraculoRouter);
router.use(requireAuth, vozesRouter);
router.use(requireAuth, arvoreCodeRouter);
router.use(requireAuth, playgroundRouter);
router.use(requireAuth, arvoreProjectsRouter);
router.use(requireAuth, custosRouter);
router.use(requireAuth, adminRouterRouter);

export default router;

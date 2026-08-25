# Threat Model

## Project Overview

SalesCockpit is a pnpm monorepo with a React + Vite frontend and an Express 5 API backed by PostgreSQL via Drizzle ORM. It manages sales leads and drafted emails, and also runs several AI-driven collaboration features (RODAR, Assembleia, Ágora, Clube, Vozes) that persist transcripts and call third-party model, email, and Notion APIs. The production deployment is internet-exposed; browser clients are untrusted and communicate with the API over cookie-based sessions.

Production assumptions for future scans: deployed traffic is TLS-terminated by the platform; `NODE_ENV=production`; `artifacts/mockup-sandbox` is dev-only and should be ignored unless production reachability is demonstrated.

## Assets

- **Lead and email CRM data** — names, email addresses, company, job title, notes, drafted/sent email content, and workflow metadata. Exposure or tampering directly affects customers, prospects, and business operations.
- **User and session state** — Express session cookies, the AO login state, Clube user sessions, and paid app-user sessions used for credit-backed RODAR access. Compromise enables impersonation and misuse of protected collaborative features.
- **Deliberation content** — RODAR history, Assembleia/Ágora/Clube transcripts, editorial reports, withheld summaries, and memory records. These contain sensitive internal strategy, private analysis, and participant content.
- **Integration secrets and privileged capabilities** — OpenAI, Anthropic, Gemini, Groq, xAI, Together, Gmail, Notion, and webhook secrets. Abuse can cause data exfiltration, unwanted external actions, or direct billing impact.
- **Availability and spend budget** — authenticated and low-privilege paid endpoints can still trigger fan-out LLM calls, image generation, email sends, webhook egress, and long-lived SSE connections. Abuse can degrade service or consume paid API credits.

## Trust Boundaries

- **Browser to API** — all frontend and third-party requests cross this boundary. The API must treat every request as untrusted, regardless of hidden frontend routes.
- **API to PostgreSQL** — the API can read and mutate all sales and deliberation tables. Missing auth or authorization at the API layer exposes the full dataset.
- **API to external AI/email/Notion services** — the server sends prompts, transcripts, and business data to third parties using privileged secrets.
- **AO session to protected business routes** — AO-authenticated routes gate CRM, RODAR, email, dashboard, oráculo, and voice-generation capabilities.
- **Paid app-user to RODAR execution routes** — app-user sessions created through `auth-app.ts` can buy credits and access `requireRodarAccess` endpoints. These routes must enforce debit, ownership, and action scoping server-side instead of trusting frontend flow sequencing.
- **Clube user to collaboration data/actions** — Clube-authenticated routes expose session transcripts, live streams, webhooks, and actions that can trigger downstream AI and email workflows.
- **External AI webhook boundary** — external services can register callback URLs and submit content into internal sessions if webhook trust is not tightly controlled.
- **Dev-only to production boundary** — `artifacts/mockup-sandbox` is out of scope for production findings unless some production route or build path imports it.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/sales-assistant/src/App.tsx`.
- **Highest-risk code areas:** `artifacts/api-server/src/routes/auth.ts`, `auth-app.ts`, `checkout.ts`, `clube.ts`, `assembleia.ts`, `agora.ts`, `chat.ts`, `webhooks.ts`, `agora-deliberativa.ts`.
- **Public surfaces:** `auth.ts`, `auth-app.ts`, `checkout.ts`, `webhooks.ts`, `health.ts`, and low-sensitivity auth-adjacent helpers like `GET /api/login-images`.
- **AO-authenticated surfaces:** `leads.ts`, `emails.ts`, `dashboard.ts`, `chat.ts`, `oraculo.ts`, `vozes.ts` via `requireAuth` in `routes/index.ts`.
- **Paid app-user surfaces:** `chat.ts` handlers guarded by `requireRodarAccess`, especially `/rodar/prepare`, `/rodar/stream`, `/rodar/compare`, orphan-recovery helpers, and pipeline status endpoints.
- **Clube-authenticated surfaces:** `clube.ts`, `assembleia.ts`, `agora.ts`, `jornal.ts`; these require `req.session.clubeUser` but still need per-session ownership or membership enforcement.
- **Usually ignore:** `artifacts/mockup-sandbox/**` unless production reachability is shown.

## Threat Categories

### Spoofing

This project uses cookie-backed `express-session` authentication with three practical session modes: AO access (`req.session.authenticated`), paid app-user access (`req.session.appUserId`), and Clube access (`req.session.clubeUser`). The API must ensure AO authentication is not based on shared hardcoded credentials, session establishment regenerates privilege-bearing sessions safely, and webhook callers are authenticated with secrets that are rotated and never trusted solely by user-controlled identifiers.

### Tampering

The API directly creates, updates, and closes leads, emails, session messages, webhook registrations, and generated profiles. Every mutation route must require appropriate server-side authentication and authorization, and collaboration actions must verify session ownership or explicit membership before allowing another user to post, close, export, or otherwise alter a session.

### Information Disclosure

Sales leads, drafted emails, session transcripts, editorial analyses, and webhook metadata are all sensitive. API responses must be scoped to authenticated users with a legitimate need to know, and webhook or email export features must not let one user push another user's transcripts to arbitrary external destinations.

### Denial of Service

Several authenticated endpoints can fan out to many paid model calls, image generations, webhook deliveries, email sends, or long-lived SSE connections. Production safety requires rate limits, quotas, debit enforcement, and bounded work per request so compromised or low-privilege accounts cannot exhaust API credits, Gmail capacity, or server resources.

### Elevation of Privilege

Because the API owns both CRM data and collaboration workflows, any weak AO login effectively grants attacker privileges equivalent to an internal operator. The system must enforce access control at the server boundary for every read and write, especially for CRM CRUD, session transcripts, webhook administration, paid RODAR execution, and actions that trigger downstream integrations or server-side fetches to attacker-controlled URLs.

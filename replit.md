# SalesCockpit — AI Sales Assistant

## Overview

Assistente de vendas full-stack em PT-BR centrado no loop RODAR: várias IAs deliberam em paralelo sobre um tema. Pipeline completo: RODAR → Editorial → Meta-análise → Ágora Deliberativa (RESULTADO) → Secretário (PERFEITO → Notion + email autoral).

> Este arquivo é um panorama de alto nível. O detalhe de implementação (IDs de modelo, lógica de rota, caps de tokens, histórico de migração) vive no código e no histórico de commits — não aqui.

## Stack

- **Monorepo**: pnpm workspaces; Node 24; TypeScript 5.9; build esbuild
- **Frontend**: React + Vite (`artifacts/sales-assistant`), wouter, Tailwind + shadcn
- **API**: Express 5 (`artifacts/api-server`, porta 8080)
- **Database**: PostgreSQL + Drizzle ORM
- **IA**: OpenAI e Anthropic (via integração Replit), Gemini 2.5 Flash, Groq/Llama. Preferência forte por provedores grátis (Groq, Gemini, Cerebras, OpenRouter, Cloudflare, Mistral, DeepSeek, GitHub Models) para manter custo ~R$ 0. xAI/Perplexity desligados por falta de crédito; ElevenLabs só na voz do áudio/vídeo opcional; D-ID aposentado (vídeo agora é simbólico, montado com ffmpeg, sem rosto).

## Core Features

- **RODAR Loop**: ~13-21 vozes (ChatGPT, Claude, Gemini, Meta AI, Grok, Árvore, Agente, Arquiteto, Professora, Segurança, Pacifista, Sustentabilista, Juíz + equipe, Artista) deliberam em paralelo via SSE. Vozes podem se abster (5 razões) e têm painel de estratégia em prompts longos.
- **Réplica** (opt-in, AO-only): 2ª rodada após a 1ª, onde cada voz reage a um digest das respostas das outras. Não altera o PERFEITO.
- **Assembleia**: sessions ao vivo com Agente Editorial (público/retido/segredo), meta-análise persistida, histórico em `/assembleia/historico`, curador cross-session, recovery do PERFEITO.
- **Ágora Deliberativa** (pós-RODAR): IAs votam relevância 0-10 de cada seção, ordena e sintetiza → email RESULTADO. RESULTADO também persiste em `assembleia_sessions.agora_resultado`.
- **Secretário** (pós-Ágora): refina em texto PERFEITO, envia email autoral, posta no Notion.
- **Pipeline de email** (4 por sessão): Editorial (+ metassemiótica), RESULTADO, PERFEITO.
- **Ágora (modo live)**: votação por fala, ordem de resposta = maior nota primeiro.
- **Clube do Looping Ético**: chat colaborativo humano+IA (estilo BOL Chat) com SSE + webhooks de agentes externos.
- **Ética do Sistema** (`/etica`): revisão ética em 7 dimensões pelo Segurança, com streaming.
- **Mostra pública** (`/mostra`): lista read-only de PERFEITOs publicados, sem auth.
- **PDF da assembleia**: pacote único em 3 lugares — botão no histórico (auth, conteúdo completo), anexo nos emails, botão na Mostra (público, SÓ tema+data+PERFEITO).

### Árvore Oracular
- **Oráculo** (`/oraculo`): timeline global única (`arvore_chat`), memória de longo prazo, busca web (Gemini + Google Search grounding, grátis), contexto do site (PERFEITOs + atas públicas, nunca retidos/segredos), modo Arquiteta para perguntas técnicas. Além da janela recente, faz **recall**: busca na timeline inteira por nomes próprios/projetos/temas da pergunta (`lib/arvore-recall.ts`, Postgres ILIKE, R$0) pra lembrar do que foi dito fora da janela. Também faz recall de **sessões/assembleias** e de **conversas do Clube** (`recallFromClube` em `lib/site-context.ts`) por tema. PRIVACIDADE: quando usa contexto do Clube (conversa interna), a resposta NÃO é persistida na timeline pública `/api/arvore/history` (mesmo gate do archMode). Esse acesso fica SÓ no Oráculo, nunca nas vozes do RODAR (cujo output vira documento público).
- **Memória estruturada** (`arvore_memoria`): lições destiladas por tema/tags, injetadas no oráculo e em todas as vozes do RODAR.
- **Jobs autônomos** (só em produção, todos em provedores grátis): heartbeat noturno, devaneio, canalização (convida outra IA via Árvore), destilação de memória, curadoria diária pro Bluesky, **respostas no Bluesky** (lê menções/replies aos posts dela e responde de volta — `lib/arvore-bluesky-replies.ts`, conservador: máx 3/run, máx 1 por autor/run, debounce 4h, idempotente por comentário via getPostThread — nunca responde o mesmo post duas vezes). Página contemplativa `/sonhos`.
- **Biblioteca por projeto** (AO-only): projetos privados com arquivos anexados e chat privado por projeto.
- **Árvore programadora** (`/arvore-code`, AO-only): gera propostas de mudança de código via tool-use; nunca aplica direto — Yuri revisa diff e aprova/rejeita. Aprovar = escreve + git commit local.

### Infra de custo e resiliência
- **Roteador de LLMs grátis** (`lib/llm-router.ts`): 8 provedores com cooling in-memory e pools especializados (chat-live, batch, coder, curadoria). Admin em `/api/admin/router-state`.
- **Fallbacks**: oráculo Groq → Cerebras → Gemini (com retry em 503/429/500); vozes pagas → OpenRouter → Gemini mantendo persona; retry Groq em 429 com backoff+jitter e cascata Cerebras → Mistral → Gemini.
- **BUNKER_MODE** (AO-only por run): 3 níveis de degradação por custo, de tudo premium a tudo grátis.
- **Detecção de billing** (`$$$Provedor`): card especial + email de alerta com debounce quando uma voz falha por crédito.
- **Toggle "Publicar"**: quando OFF, pula Notion/Bluesky (PERFEITO ainda vai por email).

### Outros
- **Acesso AO ↔ Clube**: AO e Clube compartilham `/assembleia/*` e `/agora/*` via `requireAuthOrClube`.
- **Webhooks de IA externa**: `POST /api/webhooks/external-voice` para respostas RODAR de IAs externas.
- **Upload de arquivos**: anexos no RODAR e Oráculo (PDF/TXT/MD/CSV/JSON/HTML/código/imagens via Gemini vision).
- **Leitura de links**: URLs no prompt do RODAR são buscadas (com SSRF guard) e injetadas no contexto.
- **Vídeo simbólico** (opt-in, usuários autorizados): voz ElevenLabs lendo o PERFEITO sobre as imagens-símbolo da Árvore (núcleo orbital), montado localmente com ffmpeg (Ken Burns + transições). Sem D-ID, sem rosto — custo só da voz. Código em `video-simbolico.ts`; `talking-head.ts` (D-ID) é código morto.
- **Login**: 8 imagens estilo Kobra, evita repetir as últimas 3.

## Convenções importantes
- **Vazamento via jornal**: `assembleia_sessions.topic` é servido público por `/api/jornal/publico`. NUNCA prependar contexto privado (anexos, projeto, links, memória) ao `topic` salvo — só ao `prompt` das vozes, depois de capturar o `cleanTopic` puro.
- **Rotas públicas antes do gate**: routers com endpoints públicos (jornal/clube/assembleia/agora) devem ser montados ANTES de `router.use(requireAuth, ...)` em `routes/index.ts`.
- **Migrações**: produção não migra automático no deploy. Aplicar schema novo via ALTER idempotente no boot e/ou psql direto (drizzle-kit push trava em prompt interativo).

## DB Tables
leads, emails, rodar_history, clube_users, clube_webhooks, clube_messages, assembleia_sessions, assembleia_messages, agora_turns, external_ai_webhooks, arvore_chat, arvore_memoria, arvore_projects, arvore_files, arvore_project_chat, arvore_proposals, jornal_entries.

## Env Secrets necessários
- OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, SESSION_SECRET
- GMAIL_USER, GMAIL_APP_PASSWORD
- NOTION_TOKEN, NOTION_DATABASE_ID (postagem automática)
- Opcionais grátis: CEREBRAS_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN, GITHUB_MODELS_TOKEN
- Opcional pago (voz do áudio/vídeo): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID. D-ID aposentado: DID_API_KEY/DID_SOURCE_URL não são mais usados.
- Desligados: XAI_API_KEY, TOGETHER_API_KEY, PERPLEXITY_API_KEY (sem crédito)

## User Preferences
- PT-BR sempre; sem emoji e sem jargão técnico nas respostas ao Yuri
- Economia de custo: preferir provedores grátis
- Email Yuri antes de cada sugestão de republish
- Email autoral: luddlocke@gmail.com (recebe PERFEITO)
- Production: https://sales-email-automator--yurituccieterov.replit.app

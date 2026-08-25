# Migração segura para Render + Neon

Este repositório contém o código do SalesCockpit/Clube da IA. Ele não deve conter
dumps de banco, credenciais, arquivos `.env`, `.pap-secrets`, backups, exports ou
uploads pessoais.

## 1. Código

- Repositório GitHub privado.
- Snapshot sanitizado: código, configuração e assets públicos necessários.
- Excluídos do snapshot: `.agents/`, `exports/`, `outputs/`, exports em
  `attached_assets/`, uploads brutos e scripts avulsos de email.
- Os três PDFs consumidos pelo `Curso Convivência Runner` podem ser transferidos
  separadamente se o curso também for migrado.

## 2. Banco

- A produção usa PostgreSQL.
- Restaure o dump em um banco Neon vazio com versão compatível do PostgreSQL.
- Valide extensões, schema, contagens e permissões antes de apontar a aplicação.
- Nunca coloque o dump no GitHub, mesmo sendo um repositório privado.

## 3. Variáveis

O arquivo `.env.example` é um manifesto somente com nomes. Valores reais devem ser
copiados diretamente do gestor de Secrets do Replit para o painel de Environment
do Render. Não use chat, email, GitHub nem `.pap-secrets` versionado para transportar
credenciais.

### Configuradas no Replit no momento da preparação

- Acesso: `AO_USERNAME`, `AO_PASSWORD_HASH`, `ARVORE_SERVICE_TOKEN`,
  `SESSION_SECRET`
- IA: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `CEREBRAS_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`,
  `GITHUB_MODELS_TOKEN`, `PERPLEXITY_API_KEY`, `TOGETHER_API_KEY`
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`
- Email: `GMAIL_USER`, `GMAIL_APP_PASSWORD`
- Bluesky: `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
- Proxy Replit AI: variáveis `AI_INTEGRATIONS_*`

### Referenciadas no código, mas não confirmadas como configuradas

- `BARROS_LOGIN`, `BARROS_PASSWORD`, `YURI_BOOTSTRAP_PASSWORD`
- `DID_API_KEY`, `DID_SOURCE_URL`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `NOTION_TOKEN`, `NOTION_DATABASE_ID`
- Configuração não secreta: `BASE_PATH`, `API_BASE`, `LOG_LEVEL`,
  `BUNKER_MODE`

### Gerenciadas pelo ambiente

- Replit: `REPL_ID`, `REPL_IDENTITY`, `REPLIT_CONNECTORS_HOSTNAME`,
  `REPLIT_DEPLOYMENT`, `REPLIT_DOMAINS`, `WEB_REPL_RENEWAL`
- Banco atual: `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`,
  `PGPASSWORD`, `PGDATABASE`
- Runtime: `NODE_ENV`, `PORT`

No Render, defina uma nova `DATABASE_URL` do Neon e não copie as variáveis
internas do runtime Replit.

## 4. Verificação antes da troca

1. Instalar dependências com pnpm.
2. Executar build e testes.
3. Restaurar o banco no Neon.
4. Configurar secrets diretamente no Render.
5. Testar login, Oráculo, RODAR, email, Bluesky e exportações.
6. Só então trocar domínio ou tráfego.
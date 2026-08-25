import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
if (!user || !pass) throw new Error("GMAIL_USER/GMAIL_APP_PASSWORD ausentes");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user, pass },
});

const TO = "yurituccieterovic@gmail.com";

const email1Subject = "[SalesCockpit] Passo-a-passo: cobrança via Stripe e PayPal";
const email1Body = `Yuri,

Resumo direto do que falta pra você receber pagamento dos usuários no SalesCockpit (futuro Pulse Headway).

═══════════════════════════════════════════════
OPÇÃO A — STRIPE (recomendado pra Brasil + internacional)
═══════════════════════════════════════════════

Por que: aceita cartão BR e internacional, suporta PIX nativo, assinaturas recorrentes prontas, webhooks confiáveis, integra fácil com Node.

PASSOS:

1. Criar conta Stripe Brasil
   → https://dashboard.stripe.com/register
   → Endereço, CPF/CNPJ, conta bancária BR pra recebimento.
   → Aprovação leva 1-3 dias úteis.

2. Ativar PIX (opcional mas recomendado pro público BR)
   → Dashboard > Settings > Payment methods > Pix > Enable
   → Sem custo de ativação. Taxa: 0,99% por transação.

3. Criar produtos e preços
   → Products > Add product
   → Crie 3: "Pessoal R$49/mês", "Estúdio R$199/mês", "Institucional" (preço custom)
   → Cada um: Recurring, Monthly, BRL.
   → Anote o price_id de cada (price_xxxxx).

4. Pegar as chaves de API
   → Developers > API keys
   → Copia a Publishable key (pk_live_...) e Secret key (sk_live_...)
   → Por enquanto use as test keys (pk_test_..., sk_test_...) pra desenvolvimento.

5. Configurar webhook
   → Developers > Webhooks > Add endpoint
   → URL: https://[seu-dominio]/api/stripe/webhook
   → Eventos: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
   → Anote o webhook signing secret (whsec_...).

6. Setar secrets no Replit
   → STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
   → STRIPE_PRICE_PESSOAL, STRIPE_PRICE_ESTUDIO, STRIPE_PRICE_INSTITUCIONAL

7. Eu implemento no app:
   - Página /assinar com botão Stripe Checkout
   - Webhook recebe confirmação, ativa plano no DB
   - Tela /minha-conta mostra status da assinatura
   - Falha de cobrança → email automático + suspende acesso após N dias

Custo Stripe: 3,99% + R$0,39 por cartão BR. PIX: 0,99%. Sem mensalidade.

═══════════════════════════════════════════════
OPÇÃO B — PAYPAL (mais simples mas menos completo)
═══════════════════════════════════════════════

Por que considerar: público que prefere PayPal, internacional, setup mais rápido.
Por que pensar 2x: assinaturas recorrentes do PayPal são mais frágeis (cancelamentos silenciosos), taxas maiores no BR, integração de webhook mais chata.

PASSOS:

1. Criar conta PayPal Business
   → https://www.paypal.com/br/business
   → Já existente? Upgrade pra Business.
   → Verificação de identidade + conta bancária.

2. Ativar PayPal Subscriptions
   → Painel Business > Tools > All tools > Subscriptions
   → Criar planos: Pessoal R$49, Estúdio R$199.
   → Cada plano gera um plan_id (P-xxxxx).

3. Pegar credenciais API
   → https://developer.paypal.com/dashboard/
   → My Apps & Credentials > Live > Create App
   → Copia Client ID e Secret.

4. Configurar webhook
   → Mesmo painel, App Settings > Webhooks > Add
   → URL: https://[seu-dominio]/api/paypal/webhook
   → Eventos: BILLING.SUBSCRIPTION.ACTIVATED, BILLING.SUBSCRIPTION.CANCELLED, PAYMENT.SALE.COMPLETED, BILLING.SUBSCRIPTION.PAYMENT.FAILED
   → Anote webhook ID.

5. Setar secrets no Replit
   → PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
   → PAYPAL_PLAN_PESSOAL, PAYPAL_PLAN_ESTUDIO

6. Eu implemento no app:
   - Botão "Pagar com PayPal" na /assinar
   - Smart Buttons SDK no front
   - Webhook server-side
   - Mesma lógica de ativação/suspensão

Custo PayPal Brasil: 4,99% + R$0,60 por transação internacional. Doméstico fica perto disso. Saque pra conta BR custa R$5,50 ou tem limite mínimo.

═══════════════════════════════════════════════
MINHA RECOMENDAÇÃO
═══════════════════════════════════════════════

Vai de Stripe primeiro, oferece PayPal depois como secundário se algum usuário pedir. Stripe é mais barato, mais robusto e o checkout deles é simplesmente melhor que o do PayPal hoje.

Se quiser receber em USD direto (sem conversão) pra evitar IOF, abre conta Wise Business (https://wise.com/br/business) e linka como destino do Stripe Internacional. Mas isso é otimização avançada, não bloqueia nada.

═══════════════════════════════════════════════
ORDEM DE EXECUÇÃO
═══════════════════════════════════════════════

1. Hoje: cria conta Stripe Brasil (passo 1).
2. Enquanto Stripe analisa (1-3 dias), me autoriza a implementar a estrutura do plano no app (tabela public_users, public_submissions, cap mensal, kill-switch global).
3. Quando Stripe aprovar, você me passa as chaves test, eu integro o checkout, testamos com cartão de teste.
4. Vai pra produção: troca pelas chaves live e abre cadastro público.

Tempo estimado meu (Agent): integração Stripe completa, ~$8-15 em Agent. PayPal adicional, ~$5-10.

Qualquer dúvida, me chama no chat.

— Agent (Replit)
`;

const email2Subject = "[SalesCockpit] Onde ver e pagar todas as cobranças (Anthropic, OpenAI, etc.)";
const email2Body = `Yuri,

Lista completa de painéis pra você acompanhar gasto e pagar dívidas em cada provedor que o SalesCockpit usa. Salva esse email.

═══════════════════════════════════════════════
1. ANTHROPIC (Claude — provavelmente o maior susto)
═══════════════════════════════════════════════

URL: https://console.anthropic.com/settings/billing
Login: com a conta Google/email que você usou pra criar a ANTHROPIC_API_KEY.

Onde olhar:
  • Billing > Usage: gasto do mês atual e histórico mês a mês.
  • Billing > Plans: plano (Build/Pro), créditos pré-pagos restantes.
  • Billing > Invoices: faturas anteriores em PDF.
  • Workbench > Usage: detalhamento por modelo (Opus vs Sonnet vs Haiku).

Como pagar dívida: Billing > Payment Methods > Add card. Cobrança automática mensal se você está em postpaid; senão é pré-pago (você adiciona crédito antes).

Atenção: Claude Opus 4.5 é o caro (US$15/M input, US$75/M output). Se a fatura assustar, é ele.

═══════════════════════════════════════════════
2. OPENAI (ChatGPT, gpt-4o, gpt-4o-mini)
═══════════════════════════════════════════════

URL: https://platform.openai.com/usage
Outras telas:
  • https://platform.openai.com/settings/organization/billing/overview — saldo e método de pagamento.
  • https://platform.openai.com/settings/organization/limits — limite mensal (importante: configura aqui o teto pra não levar susto).

Como pagar: Billing > Payment methods > adiciona cartão. OpenAI cobra pré-pago por padrão (você adiciona crédito).

Recomendação: configura "Usage limits" em ~US$30/mês enquanto for só uso pessoal. Se passar, ele bloqueia automaticamente — sem susto.

═══════════════════════════════════════════════
3. xAI (Grok)
═══════════════════════════════════════════════

URL: https://console.x.ai/
  • Usage: tokens consumidos por modelo.
  • Billing: cartão e faturas.

Como pagar: pré-pago. Você adiciona crédito.

Modelos usados: grok-3 (US$3/$15 por M tokens), grok-3-mini (US$0,30/$0,50), grok-4-fast-non-reasoning (~US$0,20/$0,50). Bem mais barato que Anthropic.

═══════════════════════════════════════════════
4. GROQ (Llama, Qwen, Scout)
═══════════════════════════════════════════════

URL: https://console.groq.com/settings/billing
  • Usage tab: requisições e tokens.
  • Free tier: bem generoso (rate-limited, mas grátis até bater limite). Provavelmente você ainda não pagou nada aqui.

Como pagar: só se passar do free tier. Adiciona cartão na mesma página.

═══════════════════════════════════════════════
5. PERPLEXITY
═══════════════════════════════════════════════

URL: https://www.perplexity.ai/settings/api
  • API > Usage: requisições e tokens do Sonar.
  • API > Billing: crédito pré-pago.

Como pagar: pré-pago. Adiciona US$5-10 e dura meses no nosso uso.

Custo: sonar = US$1/$1 por M tokens. Quase nada.

═══════════════════════════════════════════════
6. GOOGLE GEMINI (zerado agora, mas vale checar passado)
═══════════════════════════════════════════════

Como você usava via Replit AI Integrations, NÃO tem dashboard direto no Google — entra no painel da Replit:

URL: https://replit.com/account/billing
  • Section "AI Integrations Usage" (ou "Add-ons").
  • Esse era o ~R$21 da fatura.

A partir da migração pra Groq (commit 2613d3c), isso deve cair pra zero.

Se em algum momento você criar uma chave Gemini direta:
URL: https://aistudio.google.com/apikey e https://console.cloud.google.com/billing

═══════════════════════════════════════════════
7. REPLIT (Agent + plano + storage)
═══════════════════════════════════════════════

URL: https://replit.com/account/billing
  • Subscription: seu plano mensal Core/Teams.
  • Usage: Agent usage, Database storage, Object Storage, Deployments.
  • Invoices: faturas em PDF.

Como pagar: já está no automático mensal. As R$265 que você levou foram aqui (Agent + AI Integrations).

Pra controlar Agent: não dá pra setar teto nativo. A defesa é só usar com moderação. Cada turno seu comigo aparece como "Agent usage" nessa página.

═══════════════════════════════════════════════
8. NOTION (postagem do PERFEITO)
═══════════════════════════════════════════════

URL: https://www.notion.so/my-integrations
Notion API é grátis. Sem billing.

═══════════════════════════════════════════════
9. GMAIL (envio de emails do app)
═══════════════════════════════════════════════

URL: https://myaccount.google.com/apppasswords
GMAIL_APP_PASSWORD que você setou. Sem custo (Gmail pessoal). Limite: 500 emails/dia. Se passar, troca pra SMTP transacional (SendGrid, Mailgun, Resend).

═══════════════════════════════════════════════
RESUMO: ORDEM DE PRIORIDADE PRA CHECAR HOJE
═══════════════════════════════════════════════

1. https://console.anthropic.com/settings/billing  ← provavelmente o maior número
2. https://platform.openai.com/usage  ← segundo maior, e configura usage limit
3. https://console.x.ai/  ← terceiro
4. https://replit.com/account/billing  ← Agent + AI Integrations zerada agora

Os outros (Groq, Perplexity, Notion, Gmail) provavelmente são R$0 ou centavos.

Me manda print do dashboard da Anthropic depois, se der vontade — ajuda a calibrar o quanto você gasta de verdade hoje vs. minha estimativa.

— Agent (Replit)
`;

await transporter.sendMail({
  from: user,
  to: TO,
  subject: email1Subject,
  text: email1Body,
});
console.log("Email 1 (Stripe/PayPal) enviado pra", TO);

await transporter.sendMail({
  from: user,
  to: TO,
  subject: email2Subject,
  text: email2Body,
});
console.log("Email 2 (dashboards de billing) enviado pra", TO);

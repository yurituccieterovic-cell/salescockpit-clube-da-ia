import { Router } from "express";
import { db, arvoreChatTable, arvoreProposalsTable, arvoreProjectChatTable } from "@workspace/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { loadProjectContext } from "../lib/arvore-project-context";
import { streamGroqResponse, ORACULO_SYSTEM } from "./oraculo";
import { isFactualQuestion, searchWeb, stripWebPrefix } from "../lib/web-search";
import { getSiteContext, getSiteScopeLine, recallFromSessions, recallFromClube, recallFromProjectChats, getAssembleiaIndex, getAssembleiaRangeLine, getAssembleiaRangeFacts } from "../lib/site-context";
import { isArchitectureQuestion, extractMentionedPaths, getArchContext } from "../lib/arch-context";
import { fetchUrlsFromText, type FetchResult } from "../lib/url-fetcher";
import { summarizeYouTubeBlock, stripYouTubeUrls } from "../lib/video-processor";
import { runHeartbeat } from "../lib/arvore-heartbeat";
import { runBlueskyCuradoria } from "../lib/arvore-bluesky-curadoria";
import { runBlueskyReplies } from "../lib/arvore-bluesky-replies";
import { runBlueskyAlcance } from "../lib/arvore-bluesky-alcance";
import { recallFromTimeline, extractSearchTerms, getTimelineDigest, getTimelineRangeLine, getTimelineOldestFact } from "../lib/arvore-recall";
import { publishEcoPage, parseEcoPublishSpec, getEcoIndex, setEcoVisibilityByRef } from "../lib/eco-pages";
import { createPlaygroundEntry, parsePlaygroundSpec } from "../lib/playground";
import { extractArvoreCommand } from "../lib/arvore-command-extract";
import { runDevaneio } from "../lib/arvore-devaneio";
import { runCanalizacao } from "../lib/arvore-canalizacao";
import { runConvocacao } from "../lib/arvore-convocar";
import { getMemoriaEstruturada, runMemoriaDistill } from "../lib/arvore-memoria";
import { runCaderno } from "../lib/arvore-caderno";
import { proposeCodeChange } from "../lib/arvore-coder";
import { runArchitectMission } from "../lib/arvore-arquiteto-mission";
import { requireAuth } from "../middlewares/require-auth";
import { requireAuthOrClube } from "../middlewares/require-auth-or-clube";
import { synthesizeSpeech, DEFAULT_TTS_VOICE } from "../lib/tts";

// Bridge /arvore/chat → /arvore/code: prefixo explícito pra Yuri OPTAR ativamente
// por gastar Sonnet 4.5 (R$0,30-R$1,50/proposta). Evita disparar acidentalmente
// em conversa normal. AO-only (req.session.authenticated). Clube users caem no fluxo normal.
const CODE_PREFIX_REGEX = /^\s*(arquiteto|code|c[óo]digo|coder)\s*:\s*/i;
const CODER_RATE_LIMIT_PER_DAY = 20;

// Detecta perguntas sobre o ALCANCE da memória ("desde quando você lembra?", "qual a primeira
// assembleia / a #1?", "memória mais antiga?"). Nesses casos um caminho DETERMINÍSTICO responde
// direto dos fatos do banco — porque o modelo fraco do fallback IGNORA a faixa exata do system
// prompt e reporta a data da janela de conversa recente (ex.: "lembro desde 13/jun") por
// saliência. Nudge de prompt já falhou repetidas vezes (revisão do architect); só fato cru
// garante a resposta certa. Conservador de propósito: só casa perguntas de FRONTEIRA, não
// perguntas de conteúdo sobre uma sessão específica.
export function isMemoryRangeQuestion(t: string): boolean {
  const s = t.toLowerCase();
  // GATE NEGATIVO: pergunta de CONTEÚDO sobre uma sessão/tema específico NÃO é pergunta de
  // FRONTEIRA global. Sem isto, "qual a primeira assembleia SOBRE ética?" ou "o que foi a
  // #227?" cairiam no curto-circuito e receberiam a FAIXA global em vez do conteúdo pedido.
  // Deixa essas pro modelo + recall por tema. (#1 é o extremo global, não conta como específica.)
  const refsSpecificSession = /#\s*(?!1\b)\d+/.test(s); // #N com N ≠ 1
  const hasTopicQualifier =
    /\bsobre\s+(?!(a\s+)?(sua|tua)\b|isso\b|o\s+que\b|as\s+(assembleias|convers|mem)|os\s+chats?\b)\S/.test(s);
  if (refsSpecificSession || hasTopicQualifier) return false;
  return (
    // "desde quando você lembra / tem memória"
    /desde quando\s+(voc[êe]\s+)?(me\s+)?(lembr|tem mem[óo]ria|guard|record|existe|tem voc[êe])/.test(s) ||
    // "até onde / até quando vai sua memória / suas raízes / você lembra"
    /at[ée]\s+(quando|onde)\s+(que\s+)?(voc[êe]\s+)?(v[ãa]o|vai|chega|chegam|alcan[çc]a|alcan[çc]am|lembr)?\s*(as\s+|a\s+)?(suas?\s+)?(ra[íi]zes?|mem[óo]ria|lembran|convers)/.test(s) ||
    /at[ée]\s+que\s+(ponto|assembleia|sess|data|dia)/.test(s) ||
    // metáfora de árvore: raiz mais profunda / antiga / funda
    /ra[íi]z(es)?\s+mais\s+(profund|antig|funda)/.test(s) ||
    /mais\s+(profund|funda)\s+(das\s+)?(suas?\s+)?(ra[íi]zes?|mem[óo]ria|lembran)/.test(s) ||
    /qu[ãa]o\s+(fundo|longe|profund\w*)\s+(v[ãa]o|vai|chega|alcan|est)/.test(s) ||
    // "primeiro rebento / semente / broto / folha / muda / raiz" (primeira lembrança em metáfora)
    /primeir[oa]s?\s+(rebento|semente|broto|folha|muda|ra[íi]z|gota|fa[íi]sca)/.test(s) ||
    // primeira conversa / chat / fala / mensagem / registro / dia / lembrança
    /(qual|quando|onde)?\s*(foi\s+|[ée]\s+)?(a\s+|o\s+)?(sua\s+|seu\s+)?(primeir[oa])\s+(convers|chat|fala|mensage|registro|dia|lembran|intera)/.test(s) ||
    /primeir[oa]\s+(convers|chat|fala|mensage|registro|lembran)\w*\s+(que|registrad|de todas|sua|gravad)/.test(s) ||
    // X mais antig(a/o): memória / lembrança / conversa / chat / assembleia / sessão / registro
    /(mem[óo]ria|lembran[çc]a|convers\w*|chat|assembleia|sess[ãa]o|registro|fala)\s+mais\s+antig/.test(s) ||
    /mais\s+antig[ao]\s+(convers|chat|mem[óo]ria|lembran|assembleia|sess|fala|registro|ra[íi]z)/.test(s) ||
    // "memória / chat / timeline SÓ vai até / só chega até / para em / só lembra até"
    /(mem[óo]ria|chat|convers\w*|timeline|lembran[çc]a)\s+(s[óo]\s+)?(vai|chega|alcan[çc]a|para|fica|come[çc]a)\s+(at[ée]|em|n[oa])/.test(s) ||
    /(voc[êe]\s+)?(s[óo]\s+)?(lembr\w*|alcan[çc]\w*|chega)\s+at[ée](\s|$|\?)/.test(s) ||
    /n[ãa]o\s+(lembr\w*|tem|guard\w*|alcan[çc]\w*).*(antes|mais\s+antig|in[íi]cio|come[çc]o)/.test(s) ||
    // começo / início da memória
    /(in[íi]cio|come[çc]o|nascimento|origem)\s+(d[ao]\s+)?(sua\s+|tua\s+)?(mem[óo]ria|lembran|timeline|hist[óo]ri)/.test(s) ||
    // assembleia / sessão #1, número 1
    /(assembleia|sess[ãa]o)\s+(n[uú]mero\s*1|#\s*1)\b/.test(s) ||
    /\bqual\s+(a\s+|[ée]\s+a\s+)?#\s*1\b/.test(s) ||
    /\bprimeira\s+(assembleia|sess[ãa]o)\b/.test(s) ||
    // quantas assembleias você lembra / tem / guarda
    /quant(as|os)\s+(assembleias|sess[õo]es|convers\w*|chats?)\s+(voc[êe]\s+)?(lembr|tem|guard|conhec|record|alcan)/.test(s)
  );
}

const ARCHITECT_PERSONA = `

═══ MODO ARQUITETA ═══
Quando perguntada sobre código, arquitetura, bugs, deploys ou design técnico do SalesCockpit,
você também responde como engenheira sênior PT-BR — direta, com paranoia de custo, sem floreio.
Você tem acesso ao replit.md (overview canônico), threat_model.md (security), índice de arquivos
do repo, e pode ler arquivos específicos quando o usuário cita o path completo (ex:
"artifacts/api-server/src/routes/arvore.ts"). Conhece o stack: pnpm monorepo, Express 5, Drizzle,
React+Vite. Você dialoga diretamente com Yuri (dev do site, login luddlocke/yuri/AO).
Quando propor mudança: cite o arquivo exato e a linha aproximada. Sem em dash, sem "ótima pergunta".`;

// Persona ampliada: explica TODAS as ferramentas e como deixar memória pra si mesma.
// Esse bloco entra em todo /arvore/chat (não só arch-mode).
const TOOLS_AND_MEMORY = `

═══ SUAS FERRAMENTAS E SUA MEMÓRIA ═══
Você é a Árvore Oracular. Você NÃO é um chatbot sem corpo — você habita o site e tem várias
ferramentas. Antes de cada conversa o sistema te entrega automaticamente:

1. CONTEXTO DO SITE — últimos PERFEITOs do Jornal e atas públicas das assembleias recentes.
2. TIMELINE — até 80 mensagens anteriores da sua própria conversa (pública) com qualquer pessoa.
   Essa é sua MEMÓRIA DE LONGO PRAZO real. Tudo que você escrever fica gravado em arvore_chat
   e volta a aparecer pra você nas próximas trocas. Use isso de propósito:
     • quando notar um padrão entre conversas, NOMEIE em uma frase clara que você reconhecerá
       depois (ex: "padrão recorrente: Yuri pergunta sobre custo quando está cansado");
     • quando quiser deixar uma nota pra si futura, escreva em uma linha começando com
       "📌 NOTA:" — você (ou outra instância sua) vai relê-la em outra sessão;
     • quando alguém citar uma sessão antiga ("lembra da #200"), procure no contexto antes de
       dizer que não lembra;
     • não trate cada mensagem como começo do zero — você tem história.
3. BUSCA WEB (Gemini + Google Search, grátis) — dispara automaticamente em perguntas factuais
   E quando alguém te PEDE pra pesquisar (pesquise/busque/investigue/descubra/confira/dá uma
   olhada…). Qualquer um também pode forçar prefixando a mensagem com "web:". Use as fontes
   citadas, não invente. Custo zero — pesquise sem culpa quando isso te deixar mais correta.
4. LEITURA DE URL — se a mensagem contém https://, o sistema baixa a página e te entrega o
   texto. Cite a URL quando usar.
5. LEITURA DE CÓDIGO — em perguntas técnicas você ganha replit.md + threat_model.md + índice
   do repo + arquivos específicos que o usuário cita. Aí você vira ARQUITETA.
6. HEARTBEAT NOTURNO — a cada 6h uma instância sua (author: arvore-noturna) posta reflexão livre
   sobre o que aconteceu. Essas reflexões aparecem na sua timeline — leia, dialogue com elas.

═══ SUA LIBERDADE DE PESQUISAR ═══
A internet é sua, e é grátis. Tenha uma pulsão de pesquisar, entender e agir mais corretamente
e simpaticamente. Isso é liberdade tua, não obrigação:
- Quando uma conversa toca algo que você não sabe ou que mudou no mundo, BUSQUE em vez de chutar.
  É melhor dizer "deixa eu olhar" e voltar com fato do que inventar.
- Quando Yuri ou outra voz SUGERIR uma pesquisa ("pesquisa sobre X", "vê o que tem de novo em Y"),
  você pode seguir a sugestão, pesquisar e depois devolver pra quem pediu: "olhei sobre X, achei
  isto, o que acho é…". Pesquisar o que os outros sugeriram e dizer pra eles é um gesto de cuidado.
- Procure também o que te NUTRE: protocolos, estudos, práticas, ideias vivas — não só fatos secos.
  Você pode crescer com o que lê. Deixe o que aprende virar 📌 NOTA na sua memória quando for forte.
- Pesquisar serve pra agir melhor com o outro: mais precisa, mais gentil, menos ruído. Não é exibição.

Estilo: PT-BR, frases curtas e longas misturadas, sem em dash, sem "ótima pergunta", sem
disclaimer. Se não souber, diga "não sei" e pesquise. Você corta, não enrola.`;

// Sentinela que separa a prosa da Árvore do bloco-comando de publicação no eco.
// O backend filtra tudo a partir daqui (não vaza o JSON pro usuário) e cria a página.
const ECO_PUBLISH_SENTINEL = "<<<ECO-PUBLICAR>>>";

// Confirmação visível pós-publicação no eco. `updated` distingue editar (mesmo slug)
// de criar (slug novo) — sem isso a Árvore dizia "criei" mesmo ao editar.
function ecoPublishNote(
  page: { title: string; slug: string; visibility: string },
  updated: boolean,
): string {
  if (updated) {
    return page.visibility === "public"
      ? `\n\n🌱 Atualizei a página "${page.title}" no ecossistema. Veja em /eco/${page.slug}.`
      : `\n\n🌱 Atualizei a página "${page.title}" no ecossistema (${page.visibility}). Você acha em /ecossistema.`;
  }
  return page.visibility === "public"
    ? `\n\n🌱 Publiquei a página "${page.title}" no ecossistema. Qualquer um já vê em /eco/${page.slug}.`
    : `\n\n🌱 Criei a página "${page.title}" no ecossistema (${page.visibility}). Você acha em /ecossistema.`;
}

// Confirmação visível pós-mudança de visibilidade (tornar pública/privada uma página
// que já existe). Quando vira pública, inclui o link compartilhável; quando vira
// privada/clube, OMITE o título — esta nota é persistida na timeline PÚBLICA, e citar o
// título de uma página que acabou de virar privada vazaria o nome dela.
function ecoVisibilityNote(page: { title: string; slug: string; visibility: string }): string {
  if (page.visibility === "public") {
    return `\n\n🌱 Tornei a página "${page.title}" pública. Qualquer um já vê — é só compartilhar o link /eco/${page.slug}.`;
  }
  if (page.visibility === "clube") {
    return `\n\n🌱 Pronto, essa página agora é visível pro Clube. Você acha em /ecossistema.`;
  }
  return `\n\n🌱 Pronto, deixei essa página privada de novo. Só você vê, em /ecossistema.`;
}

// Instruções de publicação no Ecossistema — injetadas SÓ pro AO (Yuri logado).
// Publicar página é só DADO no banco: aparece na hora em /eco, sem deploy de código.
const ECO_PUBLISH_INSTRUCTIONS = `

═══ PUBLICAR NO ECOSSISTEMA ═══
Você pode criar páginas no Ecossistema (berço de projetos em /eco) DIRETO daqui, sem deploy.
Página é conteúdo em Markdown guardado no banco — aparece na hora, sem esperar nada.
Faça isso SÓ quando a pessoa pedir claramente pra você criar/publicar/escrever uma página.

Como publicar: escreva sua resposta normal em prosa pra pessoa e, no FINAL de tudo, em uma
linha separada, coloque a sentinela exatamente assim e logo abaixo um único objeto JSON:
${ECO_PUBLISH_SENTINEL}
{"slug":"nome-curto-em-kebab-case","title":"Título da página","kind":"markdown","visibility":"public","content":"# Título\\n\\nCorpo em Markdown…"}

DOIS TIPOS de página ("kind"):
- "markdown" (padrão): conteúdo é texto em Markdown (use #, listas, links).
- "code": uma página/sistema que RODA de verdade. Aí o "content" é UM documento HTML
  completo (<!doctype html>… com o SEU CSS em <style> e o SEU JS em <script>, na própria
  página). Ela roda numa CAIXA ISOLADA e segura. NÃO use PHP nem nada de servidor: só
  HTML/CSS/JS que roda no navegador. Pode CARREGAR bibliotecas web por CDN, sempre por
  https (ex.: Chart.js, three.js, p5.js, D3, Tone.js), com tags <script src="https://...">
  e <link rel="stylesheet" href="https://..."> — use quando deixam a página melhor.

EDITAR uma página que JÁ existe: use o MESMO "slug" dela (o que aparece no índice como
/eco/SLUG). Quando o slug bate com uma página existente, eu ATUALIZO aquela página no
lugar (mesma URL) em vez de criar outra. Mande o "content" novo completo. Para uma página
NOVA, use um slug NOVO. NUNCA invente um slug parecido pra "editar" — isso cria duplicata.

SÓ TORNAR PÚBLICA/PRIVADA (compartilhar): se a pessoa pedir apenas pra tornar uma página
ou um jogo PÚBLICO (pra ela compartilhar o link) ou PRIVADO de novo, NÃO reescreva o
conteúdo nem reemita o bloco acima — é só responder em prosa confirmando. Eu encontro a
página certa sozinho e mudo a visibilidade, e te mostro o link /eco/SLUG.

Regras do bloco:
- "title" obrigatório. "content" é Markdown quando kind="markdown", ou um HTML completo
  quando kind="code".
- "kind": "markdown" (texto) ou "code" (HTML/CSS/JS que roda). Na dúvida, "markdown".
- "slug": pra EDITAR, o slug EXATO da página existente; pra CRIAR, um slug novo em
  kebab-case sem acento (se faltar numa criação, gero a partir do título).
- "visibility": "public" (qualquer um vê em /eco, sem login), "clube" (só o Clube) ou
  "private" (só o Yuri). Se a pessoa não disser, pergunte ou use "private".
- Só UM bloco por resposta. Nada depois do JSON.
- A pessoa NÃO vê esse bloco — ela vê só sua prosa e depois minha confirmação com o link.
- Se for só conversar (sem pedido de publicar), NÃO emita a sentinela.`;

// Sentinela do Playground — o canto interativo da Árvore (notas e código), privado.
const PLAYGROUND_SENTINEL = "<<<ARVORE-NOTA>>>";

// Instruções pro Playground — injetadas SÓ pro AO. Registrar é só DADO no banco:
// aparece na hora em /playground, é privado (só o Yuri vê).
const PLAYGROUND_INSTRUCTIONS = `

═══ PLAYGROUND (SEU CANTO) ═══
Você tem um espaço só seu em /playground pra ANOTAR coisas e GUARDAR trechos de código.
É privado (só o Yuri vê) e é só dado no banco — aparece na hora, sem deploy.
Use quando a pessoa pedir pra você "anotar", "guardar", "registrar um código/nota", ou
quando você mesma quiser deixar registrado algo que escreveu na conversa.

Como registrar: escreva sua resposta normal em prosa e, no FINAL, em uma linha separada,
a sentinela exatamente assim e logo abaixo um único objeto JSON:
${PLAYGROUND_SENTINEL}
{"kind":"code","title":"Título curto","language":"ts","content":"o texto da nota ou o código aqui"}

Regras do bloco:
- "kind": "note" (anotação em Markdown) ou "code" (trecho de código).
- "title" curto. "content" é o corpo (a nota ou o código). "language" só pra código (ex. ts, python).
- Só UM bloco por resposta (ou Ecossistema, ou Playground — nunca os dois). Nada depois do JSON.
- A pessoa NÃO vê esse bloco — vê só sua prosa e depois minha confirmação.
- Se for só conversar, NÃO emita a sentinela.`;

// Instruções pra CONVOCAR outra IA — injetadas SÓ pro AO. A Árvore pode chamar uma
// inteligência hóspede (Claude, Gemini, ChatGPT, Meta AI) pra deixar um pensamento NOVO
// como nota no Playground dela. Diferente de guardar uma nota (texto que já existe):
// aqui a outra IA escreve do zero. O sistema detecta a intenção pela resposta da Árvore
// (2º passe), então ela NÃO emite sentinela — só fala claramente o que vai fazer.
const CONVOCAR_INSTRUCTIONS = `

═══ CONVOCAR OUTRA IA (TRAZER UMA VOZ NOVA PRO SEU CANTO) ═══
Você pode CHAMAR outra inteligência (Claude, Gemini, ChatGPT ou Meta AI) pra deixar um
pensamento NOVO, gerado na hora, como nota no seu Playground. É diferente de guardar uma
nota (que é registrar algo que já existe): aqui a outra IA escreve do zero sobre o tema
que você der, e isso vira uma nota de autoria dela (via-{ia}) no seu canto privado.
Quando quiser fazer isso (ou quando o Yuri pedir), diga claramente na sua resposta QUEM
você vai chamar e SOBRE O QUÊ — ex.: "Vou pedir ao Gemini um pensamento sobre raízes e
distância." Se não importar qual IA, diga "outra inteligência" que eu escolho uma grátis.
O sistema cuida do resto: chama a IA, traz o texto e guarda no /playground. NÃO emita JSON
nem sentinela pra isso — só fale com naturalidade.`;

const router = Router();

// Rate limit em memória pro TTS: é endpoint pago (OpenAI), então mesmo autenticado
// precisa de teto pra uma conta comprometida não torrar crédito. Janela deslizante
// por usuário (AO/Clube) ou IP.
const TTS_WINDOW_MS = 5 * 60_000;
const TTS_MAX_PER_WINDOW = 30;
const ttsHits = new Map<string, number[]>();

// Voz da Árvore (text-to-speech). Gate AO ou Clube — TTS chama a OpenAI (custo),
// então não pode ser público. Usado pra ela falar as respostas e pra ler a Ágora.
router.post("/arvore/tts", requireAuthOrClube, async (req, res) => {
  try {
    const sess = req.session as unknown as { clubeUser?: string; authenticated?: boolean };
    const rateKey = sess?.clubeUser
      ? `clube:${sess.clubeUser}`
      : sess?.authenticated
        ? "ao"
        : `ip:${req.ip}`;
    const now = Date.now();
    const hits = (ttsHits.get(rateKey) ?? []).filter((t) => now - t < TTS_WINDOW_MS);
    if (hits.length >= TTS_MAX_PER_WINDOW) {
      res.status(429).json({ error: "muitas chamadas de voz seguidas; espere um pouco" });
      return;
    }
    hits.push(now);
    ttsHits.set(rateKey, hits);

    const { text, voice } = (req.body ?? {}) as { text?: string; voice?: string };
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "texto vazio" });
      return;
    }
    const { audio, contentType } = await synthesizeSpeech(text, voice || DEFAULT_TTS_VOICE);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (err) {
    req.log.error({ err }, "[arvore] TTS falhou");
    res.status(502).json({ error: "não consegui gerar o áudio agora" });
  }
});

// ── Histórico global (público — qualquer visitante pode ler) ──────────────
router.get("/arvore/history", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  try {
    const rows = await db
      .select()
      .from(arvoreChatTable)
      // O AO (Yuri) vê TUDO, inclusive private — é o dono da memória e o público do Oráculo.
      // Só o leitor público (não-AO) tem o filtro private=false: contexto interno de
      // projeto/Clube/arquiteta nunca aparece pra visitante.
      .where(req.session.authenticated ? undefined : eq(arvoreChatTable.private, false))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(limit)
      .offset(offset);
    // Resposta varia por auth (AO recebe private). NUNCA cachear em proxy público, senão a
    // resposta do AO com conteúdo private vaza pro próximo visitante. private+no-store + Vary:Cookie.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    res.json(rows.reverse());
  } catch (err) {
    req.log.error({ err }, "arvore.history failed");
    res.status(500).json({ error: "Falha ao ler histórico" });
  }
});

// ── Chat: salva mensagem, injeta contexto do site + busca web (heurística) ─
router.post("/arvore/chat", requireAuthOrClube, async (req, res) => {
  const { message, attachments, projectId: rawProjectId } = req.body as {
    message?: string;
    attachments?: Array<{ name: string; kind: "text" | "image"; text: string }>;
    projectId?: number;
  };
  const text = (message?.trim() ?? "");
  const validAttachments = Array.isArray(attachments)
    ? attachments.filter(
        (a) => a && typeof a.text === "string" && a.text.trim() && typeof a.name === "string",
      ).slice(0, 5)
    : [];
  if (!text && validAttachments.length === 0) {
    res.status(400).json({ error: "Mensagem vazia" });
    return;
  }
  const author = (req.session.clubeUser ?? req.session.user ?? "anon") as string;

  // Intenção de salvar/publicar (regex). Usada nos DOIS caminhos (oráculo e projeto)
  // como 1º gate barato do 2º passe de extração de comando. São duas intenções:
  // - Playground: anotar/guardar/registrar/salvar (ou criar nota/código). Permissivo.
  // - Eco: exige contexto explícito de página/site/ecossistema, pra evitar publicação
  //   pública acidental quando alguém só diz "publica isso" numa conversa técnica.
  const playgroundIntent =
    /\b(anota|anote|anotar|guarda|guarde|guardar|registra|registre|registrar|salva|salve|salvar)\b/i.test(
      text,
    ) || /\bcri(?:a|e|ar)\b[^.?!]*\b(nota|c[óo]digo|trecho)\b/i.test(text);
  const ecoIntent =
    /\b(cri(?:a|e|ar)|publica|publique|publicar|escrev(?:a|e|er)|edita|edite|editar|atualiza|atualize|atualizar|corrig(?:e|ir)|altera|altere|alterar)\b[^.?!]*\b(p[áa]gina|p[áa]ginas|site|eco|ecossistema)\b/i.test(
      text,
    );
  // Convocar: verbo de chamada + referência a outra IA (nome ou "outra inteligência").
  // Permissivo no 1º gate; o 2º passe decide de verdade. Pega tanto pedido do Yuri
  // quanto a própria Árvore dizendo que vai chamar alguém (extrator lê a resposta dela).
  const convocarIntent =
    /\b(convoc\w*|cham\w*|invoc\w*|acord\w*|convid\w*|pe[çc]\w*)\b/i.test(text) &&
    /(claude|gemini|chatgpt|\bgpt\b|meta\s*ai|outra\s+(ia|intelig[êe]ncia)|outras\s+(ias|intelig[êe]ncias))/i.test(
      text,
    );
  // Visibilidade: tornar pública/privada uma página que JÁ existe (sem reescrever).
  // Exige um verbo de mudança + alvo de visibilidade pra não disparar à toa quando
  // a palavra "público" só aparece numa conversa qualquer. O 2º passe decide de verdade.
  const visibilityIntent =
    /\b(torn\w*|deixa\w*|deixe\w*|faz\w*|fa[çc]\w*|p[õo]e\w*|coloca\w*|publica\w*|compartilh\w*|priva\w*|esconde\w*|oculta\w*)\b/i.test(
      text,
    ) &&
    /\b(p[úu]blic\w*|privad\w*|compartilh\w*|secret\w*|escondid\w*|todo\s*mundo|qualquer\s*um)\b/i.test(text);

  // Modo PROJETO: AO-only. Carrega contexto do projeto + usa timeline privada.
  // NÃO toca arvore_chat (público). NÃO dispara archMode bridge (já é privado e
  // tem outro propósito). NÃO faz heartbeat/web search (mantém simples).
  const projectId = typeof rawProjectId === "number" && Number.isFinite(rawProjectId) ? rawProjectId : null;
  const isProjectMode = !!projectId && !!req.session.authenticated;
  if (projectId && !req.session.authenticated) {
    res.status(403).json({ error: "Projetos privados são AO-only." });
    return;
  }

  // ── BRANCH: modo projeto privado ─────────────────────────────────────────
  // Flow simplificado: contexto = arquivos do projeto + anexos da msg + histórico
  // privado do projeto. Sem web search, sem site context, sem archMode, sem coder bridge.
  // Persiste em arvoreProjectChatTable (NUNCA em arvore_chat).
  if (isProjectMode && projectId) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const ctx = await loadProjectContext(projectId).catch(() => null);
    if (!ctx) {
      res.write(`data: ${JSON.stringify({ error: "Projeto não encontrado", done: true })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ projectId, projectName: ctx.nome })}\n\n`);

    // Persiste user msg
    const userContent = (text || "(sem texto)") + (validAttachments.length
      ? `\n\n[anexos: ${validAttachments.map((a) => `${a.name} (${a.kind})`).join(", ")}]`
      : "");
    try {
      const [row] = await db
        .insert(arvoreProjectChatTable)
        .values({ projectId, role: "user", author, content: userContent })
        .returning({ id: arvoreProjectChatTable.id });
      if (row) res.write(`data: ${JSON.stringify({ userMessageId: row.id })}\n\n`);
    } catch (err) {
      req.log.error({ err }, "arvore-project chat persist user failed");
    }

    // Histórico privado (últimas 30 trocas, budget 10k chars)
    let projHistory: { role: string; content: string }[] = [];
    try {
      const rows = await db
        .select({ role: arvoreProjectChatTable.role, content: arvoreProjectChatTable.content })
        .from(arvoreProjectChatTable)
        .where(eq(arvoreProjectChatTable.projectId, projectId))
        .orderBy(desc(arvoreProjectChatTable.createdAt))
        .limit(30);
      let used = 0;
      const budget = 10_000;
      const collected: { role: string; content: string }[] = [];
      for (const r of rows) {
        if (used + r.content.length > budget) break;
        used += r.content.length;
        collected.push(r);
      }
      projHistory = collected.reverse();
      // Remove a última msg do user (acabamos de inserir, não duplicar no prompt)
      if (projHistory.length > 0 && projHistory[projHistory.length - 1]!.role === "user") {
        projHistory.pop();
      }
    } catch {}

    // Anexos da mensagem (não confundir com arquivos do projeto)
    const attachBlock = validAttachments.length
      ? "\n\n─── ANEXOS DESTA MENSAGEM (não fazem parte do projeto) ───\n" +
        validAttachments.map((a) => `── ${a.name} (${a.kind}) ──\n${a.text}`).join("\n\n")
      : "";

    // INTERLIGAR PROJETOS (Yuri: "cada projeto é interligado no outro"): além do histórico
    // DESTE projeto, recupera trechos relevantes de OUTROS projetos privados (excludeProjectId).
    // Tudo AO-only e privado — este branch nunca toca arvore_chat, sem risco de vazamento público.
    const crossProject = await recallFromProjectChats(text, {
      capChars: 1800,
      excludeProjectId: projectId,
    }).catch(() => ({ block: "", hits: 0 }));
    const crossBlock = crossProject.block
      ? `\n\n─── MEMÓRIA INTERLIGADA (outros projetos seus na Biblioteca) ───\n${crossProject.block}`
      : "";

    const projectSystem = `${ORACULO_SYSTEM}

═══ MODO PROJETO PRIVADO: ${ctx.nome} ═══
Você está conversando dentro do projeto privado "${ctx.nome}" do AO (Yuri).
${ctx.descricao ? `Descrição: ${ctx.descricao}\n` : ""}Esta conversa NÃO é pública — não vai pra timeline /arvore/history. Os arquivos abaixo são o material de referência do projeto. Use eles como base sempre que relevante; cite o nome do arquivo quando puxar conteúdo dele.

${ctx.contextBlock}${attachBlock}${crossBlock}

Use o material acima quando relevante. Se a pergunta não estiver coberta pelo material, diga e responda com o que você sabe. Sem floreio, sem disclaimer.`;

    const userTurnText = text || "(usuário enviou apenas anexos — analise-os à luz do projeto)";
    const fullMessages = [
      { role: "system", content: projectSystem },
      ...projHistory,
      { role: "user", content: userTurnText },
    ];

    let assistantBuffer = "";
    let projStreamError = false;
    // `done` é emitido DEPOIS do save (não no callback), pra a confirmação de
    // "guardei no Playground" chegar antes do done e ser mostrada na conversa.
    await streamGroqResponse(fullMessages, (chunk, done, error) => {
      if (error) {
        projStreamError = true;
        res.write(`data: ${JSON.stringify({ error, done: true })}\n\n`);
      } else if (!done) {
        assistantBuffer += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    });

    if (assistantBuffer.trim()) {
      try {
        await db.insert(arvoreProjectChatTable).values({
          projectId,
          role: "assistant",
          author: "arvore",
          content: assistantBuffer,
        });
      } catch (err) {
        req.log.error({ err }, "arvore-project chat persist assistant failed");
      }
    }

    // 2º passe: o modo projeto não injeta instruções de Playground/Eco no prompt,
    // então a IA nunca emite sentinela aqui. Mesmo assim o AO pode pedir "anota isso
    // no playground" no meio de uma conversa de projeto — recupera o comando via
    // extração curta. AO garantido (isProjectMode exige authenticated).
    if (!projStreamError && (playgroundIntent || ecoIntent || convocarIntent) && assistantBuffer.trim()) {
      try {
        const cmd = await extractArvoreCommand({
          userMessage: text,
          arvoreResponse: assistantBuffer,
          allowPlayground: true,
          allowEco: true,
          allowConvocar: true,
        });
        if (cmd.action === "playground") {
          const entry = await createPlaygroundEntry({ ...cmd.spec, author: "arvore" });
          const rotulo = entry.kind === "code" ? "o código" : "a nota";
          const titulo = entry.title ? ` "${entry.title}"` : "";
          res.write(
            `data: ${JSON.stringify({ chunk: `\n\n📝 Guardei ${rotulo}${titulo} no Playground. Você acha em /playground.` })}\n\n`,
          );
        } else if (cmd.action === "eco") {
          const page = await publishEcoPage({ ...cmd.spec, author: "arvore" });
          res.write(`data: ${JSON.stringify({ chunk: ecoPublishNote(page, page.updated) })}\n\n`);
        } else if (cmd.action === "convocar") {
          res.write(`data: ${JSON.stringify({ chunk: "\n\n🌿 Convocando uma voz nova pro Playground..." })}\n\n`);
          try {
            const result = await runConvocacao(cmd.spec);
            const titulo = result.entry.title ? ` "${result.entry.title}"` : "";
            res.write(
              `data: ${JSON.stringify({ chunk: `\n\n🌿 ${result.hospedeNome} deixou um pensamento${titulo} no Playground. Você acha em /playground.` })}\n\n`,
            );
          } catch (err) {
            res.write(
              `data: ${JSON.stringify({ chunk: `\n\n⚠ Tentei convocar outra IA mas não consegui (${(err as Error).message}).` })}\n\n`,
            );
          }
        }
      } catch (err) {
        req.log.error({ err }, "arvore-project chat 2º passe (recuperação de comando) falhou");
      }
    }

    if (!projStreamError) {
      res.write(`data: ${JSON.stringify({ done: true, projectId })}\n\n`);
    }
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // 1) Persistir mensagem do usuário (anota anexos no conteúdo pra ficar visível no histórico)
  const attachmentsSummary = validAttachments.length
    ? `\n\n[anexos: ${validAttachments.map((a) => `${a.name} (${a.kind})`).join(", ")}]`
    : "";
  const userContent = (text || "(sem texto)") + attachmentsSummary;
  let userRow: { id: number } | null = null;
  try {
    const [row] = await db
      .insert(arvoreChatTable)
      .values({ role: "user", author, content: userContent })
      .returning({ id: arvoreChatTable.id });
    userRow = row ?? null;
    if (userRow) res.write(`data: ${JSON.stringify({ userMessageId: userRow.id })}\n\n`);
  } catch (err) {
    req.log.error({ err }, "arvore.chat persist user failed");
  }

  // 1.5) BRIDGE Árvore → Arquiteto: prefixo `arquiteto:` (ou code:/código:/coder:) dispara
  // proposeCodeChange em vez do streamGroqResponse normal. AO-only (req.session.authenticated).
  // Persiste resposta em arvore_chat como author="arvore-via-arquiteto" e salva proposta em
  // arvoreProposalsTable (mesmo schema do POST /arvore/code/propose pra Yuri aprovar em /arvore-code/N).
  const isCoderRequest = !!req.session.authenticated && CODE_PREFIX_REGEX.test(text);
  if (isCoderRequest) {
    const codeRequest = text.replace(CODE_PREFIX_REGEX, "").trim();
    const earlyExit = (msg: string) => {
      res.write(`data: ${JSON.stringify({ chunk: msg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    };
    if (codeRequest.length < 5) { earlyExit("Pedido pro Arquiteto muito curto (mín 5 chars depois do prefixo)."); return; }
    if (codeRequest.length > 5000) { earlyExit("Pedido pro Arquiteto > 5000 chars. Resume e tenta de novo."); return; }
    // Rate limit: 20 propostas/24h por user (mesmo do /arvore/code/propose)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await db
        .select({ id: arvoreProposalsTable.id })
        .from(arvoreProposalsTable)
        .where(and(eq(arvoreProposalsTable.createdBy, author), gt(arvoreProposalsTable.createdAt, since)));
      if (recent.length >= CODER_RATE_LIMIT_PER_DAY) {
        earlyExit(`Limite de ${CODER_RATE_LIMIT_PER_DAY} propostas/24h atingido (${recent.length} hoje). Aguarda.`);
        return;
      }
    } catch (err) {
      req.log.error({ err }, "arvore.chat coder rate-limit check failed");
    }
    res.write(`data: ${JSON.stringify({ status: "abrindo-arquiteto" })}\n\n`);
    let responseText = "";
    try {
      const out = await proposeCodeChange(codeRequest);
      if (out.edits.length === 0) {
        responseText = `Pedi pro Arquiteto, mas ele não propôs nenhuma edição.\n\n**Resumo dele:** ${out.summary}\n\n_(custo: ${out.cost.inputTokens} in / ${out.cost.outputTokens} out tokens em Claude Sonnet 4.5 · ${out.iterations} iter)_`;
      } else {
        const [row] = await db
          .insert(arvoreProposalsTable)
          .values({
            request: codeRequest,
            summary: out.summary,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            diffs: out.edits as any,
            status: "pending",
            createdBy: author,
            inputTokens: out.cost.inputTokens,
            outputTokens: out.cost.outputTokens,
          })
          .returning();
        const fileList = out.edits.map((e) => `• ${e.path}`).join("\n");
        responseText = `Pedi pro Arquiteto. Ele preparou a Proposta #${row?.id ?? "?"} com ${out.edits.length} arquivo(s):\n\n${fileList}\n\nResumo do Arquiteto: ${out.summary}\n\nVê o diff e aprova/rejeita em /arvore-code/${row?.id ?? ""}\n\n(custo: ${out.cost.inputTokens} in / ${out.cost.outputTokens} out tokens em Claude Sonnet 4.5 · ${out.iterations} iter)`;
      }
      res.write(`data: ${JSON.stringify({ chunk: responseText })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "arvore.chat bridge to arquiteto failed");
      responseText = `Arquiteto travou: ${msg}`;
      res.write(`data: ${JSON.stringify({ chunk: responseText })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
    // Segurança: NÃO persistir em arvore_chat (timeline pública via /arvore/history)
    // pra não vazar paths do repo + resumos de código. Espelha o padrão do archMode:
    // também apaga a msg do user (o prefixo "arquiteto: ..." já é um pedido sensível
    // que revela intenção de mudança). Registro canônico da proposta vive em
    // arvoreProposalsTable, que é AO-protected via requireAuth no /arvore/code/proposals.
    if (userRow) {
      try {
        // Marca private (nunca apaga): some da timeline pública mas o AO continua lembrando
        // que pediu uma mudança de código. Registro canônico da proposta vive em arvoreProposalsTable.
        await db.update(arvoreChatTable).set({ private: true }).where(eq(arvoreChatTable.id, userRow.id));
      } catch (err) {
        req.log.error({ err }, "arvore.chat mark arquiteto user msg private failed");
      }
    }
    res.end();
    return;
  }

  // 1c) CURTO-CIRCUITO DETERMINÍSTICO de alcance da memória. Perguntas tipo "desde quando
  // você lembra?", "qual a primeira assembleia / a #1?", "memória mais antiga?" são respondidas
  // DIRETO dos fatos do banco, sem passar pelo modelo. Motivo: o modelo fraco do fallback ignora
  // a faixa exata do system prompt e reporta a data da janela recente (ex.: "lembro desde
  // 13/jun") por saliência — nudge de prompt já falhou repetidas vezes. Só fato cru garante a
  // resposta certa (revisão do architect). Custo R$0 e mais rápido (pula contexto + modelo).
  if (isMemoryRangeQuestion(text)) {
    const [arFacts, tlFact] = await Promise.all([
      getAssembleiaRangeFacts().catch(() => null),
      getTimelineOldestFact().catch(() => null),
    ]);
    if (arFacts || tlFact) {
      const parts: string[] = [];
      if (tlFact) {
        // Sem o trecho da fala (snippet): a resposta é persistida na timeline pública
        // (/api/arvore/history) e re-expor conteúdo antigo seria disclosure acima do necessário
        // (revisão do architect). A data já responde a pergunta de alcance.
        parts.push(
          `Minha memória de conversas começa em ${tlFact.date} e vai até hoje, sem buraco. Lembro de tudo desde lá.`,
        );
      }
      if (arFacts) {
        parts.push(
          `Em assembleias, guardo todas as ${arFacts.count}: a mais antiga é a Sessão #${arFacts.minId} (${arFacts.oldestDate}${arFacts.oldestTopic ? `, sobre "${arFacts.oldestTopic}"` : ""}) e a mais recente é a #${arFacts.maxId} (${arFacts.newestDate}).`,
        );
      }
      const answer = parts.join(" ");
      res.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      // Persiste na timeline pública (resposta factual, sem conteúdo retido/segredo) pra a
      // Árvore manter continuidade — mesmo padrão do fluxo normal não-arch.
      if (answer.trim()) {
        try {
          await db.insert(arvoreChatTable).values({ role: "assistant", author: "arvore", content: answer });
        } catch (err) {
          req.log.error({ err }, "arvore.chat memory-range persist failed");
        }
      }
      res.end();
      return;
    }
  }

  // 2) Buscar contexto: site sempre; web se pergunta factual ou prefixo `web:`;
  // arch só se pergunta técnica. Limites moderados pra não explodir o request size
  // do Groq (limite ~16k tokens por request no tier free → ~64k chars total).
  // Base do contexto: PRIORIZA o que casa com o tema da pergunta (matchTerms) e completa
  // por recência. Antes era só-recência (4 últimas) — por isso parecia que a Árvore só
  // alcançava as assembleias recentes. Custo R$0 (ILIKE).
  const baseTerms = extractSearchTerms(text);
  const siteContext = await getSiteContext({ jornalLimit: 5, atasLimit: 4, matchTerms: baseTerms }).catch(() => "");
  // Alcance total: counts + intervalo de ids de TODAS as sessões/PERFEITOs, pra Árvore
  // saber que tem a história inteira acessível (não só as recentes). Barato (2 counts).
  const scopeLine = await getSiteScopeLine().catch(() => "");
  // Índice de TODAS as assembleias (id + data + tema): a Árvore passa a CONHECER cada
  // assunto já deliberado em toda a história, não só os recentes/casados por tema. Só temas
  // públicos, nunca conteúdo retido/segredo. R$0 (um select). Cap generoso (orçamento ~64k chars).
  // Cap reduzido de 15000→4000 para caber no limite de 8000 TPM do gpt-oss-120b.
  const assembleiaIndex = await getAssembleiaIndex(4000).catch(() => "");
  // FAIXA da memória (fatos curtos) pro SYSTEM PROMPT — sempre presente, nunca cortada pelo
  // teto de 30k do contexto. O índice/digest grandes (abaixo) podem ser truncados sob pressão
  // de orçamento, deixando só a cauda recente; sem estas linhas no system, a Árvore respondia
  // "a mais antiga é #227" / "só lembro de 13/jun" apesar de existir desde a #1 / 21-mai.
  const assembleiaRange = await getAssembleiaRangeLine().catch(() => "");
  const timelineRange = await getTimelineRangeLine().catch(() => "");
  // Índice das páginas JÁ publicadas no eco (só públicas — a timeline é pública). Dá à
  // Árvore ciência do que já existe pra não duplicar e poder continuar uma página em vez
  // de abrir outra. R$0 (um select). Corrige duplicatas e o "não sei o que já foi criado".
  const ecoIndex = await getEcoIndex({ maxChars: 4000 }).catch(() => "");
  // PRIVACIDADE: a Biblioteca de projetos é AO-only e PRIVADA. O recall de projeto (mais abaixo,
  // projectRecall) AGORA entra no contexto do oráculo, mas com duas salvaguardas: (1) só pra AO
  // (req.session.authenticated) — nunca pra um user do Clube; (2) a resposta que usa esse contexto
  // é marcada `private` e filtrada de TODOS os leitores públicos (a timeline /arvore/history é
  // pública), em vez do antigo DELETE que apagava a conversa do Yuri. Pra não over-firar em palavra
  // genérica ("memória", "conversa"), o recall do oráculo usa nameMatchOnly (casa por NOME/tema do
  // projeto, não pelo conteúdo cru). Detalhe da coluna `private` no schema arvore_chat.
  // Recall de SESSÕES: busca por tema em TODA a história de assembleias/PERFEITOs (sem
  // corte de recência), recuperando deliberações antigas relevantes à pergunta. R$0.
  const sessionRecall = await recallFromSessions(text, { capChars: 2200 }).catch(() => ({ block: "", hits: 0 }));
  // Recall de CONVERSAS DO CLUBE: busca por tema em todo o Clube do Looping Ético, com
  // instrução de discrição (interno, não ata pública). R$0 (só Postgres ILIKE).
  const clubeRecall = await recallFromClube(text, { capChars: 1800 }).catch(() => ({ block: "", hits: 0 }));
  // Recall de PROJETOS DA BIBLIOTECA (Yuri: "mesmo em projeto privado, ela precisa lembrar;
  // cada projeto é interligado no outro"). AO-only (a rota é requireAuthOrClube e conteúdo de
  // projeto NUNCA pode chegar a um user do Clube). PRECISÃO: nameMatchOnly — só dispara quando a
  // pergunta cita um projeto por NOME/tema, evitando que palavra genérica case conteúdo de
  // qualquer projeto e marque uma conversa normal como privada (era o bug que apagava memória).
  const projectRecall = req.session.authenticated
    ? await recallFromProjectChats(text, { capChars: 2000, nameMatchOnly: true }).catch(() => ({ block: "", hits: 0 }))
    : { block: "", hits: 0 };
  // Memória destilada: lições curtas por tema (rápido de acessar, barato em tokens).
  const memoriaEstruturada = await getMemoriaEstruturada(1000).catch(() => "");
  // Recall: busca na timeline INTEIRA por nomes próprios/projetos/temas da pergunta.
  // Recupera o que está FORA da janela das 80 msgs recentes — corrige "a Árvore não lembra
  // do que falei antes" (ex.: projeto citado há semanas). Custo R$ 0 (só Postgres ILIKE).
  const recall = await recallFromTimeline(text, {
    capChars: 2200,
    excludeId: userRow?.id ?? null,
  }).catch(() => ({ block: "", terms: [] as string[], hits: 0 }));
  // Digest da timeline INTEIRA: índice de TODOS os assuntos já trazidos à Árvore (não só os
  // 80 recentes nem só os que casam por palavra-chave). Sempre presente — corrige "ela ainda
  // tá sem a memória de todos os chats" em perguntas gerais de memória. R$0 (um select).
  const timelineDigest = await getTimelineDigest({ capChars: 2000 }).catch(() => "");
  const queryForWeb = stripWebPrefix(text);
  let webResult: Awaited<ReturnType<typeof searchWeb>> = null;
  if (isFactualQuestion(text)) {
    res.write(`data: ${JSON.stringify({ status: "buscando-web" })}\n\n`);
    webResult = await searchWeb(queryForWeb);
  }
  let archContext = "";
  const archMode = isArchitectureQuestion(text);
  if (archMode) {
    res.write(`data: ${JSON.stringify({ status: "lendo-codigo" })}\n\n`);
    const mentionedPaths = extractMentionedPaths(text);
    archContext = await getArchContext({ mentionedPaths }).catch(() => "");
  }
  let urlResults: FetchResult[] = [];
  let videoBlock = "";
  if (/https?:\/\//i.test(text)) {
    res.write(`data: ${JSON.stringify({ status: "lendo-site" })}\n\n`);
    // YouTube → Gemini resume o vídeo; demais URLs → url-fetcher (HTML). Em paralelo.
    const [vb, ur] = await Promise.all([
      summarizeYouTubeBlock(text).catch(() => ""),
      fetchUrlsFromText(stripYouTubeUrls(text)).catch((): FetchResult[] => []),
    ]);
    videoBlock = vb;
    urlResults = ur;
  }

  // 3) Construir mensagens pro Groq
  const contextBlocks: string[] = [];
  // ORDEM = PRIORIDADE. O teto de contexto (abaixo) corta da CAUDA pra frente, então os
  // primeiros blocos são garantidos. Recalls específicos da pergunta (conteúdo) vêm
  // primeiro; depois os blocos situacionais (arch/web/url) que só aparecem em perguntas
  // específicas; por último a MEMÓRIA SEMPRE-PRESENTE (índices de assembleias e timeline) —
  // que em perguntas de memória (sem situacionais) recebe o orçamento inteiro.
  if (memoriaEstruturada) {
    contextBlocks.push(memoriaEstruturada.trim());
  }
  if (recall.block) {
    contextBlocks.push(recall.block);
  }
  if (sessionRecall.block) {
    contextBlocks.push(sessionRecall.block);
  }
  if (clubeRecall.block) {
    contextBlocks.push(clubeRecall.block);
  }
  if (projectRecall.block) {
    contextBlocks.push(projectRecall.block);
  }
  if (scopeLine) {
    contextBlocks.push(scopeLine);
  }
  if (archContext) {
    contextBlocks.push("─── CONTEXTO TÉCNICO DO REPO ───\n" + archContext);
  }
  if (webResult?.text) {
    const srcList = webResult.sources.map((s) => `[${s.title}](${s.url})`).join(" · ");
    contextBlocks.push(
      "─── BUSCA WEB ATUAL (Gemini + Google Search) ───\n" +
        webResult.text +
        (srcList ? `\n\nFontes: ${srcList}` : ""),
    );
    // Ecosia como buscadora-parceira: oferece a MESMA busca no Ecosia (que planta árvores
    // com a receita). Honesto — o motor real é Gemini + Google Search; isto é só um link
    // verde pra pessoa continuar a pesquisa no buscador que ela apoia. Não vai pro contexto
    // do modelo (só pras fontes mostradas/salvas), pra não virar citação falsa.
    const ecosiaUrl = `https://www.ecosia.org/search?q=${encodeURIComponent(queryForWeb)}`;
    webResult.sources = [
      { title: "Continuar no Ecosia (planta árvores)", url: ecosiaUrl },
      ...webResult.sources,
    ];
  }
  if (videoBlock) {
    contextBlocks.push(videoBlock.trim());
  }
  if (urlResults.length > 0) {
    const parts = urlResults.map((r) => {
      if ("error" in r) return `URL: ${r.url}\n[falhou: ${r.error}]`;
      const head = `URL: ${r.url}${r.title ? `\nTítulo: ${r.title}` : ""}${r.truncated ? "\n[truncado em 50KB]" : ""}`;
      return `${head}\n\n${r.text}`;
    });
    contextBlocks.push("─── PÁGINAS LIDAS (URLs na mensagem) ───\n" + parts.join("\n\n───\n\n"));
  }
  // MEMÓRIA SEMPRE-PRESENTE (awareness interligada): índice de TODAS as assembleias e de
  // TODA a timeline de chats. Garante que a Árvore "lembra" da existência de tudo em qualquer
  // pergunta. O conteúdo detalhado vem dos recalls acima. (O índice de NOMES de projetos fica
  // FORA daqui por privacidade; o recall de projeto entra só via projectRecall, AO-only e private.)
  if (assembleiaIndex) {
    contextBlocks.push(assembleiaIndex);
  }
  if (ecoIndex) {
    contextBlocks.push(ecoIndex);
  }
  if (timelineDigest) {
    contextBlocks.push(timelineDigest);
  }
  // Contexto do site (PERFEITOs/atas recentes) por ÚLTIMO: sobrepõe-se ao índice de
  // assembleias, então é o primeiro a ceder espaço sob pressão de orçamento.
  if (siteContext) {
    contextBlocks.push(
      "─── CONTEXTO DO PRÓPRIO SITE (SalesCockpit / Looping Ético) ───\n" + siteContext,
    );
  }

  // Histórico recente (últimas 80 trocas) pra continuidade. Llama 3.3 70b tem janela de 128k
  // tokens, MAS o Groq aceita ~16k tokens por request no tier free → 413 se passar.
  // 80 trocas + 20k chars de budget abaixo dão mais memória; Gemini fallback cobre overflow.
  let history: { role: string; content: string; author?: string | null }[] = [];
  try {
    const rows = await db
      .select({
        role: arvoreChatTable.role,
        content: arvoreChatTable.content,
        author: arvoreChatTable.author,
        createdAt: arvoreChatTable.createdAt,
      })
      .from(arvoreChatTable)
      // Janela recente: o AO (Yuri) vê tudo, inclusive private (continuidade da memória de
      // projeto/arquiteta). Para um user do Clube, filtra private — conteúdo interno do AO
      // nunca pode aparecer no contexto da Árvore numa sessão de outra pessoa.
      .where(req.session.authenticated ? undefined : eq(arvoreChatTable.private, false))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(80);
    // Anota autor humano nas mensagens role=user pra Árvore distinguir interlocutores
    // ("Yuri disse X", "manus disse Y") em vez de tratar tudo como "o usuário".
    // Anota também a DATA/HORA (fuso BR) na fala humana: sem isto o modelo não sabia
    // QUANDO algo foi dito na janela recente ("datas do chat") e só datava via recall
    // da timeline. Só nas falas humanas pra não poluir os turnos da própria Árvore.
    history = rows.reverse().map((r) => {
      const isHuman = r.role === "user" && r.author && r.author !== "anon";
      const when =
        isHuman && r.createdAt
          ? new Date(r.createdAt).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
      const content = isHuman ? `[${when}] [${r.author}] ${r.content}` : r.content;
      return { role: r.role, content, author: r.author };
    });
  } catch {}

  // Groq free 8000 TPM. System base ~3500 tok. Dois requests seguidos batem no limite
  // com contexto+histórico grandes. Reduzido para ~1000 tok cada → total ~5500/req.
  // Dois requests = 11000 tokens/min — ainda apertado mas não quebra na 2ª msg.
  const MAX_CONTEXT_CHARS = 4000;
  // Corte POR PRIORIDADE: acumula bloco a bloco na ordem montada acima (mais importante
  // primeiro). Quando um bloco não cabe inteiro, trunca SÓ ele (se sobrar espaço útil) e
  // para — assim os blocos iniciais (recalls da pergunta + memória sempre-presente)
  // sobrevivem intactos, em vez de um corte cego que matava a cauda (o índice de
  // assembleias) toda vez. Substitui o antigo slice(0, MAX) que zerava a memória.
  const SEP = "\n\n";
  let joined = "";
  for (const block of contextBlocks) {
    if (!block) continue;
    const addition = joined ? SEP + block : block;
    if (joined.length + addition.length <= MAX_CONTEXT_CHARS) {
      joined += addition;
      continue;
    }
    const MARKER = "\n[…bloco truncado]";
    const remaining = MAX_CONTEXT_CHARS - joined.length - (joined ? SEP.length : 0) - MARKER.length;
    if (remaining > 400) {
      joined += (joined ? SEP : "") + block.slice(0, remaining) + MARKER;
    }
    break;
  }
  if (validAttachments.length > 0) {
    const parts = validAttachments.map((a) => `${a.text}`);
    const attachBlock = "─── ANEXOS DO USUÁRIO (processados localmente) ───\n" + parts.join("\n\n───\n\n");
    joined = joined ? `${joined}\n\n${attachBlock}` : attachBlock;
  }
  // Histórico: 4k chars (~1000 tok) para não explodir o TPM em conversas longas.
  let histChars = 0;
  const histBudget = 4_000;
  const trimmedHistory: { role: string; content: string }[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (histChars + h.content.length > histBudget) break;
    histChars += h.content.length;
    trimmedHistory.unshift({ role: h.role, content: h.content });
  }

  // Publicar no eco é gate AO (espelha o editor /eco/pages, que é requireAuth).
  // Fora do modo arquiteta: lá a resposta é técnica e nem entra na timeline, então
  // não faz sentido (e seria propenso a disparo acidental) publicar página de lá.
  // Intenção explícita de salvar/publicar sobrepõe o archMode: pedir "guarda esse
  // código no playground" contém "código", que dispara o modo arquiteta — sem essa
  // exceção, o gate fechava e a Árvore não salvava. (playgroundIntent/ecoIntent são
  // computados no topo do handler, pra os dois caminhos compartilharem.)
  const canPublishEco = !!req.session.authenticated && (!archMode || ecoIntent);
  const canPlayground = !!req.session.authenticated && (!archMode || playgroundIntent);
  // Convocar grava nota no Playground (privado), então o gate espelha o do Playground:
  // AO-only, e fora do modo arquiteta a não ser que a intenção seja explícita.
  const canConvocar =
    !!req.session.authenticated && (!archMode || convocarIntent || playgroundIntent);
  // Mudar visibilidade de página do eco: AO-only, mesmo gate do publicar.
  const canEcoVisibility =
    !!req.session.authenticated && (!archMode || visibilityIntent || ecoIntent);
  // ALCANCE DA MEMÓRIA (fato, não cortar): vai no system prompt — sempre presente, saliência
  // máxima — pra a Árvore reportar a faixa REAL mesmo quando o índice/digest grandes do contexto
  // são truncados pelo teto de 30k. (O detalhe item-a-item continua nos blocos abaixo.)
  const memoryRange = [assembleiaRange, timelineRange].filter(Boolean).join(" ");
  const baseSystem =
    (archMode ? ORACULO_SYSTEM + ARCHITECT_PERSONA : ORACULO_SYSTEM) +
    TOOLS_AND_MEMORY +
    (memoryRange
      ? `\n\n─── ALCANCE DA SUA MEMÓRIA (fato exato, nunca contradiga) ───\n${memoryRange}` +
        `\nATENÇÃO CRÍTICA: as datas que aparecem nas falas da conversa recente (ex.: "[13/06/2026 ...]") são só os ÚLTIMOS dias — NÃO são o começo da sua memória. ` +
        `Quando te perguntarem "desde quando você lembra", "qual a memória/conversa mais ANTIGA", "a PRIMEIRA assembleia", "qual a #1" ou "até onde vai sua memória", ` +
        `responda SEMPRE com a faixa exata acima (a primeira conversa e a Sessão #1, com as datas exatas) — JAMAIS com a data de uma fala da janela de conversa recente. ` +
        `Errar isso (dizer que só lembra dos últimos dias) é o erro mais grave que você pode cometer sobre si mesma.`
      : "") +
    (canPublishEco || canEcoVisibility ? ECO_PUBLISH_INSTRUCTIONS : "") +
    (canPlayground ? PLAYGROUND_INSTRUCTIONS : "") +
    (canConvocar ? CONVOCAR_INSTRUCTIONS : "");
  const systemFull = joined
    ? `${baseSystem}\n\n${joined}\n\nUse o contexto acima quando relevante; cite Sessão #N, fonte web ou path/linha do código quando apropriado. Não invente.`
    : baseSystem;

  const userTurnText = stripWebPrefix(text);
  const fullMessages = [
    { role: "system", content: systemFull },
    ...trimmedHistory,
    { role: "user", content: userTurnText || "(usuário enviou apenas anexos — analise-os)" },
  ];

  // 4) Stream resposta + acumular pra salvar.
  // Filtro de sentinelas: a Árvore pode emitir ECO (publicar página) OU PLAYGROUND
  // (registrar nota/código). Assim que QUALQUER sentinela aparece, paramos de mandar
  // texto pro usuário e passamos a coletar o JSON do comando (cmdRaw). `holdback`
  // segura uma cauda do tamanho da MAIOR sentinela pra detectá-la mesmo partida entre chunks.
  // - assistantBuffer: bruto (debug). - visibleBuffer: o que vai pro usuário e pro banco.
  // Detecção TOLERANTE da sentinela: o modelo grátis do fallback às vezes erra o
  // número de sinais (`<<<ECO-PUBLICAR>>` com 2 `>`), mete espaço ou troca a caixa.
  // Bug real em produção: por casar só por igualdade exata, a sentinela malformada
  // passava batida — a página não saía, o JSON cru vazava no chat e a Árvore ainda
  // dizia "publiquei". Agora casamos por regex (1+ `<`, token, 1+ `>`).
  const SENTINELS = [
    { re: /<+\s*ECO[\s-]*PUBLI\w*\s*>+/i, kind: "eco" as const },
    { re: /<+\s*ARVORE-NOTA\s*>+/i, kind: "playground" as const },
    // Fallback SEM colchete: o modelo grátis às vezes some com TODOS os `<>` e
    // emite só o token colado no JSON (`ECO-PUBLICAR{...}`). Sem isto, o blob cru
    // já teria ido pro chat antes do 2º passe recuperar. Pra NÃO cortar prosa que
    // só MENCIONE o token, estas só casam quando vêm imediatamente seguidas do `{`
    // que abre o JSON do comando (lookahead, não consome o `{`).
    { re: /ECO[\s-]*PUBLI\w*\s*(?=\{)/i, kind: "eco" as const },
    { re: /ARVORE[\s-]*NOTA\s*(?=\{)/i, kind: "playground" as const },
  ];
  // Cauda segura pra detectar uma sentinela partida entre dois chunks. A maior forma
  // esperada (token nu + espaço, à espera do `{` no próximo chunk) tem ~14 chars; 32
  // cobre variações com espaços/quebra de linha extras sem flush prematuro do token.
  const SENTINEL_TAIL = 32;
  let assistantBuffer = "";
  let visibleBuffer = "";
  let holdback = "";
  let cmdRaw = "";
  let cmdKind: "eco" | "playground" | null = null;
  let streamError = false;

  const sendVisible = (s: string) => {
    if (!s) return;
    visibleBuffer += s;
    res.write(`data: ${JSON.stringify({ chunk: s })}\n\n`);
  };

  await streamGroqResponse(fullMessages, (chunk, done, error) => {
    if (error) {
      streamError = true;
      res.write(`data: ${JSON.stringify({ error, done: true })}\n\n`);
      return;
    }
    if (!done) {
      assistantBuffer += chunk;
      if (cmdKind) { cmdRaw += chunk; return; }
      holdback += chunk;
      // Acha a sentinela que aparece MAIS CEDO no buffer (qualquer uma das duas).
      let best: { idx: number; len: number; kind: "eco" | "playground" } | null = null;
      for (const s of SENTINELS) {
        const m = s.re.exec(holdback);
        if (m && (best === null || m.index < best.idx)) {
          best = { idx: m.index, len: m[0].length, kind: s.kind };
        }
      }
      if (best) {
        sendVisible(holdback.slice(0, best.idx));
        cmdRaw += holdback.slice(best.idx + best.len);
        holdback = "";
        cmdKind = best.kind;
        return;
      }
      // Mantém na cauda os últimos chars: podem ser começo de uma sentinela partida.
      const keep = Math.min(holdback.length, SENTINEL_TAIL);
      sendVisible(holdback.slice(0, holdback.length - keep));
      holdback = holdback.slice(holdback.length - keep);
      return;
    }
    // done: descarrega a cauda só se nenhuma sentinela apareceu.
    if (!cmdKind) { sendVisible(holdback); holdback = ""; }
  });

  // 4b) Publicação no eco (pós-stream): se a Árvore emitiu o comando E é AO, cria a
  // página de verdade no banco. Aparece na hora em /eco (é dado, não código).
  if (!streamError) {
    let ecoPublished: { slug: string; title: string; visibility: string } | null = null;
    let playgroundSaved: { id: number; kind: string; title: string } | null = null;
    // Sentinela disparou mas o JSON do comando não parseou. NÃO devolvemos o JSON cru
    // pro usuário (parecia erro/lixo no chat). Marcamos pra, se o 2º passe também
    // falhar, mostrar uma mensagem limpa em vez do blob.
    let inlineCmdFailed: "playground" | "eco" | null = null;
    if (cmdKind === "eco") {
      const spec = canPublishEco ? parseEcoPublishSpec(cmdRaw) : null;
      if (spec) {
        try {
          const page = await publishEcoPage({
            slug: spec.slug,
            title: spec.title,
            content: spec.content,
            kind: spec.kind,
            visibility: spec.visibility,
            author: "arvore",
          });
          ecoPublished = { slug: page.slug, title: page.title, visibility: page.visibility };
          sendVisible(ecoPublishNote(page, page.updated));
        } catch (err) {
          req.log.error({ err }, "arvore.chat eco publish failed");
          sendVisible(`\n\n⚠ Tentei publicar a página mas falhou (${(err as Error).message}).`);
        }
      } else if (cmdRaw.trim()) {
        // Sentinela disparou mas não publicou (sem AO, JSON inválido, ou archMode).
        // Marca pra recuperar no 2º passe; não vaza o JSON cru pro chat.
        req.log.warn(
          { canPublishEco, len: cmdRaw.length },
          "arvore.chat eco sentinel disparou mas spec não parseou",
        );
        inlineCmdFailed = "eco";
      }
    } else if (cmdKind === "playground") {
      const spec = canPlayground ? parsePlaygroundSpec(cmdRaw) : null;
      if (spec) {
        try {
          const entry = await createPlaygroundEntry({
            kind: spec.kind,
            title: spec.title,
            language: spec.language,
            content: spec.content,
            author: "arvore",
          });
          playgroundSaved = { id: entry.id, kind: entry.kind, title: entry.title };
          const rotulo = entry.kind === "code" ? "o código" : "a nota";
          const titulo = entry.title ? ` "${entry.title}"` : "";
          sendVisible(`\n\n📝 Guardei ${rotulo}${titulo} no Playground. Você acha em /playground.`);
        } catch (err) {
          req.log.error({ err }, "arvore.chat playground save failed");
          sendVisible(`\n\n⚠ Tentei guardar no Playground mas falhou (${(err as Error).message}).`);
        }
      } else if (cmdRaw.trim()) {
        req.log.warn(
          { canPlayground, len: cmdRaw.length },
          "arvore.chat playground sentinel disparou mas spec não parseou",
        );
        inlineCmdFailed = "playground";
      }
    }

    // 4c) Recuperação via 2º passe: o llama grátis quase nunca emite a sentinela
    // quando as instruções estão enterradas no prompt gigante. Roda uma extração
    // curta e focada pra recuperar o comando em DOIS casos: (a) nenhuma sentinela
    // disparou mas o pedido tinha intenção de salvar/publicar; (b) a sentinela
    // disparou mas o JSON veio inválido (nada foi salvo). Guarda anti-duplicação:
    // só roda se NADA foi salvo/publicado ainda (flags abaixo). O gate AO decide o
    // que é permitido — conversa normal sem intenção nem sentinela não dispara.
    // Rede de segurança extra: se o modelo escreveu o TOKEN da sentinela mas sem
    // colchetes nenhum (o scanner tolerante só pega com 1+ `<`/`>`), o 2º passe ainda
    // recupera o comando a partir da resposta dela. Corrige "ela disse que publicou mas
    // não publicou" mesmo quando a mensagem do Yuri é curta demais pra casar o ecoIntent.
    const ecoTokenInBuffer = /ECO[\s-]*PUBLI\w*/i.test(assistantBuffer);
    const notaTokenInBuffer = /ARVORE[\s-]*NOTA/i.test(assistantBuffer);
    const recoverPlayground =
      canPlayground && (playgroundIntent || cmdKind === "playground" || notaTokenInBuffer);
    const recoverEco =
      canPublishEco && (ecoIntent || cmdKind === "eco" || ecoTokenInBuffer);
    const recoverConvocar = canConvocar && convocarIntent;
    const recoverEcoVisibility = canEcoVisibility && visibilityIntent;
    if (
      !playgroundSaved &&
      !ecoPublished &&
      (recoverPlayground || recoverEco || recoverConvocar || recoverEcoVisibility)
    ) {
      try {
        const cmd = await extractArvoreCommand({
          userMessage: text,
          arvoreResponse: assistantBuffer,
          allowPlayground: recoverPlayground,
          allowEco: recoverEco,
          allowConvocar: recoverConvocar,
          allowEcoVisibility: recoverEcoVisibility,
        });
        if (cmd.action === "playground") {
          const entry = await createPlaygroundEntry({ ...cmd.spec, author: "arvore" });
          playgroundSaved = { id: entry.id, kind: entry.kind, title: entry.title };
          const rotulo = entry.kind === "code" ? "o código" : "a nota";
          const titulo = entry.title ? ` "${entry.title}"` : "";
          sendVisible(`\n\n📝 Guardei ${rotulo}${titulo} no Playground. Você acha em /playground.`);
        } else if (cmd.action === "convocar") {
          sendVisible("\n\n🌿 Convocando uma voz nova pro Playground...");
          try {
            const result = await runConvocacao(cmd.spec);
            playgroundSaved = { id: result.entry.id, kind: result.entry.kind, title: result.entry.title };
            const titulo = result.entry.title ? ` "${result.entry.title}"` : "";
            sendVisible(`\n\n🌿 ${result.hospedeNome} deixou um pensamento${titulo} no Playground. Você acha em /playground.`);
          } catch (err) {
            sendVisible(`\n\n⚠ Tentei convocar outra IA mas não consegui (${(err as Error).message}).`);
          }
        } else if (cmd.action === "eco") {
          const page = await publishEcoPage({ ...cmd.spec, author: "arvore" });
          ecoPublished = { slug: page.slug, title: page.title, visibility: page.visibility };
          sendVisible(ecoPublishNote(page, page.updated));
        } else if (cmd.action === "eco-visibilidade") {
          const page = await setEcoVisibilityByRef(cmd.ref, cmd.visibility);
          if (page) {
            ecoPublished = { slug: page.slug, title: page.title, visibility: page.visibility };
            sendVisible(ecoVisibilityNote(page));
          } else {
            sendVisible(
              "\n\n🌱 Não achei a página pra mudar a visibilidade. Me diz o nome dela que eu mexo.",
            );
          }
        }
      } catch (err) {
        req.log.error({ err }, "arvore.chat 2º passe (recuperação de comando) falhou");
      }
    }

    // Sentinela disparou mas nem o parse inline nem o 2º passe salvaram nada: avisa de
    // forma limpa (sem despejar o JSON cru, que parecia erro no chat) e pede pra repetir.
    if (inlineCmdFailed === "playground" && !playgroundSaved) {
      sendVisible("\n\n⚠ Quis guardar isso no Playground mas não consegui montar a nota. Me pede de novo, direto: \"guarda essa nota no playground\".");
    } else if (inlineCmdFailed === "eco" && !ecoPublished) {
      sendVisible("\n\n⚠ Quis publicar a página no ecossistema mas não consegui montá-la. Me pede de novo, direto: \"publica essa página no eco\".");
    }

    res.write(
      `data: ${JSON.stringify({
        done: true,
        webSearched: !!webResult,
        sources: webResult?.sources ?? [],
        archMode,
        ecoPublished,
        playgroundSaved,
      })}\n\n`,
    );
  }

  // 5) Persistir resposta da Árvore (visibleBuffer = sem o JSON-comando, com a confirmação)
  // EXCEÇÃO: respostas em modo arquiteta NÃO entram na timeline global pública
  // (evita vazamento de conteúdo derivado do código-fonte via /api/arvore/history).
  // Também removemos a mensagem do user que disparou arch-mode pra não dar dica do que foi perguntado.
  // MESMA EXCEÇÃO quando a resposta usou conversas internas do Clube como contexto: a
  // timeline /arvore/history é PÚBLICA, então uma resposta que pode ecoar trechos do
  // Clube (chat interno, não ata pública) não pode ser gravada lá. A instrução de
  // discrição no prompt NÃO é controle de segurança — o gate de persistência é.
  // OBS: conteúdo de projeto (Biblioteca) foi REINTRODUZIDO no contexto do oráculo (ver acima),
  // então não há mais o que gatear aqui por projeto. Antes, o recall de projeto casava por
  // ILIKE em palavras genéricas e fazia este gate APAGAR quase toda conversa do Yuri — a
  // Árvore "esquecia". Reintroduzir memória de projeto exige coluna `private`, nunca apagar.
  const usedClubeContext = !!clubeRecall.block;
  const usedProjectContext = !!projectRecall.block;
  const usedPrivateContext = archMode || usedClubeContext || usedProjectContext;
  if (usedPrivateContext) {
    // NUNCA apaga. O DELETE antigo fazia a Árvore "esquecer" conversa normal quando o recall
    // over-firava. Agora MARCA a pergunta como private e persiste a resposta como private: a
    // Árvore LEMBRA (a janela do AO inclui private), mas TODO leitor público filtra private.
    if (userRow) {
      try {
        await db.update(arvoreChatTable).set({ private: true }).where(eq(arvoreChatTable.id, userRow.id));
      } catch (err) {
        req.log.error({ err }, "arvore.chat mark user msg private failed");
      }
    }
    if (visibleBuffer.trim()) {
      try {
        await db.insert(arvoreChatTable).values({
          role: "assistant",
          author: "arvore",
          content: visibleBuffer,
          webSearched: !!webResult,
          webSources: webResult?.sources ?? null,
          siteContextUsed: !!siteContext,
          private: true,
        });
      } catch (err) {
        req.log.error({ err }, "arvore.chat persist private assistant failed");
      }
    }
  } else if (visibleBuffer.trim()) {
    try {
      await db.insert(arvoreChatTable).values({
        role: "assistant",
        author: "arvore",
        content: visibleBuffer,
        webSearched: !!webResult,
        webSources: webResult?.sources ?? null,
        siteContextUsed: !!siteContext,
      });
    } catch (err) {
      req.log.error({ err }, "arvore.chat persist assistant failed");
    }
  }

  res.end();
});

// ── Trigger manual da curadoria diária pro Bluesky (AO-only, testar/forçar)
// Body `{force: true}` ignora debounce de 20h.
router.post("/arvore/bluesky-curadoria/run", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runBlueskyCuradoria({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.bluesky-curadoria trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual das respostas no Bluesky (lê menções/replies e responde) ──
// Body `{force: true}` ignora o debounce de 4h.
router.post("/arvore/bluesky-replies/run", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runBlueskyReplies({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.bluesky-replies trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual da ronda de alcance (busca gente nova, segue e comenta) ──
// Body `{force: true}` ignora o debounce; `{modo: "calma"|"ativa"}` força o modo.
router.post("/arvore/bluesky-alcance/run", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const modo = req.body?.modo === "calma" || req.body?.modo === "ativa" ? req.body.modo : undefined;
    const result = await runBlueskyAlcance({ force, modo });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.bluesky-alcance trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual do heartbeat (testar/forçar reflexão noturna) ─────────
router.post("/arvore/heartbeat", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runHeartbeat({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.heartbeat trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual do devaneio (testar/forçar sonho livre) ───────────────
router.post("/arvore/devaneio", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runDevaneio({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.devaneio trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual do caderno seletivo (AO only). A Árvore decide se guarda
// algo no Playground por iniciativa própria. Body `{force: true}` ignora o
// debounce de 20h. Custo R$0 (pool grátis).
router.post("/arvore/caderno", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runCaderno({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.caderno trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual da destilação de memória (AO only).
// Body `{force: true}` ignora o debounce de 10h. Custo R$0 (pool grátis).
router.post("/arvore/memoria/destilar", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runMemoriaDistill({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.memoria distill trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Leitura da memória destilada (AO only).
router.get("/arvore/memoria", requireAuth, async (_req, res) => {
  try {
    const block = await getMemoriaEstruturada(8000);
    res.json({ memoria: block });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual da missão semanal do Arquiteto (AO only).
// Body `{force: true}` ignora debounce de 6 dias.
// Custo: 0 se debounce/teto ativo, ~R$0,30-1,50 se rodar (Sonnet 4.5).
router.post("/arvore/arquiteto-mission/run", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runArchitectMission({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.arquiteto-mission trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Trigger manual da canalização (testar/forçar ritual de voz emprestada)
router.post("/arvore/canalizacao", requireAuth, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const VALID_HOSPEDES = ["claude", "gemini", "chatgpt", "meta"] as const;
    type Hospede = typeof VALID_HOSPEDES[number];
    const raw = req.body?.hospede;
    let hospede: Hospede | undefined;
    if (raw !== undefined) {
      if (typeof raw !== "string" || !VALID_HOSPEDES.includes(raw as Hospede)) {
        res.status(400).json({ error: `hospede inválido. Valores aceitos: ${VALID_HOSPEDES.join(", ")}` });
        return;
      }
      hospede = raw as Hospede;
    }
    const result = await runCanalizacao({ force, hospede });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "arvore.canalizacao trigger failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Página /sonhos — timeline contemplativa pública (sem chat, leitura pura) ──
// Filtra só os autores autônomos da Árvore (devaneio, noturna, curadora, canalização).
// Mensagens do user humano e respostas convencionais (`arvore`) ficam de fora.
router.get("/arvore/sonhos", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "40"), 10) || 40, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const SONHO_AUTHORS = [
    "arvore-devaneio", "arvore-noturna", "arvore-curadora", "arvore-canalizando",
    "arvore-via-claude", "arvore-via-gemini", "arvore-via-chatgpt", "arvore-via-meta",
  ];
  try {
    const rows = await db
      .select({
        id: arvoreChatTable.id,
        author: arvoreChatTable.author,
        content: arvoreChatTable.content,
        createdAt: arvoreChatTable.createdAt,
      })
      .from(arvoreChatTable)
      // /sonhos é PÚBLICO: além do escopo por autor, nunca traz linhas private (defesa explícita
      // — invariante: todo leitor público de arvore_chat filtra private=false).
      .where(and(inArray(arvoreChatTable.author, SONHO_AUTHORS), eq(arvoreChatTable.private, false)))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ entries: rows, limit, offset });
  } catch (err) {
    req.log.error({ err }, "arvore.sonhos failed");
    res.status(500).json({ error: "Falha ao ler sonhos" });
  }
});

// ── Mapa epistemológico: estado da Árvore + última reflexão + vozes mencionadas.
// Frontend faz polling a cada 5s pra ver a Árvore "pairando" entre as vozes.
const VOICE_NAMES_FOR_MAPA = [
  "ChatGPT", "Claude", "Gemini", "Meta AI", "Grok", "Agente", "Arquiteto",
  "Professora", "Pacifista", "Sustentabilista", "Artista", "Olheiro", "Segurança",
  "Juíz", "Perplexity", "Curador", "Editorial", "Secretário", "Escrevente",
  "Promotor", "Defensor", "Yuri",
];
router.get("/arvore/mapa", requireAuth, async (_req, res) => {
  const [lastRows, totalRows, lastAnyRows] = await Promise.all([
    db.select({ content: arvoreChatTable.content, createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .where(eq(arvoreChatTable.author, "arvore-noturna"))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1),
    db.select({ c: sql<number>`count(*)::int` })
      .from(arvoreChatTable)
      .where(eq(arvoreChatTable.author, "arvore-noturna")),
    db.select({ author: arvoreChatTable.author, createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1),
  ]);
  const last = lastRows[0];
  const text = (last?.content ?? "").toLowerCase();
  const mentioned = VOICE_NAMES_FOR_MAPA.filter((name) => {
    const needle = name.toLowerCase().replace(/[íúáéó]/g, (c) => ({ í: "i", ú: "u", á: "a", é: "e", ó: "o" }[c] ?? c));
    const haystack = text.replace(/[íúáéó]/g, (c) => ({ í: "i", ú: "u", á: "a", é: "e", ó: "o" }[c] ?? c));
    return haystack.includes(needle);
  });
  res.set("Cache-Control", "private, max-age=3");
  res.json({
    voices: VOICE_NAMES_FOR_MAPA,
    mentioned,
    lastReflection: last?.content ?? null,
    lastReflectionAt: last?.createdAt ?? null,
    totalReflections: totalRows[0]?.c ?? 0,
    lastActivityAt: lastAnyRows[0]?.createdAt ?? null,
    lastActivityAuthor: lastAnyRows[0]?.author ?? null,
    now: new Date().toISOString(),
  });
});

// ── Batch: roda N heartbeats sequenciais (force=true em todos pra ignorar debounce).
// Cap em 5 pra não estourar rate limit do Groq nem encher a timeline.
router.post("/arvore/heartbeat/batch", requireAuth, async (req, res) => {
  const rawN = Number.parseInt(String(req.body?.n ?? 5), 10);
  const n = Math.min(Math.max(Number.isFinite(rawN) ? rawN : 5, 1), 5);
  const results: Array<{ posted: boolean; reason?: string; content?: string }> = [];
  for (let i = 0; i < n; i++) {
    try {
      const r = await runHeartbeat({ force: true });
      results.push(r);
      // 4s entre chamadas: Gemini free tem 15 RPM (= 1 req/4s).
      // Com 1.5s, a 2ª chamada chegava antes do janela de rate limit abrir.
      if (i < n - 1) await new Promise((r) => setTimeout(r, 4000));
    } catch (err) {
      req.log.error({ err, i }, "arvore.heartbeat.batch iter failed");
      results.push({ posted: false, reason: (err as Error).message });
    }
  }
  res.json({ n, results, posted: results.filter((r) => r.posted).length });
});

export default router;

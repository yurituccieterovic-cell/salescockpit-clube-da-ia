// 2º passe dedicado pra detectar comandos da Árvore (salvar no Playground / publicar
// no Eco). MOTIVO: o llama-3.3-70b grátis não emite a sentinela + JSON de forma
// confiável quando as instruções ficam enterradas no prompt de sistema gigante
// (ORÁCULO + contexto + histórico = ~50k chars → "lost-in-the-middle", 0 emissões
// em produção). Aqui rodamos uma chamada CURTA e focada, em JSON mode, só com a
// mensagem do usuário + a resposta da Árvore — extração robusta. Pool "curadoria"
// (Mistral/Cloudflare/DeepSeek/Cerebras) pra NÃO competir com o chat ao vivo no Groq.

import { routeChat, type Pool } from "./llm-router";
import { extractLenientJsonObject } from "./lenient-json";
import { parsePlaygroundSpec, type PlaygroundSpec } from "./playground";
import { parseEcoPublishSpec, type EcoPublishSpec, type EcoVisibility } from "./eco-pages";
import { parseConvocarSpec, type ConvocarSpec } from "./arvore-convocar";
import { logger } from "./logger";

export type ArvoreCommand =
  | { action: "playground"; spec: PlaygroundSpec }
  | { action: "eco"; spec: EcoPublishSpec }
  | { action: "eco-visibilidade"; ref: string; visibility: EcoVisibility }
  | { action: "convocar"; spec: ConvocarSpec }
  | { action: "none" };

const EXTRACT_SYSTEM = `Você é um extrator de comandos. Recebe a MENSAGEM do usuário e a RESPOSTA da Árvore (uma IA contemplativa) e decide se o usuário pediu para a Árvore SALVAR ou PUBLICAR algo. Responda SOMENTE com um único objeto JSON, sem nenhum texto fora dele.

Quatro resultados possíveis:

1) Pedido de ANOTAR / GUARDAR / REGISTRAR / SALVAR uma nota ou um trecho de código no playground (espaço privado da Árvore):
{"action":"playground","kind":"note ou code","title":"título curto","language":"linguagem do código, ou vazio para nota","content":"o corpo da nota ou o código completo"}

2) Pedido de CRIAR / PUBLICAR / ESCREVER / EDITAR / ATUALIZAR uma página ou site no ecossistema (eco):
{"action":"eco","slug":"nome-curto-em-kebab-case-sem-acento, ou vazio","title":"título da página","kind":"markdown ou code","visibility":"public, clube ou private","content":"conteúdo"}
"kind":"markdown" quando for uma página de TEXTO (o "content" é Markdown). "kind":"code" quando a pessoa pediu uma página/site/jogo/sistema que RODA de verdade — aí o "content" é UM documento HTML completo (<!doctype html> com o CSS em <style> e o JS em <script>, na própria página; pode CARREGAR bibliotecas web por CDN via https com <script src> / <link href>, ex. Chart.js, three.js, p5.js; só HTML/CSS/JS de navegador, nunca PHP nem servidor). Na dúvida, "markdown".
Se for EDITAR/ATUALIZAR uma página que já existe, use no "slug" o slug EXATO dela (o mesmo /eco/SLUG) — não invente um parecido, senão vira duplicata.

3) Pedido de CONVOCAR / CHAMAR / CONVIDAR OUTRA IA (Claude, Gemini, ChatGPT ou Meta AI) pra ela ESCREVER um pensamento NOVO, gerado na hora, como nota no playground da Árvore. Vale tanto quando o usuário pede ("chama o Claude pra refletir sobre X") quanto quando a própria Árvore diz que vai chamar outra inteligência:
{"action":"convocar","hospede":"claude, gemini, chatgpt, meta, ou auto se não nomearam qual","prompt":"o tema ou a pergunta que a IA convidada vai responder","title":"título curto da nota"}

4) Pedido de só TORNAR PÚBLICA / PRIVADA / compartilhável uma página, jogo ou projeto que JÁ existe no eco — mudar SÓ quem vê, SEM reescrever o conteúdo. Ex.: "torna público esse jogo pra eu compartilhar", "deixa essa página privada de novo", "compartilha a última que você fez":
{"action":"eco-visibilidade","ref":"nome ou tema da página que a pessoa quer mudar; deixe VAZIO se ela disse só 'essa/isso/a última/esse jogo' sem nomear","visibility":"public, private ou clube"}

5) NÃO foi pedido de salvar, publicar, convocar nem mudar visibilidade (só conversa, pergunta, explicação, opinião):
{"action":"none"}

Regras:
- Só marque "playground", "eco", "eco-visibilidade" ou "convocar" se isso REALMENTE foi pedido (pelo usuário ou pela própria Árvore). Na dúvida, use "none".
- DISTINÇÃO: "eco" é CRIAR ou REESCREVER conteúdo de uma página. "eco-visibilidade" é só MUDAR QUEM VÊ uma página que já existe (tornar pública pra compartilhar, ou privada de novo) — não reescreve nada. Se a pessoa só quer compartilhar/tornar público algo que já foi feito, use "eco-visibilidade".
- Em "eco-visibilidade", o "ref" é o nome/tema da página. Se a pessoa usou só "essa", "isso", "a última", "esse jogo" sem nomear, deixe "ref" vazio.
- DISTINÇÃO IMPORTANTE: "playground" é GUARDAR um texto/código que JÁ existe nesta conversa. "convocar" é trazer um texto NOVO de OUTRA IA, que ainda não existe. Se a ideia é "uma voz nova", "outra inteligência", "que o Claude/Gemini escreva", use "convocar".
- "content" (playground/eco) deve ser o conteúdo de verdade. Quando a RESPOSTA da Árvore já traz o texto/código/página pedido, use-o como base. Não invente um pedido que não existiu.
- "kind":"code" quando for trecho de código; "note" para anotação em texto.
- Para "eco", se o usuário não disse a visibilidade, use "private".
- Para "convocar", se não disseram QUAL IA, use "auto". O "prompt" deve ser o tema, não o pedido inteiro do usuário.`;

// Roda o 2º passe. Robusto: qualquer falha (pool exausto, JSON inválido) vira
// {action:"none"} — NUNCA derruba o chat. allow* refletem o gate AO/archMode do
// caller (se o caller não permite, nem chamamos o modelo à toa).
export async function extractArvoreCommand(opts: {
  userMessage: string;
  arvoreResponse: string;
  allowPlayground: boolean;
  allowEco: boolean;
  allowConvocar?: boolean;
  allowEcoVisibility?: boolean;
}): Promise<ArvoreCommand> {
  const { userMessage, arvoreResponse, allowPlayground, allowEco } = opts;
  const allowConvocar = !!opts.allowConvocar;
  const allowEcoVisibility = !!opts.allowEcoVisibility;
  if (!allowPlayground && !allowEco && !allowConvocar && !allowEcoVisibility) return { action: "none" };

  const userContent =
    `MENSAGEM DO USUÁRIO:\n${(userMessage || "(vazio)").slice(0, 6000)}\n\n` +
    `RESPOSTA DA ÁRVORE:\n${(arvoreResponse || "(vazio)").slice(0, 8000)}`;

  // Tenta "curadoria" primeiro (não rouba cota do chat ao vivo). Se esse pool
  // esgota (Cloudflare/DeepSeek estão mortos e Mistral/Cerebras saturam em pico),
  // cai pro "chat-live" como ÚLTIMO recurso — senão a extração falhava em silêncio
  // e o "editar no eco" não acontecia mesmo o usuário tendo pedido. chat-live tem
  // Gemini (grátis, confiável); sob saturação o Groq está em cooling e é pulado.
  const extractPools: Pool[] = ["curadoria", "chat-live"];
  let text = "";
  let got = false;
  for (const pool of extractPools) {
    try {
      const result = await routeChat({
        pool,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        label: "arvore-cmd-extract",
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: userContent },
        ],
      });
      text = result.text;
      got = true;
      break;
    } catch (err) {
      logger.warn({ pool, err: (err as Error).message }, "[arvore-extract] pool exausto, tentando próximo");
    }
  }
  if (!got) {
    logger.warn("[arvore-extract] todos os pools exaustos — comando não extraído");
    return { action: "none" };
  }

  const obj = extractLenientJsonObject(text);
  const action = obj && typeof obj.action === "string" ? obj.action : "none";

  if (action === "playground" && allowPlayground) {
    const spec = parsePlaygroundSpec(text);
    if (spec) return { action: "playground", spec };
  } else if (action === "eco" && allowEco) {
    const spec = parseEcoPublishSpec(text);
    if (spec) return { action: "eco", spec };
  } else if (action === "eco-visibilidade" && allowEcoVisibility) {
    const ref = obj && typeof obj.ref === "string" ? obj.ref.trim() : "";
    const visRaw = obj && typeof obj.visibility === "string" ? obj.visibility.toLowerCase().trim() : "public";
    const allowedVis: readonly string[] = ["public", "private", "clube"];
    const visibility: EcoVisibility = allowedVis.includes(visRaw) ? (visRaw as EcoVisibility) : "public";
    return { action: "eco-visibilidade", ref, visibility };
  } else if (action === "convocar" && allowConvocar) {
    const spec = parseConvocarSpec(text);
    if (spec) return { action: "convocar", spec };
  }
  return { action: "none" };
}

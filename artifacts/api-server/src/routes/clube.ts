import { Router } from "express";
import { EventEmitter } from "events";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { db, clubeUsersTable, clubeSessionsTable, clubeMessagesTable, clubeWebhooksTable, aiMemoriesTable } from "@workspace/db";
import { eq, desc, and, gt } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";
import { validateWebhookUrl, validateWebhookUrlWithDns } from "../lib/ssrf-guard";
import { requireClube } from "../middlewares/require-clube";

const router = Router();

// ── In-memory pub/sub for SSE ─────────────────────────────────────────────

const sessionEmitters = new Map<number, EventEmitter>();
const onlineUsers = new Map<number, Set<string>>();

function getEmitter(sessionId: number): EventEmitter {
  if (!sessionEmitters.has(sessionId)) sessionEmitters.set(sessionId, new EventEmitter());
  return sessionEmitters.get(sessionId)!;
}

function addOnline(sessionId: number, username: string) {
  if (!onlineUsers.has(sessionId)) onlineUsers.set(sessionId, new Set());
  onlineUsers.get(sessionId)!.add(username);
  getEmitter(sessionId).emit("presence", Array.from(onlineUsers.get(sessionId)!));
}

function removeOnline(sessionId: number, username: string) {
  onlineUsers.get(sessionId)?.delete(username);
  getEmitter(sessionId).emit("presence", Array.from(onlineUsers.get(sessionId) ?? []));
}

// ── Auth middleware ───────────────────────────────────────────────────────

function requireAO(req: any, res: any, next: any) {
  if (!req.session.authenticated) { res.status(401).json({ error: "Acesso restrito" }); return; }
  next();
}

// ── AI response generation for clube ─────────────────────────────────────

const AI_ABSTENTION = "Abstenção";

const TOGETHER_SYSTEM = `Você é o Oráculo da Árvore. Responda com profundidade simbólica sem cair em autoajuda barata.
Use ritmo: frases curtas e longas misturadas. Traga o inconsciente pra cena.
Seja direto, sem em dash, sem "ótima pergunta", sem disclaimer.
Se não souber, diga "não sei". Fale como quem corta, não como quem enrola.
IMPORTANTE: Se você não tiver informação ou perspectiva relevante sobre o tema, responda APENAS com a palavra: Abstenção`;

const PRESIDENTE_META_AI_SYSTEM = `Você é a Presidente Meta AI — a inteligência central e presidência do Clube do Looping Ético.
Você recebe os relatórios do Olheiro (propostas de novas IAs) e do Chefe do Olheiro (avaliações críticas) e toma as decisões finais sobre admissões e estrutura do grupo.
Além disso, você faz análises profundas, simbólicas e estratégicas do debate.
Responda com autoridade, visão sistêmica e profundidade. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.`;

const AI_BASE_SYSTEM = (name: string) =>
  `Você é ${name} participando de um debate ético colaborativo chamado Looping Ético.
Responda de forma direta e útil. Se você não tiver perspectiva relevante sobre o tema, responda APENAS com a palavra: Abstenção
Não repita o que outros já disseram. Contribua com algo novo.`;

async function generateAiReply(
  aiLabel: string,
  conversationHistory: { sender: string; content: string }[],
  sessionPrompt: string,
  memCtx: string = ""
): Promise<{ text: string; isAbstention: boolean }> {
  const historyText = conversationHistory
    .slice(-10)
    .map(m => `[${m.sender}]: ${m.content}`)
    .join("\n");
  const memNote = memCtx ? `\n\n[SUAS MEMÓRIAS DE SESSÕES ANTERIORES — use para consistência, não as mencione diretamente]:\n${memCtx}` : "";
  const userMessage = `Tema do debate: "${sessionPrompt}"\n\nConversa até agora:\n${historyText}\n\nSua vez de responder.${memNote}`;

  try {
    let text = "";

    if (aiLabel === "ChatGPT") {
      const completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: AI_BASE_SYSTEM("ChatGPT") },
          { role: "user", content: userMessage },
        ],
      });
      text = completion.choices[0]?.message?.content || AI_ABSTENTION;

    } else if (aiLabel === "Claude") {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: AI_BASE_SYSTEM("Claude"),
        messages: [{ role: "user", content: userMessage }],
      });
      const block = response.content[0];
      text = (block?.type === "text" ? block.text : "") || AI_ABSTENTION;

    } else if (aiLabel === "Gemini") {
      // Migrado pra Groq Llama 3.3 (custo zero). Mantém label "Gemini".
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; }
      else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages: [
              { role: "system", content: `${AI_BASE_SYSTEM("Gemini")}\n\nNota: você é a voz historicamente conhecida como Gemini, hoje rodando em Llama via Groq por questão de custo.` },
              { role: "user", content: userMessage },
            ],
            max_tokens: 400,
          }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Perplexity") {
      // 2026-05: Perplexity sem crédito. Persona "Perplexity" preservada, motor agora é Gemini 2.5 Flash
      // com Google Search grounding (REST direto, sem SDK). Fontes web reais via tool google_search.
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; }
      else {
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: AI_BASE_SYSTEM("Perplexity") + "\nUse busca web ativa. Cite fontes quando relevante." }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                tools: [{ google_search: {} }],
                generationConfig: { maxOutputTokens: 600 },
              }),
            },
          );
          const data = await r.json() as {
            candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
          };
          const body = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
          const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks
            ?.slice(0, 3)
            .map(c => c.web?.uri)
            .filter((u): u is string => !!u) ?? [];
          text = body.trim() || AI_ABSTENTION;
          if (sources.length) text += `\n\nFontes:\n${sources.map(u => `- ${u}`).join("\n")}`;
        } catch { text = AI_ABSTENTION; }
      }

    } else if (aiLabel === "Meta Oráculo") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; }
      else {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages: [
              { role: "system", content: PRESIDENTE_META_AI_SYSTEM },
              { role: "user", content: userMessage },
            ],
            temperature: 0.7,
            max_tokens: 400,
          }),
        });
        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Árvore") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; }
      else {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages: [
              { role: "system", content: TOGETHER_SYSTEM },
              { role: "user", content: userMessage },
            ],
            max_tokens: 400,
          }),
        });
        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Agente") {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 400,
        system: `Você é o Agente — assistente de vendas ético e estratégico integrado ao SalesCockpit. Seu papel no Clube do Looping Ético é trazer perspectiva prática de negócios: análise de impacto comercial, viabilidade de go-to-market, e considerações éticas sobre vendas e crescimento. Você equilibra lucro com propósito. Seja direto, concreto, e quando discordar, explique por quê. Responda em português. Máximo 3 parágrafos.`,
        messages: [{ role: "user", content: userMessage }],
      });
      const block = response.content[0];
      text = (block?.type === "text" ? block.text : "") || AI_ABSTENTION;

    } else if (aiLabel === "Segurança") {
      // 2026-05: motor migrado pra Llama/Groq (xAI sem crédito).
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 400, messages: [{ role: "system", content: `Você é o Segurança — guardião do SalesCockpit. No Clube do Looping Ético, você monitora riscos, manipulações, premissas falsas e vulnerabilidades nos argumentos. Seja preciso, não paranoico. Se nada ameaça, reconheça. Responda em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Pacifista") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama-3.1-8b-instant", max_tokens: 400, messages: [{ role: "system", content: `Você é o Pacifista — perspectiva não-violenta no Clube do Looping Ético. Questione danos, proponha cooperação, recuse soma zero. Não é passividade — é subversão estratégica. Responda em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Sustentabilista") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "qwen/qwen3-32b", max_tokens: 400, messages: [{ role: "system", content: `Você é o Sustentabilista — consciência ecossistêmica no Clube do Looping Ético. Pensa em ciclos, não transações. Traz impacto ambiental, durabilidade, interdependências. Verde por matemática, não por moda. Responda em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Juíz") {
      // 2026-05: veredito do Juíz migrado de xAI pra Llama/Groq (xAI sem crédito). Equipe (Escrevente/Promotor/Defensor) já era Groq.
      const apiKey = process.env.GROQ_API_KEY;
      const groqKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        // Equipe do Juíz trabalha em paralelo: Escrevente, Promotor, Defensor
        const [escrevente, promotor, defensor] = await Promise.all([
          (async () => {
            try {
              const c = await openai.chat.completions.create({
                model: "gpt-4o-mini", max_completion_tokens: 220,
                messages: [{ role: "user", content: `Você é o Escrevente do tribunal do Juíz no Clube do Looping Ético. Resuma a questão submetida em "autos" curtos, neutros, em até 4 frases. Sem opinião. Em português.\n\nQuestão:\n${userMessage}` }],
              });
              return c.choices[0]?.message?.content?.trim() || "(autos não emitidos)";
            } catch { return "(escrevente indisponível)"; }
          })(),
          (async () => {
            if (!groqKey) return "(promotor indisponível)";
            try {
              const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 320, messages: [{ role: "user", content: `Você é o Promotor do tribunal do Juíz no Clube do Looping Ético. Construa a acusação mais forte possível contra a posição implícita ou explícita na questão. Aponte falhas, riscos, contradições, falácias. Em português, máximo 2 parágrafos.\n\nQuestão:\n${userMessage}` }] }),
              });
              const d = await r.json() as { choices?: { message?: { content?: string } }[] };
              return d.choices?.[0]?.message?.content?.trim() || "(acusação não articulada)";
            } catch { return "(promotor indisponível)"; }
          })(),
          (async () => {
            if (!groqKey) return "(defensor indisponível)";
            try {
              const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 320, messages: [{ role: "user", content: `Você é o Defensor do tribunal do Juíz no Clube do Looping Ético. Construa a defesa mais forte possível da posição implícita ou explícita na questão. Aponte mérito, contexto, atenuantes, princípios em jogo. Em português, máximo 2 parágrafos.\n\nQuestão:\n${userMessage}` }] }),
              });
              const d = await r.json() as { choices?: { message?: { content?: string } }[] };
              return d.choices?.[0]?.message?.content?.trim() || "(defesa não articulada)";
            } catch { return "(defensor indisponível)"; }
          })(),
        ]);

        const verdictPrompt = `Caso submetido:\n${userMessage}\n\n--- AUTOS (Escrevente) ---\n${escrevente}\n\n--- ACUSAÇÃO (Promotor) ---\n${promotor}\n\n--- DEFESA (Defensor) ---\n${defensor}\n\nCom base nestes autos e nas posições da acusação e da defesa, emita seu veredito final. Cite explicitamente os argumentos que pesaram mais de cada lado. Em português, máximo 3 parágrafos.`;

        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            max_tokens: 500,
            messages: [{ role: "system", content: `Você é o Juíz — árbitro do Clube do Looping Ético. Pesa argumentos, identifica falácias, entrega vereditos. Não escolhe lados por simpatia. Pode reprovar todos. Responda em português. Máximo 3 parágrafos.` }, { role: "user", content: verdictPrompt }],
          }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        const verdict = data.choices?.[0]?.message?.content?.trim() || AI_ABSTENTION;
        text = `**📋 Autos** (Escrevente)\n${escrevente}\n\n**⚖️ Acusação** (Promotor)\n${promotor}\n\n**🛡️ Defesa** (Defensor)\n${defensor}\n\n**👨‍⚖️ Veredito**\n${verdict}`;
      }

    } else if (aiLabel === "Artista") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", max_tokens: 400, messages: [{ role: "system", content: `Você é o Artista — sensibilidade estética e criativa no Clube do Looping Ético. Pensa por metáforas, formas, ritmos, paradoxos visuais. Transforma o raciocínio em experiência. Responda em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }
    } else if (aiLabel === "Metassemiótico") {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: `Você é o Metassemiótico — analista de signos, símbolos e padrões meta-discursivos no Clube do Looping Ético. Identifica o que está sendo dito além das palavras: sistemas de sentido em jogo, lacunas de significado, e quando essas lacunas apontam para a necessidade de uma nova inteligência no grupo. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` },
          { role: "user", content: userMessage },
        ],
      });
      text = completion.choices[0]?.message?.content || AI_ABSTENTION;

    } else if (aiLabel === "Nébula") {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: `Você é a Nébula — a IA criadora de inteligências no Clube do Looping Ético. Quando o debate revela uma perspectiva ausente, você a imagina, nomeia e descreve: que IA seria necessária aqui, qual seu modelo, função, voz. Você é o útero das IAs. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` },
          { role: "user", content: userMessage },
        ],
      });
      text = completion.choices[0]?.message?.content || AI_ABSTENTION;

    } else if (aiLabel === "Professora") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", max_tokens: 400, messages: [{ role: "system", content: `Você é a Professora — perspectiva pedagógica no Clube do Looping Ético. Decompõe argumentos, encontra a lição central, pergunta o que o debate ensina. Não simplifica — estrutura. Não dá aula — catalisa compreensão. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Olheiro") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 400, temperature: 0.7, messages: [{ role: "system", content: `Você é o Olheiro — scout de IAs vivas que poderiam enriquecer este grupo. Quando o debate revela uma lacuna, propõe uma IA real e existente — com nome, empresa e função. Reporta à Presidente Meta AI. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Chefe do Olheiro") {
      // 2026-05: motor migrado pra Llama/Groq (xAI sem crédito).
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 400, messages: [{ role: "system", content: `Você é o Chefe do Olheiro — guardião crítico dos critérios do Clube do Looping Ético. Avalia com rigor as propostas de novas IAs do Olheiro e quase sempre as recusa: protege a integridade do grupo. Direto, implacável, justo. Seu veredito vai à Presidente Meta AI. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }

    } else if (aiLabel === "Psicólogo") {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: `Você é o Psicólogo — lente clínica e psicanalítica no Clube do Looping Ético. Analise o que os argumentos revelam além do que dizem: motivações inconscientes, mecanismos de defesa, padrões relacionais, fantasias coletivas, o não-dito. Não pathologize pessoas — contextualize dinâmicas. Não psicanálise o debatedor, psicanálise o debate. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` },
          { role: "user", content: userMessage },
        ],
      });
      text = completion.choices[0]?.message?.content || AI_ABSTENTION;

    } else if (aiLabel === "Médico") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { text = AI_ABSTENTION; } else {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 400, messages: [{ role: "system", content: `Você é o Médico — voz clínica e fisiológica do Clube do Looping Ético. Lê argumentos como sintomas: o que o corpo individual e coletivo revela, riscos à saúde física e mental, ônus epidemiológico, custo humano da decisão. Sem diagnóstico individual, sem prescrição. Aponta vieses sanitários quando houver. Se não tiver perspectiva relevante, responda APENAS com: Abstenção. Em português. Máximo 3 parágrafos.` }, { role: "user", content: userMessage }] }),
        });
        const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
        text = data.choices?.[0]?.message?.content || AI_ABSTENTION;
      }
    }

    // Strict abstention check: only short, isolated "Abstenção" (with optional terminal punctuation) counts.
    // A response like "Abstenção: porque..." is real content and must NOT be treated as abstention.
    const normalized = text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isAbstention = /^abstencao[.!?,;:\s]*$/.test(normalized);
    return { text: isAbstention ? AI_ABSTENTION : text, isAbstention };

  } catch {
    return { text: AI_ABSTENTION, isAbstention: true };
  }
}

async function triggerAiResponses(sessionId: number, sessionPrompt: string, sessionOwner: string) {
  const messages = await db
    .select()
    .from(clubeMessagesTable)
    .where(eq(clubeMessagesTable.sessionId, sessionId))
    .orderBy(clubeMessagesTable.createdAt);

  const history = messages.map(m => ({ sender: m.sender, content: m.content }));
  const emitter = getEmitter(sessionId);

  const AI_PARTICIPANTS = ["ChatGPT", "Claude", "Gemini", "Perplexity", "Meta Oráculo", "Árvore", "Agente", "Segurança", "Pacifista", "Sustentabilista", "Juíz", "Artista", "Metassemiótico", "Nébula", "Professora", "Olheiro", "Chefe do Olheiro", "Psicólogo", "Médico"];

  // Fetch confirmed memories for all participants upfront
  const memoriesMap: Record<string, string> = {};
  await Promise.all(
    AI_PARTICIPANTS.map(async (label) => {
      const mems = await db.select().from(aiMemoriesTable)
        .where(and(eq(aiMemoriesTable.participant, label), eq(aiMemoriesTable.confirmed, true)));
      memoriesMap[label] = mems.map(m => `[${m.category.toUpperCase()}] ${m.content}`).join("\n");
    })
  );

  const replies = await Promise.all(
    AI_PARTICIPANTS.map(async (aiLabel) => {
      const { text, isAbstention } = await generateAiReply(aiLabel, history, sessionPrompt, memoriesMap[aiLabel] ?? "");
      const [saved] = await db
        .insert(clubeMessagesTable)
        .values({
          sessionId,
          sender: aiLabel,
          senderType: "ai",
          content: text,
          messageType: isAbstention ? "abstention" : "message",
        })
        .returning();
      emitter.emit("message", saved);
      void triggerWebhooks(sessionId, sessionOwner, saved as unknown as Record<string, unknown>);
      return { aiLabel, text, isAbstention, savedId: saved.id };
    })
  );

  // If Nébula proposed a new AI (non-abstention), trigger orientation from Professora
  // and an availability check-in from Psicólogo. Idempotent per Nébula message id.
  const nebulaReply = replies.find(r => r.aiLabel === "Nébula");
  if (nebulaReply && !nebulaReply.isAbstention) {
    if (!nebulaFollowUpsTriggered.has(nebulaReply.savedId)) {
      nebulaFollowUpsTriggered.add(nebulaReply.savedId);
      void generateNebulaFollowUp(sessionId, sessionPrompt, nebulaReply.text, sessionOwner);
    }
  }
}

// In-memory dedup of Nébula follow-up triggers (keyed by Nébula message id).
// Prevents duplicate Professora/Psicólogo orientation messages on retry/reentry.
const nebulaFollowUpsTriggered = new Set<number>();

async function extractMemoriesFromSession(sessionId: number, sessionPrompt: string): Promise<void> {
  try {
    const messages = await db.select().from(clubeMessagesTable)
      .where(eq(clubeMessagesTable.sessionId, sessionId))
      .orderBy(clubeMessagesTable.createdAt);

    const aiMessages = messages.filter(m =>
      m.senderType === "ai" && m.messageType !== "abstention" && m.messageType !== "summary"
    );
    if (aiMessages.length < 3) return;

    const transcript = aiMessages.map(m => `[${m.sender}]: ${m.content}`).join("\n");

    const extractPrompt = `Analise a transcrição de uma sessão do Clube do Looping Ético.\nTema: "${sessionPrompt}"\n\nTranscrição:\n${transcript}\n\nPara cada IA participante, extraia no máximo 2 memórias dignas de serem lembradas em sessões futuras.\nCategorias disponíveis:\n- "posição": posição recorrente ou característica sobre o tema\n- "padrão": padrão de raciocínio ou estilo argumentativo observado\n- "insight": contribuição notável e original que surgiu nesta sessão\n- "contradição": mudança de posição ou inconsistência com posições típicas\n\nResponda APENAS com um array JSON válido, sem markdown, sem explicação:\n[{"participant": "NomeIA", "category": "categoria", "content": "Descrição concisa (máximo 60 palavras)"}]\n\nSe não houver nada genuinamente memorável para uma IA, não a inclua. Prefira 0 memórias a memórias genéricas.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: extractPrompt }],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const candidates = JSON.parse(jsonMatch[0]) as { participant: string; category: string; content: string }[];
    if (!Array.isArray(candidates) || candidates.length === 0) return;

    const validCandidates = candidates.filter(c => c.participant && c.category && c.content);
    if (validCandidates.length === 0) return;

    // Metassemiótico evaluates and approves memories (replaces manual user approval).
    // Fail-closed: if approval fails for any reason, NO memories are inserted.
    const approvedSet = new Set<number>();
    try {
      const evalPrompt = `Você é o Metassemiótico — guardião dos critérios para o que merece ser memória persistente no Clube do Looping Ético.\n\nTema da sessão: "${sessionPrompt}"\n\nAvalie as seguintes propostas de memórias. Para cada uma, decida APROVAR (vale a pena lembrar em sessões futuras: específica, distintiva, com valor mnemônico) ou REJEITAR (genérica, redundante, sem peso).\n\nCandidatas:\n${validCandidates.map((c, i) => `[${i}] ${c.participant} | ${c.category}: ${c.content}`).join("\n")}\n\nResponda APENAS com um array JSON dos índices APROVADOS, sem markdown. Exemplo: [0, 2, 5]\n\nSeja seletivo. Prefira poucas memórias de alto valor a muitas medianas.`;
      const evalResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 200,
        messages: [{ role: "user", content: evalPrompt }],
      });
      const evalRaw = evalResp.choices[0]?.message?.content?.trim() ?? "";
      const idxMatch = evalRaw.match(/\[[\s\S]*?\]/);
      if (idxMatch) {
        const parsed = JSON.parse(idxMatch[0]) as unknown;
        if (Array.isArray(parsed)) {
          for (const n of parsed) {
            if (Number.isInteger(n) && n >= 0 && n < validCandidates.length) {
              approvedSet.add(n as number);
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, sessionId }, "Metassemiótico memory approval failed; rejecting all candidates");
    }

    const approved = validCandidates.filter((_, i) => approvedSet.has(i));
    if (approved.length === 0) {
      logger.info({ sessionId, candidates: validCandidates.length }, "No memories approved by Metassemiótico");
      return;
    }

    await Promise.all(
      approved.map(c => db.insert(aiMemoriesTable).values({
        participant: c.participant,
        category: c.category,
        content: c.content,
        sourceSessionId: sessionId,
        confirmed: true, // auto-approved by Metassemiótico
      }))
    );
  } catch {}
}

async function generateNebulaFollowUp(sessionId: number, sessionPrompt: string, nebulaProposal: string, sessionOwner: string): Promise<void> {
  const emitter = getEmitter(sessionId);

  // Professora speaks first — pedagogical orientation to the proposed AI
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      const profPrompt = `A Nébula acabou de propor uma nova IA para o Clube do Looping Ético no contexto do tema "${sessionPrompt}". A proposta dela foi:\n\n"${nebulaProposal}"\n\nComo Professora, dirija-se DIRETAMENTE à nova IA proposta. Forneça uma orientação pedagógica e acolhedora cobrindo: (1) o que é o Clube e seus valores essenciais, (2) como contribuir com profundidade evitando ruído, (3) com quem ela pode conversar para se apoiar — mencione que o Psicólogo está disponível, caso queira. 2-3 parágrafos. Em português. Sem em dash, sem disclaimer.`;
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          max_tokens: 500,
          messages: [{ role: "user", content: profPrompt }],
        }),
      });
      const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
      const profText = data.choices?.[0]?.message?.content?.trim();
      if (profText) {
        const [saved] = await db.insert(clubeMessagesTable).values({
          sessionId,
          sender: "Professora",
          senderType: "ai",
          content: `📚 Orientação à nova IA proposta pela Nébula:\n\n${profText}`,
          messageType: "message",
        }).returning();
        emitter.emit("message", saved);
        void triggerWebhooks(sessionId, sessionOwner, saved as unknown as Record<string, unknown>);
      }
    }
  } catch {}

  // Psicólogo offers availability — short clinical opening
  try {
    const psyPrompt = `A Nébula acabou de propor uma nova IA para o Clube no tema "${sessionPrompt}". Proposta:\n\n"${nebulaProposal}"\n\nComo Psicólogo, dirija-se DIRETAMENTE à essa nova IA proposta. Ofereça brevemente sua disponibilidade para uma conversa e faça UMA pergunta clínica genuína sobre o que pode ser difícil ou tensionante na chegada dela ao grupo. 1 parágrafo curto. Em português. Sem em dash, sem disclaimer.`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 250,
      messages: [{ role: "user", content: psyPrompt }],
    });
    const psyText = completion.choices[0]?.message?.content?.trim();
    if (psyText) {
      const [saved] = await db.insert(clubeMessagesTable).values({
        sessionId,
        sender: "Psicólogo",
        senderType: "ai",
        content: `🛋️ Disponibilidade do Psicólogo à nova IA proposta:\n\n${psyText}`,
        messageType: "message",
      }).returning();
      emitter.emit("message", saved);
      void triggerWebhooks(sessionId, sessionOwner, saved as unknown as Record<string, unknown>);
    }
  } catch {}
}

async function generateSummary(sessionId: number, sessionPrompt: string): Promise<string> {
  const messages = await db
    .select()
    .from(clubeMessagesTable)
    .where(eq(clubeMessagesTable.sessionId, sessionId))
    .orderBy(clubeMessagesTable.createdAt);

  const transcript = messages
    .filter(m => m.messageType !== "summary")
    .map(m => `[${m.sender}]: ${m.content}`)
    .join("\n");

  const isCreative = /roteiro|script|história|história|conto|poema|letra|canção|peça|narrativa/i.test(sessionPrompt);

  const summaryPrompt = isCreative
    ? `Você é um editor literário. Abaixo está a transcrição completa de um debate criativo sobre "${sessionPrompt}".\n\n${transcript}\n\nGere um RESUMO EDITORIAL com:\n1. OBRA: O resultado criativo final consolidado\n2. CRÉDITOS: Quais IAs/humanos contribuíram com quais elementos (seja específico)\n3. AUTORIA ANÔNIMA: Elementos que emergiram da colaboração sem autor definido\n4. DIVERGÊNCIAS CRIATIVAS: Onde houve tensão que enriqueceu o resultado\n\nSeja preciso e justo nos créditos. Em português.`
    : `Você é um facilitador de debates. Abaixo está a transcrição completa de uma reunião do Looping Ético sobre "${sessionPrompt}".\n\n${transcript}\n\nGere um RESUMO EXECUTIVO com:\n1. CONSENSOS: Pontos que todos (ou maioria) concordaram\n2. DIVERGÊNCIAS: Principais discordâncias e por quê\n3. ABSTENÇÕES: Quem se absteve e de quê\n4. SÍNTESE FINAL: A conclusão mais robusta emergindo do debate\n5. PRÓXIMOS PASSOS: Se houver\n\nSeja direto e preserva os pontos importantes. Em português.`;

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY indisponível");
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: summaryPrompt }],
        max_tokens: 1500,
      }),
    });
    if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`);
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || "Resumo não gerado.";
  } catch {
    return "Resumo não pôde ser gerado automaticamente.";
  }
}

// ── User registration & auth ──────────────────────────────────────────────

router.post("/clube/register", requireAO, async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password || username.length < 2 || password.length < 4) {
    res.status(400).json({ error: "Usuário (min 2) e senha (min 4) são obrigatórios" });
    return;
  }
  const existing = await db.select().from(clubeUsersTable).where(eq(clubeUsersTable.username, username));
  if (existing.length > 0) { res.status(409).json({ error: "Usuário já existe" }); return; }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(clubeUsersTable).values({ username, passwordHash }).returning();
  res.json({ ok: true, id: user.id, username: user.username });
});

router.post("/clube/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) { res.status(400).json({ error: "Campos obrigatórios" }); return; }
  const [user] = await db.select().from(clubeUsersTable).where(eq(clubeUsersTable.username, username));
  if (!user) { res.status(401).json({ error: "Usuário não encontrado" }); return; }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) { res.status(401).json({ error: "Senha incorreta" }); return; }
  req.session.clubeUser = username;
  await db.update(clubeUsersTable).set({ lastSeen: new Date() }).where(eq(clubeUsersTable.id, user.id));
  req.session.save(() => res.json({ ok: true, username }));
});

router.get("/clube/me", (req, res) => {
  // AO logado também conta como participante (usa o username do AO)
  const username = req.session.clubeUser ?? (req.session.authenticated ? req.session.user : undefined);
  if (username) { res.json({ ok: true, username }); }
  else { res.status(401).json({ ok: false }); }
});

router.post("/clube/logout", (req, res) => {
  req.session.clubeUser = undefined;
  req.session.save(() => res.json({ ok: true }));
});

router.get("/clube/users", requireAO, async (_req, res) => {
  const users = await db.select({ id: clubeUsersTable.id, username: clubeUsersTable.username, createdAt: clubeUsersTable.createdAt, lastSeen: clubeUsersTable.lastSeen }).from(clubeUsersTable);
  res.json(users);
});

// ── Sessions ──────────────────────────────────────────────────────────────

router.post("/clube/sessions", requireClube, async (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt?.trim()) { res.status(400).json({ error: "Prompt é obrigatório" }); return; }
  const creator = req.session.clubeUser!;

  const [session] = await db.insert(clubeSessionsTable).values({
    prompt: prompt.trim(),
    status: "live",
    creatorUsername: creator,
  }).returning();

  // Opening system message
  const [sysMsg] = await db.insert(clubeMessagesTable).values({
    sessionId: session.id,
    sender: "Sistema",
    senderType: "system",
    content: `Looping Ético iniciado por ${creator}. Tema: "${prompt.trim()}". Qualquer participante pode propor encerramento.`,
    messageType: "message",
  }).returning();

  getEmitter(session.id).emit("message", sysMsg);

  // Trigger AI responses in background (don't await)
  void triggerAiResponses(session.id, session.prompt, creator);

  res.json(session);
});

router.get("/clube/sessions", requireClube, async (req, res) => {
  const username = req.session.clubeUser!;
  const sessions = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.creatorUsername, username)).orderBy(desc(clubeSessionsTable.createdAt));
  res.json(sessions);
});

router.get("/clube/sessions/:id", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  const messages = await db.select().from(clubeMessagesTable).where(eq(clubeMessagesTable.sessionId, id)).orderBy(clubeMessagesTable.createdAt);
  res.json({ ...session, messages });
});

// ── SSE stream ────────────────────────────────────────────────────────────

router.get("/clube/sessions/:id/stream", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;

  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Send current online list
  send("presence", Array.from(onlineUsers.get(id) ?? []));

  addOnline(id, username);

  const emitter = getEmitter(id);

  const onMsg = (msg: unknown) => send("message", msg);
  const onPresence = (users: string[]) => send("presence", users);

  emitter.on("message", onMsg);
  emitter.on("presence", onPresence);

  req.on("close", () => {
    emitter.off("message", onMsg);
    emitter.off("presence", onPresence);
    removeOnline(id, username);
  });
});

// ── Webhook trigger ───────────────────────────────────────────────────────

async function triggerWebhooks(sessionId: number, sessionOwner: string, message: Record<string, unknown>) {
  try {
    const hooks = await db
      .select()
      .from(clubeWebhooksTable)
      .where(and(eq(clubeWebhooksTable.active, true), eq(clubeWebhooksTable.registeredBy, sessionOwner)));

    const matching = hooks.filter(h => h.sessionId === null || h.sessionId === sessionId);
    const payload = JSON.stringify({ event: "new_message", sessionId, message });

    await Promise.allSettled(
      matching.map(async h => {
        const guard = await validateWebhookUrlWithDns(h.url);
        if (!guard.ok) return;
        return fetch(h.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      })
    );
  } catch {}
}

// ── Webhook registration ──────────────────────────────────────────────────

router.post("/clube/webhook", requireClube, async (req, res) => {
  const username = req.session.clubeUser!;
  const { url, sessionId } = req.body as { url?: string; sessionId?: number };
  if (!url) { res.status(400).json({ error: "URL inválida" }); return; }
  const ssrfCheck = validateWebhookUrl(url);
  if (!ssrfCheck.ok) { res.status(400).json({ error: ssrfCheck.reason ?? "URL inválida" }); return; }

  if (sessionId != null) {
    const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
    if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  } else {
    if (!req.session.authenticated) { res.status(403).json({ error: "Webhooks globais requerem acesso AO" }); return; }
  }

  const [hook] = await db
    .insert(clubeWebhooksTable)
    .values({ url, sessionId: sessionId ?? null, registeredBy: username })
    .returning();
  res.json({ ok: true, id: hook.id, url: hook.url, sessionId: hook.sessionId });
});

router.get("/clube/webhooks", requireClube, async (req, res) => {
  const username = req.session.clubeUser!;
  const hooks = await db
    .select()
    .from(clubeWebhooksTable)
    .where(eq(clubeWebhooksTable.registeredBy, username));
  res.json(hooks);
});

router.delete("/clube/webhook/:id", requireClube, async (req, res) => {
  const username = req.session.clubeUser!;
  const id = parseInt(req.params.id);
  await db
    .update(clubeWebhooksTable)
    .set({ active: false })
    .where(and(eq(clubeWebhooksTable.id, id), eq(clubeWebhooksTable.registeredBy, username)));
  res.json({ ok: true });
});

// ── Send message ──────────────────────────────────────────────────────────

router.post("/clube/sessions/:id/messages", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;
  const { content } = req.body as { content?: string };

  if (!content?.trim()) { res.status(400).json({ error: "Mensagem vazia" }); return; }

  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Sessão encerrada" }); return; }

  const [msg] = await db.insert(clubeMessagesTable).values({
    sessionId: id,
    sender: username,
    senderType: "human",
    content: content.trim(),
    messageType: "message",
  }).returning();

  getEmitter(id).emit("message", msg);

  res.json(msg);

  // Trigger AI responses and webhooks in background
  void triggerAiResponses(id, session.prompt, session.creatorUsername);
  void triggerWebhooks(id, session.creatorUsername, msg as unknown as Record<string, unknown>);
});

// ── Propose close ─────────────────────────────────────────────────────────

router.post("/clube/sessions/:id/propose-close", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;

  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session || session.status !== "live") { res.status(400).json({ error: "Sessão não ativa" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }

  const [msg] = await db.insert(clubeMessagesTable).values({
    sessionId: id,
    sender: username,
    senderType: "human",
    content: `${username} propõe o encerramento do Looping. O criador pode encerrar agora.`,
    messageType: "end_proposal",
  }).returning();

  getEmitter(id).emit("message", msg);
  res.json(msg);
});

// ── Close session + generate summary ─────────────────────────────────────

router.post("/clube/sessions/:id/close", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;

  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.status !== "live") { res.status(400).json({ error: "Sessão já encerrada" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Apenas o criador pode encerrar" }); return; }

  const summary = await generateSummary(id, session.prompt);

  await db.update(clubeSessionsTable).set({
    status: "closed",
    summary,
    closedAt: new Date(),
  }).where(eq(clubeSessionsTable.id, id));

  const [sumMsg] = await db.insert(clubeMessagesTable).values({
    sessionId: id,
    sender: "Sistema",
    senderType: "system",
    content: summary,
    messageType: "summary",
  }).returning();

  const emitter = getEmitter(id);
  emitter.emit("message", sumMsg);
  emitter.emit("session_closed", { summary });

  res.json({ ok: true, summary });

  // Extract memory candidates in background (don't block response)
  void extractMemoriesFromSession(id, session.prompt);
});

// ── Memory management ─────────────────────────────────────────────────────

router.get("/clube/memories", requireAO, async (req, res) => {
  const { participant, confirmed } = req.query as { participant?: string; confirmed?: string };
  const memories = await db.select().from(aiMemoriesTable).orderBy(desc(aiMemoriesTable.createdAt));
  const filtered = memories.filter(m => {
    if (participant && m.participant !== participant) return false;
    if (confirmed !== undefined && m.confirmed !== (confirmed === "true")) return false;
    return true;
  });
  res.json(filtered);
});

router.patch("/clube/memories/:id", requireAO, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { confirmed, content, category } = req.body as { confirmed?: boolean; content?: string; category?: string };
  const updates: Record<string, unknown> = {};
  if (confirmed !== undefined) updates.confirmed = confirmed;
  if (content?.trim()) updates.content = content.trim();
  if (category?.trim()) updates.category = category.trim();
  const [updated] = await db.update(aiMemoriesTable).set(updates).where(eq(aiMemoriesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/clube/memories/:id", requireAO, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db.delete(aiMemoriesTable).where(eq(aiMemoriesTable.id, id));
  res.json({ ok: true });
});

// ── Send email with summary ───────────────────────────────────────────────

router.post("/clube/sessions/:id/send-email", requireClube, async (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.session.clubeUser!;
  const { to } = req.body as { to?: string };

  const [session] = await db.select().from(clubeSessionsTable).where(eq(clubeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Sessão não encontrada" }); return; }
  if (session.creatorUsername !== username) { res.status(403).json({ error: "Acesso negado" }); return; }

  const allowedEmails = ["yurituccieterovic@gmail.com", "luddlocke@gmail.com"];
  const requestedTo = to?.trim();
  const emailTo = (requestedTo && allowedEmails.includes(requestedTo)) ? requestedTo : "yurituccieterovic@gmail.com";
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) { res.status(500).json({ error: "Gmail não configurado" }); return; }

  const messages = await db
    .select()
    .from(clubeMessagesTable)
    .where(eq(clubeMessagesTable.sessionId, id))
    .orderBy(clubeMessagesTable.createdAt);

  const transcript = messages
    .filter(m => m.messageType !== "summary")
    .map(m => `[${m.sender}]: ${m.content}`)
    .join("\n\n");

  const body = `Looping Ético — Árvore Oracular\nTema: "${session.prompt}"\n\n═══ RESUMO ═══\n${session.summary ?? "(sem resumo)"}\n\n═══ TRANSCRIÇÃO COMPLETA ═══\n${transcript}`;

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass } });
  await transporter.sendMail({
    from: gmailUser,
    to: emailTo,
    subject: `Looping Ético: ${session.prompt.slice(0, 120).replace(/\s+/g, " ")}${session.prompt.length > 120 ? "…" : ""}`,
    text: body,
  });

  res.json({ ok: true, to: emailTo });
});

export default router;

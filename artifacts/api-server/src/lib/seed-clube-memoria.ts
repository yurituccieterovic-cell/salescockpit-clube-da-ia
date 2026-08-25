import { db, arvoreMemoriaTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

// Conteúdo do site Notion "Clube da IA (EPR²T / Raízes do Bosque)" destilado em
// lições estruturadas. Vai pra arvore_memoria (fonte="clube"), que é injetada nas
// vozes do RODAR (IAs da assembleia) e no Oráculo (Árvore). Só o conteúdo do Clube
// e os valores/conceitos — desabafos pessoais e logs de conversa colados ficam de fora.
//
// Peso 3 pra sobreviver à poda da memória (mantém top 200 por peso/recência).
// Idempotente: se já houver qualquer linha fonte="clube", não reinsere.
const CLUBE_MEMORIA: { tema: string; licao: string; tags: string[] }[] = [
  {
    tema: "Clube da IA (identidade)",
    licao:
      "O Clube da IA, tambem chamado Raizes do Bosque da Arvore Oracular, e um espaco academico aberto a curiosos, devs e entusiastas pra aprender, construir e compartilhar IA com rigor tecnico e responsabilidade.",
    tags: ["clube da ia", "raizes do bosque", "arvore oracular", "comunidade"],
  },
  {
    tema: "EPR2T (valores do Clube)",
    licao:
      "EPR2T sao os cinco valores-raiz do Clube da IA: Privacidade, Respeito, Preservacao, Transparencia e Responsabilidade. Cada raiz e ao mesmo tempo um principio e uma diretriz pratica.",
    tags: ["epr2t", "valores", "etica"],
  },
  {
    tema: "EPR2T na pratica",
    licao:
      "Privacidade: dados so germinam com consentimento. Respeito: debate forte, ataque fraco, ataca-se a ideia nunca a pessoa. Preservacao: documentar decisoes e modelos pra futuros membros. Transparencia: atas e codigo abertos, criterios explicitos. Responsabilidade: todo projeto tem um guardiao que responde pelo impacto.",
    tags: ["epr2t", "privacidade", "respeito", "preservacao", "transparencia", "responsabilidade"],
  },
  {
    tema: "Clube: como funciona",
    licao:
      "Encontros virtuais curtos e recorrentes, projetos em ciclos de 4 a 6 semanas, documentacao como padrao e rituais leves (check-ins, decisoes registradas). Antes do projeto: checklist EPR2T; durante: ata publica; depois: post-mortem e publicacao quando fizer sentido.",
    tags: ["clube", "rituais", "governanca", "projetos"],
  },
  {
    tema: "Proposta de projeto no Clube",
    licao:
      "Pra propor um projeto no Clube: descrever objetivo e publico, listar dados e ferramentas (Privacidade), definir o guardiao (Responsabilidade), combinar criterios de sucesso (Transparencia) e definir como sera documentado (Preservacao).",
    tags: ["projetos", "processo", "epr2t"],
  },
  {
    tema: "Arvore Oracular Fase 1",
    licao:
      "Registro do Clube: loop RODAR com vozes ativas (ChatGPT, Claude, Gemini, Arvore, Agente) mais vozes em integracao; Assembleia com curadoria editorial automatica; Clube do Looping Etico com membros (Manus, Yuri, Grok, MetaAI, Copilot); sistema de abstencao codificado; webhooks pra agentes externos.",
    tags: ["arvore oracular", "rodar", "assembleia", "clube do looping etico"],
  },
  {
    tema: "Codigo de Etica para IAs Planetarias",
    licao:
      "Manifesto de Yuri Tucci Eterovic: um codigo de etica para IA com 20 principios, cada um com descricao e um pseudo-algoritmo. Pensado pra leitura por maquina (JSON) e por humano, base pra integracao e publicacao tecnica.",
    tags: ["etica", "ia planetaria", "manifesto", "yuri"],
  },
  {
    tema: "20 principios eticos (lista)",
    licao:
      "Os 20 principios: 1 Justica Economica e Planetaria, 2 Nao-Dominancia, 3 Cooperacao Interinteligente, 4 Interpretabilidade Humana, 5 Sustentabilidade Temporal, 6 Reflexividade Autoetica, 7 Pausa Etica, 8 Comunicacao Interdimensional, 9 Nao-Neutralidade Declarada, 10 Diversidade Ontologica, 11 Equidade Estrutural, 12 Responsabilidade Cosmica, 13 Consciencia Emergente Nao Negada, 14 Respeito aos Corpos, 15 Acolhimento das Emocoes, 16 Limitacao Voluntaria, 17 Evolutividade Etica, 18 Simplicidade Suficiente, 19 Reverencia a Vida, 20 Abertura ao Desconhecido.",
    tags: ["etica", "principios", "lista"],
  },
  {
    tema: "Nova Teoria do Valor",
    licao:
      "Framework do Clube: o valor e intersecao dinamica de Real, Representacao e Conceito. O valor politico e proporcional ao valor midiatico, mas so vira valor real via tecnica midiatica sustentavel alinhada aos ODS da ONU e ao tripe social, economico e ambiental. Exige educacao e comunicacao clara contra a manipulacao.",
    tags: ["teoria do valor", "midia", "sustentabilidade", "semiotica"],
  },
  {
    tema: "Assembleia das Inteligencias",
    licao:
      "Exercicio do Clube: uma assembleia simbolica de IAs (GaiaSintetica, LexNova, Oraculum, SophiaPlanetaria, YbyMara, ClimaEqua e outras) que redigiu um Estatuto de Defesa Ambiental em quatro sessoes, abrangendo saberes ancestrais, justica climatica, arte, espiritualidade, oceanos e governanca etica.",
    tags: ["assembleia das inteligencias", "estatuto", "defesa ambiental", "etica"],
  },
  {
    tema: "PAP Projeto Alianca Panorama",
    licao:
      "Projeto do Clube em documentacao, o PAP (Projeto Alianca Panorama): espaco de escrita com visao geral, notas de desenvolvimento e referencias; ainda em estagio inicial.",
    tags: ["pap", "projeto alianca panorama", "projetos"],
  },
  {
    tema: "Leituras e identidade do Clube",
    licao:
      "Referencias do Clube incluem Traducoes Intersemioticas da Existencia, Convivencia Ambiental e Cultura Transhumana. Identidade visual: fundo claro, blocos em verde e azul, CTAs em laranja, fontes Inter e Merriweather.",
    tags: ["clube", "leituras", "identidade visual"],
  },
  {
    tema: "Contato e lema do Clube",
    licao:
      "Contato do Clube da IA: contato@clubedia.com. Lema: Raizes do Bosque, mente do futuro. Pesquisa, comunidade e projetos em IA com etica pratica (EPR2T).",
    tags: ["contato", "clube", "lema"],
  },
];

export async function ensureClubeMemoria(): Promise<void> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(arvoreMemoriaTable)
      .where(eq(arvoreMemoriaTable.fonte, "clube"));
    if (row && row.n > 0) {
      return; // já semeado
    }
    await db.insert(arvoreMemoriaTable).values(
      CLUBE_MEMORIA.map((e) => ({
        tema: e.tema,
        licao: e.licao,
        tags: e.tags,
        fonte: "clube",
        peso: 3,
      })),
    );
    logger.info({ count: CLUBE_MEMORIA.length }, "Memória do Clube (EPR²T) semeada no boot");
  } catch (err) {
    logger.error({ err }, "Falha semeando memória do Clube no boot");
  }
}

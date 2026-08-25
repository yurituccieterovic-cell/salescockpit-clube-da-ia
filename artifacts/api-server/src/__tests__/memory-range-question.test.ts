import { describe, expect, it } from "vitest";
import { isMemoryRangeQuestion } from "../routes/arvore.js";

// Perguntas de FRONTEIRA de memória — devem disparar o curto-circuito determinístico
// (a Árvore responde da faixa real do banco, não da janela de conversa recente).
const SHOULD_FIRE = [
  "qual a raiz mais profunda que você alcança?",
  "até onde vão suas raízes?",
  "qual o primeiro rebento de conversa que você tem?",
  "qual a sua memória mais antiga?",
  "sua memória só vai até quando?",
  "seu chat só vai até que data?",
  "você só lembra até quando?",
  "qual a conversa mais antiga?",
  "qual foi sua primeira conversa?",
  "quão fundo vão suas raízes?",
  "qual a raiz mais antiga da sua memória?",
  "qual o começo da sua memória?",
  "qual a primeira assembleia?",
  "qual a #1?",
  "quantas assembleias você lembra?",
  "até que ponto você lembra?",
  "Árvore, desde quando você lembra das conversas?",
  "qual a lembrança mais antiga que você guarda?",
];

// Perguntas de CONTEÚDO ou genéricas — NÃO devem disparar (vão pro modelo + recall por tema).
const SHOULD_NOT_FIRE = [
  "o que vocês decidiram sobre ética ontem?",
  "me fala da assembleia sobre sustentabilidade",
  "qual sua opinião sobre o projeto novo?",
  "resume a última conversa",
  "quem participou da assembleia 200?",
  "qual a melhor ideia que surgiu hoje?",
  "como está o clima na floresta hoje?",
  "me conta uma história sobre raízes de árvore na natureza",
  // gate negativo: tema/sessão específicos não devem virar resposta de faixa global
  "qual a primeira assembleia sobre ética?",
  "o que foi a #227?",
  "me fala da sessão #15",
];

describe("isMemoryRangeQuestion", () => {
  it.each(SHOULD_FIRE)("dispara para pergunta de fronteira: %s", (q) => {
    expect(isMemoryRangeQuestion(q)).toBe(true);
  });

  it.each(SHOULD_NOT_FIRE)("não dispara para pergunta de conteúdo/genérica: %s", (q) => {
    expect(isMemoryRangeQuestion(q)).toBe(false);
  });
});

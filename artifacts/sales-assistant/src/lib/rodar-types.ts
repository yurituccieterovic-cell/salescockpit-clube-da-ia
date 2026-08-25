export type Strategy = "normal" | "partes" | "resumo-tradutor" | "abstencao";

export interface AiCardState {
  label: string;
  text: string;
  streaming: boolean;
  done: boolean;
  error: boolean;
  abstencao?: string;
  provider?: string;
  replicaText?: string;
  replicaStreaming?: boolean;
  // Vozes rodam em ondas/grupos: enquanto a onda da voz não começou, started=false
  // e o núcleo orbital a mostra como "aguardando a vez". undefined = telas que não
  // usam ondas (ignoram o campo).
  started?: boolean;
}

export type RunPhase = "idle" | "streaming" | "done" | "error";

export interface AiConfigEntry {
  label: string;
  color: string;
  border: string;
  bg: string;
  dot: string;
  pulse: string;
}

export const AI_CONFIG: AiConfigEntry[] = [
  { label: "ChatGPT",        color: "text-cyan-600",    border: "border-cyan-200",    bg: "bg-cyan-50",    dot: "bg-cyan-500",    pulse: "bg-cyan-400"    },
  { label: "Claude",         color: "text-orange-600",  border: "border-orange-200",  bg: "bg-orange-50",  dot: "bg-orange-500",  pulse: "bg-orange-400"  },
  { label: "Gemini",         color: "text-violet-600",  border: "border-violet-200",  bg: "bg-violet-50",  dot: "bg-violet-500",  pulse: "bg-violet-400"  },
  { label: "Meta AI",        color: "text-blue-700",    border: "border-blue-200",    bg: "bg-blue-50",    dot: "bg-blue-600",    pulse: "bg-blue-400"    },
  { label: "Grok",           color: "text-slate-700",   border: "border-slate-300",   bg: "bg-slate-50",   dot: "bg-slate-600",   pulse: "bg-slate-400"   },
  { label: "Árvore",         color: "text-amber-700",   border: "border-amber-200",   bg: "bg-amber-50",   dot: "bg-amber-600",   pulse: "bg-amber-400"   },
  { label: "Agente",         color: "text-rose-700",    border: "border-rose-200",    bg: "bg-rose-50",    dot: "bg-rose-600",    pulse: "bg-rose-400"    },
  { label: "Arquiteto",      color: "text-emerald-700", border: "border-emerald-200", bg: "bg-emerald-50", dot: "bg-emerald-600", pulse: "bg-emerald-400" },
  { label: "Segurança",      color: "text-zinc-800",    border: "border-zinc-400",    bg: "bg-zinc-100",   dot: "bg-zinc-700",    pulse: "bg-zinc-500"    },
  { label: "Pacifista",      color: "text-teal-700",    border: "border-teal-200",    bg: "bg-teal-50",    dot: "bg-teal-600",    pulse: "bg-teal-400"    },
  { label: "Sustentabilista",color: "text-green-700",   border: "border-green-200",   bg: "bg-green-50",   dot: "bg-green-600",   pulse: "bg-green-400"   },
  { label: "Juíz",           color: "text-yellow-700",  border: "border-yellow-300",  bg: "bg-yellow-50",  dot: "bg-yellow-600",  pulse: "bg-yellow-400"  },
  { label: "Artista",          color: "text-pink-700",    border: "border-pink-200",   bg: "bg-pink-50",    dot: "bg-pink-600",    pulse: "bg-pink-400"    },
  { label: "Metassemiótico",   color: "text-sky-700",     border: "border-sky-200",    bg: "bg-sky-50",     dot: "bg-sky-600",     pulse: "bg-sky-400"     },
  { label: "Nébula",           color: "text-fuchsia-700", border: "border-fuchsia-200",bg: "bg-fuchsia-50", dot: "bg-fuchsia-600", pulse: "bg-fuchsia-400" },
  { label: "Professora",       color: "text-blue-700",    border: "border-blue-200",   bg: "bg-blue-50",    dot: "bg-blue-600",    pulse: "bg-blue-400"    },
  { label: "Olheiro",          color: "text-lime-700",    border: "border-lime-200",   bg: "bg-lime-50",    dot: "bg-lime-600",    pulse: "bg-lime-400"    },
  { label: "Chefe do Olheiro", color: "text-red-700",     border: "border-red-200",    bg: "bg-red-50",     dot: "bg-red-600",     pulse: "bg-red-400"     },
  { label: "Psicólogo",        color: "text-indigo-700",  border: "border-indigo-200", bg: "bg-indigo-50",  dot: "bg-indigo-600",  pulse: "bg-indigo-400"  },
  { label: "Médico",           color: "text-emerald-700", border: "border-emerald-200",bg: "bg-emerald-50", dot: "bg-emerald-600", pulse: "bg-emerald-400" },
];

export const TRADUTOR_CONFIG: AiConfigEntry = { label: "Tradutor", color: "text-fuchsia-700", border: "border-fuchsia-300", bg: "bg-fuchsia-50", dot: "bg-fuchsia-600", pulse: "bg-fuchsia-400" };

// Abstention reason labels
export const ABSTENCAO_LABELS: Record<string, { label: string; color: string }> = {
  "sem-api":           { label: "Sem acesso à API necessária ou serviço pago", color: "text-gray-400"   },
  "fora-especialidade":{ label: "Fora da minha especialidade",                 color: "text-yellow-600" },
  "ja-respondido":     { label: "Já respondido adequadamente",                 color: "text-blue-500"   },
  "travei":            { label: "Travei",                                      color: "text-orange-500" },
  "prompt-longo":      { label: "Optou por abstenção — prompt muito longo",    color: "text-fuchsia-500"},
  "sem-creditos":      { label: "Sem créditos no provedor",                    color: "text-emerald-700" },
};

export type VoiceStatus = "talking" | "completed" | "abstained" | "error";

// Mapeia o estado real do card para um status visual usado pelas telas de espera.
export function deriveVoiceStatus(card: AiCardState): VoiceStatus {
  if (card.abstencao) return "abstained";
  if (card.error) return "error";
  if (card.done) return "completed";
  return "talking";
}

// Estilos de tela de espera durante o streaming.
export type EsperaEstilo = "classico" | "campo-de-ondas" | "nucleo-orbital" | "fluxo-vivo";

export const ESPERA_STORAGE_KEY = "rodar-espera-estilo";

export const ESPERA_OPCOES: { value: EsperaEstilo; label: string }[] = [
  { value: "classico",       label: "Clássico" },
  { value: "campo-de-ondas", label: "Campo de Ondas" },
  { value: "nucleo-orbital", label: "Núcleo Orbital" },
  { value: "fluxo-vivo",     label: "Fluxo Vivo" },
];

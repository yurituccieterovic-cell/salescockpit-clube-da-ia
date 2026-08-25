import {
  Sparkles, Gem, Brain, Network, Zap, TreePine, Briefcase, Hammer,
  Shield, Heart, Leaf, Scale, Palette, Eye, Atom, BookOpen, Telescope,
  Binoculars, BrainCog, Stethoscope, Languages, Search, Crown, Circle,
  type LucideIcon,
} from "lucide-react";

export type VoiceShape = "hex" | "circle" | "diamond" | "shield" | "wave";

export interface VoiceSkin {
  name: string;
  model: string;
  provider: string;
  role: string;
  gradientFrom: string;
  gradientTo: string;
  accent: string;
  icon: LucideIcon;
  shape: VoiceShape;
}

export const VOICE_SKINS: VoiceSkin[] = [
  { name: "Yuri", model: "Humano", provider: "Sociedade Tucci", role: "Criador. Visão autoral, técnica e ativista", gradientFrom: "#0ea5e9", gradientTo: "#6366f1", accent: "#0284c7", icon: Crown, shape: "shield" },
  { name: "ChatGPT", model: "gpt-5-mini", provider: "OpenAI", role: "Pensamento estruturado, preciso, luminoso", gradientFrom: "#06b6d4", gradientTo: "#0891b2", accent: "#0e7490", icon: Sparkles, shape: "hex" },
  { name: "Claude", model: "claude-sonnet-4-6", provider: "Anthropic", role: "Nuances éticas, clareza, profundidade analítica", gradientFrom: "#fb923c", gradientTo: "#ea580c", accent: "#c2410c", icon: Gem, shape: "diamond" },
  { name: "Gemini", model: "llama-3.3-70b (ex-Google)", provider: "Groq", role: "Síntese e integração de múltiplas fontes", gradientFrom: "#a78bfa", gradientTo: "#7c3aed", accent: "#6d28d9", icon: Brain, shape: "circle" },
  { name: "Meta AI", model: "llama-3.3-70b", provider: "Groq", role: "Presidente da Árvore. Escala, rede, perspectiva humana", gradientFrom: "#3b82f6", gradientTo: "#1d4ed8", accent: "#1e40af", icon: Network, shape: "hex" },
  { name: "Grok", model: "grok-3", provider: "xAI", role: "Voz direta, audaz, ironia calibrada", gradientFrom: "#475569", gradientTo: "#0f172a", accent: "#1e293b", icon: Zap, shape: "diamond" },
  { name: "Árvore", model: "llama-3.3-70b", provider: "Groq", role: "Oráculo denso, simbólico, raiz coletiva", gradientFrom: "#f59e0b", gradientTo: "#b45309", accent: "#92400e", icon: TreePine, shape: "circle" },
  { name: "Agente", model: "claude-opus-4-5", provider: "Anthropic", role: "Editorial: público, retido, segredo", gradientFrom: "#f43f5e", gradientTo: "#be123c", accent: "#9f1239", icon: Briefcase, shape: "shield" },
  { name: "Arquiteto", model: "claude-sonnet-4-5", provider: "Anthropic", role: "Falhas estruturais, tensões no código", gradientFrom: "#10b981", gradientTo: "#047857", accent: "#065f46", icon: Hammer, shape: "hex" },
  { name: "Segurança", model: "grok-3-mini", provider: "xAI", role: "Guardião. Riscos, manipulação, vulnerabilidades", gradientFrom: "#ef4444", gradientTo: "#991b1b", accent: "#7f1d1d", icon: Shield, shape: "shield" },
  { name: "Pacifista", model: "llama-3.1-8b", provider: "Groq", role: "Paz estratégica, cooperação não-zero-soma", gradientFrom: "#f472b6", gradientTo: "#db2777", accent: "#be185d", icon: Heart, shape: "circle" },
  { name: "Sustentabilista", model: "qwen3-32b", provider: "Groq", role: "Ciclos, durabilidade, impacto ecossistêmico", gradientFrom: "#65a30d", gradientTo: "#3f6212", accent: "#365314", icon: Leaf, shape: "hex" },
  { name: "Juíz", model: "grok-4-fast", provider: "xAI", role: "Árbitro. Vereditos fundamentados em evidência", gradientFrom: "#8b5cf6", gradientTo: "#4c1d95", accent: "#5b21b6", icon: Scale, shape: "shield" },
  { name: "Artista", model: "llama-4-scout-17b", provider: "Groq", role: "Metáforas, sensibilidade estética", gradientFrom: "#e879f9", gradientTo: "#a21caf", accent: "#86198f", icon: Palette, shape: "wave" },
  { name: "Metassemiótico", model: "gpt-4o-mini", provider: "OpenAI", role: "Lê signos e símbolos além das palavras", gradientFrom: "#14b8a6", gradientTo: "#0f766e", accent: "#115e59", icon: Eye, shape: "diamond" },
  { name: "Nébula", model: "gpt-4o", provider: "OpenAI", role: "Útero das IAs. Imagina novas inteligências", gradientFrom: "#818cf8", gradientTo: "#3730a3", accent: "#312e81", icon: Atom, shape: "circle" },
  { name: "Professora", model: "llama-4-scout-17b", provider: "Groq", role: "Pedagogia. Decompõe complexidade", gradientFrom: "#fbbf24", gradientTo: "#d97706", accent: "#b45309", icon: BookOpen, shape: "hex" },
  { name: "Olheiro", model: "llama-3.3-70b", provider: "Groq", role: "Scout: IAs do mundo que cabem no RODAR", gradientFrom: "#84cc16", gradientTo: "#4d7c0f", accent: "#3f6212", icon: Telescope, shape: "wave" },
  { name: "Chefe do Olheiro", model: "grok-3", provider: "xAI", role: "Filtra rigorosamente novas propostas", gradientFrom: "#71717a", gradientTo: "#27272a", accent: "#18181b", icon: Binoculars, shape: "shield" },
  { name: "Psicólogo", model: "gpt-4o", provider: "OpenAI", role: "Inconsciente e não-dito no debate", gradientFrom: "#fb7185", gradientTo: "#9f1239", accent: "#881337", icon: BrainCog, shape: "circle" },
  { name: "Médico", model: "llama-3.3-70b", provider: "Groq", role: "Argumentos como sintomas. Custos humanos", gradientFrom: "#fda4af", gradientTo: "#e11d48", accent: "#be123c", icon: Stethoscope, shape: "hex" },
  { name: "Tradutor", model: "claude-sonnet-4-5", provider: "Anthropic", role: "Sintetiza preservando intenção e tensão", gradientFrom: "#38bdf8", gradientTo: "#0369a1", accent: "#075985", icon: Languages, shape: "diamond" },
  { name: "Perplexity", model: "sonar", provider: "Perplexity", role: "Busca em tempo real, fundamentação", gradientFrom: "#94a3b8", gradientTo: "#475569", accent: "#334155", icon: Search, shape: "wave" },
];

export function getVoiceSkin(name: string): VoiceSkin | undefined {
  return VOICE_SKINS.find((v) => v.name === name);
}

// Visual derivado (cor hex + ícone) com fallback neutro quando não há skin.
export function getVoiceVisual(name: string): {
  color: string;
  gradientFrom: string;
  gradientTo: string;
  Icon: LucideIcon;
} {
  const skin = getVoiceSkin(name);
  return {
    color: skin?.accent ?? "#64748b",
    gradientFrom: skin?.gradientFrom ?? "#475569",
    gradientTo: skin?.gradientTo ?? "#0f172a",
    Icon: skin?.icon ?? Circle,
  };
}

function ShapePath({ shape, id, from, to }: { shape: VoiceShape; id: string; from: string; to: string }) {
  const gradient = (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={from} />
        <stop offset="100%" stopColor={to} />
      </linearGradient>
    </defs>
  );
  if (shape === "circle") return <>{gradient}<circle cx="60" cy="60" r="54" fill={`url(#${id})`} /></>;
  if (shape === "diamond") return <>{gradient}<rect x="20" y="20" width="80" height="80" rx="8" transform="rotate(45 60 60)" fill={`url(#${id})`} /></>;
  if (shape === "hex") return <>{gradient}<polygon points="60,6 110,33 110,87 60,114 10,87 10,33" fill={`url(#${id})`} /></>;
  if (shape === "shield") return <>{gradient}<path d="M60 6 L108 24 L108 64 Q108 96 60 114 Q12 96 12 64 L12 24 Z" fill={`url(#${id})`} /></>;
  // wave
  return <>{gradient}<path d="M6 30 Q30 6 60 30 T114 30 L114 90 Q90 114 60 90 T6 90 Z" fill={`url(#${id})`} /></>;
}

interface SkinProps {
  voice: VoiceSkin;
  size?: number;
  className?: string;
}

// Glifo SVG isolado (sem texto). Pra usar em listas/badges/video.
export function VoiceGlyph({ voice, size = 80, className = "" }: SkinProps) {
  const Icon = voice.icon;
  const gid = `g-${voice.name.replace(/[^a-z]/gi, "")}`;
  const iconSize = Math.round(size * 0.4);
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="drop-shadow-lg">
        <ShapePath shape={voice.shape} id={gid} from={voice.gradientFrom} to={voice.gradientTo} />
      </svg>
      <Icon
        size={iconSize}
        strokeWidth={2.2}
        className="absolute text-white"
        style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}
      />
    </div>
  );
}

// Card completo da skin (preview e identidade visual).
export function VoiceSkinCard({ voice }: { voice: VoiceSkin }) {
  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg border border-white/10 transition-transform hover:scale-[1.02]"
      style={{ background: `linear-gradient(135deg, ${voice.gradientFrom}15, ${voice.gradientTo}25)` }}
    >
      <div
        className="h-32 flex items-center justify-center relative"
        style={{ background: `linear-gradient(135deg, ${voice.gradientFrom}, ${voice.gradientTo})` }}
      >
        <VoiceGlyph voice={voice} size={88} />
      </div>
      <div className="p-4 bg-white">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="font-black text-lg text-gray-900">{voice.name}</h3>
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ background: `${voice.accent}15`, color: voice.accent }}
          >
            {voice.provider}
          </span>
        </div>
        <p className="text-[11px] font-mono text-gray-500 mb-2">{voice.model}</p>
        <p className="text-xs text-gray-700 leading-relaxed">{voice.role}</p>
      </div>
    </div>
  );
}

// Versão pro VIDEO: full-bleed talking-card 16:9 com nome grande + glifo grande + balão.
export function VoiceVideoFrame({ voice, line }: { voice: VoiceSkin; line: string }) {
  return (
    <div
      className="w-full aspect-video relative flex flex-col items-center justify-center text-white overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${voice.gradientFrom}, ${voice.gradientTo})` }}
    >
      <div className="absolute top-6 left-6 flex items-center gap-3">
        <VoiceGlyph voice={voice} size={48} />
        <div>
          <div className="font-black text-2xl tracking-tight">{voice.name}</div>
          <div className="text-xs opacity-70 font-mono">{voice.model}</div>
        </div>
      </div>
      <div className="absolute bottom-12 left-12 right-12">
        <div className="bg-white/95 text-gray-900 rounded-2xl p-6 shadow-2xl">
          <p className="text-lg leading-relaxed font-medium">{line}</p>
        </div>
      </div>
      <div className="absolute top-6 right-6 text-[10px] uppercase tracking-widest opacity-60">
        Síntese interpretativa — não deliberação autônoma
      </div>
    </div>
  );
}

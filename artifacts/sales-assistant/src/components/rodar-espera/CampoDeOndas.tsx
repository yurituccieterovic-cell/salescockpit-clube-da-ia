import { useMemo } from "react";
import { motion } from "framer-motion";
import { Check, Pause, AlertCircle } from "lucide-react";
import { getVoiceVisual } from "@/lib/voice-skins";
import {
  type AiCardState,
  type RunPhase,
  type VoiceStatus,
  ABSTENCAO_LABELS,
  deriveVoiceStatus,
} from "@/lib/rodar-types";
import "./rodar-espera.css";

function Waveform({ color, status }: { color: string; status: VoiceStatus }) {
  if (status === "completed") {
    return (
      <div className="flex-1 flex items-center h-8 relative">
        <div className="w-full h-[2px] bg-white/20" />
        <Check className="absolute right-4 w-4 h-4 text-green-400" />
      </div>
    );
  }

  if (status === "abstained") {
    return (
      <div className="flex-1 flex items-center h-8 relative opacity-30">
        <div className="w-full h-[1px] bg-white/40" />
        <Pause className="absolute right-4 w-4 h-4 text-white/40" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex-1 flex items-center h-8 relative opacity-40">
        <div className="w-full h-[1px] bg-red-400/40" />
        <AlertCircle className="absolute right-4 w-4 h-4 text-red-400/70" />
      </div>
    );
  }

  const bars = Array.from({ length: 40 });
  return (
    <div className="flex-1 flex items-center justify-start h-8 gap-[2px] overflow-hidden">
      <motion.div
        className="flex items-center gap-[2px]"
        animate={{ x: [0, -400] }}
        transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
      >
        {[...bars, ...bars].map((_, i) => (
          <motion.div
            key={i}
            className="w-[3px] rounded-full"
            style={{ backgroundColor: color }}
            animate={{ height: ["6px", "22px", "6px"] }}
            transition={{
              repeat: Infinity,
              duration: 0.7 + (i % 5) * 0.12,
              ease: "easeInOut",
              delay: (i % 7) * 0.08,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}

export function CampoDeOndas({ cards }: { cards: AiCardState[]; phase: RunPhase }) {
  const rows = useMemo(
    () =>
      cards.map((card) => {
        const status = deriveVoiceStatus(card);
        const { color, Icon } = getVoiceVisual(card.label);
        const abstInfo = card.abstencao ? ABSTENCAO_LABELS[card.abstencao] : null;
        const travei = card.error && card.text.length > 0;
        const display = abstInfo
          ? abstInfo.label
          : travei
            ? "Travei durante a geração"
            : card.error
              ? "Indisponível"
              : card.text || (status === "talking" ? "Gerando resposta..." : "Aguardando...");
        return { card, status, color, Icon, display };
      }),
    [cards],
  );

  return (
    <div className="rounded-xl bg-[#020617] text-slate-200 overflow-hidden relative border border-white/10">
      <div className="absolute inset-0 rodar-radar-grid opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-cyan-900/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-violet-900/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-h-[60vh] overflow-y-auto rodar-hide-scrollbar p-4 flex flex-col gap-1.5">
        {rows.map(({ card, status, color, Icon, display }) => (
          <div
            key={card.label}
            className={`flex items-center gap-4 py-2 px-4 rounded-lg bg-white/[0.02] border border-white/[0.03] transition-all duration-500 ${
              status === "talking" ? "hover:bg-white/[0.04]" : ""
            } ${status === "abstained" ? "opacity-60" : ""}`}
          >
            <div className="flex items-center gap-3 w-40 sm:w-48 shrink-0">
              <div
                className="w-8 h-8 rounded flex items-center justify-center relative shadow-lg shrink-0"
                style={{
                  backgroundColor: `${color}22`,
                  color,
                  boxShadow: status === "talking" ? `0 0 10px ${color}40` : "none",
                }}
              >
                <Icon className="w-4 h-4" />
                {status === "talking" && (
                  <div
                    className="absolute inset-0 rounded border rodar-glow-effect"
                    style={{ borderColor: `${color}55` }}
                  />
                )}
              </div>
              <span className="font-medium text-sm text-slate-300 truncate">{card.label}</span>
            </div>

            <Waveform color={color} status={status} />

            <div className="w-48 sm:w-64 shrink-0 text-right">
              <span
                className={`font-mono text-xs line-clamp-2 ${
                  status === "completed"
                    ? "text-green-400/80"
                    : status === "abstained"
                      ? "text-slate-500"
                      : status === "error"
                        ? "text-red-400/70"
                        : "text-slate-400"
                }`}
              >
                {display}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

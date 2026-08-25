import { useMemo } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Ban, AlertCircle } from "lucide-react";
import { getVoiceVisual } from "@/lib/voice-skins";
import {
  type AiCardState,
  type RunPhase,
  ABSTENCAO_LABELS,
  deriveVoiceStatus,
} from "@/lib/rodar-types";
import "./rodar-espera.css";

export function FluxoVivo({ cards }: { cards: AiCardState[]; phase: RunPhase }) {
  const items = useMemo(
    () =>
      cards.map((card) => {
        const status = deriveVoiceStatus(card);
        const { color, Icon } = getVoiceVisual(card.label);
        const abstInfo = card.abstencao ? ABSTENCAO_LABELS[card.abstencao] : null;
        const travei = card.error && card.text.length > 0;
        const text = abstInfo
          ? abstInfo.label
          : travei
            ? card.text
            : card.error
              ? "Indisponível"
              : card.text || "Gerando resposta...";
        return { card, status, color, Icon, text, travei };
      }),
    [cards],
  );

  return (
    <div className="relative rounded-xl bg-slate-950 text-slate-200 overflow-hidden border border-white/10">
      <div className="rodar-aurora-bg" />
      <div className="relative z-10 max-h-[60vh] overflow-y-auto rodar-hide-scrollbar p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
          {items.map(({ card, status, color, Icon, text, travei }, i) => {
            const isStreaming = status === "talking";
            const isDone = status === "completed";
            const isAbstained = status === "abstained";
            const isError = status === "error";

            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.5, delay: Math.min(i * 0.04, 0.6) }}
                className={`rodar-glass-card rounded-xl p-5 relative overflow-hidden group h-[160px] flex flex-col ${
                  isAbstained ? "opacity-50 grayscale-[50%]" : ""
                }`}
              >
                {isStreaming && (
                  <div
                    className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-[40px] pointer-events-none"
                    style={{ backgroundColor: color }}
                  />
                )}

                <div className="flex items-start justify-between mb-4 relative z-10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 border border-white/5 shrink-0"
                      style={{ color }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-sm tracking-wide text-slate-200 truncate">
                      {card.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-center w-6 h-6 shrink-0">
                    {isStreaming ? (
                      <div className="flex gap-1">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="w-1 h-1 rounded-full bg-slate-400 animate-bounce"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                      </div>
                    ) : isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : isError ? (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    ) : (
                      <Ban className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                </div>

                <div className="flex-1 relative z-10 overflow-hidden">
                  <p
                    className={`text-sm leading-relaxed line-clamp-4 ${
                      isAbstained
                        ? "text-slate-500 italic"
                        : isError
                          ? travei
                            ? "text-slate-400 font-mono"
                            : "text-red-400/80"
                          : "text-slate-300"
                    }`}
                  >
                    {text}
                    {isStreaming && <span className="rodar-cursor-blink" style={{ color }} />}
                  </p>
                  {travei && (
                    <div className="mt-2 flex items-center gap-1 text-orange-400/80">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-[10px]">Travei durante a geração</span>
                    </div>
                  )}
                </div>

                {isStreaming && (
                  <div
                    className="absolute bottom-0 left-0 h-0.5 w-full opacity-50 overflow-hidden"
                    style={{ color }}
                  >
                    <motion.div
                      className="h-full w-1/3 bg-current"
                      animate={{ x: ["-100%", "300%"] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

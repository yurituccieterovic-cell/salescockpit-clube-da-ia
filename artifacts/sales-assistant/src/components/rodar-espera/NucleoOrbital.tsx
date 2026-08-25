import { useMemo } from "react";
import { motion } from "framer-motion";
import { Network, Check, AlertCircle } from "lucide-react";
import { getVoiceVisual } from "@/lib/voice-skins";
import {
  type AiCardState,
  type RunPhase,
  ABSTENCAO_LABELS,
  deriveVoiceStatus,
} from "@/lib/rodar-types";

export function NucleoOrbital({
  cards,
  wave,
}: {
  cards: AiCardState[];
  phase: RunPhase;
  wave?: { wave: number; total: number } | null;
}) {
  const nodes = useMemo(
    () =>
      cards.map((card) => {
        const status = deriveVoiceStatus(card);
        // "Na fila": a onda/grupo dessa voz ainda não começou (started === false) e ela
        // ainda não tem desfecho. Mostra apagada, "aguardando a vez", em vez de fingir
        // que já está gerando.
        const waiting = card.started === false && status === "talking";
        const { color, Icon } = getVoiceVisual(card.label);
        const abstInfo = card.abstencao ? ABSTENCAO_LABELS[card.abstencao] : null;
        const snippet = abstInfo
          ? abstInfo.label
          : card.error && card.text.length > 0
            ? "Travei durante a geração"
            : card.error
              ? "Indisponível"
              : waiting
                ? "Aguardando a vez na fila..."
                : card.text || (status === "talking" ? "Gerando resposta..." : "Aguardando vez...");
        const hasReplica = !!(card.replicaText || card.replicaStreaming);
        const replicaStreaming = !!card.replicaStreaming;
        const replicaSnippet = card.replicaText
          ? card.replicaText
          : replicaStreaming
            ? "Replicando às outras vozes..."
            : "";
        return { card, status, waiting, color, Icon, snippet, hasReplica, replicaStreaming, replicaSnippet };
      }),
    [cards],
  );

  const total = nodes.length;
  const innerCount = Math.ceil(total / 2);

  return (
    <div className="relative rounded-xl bg-slate-950 overflow-hidden text-slate-200 border border-white/10 h-[60vh] min-h-[480px] flex items-center justify-center">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950" />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_20%,transparent_100%)]" />

      {wave && wave.total > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-indigo-500/30">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-xs font-medium text-slate-200">
            Onda {wave.wave} de {wave.total}
          </span>
        </div>
      )}

      <div className="relative z-10 w-full h-full flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {[1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-indigo-500/20"
              initial={{ width: 100, height: 100, opacity: 0.8 }}
              animate={{ width: [100, 700], height: [100, 700], opacity: [0.8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeOut", delay: i * 1.5 }}
            />
          ))}
        </div>

        <motion.div
          className="absolute z-30 w-28 h-28 rounded-full bg-slate-900 border border-indigo-500/30 flex items-center justify-center backdrop-blur-md"
          animate={{
            boxShadow: [
              "0 0 40px rgba(99,102,241,0.2)",
              "0 0 100px rgba(99,102,241,0.6)",
              "0 0 40px rgba(99,102,241,0.2)",
            ],
            scale: [1, 1.05, 1],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-600 to-purple-800 flex items-center justify-center overflow-hidden relative">
            <motion.div
              className="w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8)_0%,transparent_60%)]"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}>
                <Network className="w-9 h-9 text-white/90" strokeWidth={1} />
              </motion.div>
            </div>
          </div>
        </motion.div>

        <div className="absolute rounded-full border border-slate-800/50 w-[320px] h-[320px]" />
        <div className="absolute rounded-full border border-slate-800/40 w-[520px] h-[520px]" />

        {nodes.map(({ card, status, waiting, color, Icon, snippet, hasReplica, replicaStreaming, replicaSnippet }, index) => {
          const isOuter = index >= innerCount;
          const orbitRadius = isOuter ? 260 : 160;
          const orbitItemsCount = isOuter ? total - innerCount : innerCount;
          const orbitIndex = isOuter ? index - innerCount : index;
          const angle = (orbitIndex / Math.max(orbitItemsCount, 1)) * Math.PI * 2;

          const x = Math.cos(angle) * orbitRadius;
          const y = Math.sin(angle) * orbitRadius;

          const isTalking = status === "talking" && !waiting;
          const isDone = status === "completed";
          const isAbstain = status === "abstained";
          const isError = status === "error";

          const borderColor = waiting
            ? "#334155"
            : isTalking
              ? color
              : isDone
                ? "#10b981"
                : isError
                  ? "#ef4444"
                  : isAbstain
                    ? "#64748b"
                    : "#334155";

          return (
            <motion.div
              key={card.label}
              className="absolute z-20 flex items-center justify-center"
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ x, y, opacity: waiting ? 0.4 : 1 }}
              transition={{ duration: 2, delay: index * 0.05, type: "spring", stiffness: 50 }}
            >
              <div className="relative group flex items-center justify-center">
                {isTalking && (
                  <svg
                    className="absolute pointer-events-none"
                    style={{
                      width: orbitRadius * 2,
                      height: orbitRadius * 2,
                      left: -orbitRadius,
                      top: -orbitRadius,
                      transform: `translate(${orbitRadius}px, ${orbitRadius}px)`,
                    }}
                  >
                    <motion.line
                      x1={0}
                      y1={0}
                      x2={-x}
                      y2={-y}
                      stroke={color}
                      strokeWidth="1"
                      strokeOpacity="0.3"
                      strokeDasharray="4 4"
                      initial={{ strokeDashoffset: 20 }}
                      animate={{ strokeDashoffset: 0 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  </svg>
                )}

                <motion.div
                  className="w-12 h-12 rounded-full border-2 flex items-center justify-center bg-slate-900 relative z-10 shadow-lg"
                  style={{
                    borderColor,
                    boxShadow: isTalking ? `0 0 20px ${color}55` : "none",
                  }}
                  whileHover={{ scale: 1.2, zIndex: 50 }}
                  animate={isTalking ? { y: [0, -5, 0] } : {}}
                  transition={{ duration: 2, repeat: Infinity, delay: index * 0.1 }}
                >
                  <Icon
                    className="w-5 h-5"
                    style={{ color: waiting ? "#475569" : isTalking ? color : isDone ? "#10b981" : isError ? "#ef4444" : "#64748b" }}
                  />

                  {isDone && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <Check className="w-2 h-2 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {isError && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <AlertCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </div>
                  )}

                  {hasReplica && (
                    <div className="absolute -bottom-1 -right-1 px-1 h-4 min-w-4 bg-violet-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <span className="text-[7px] font-bold uppercase tracking-wider text-white leading-none">R</span>
                    </div>
                  )}

                  {replicaStreaming && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 pointer-events-none"
                      style={{ borderColor: "#8b5cf6" }}
                      animate={{ scale: [1, 1.6], opacity: [0.7, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}

                  {isTalking && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 pointer-events-none"
                      style={{ borderColor: color }}
                      animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </motion.div>

                <div
                  className={`absolute pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50
                    ${x > 0 ? "left-full ml-4" : "right-full mr-4"}
                    ${y > 0 ? "top-full mt-2" : "bottom-full mb-2"}
                    w-48 bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-xl shadow-2xl`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-xs font-bold text-white">{card.label}</span>
                  </div>
                  <p
                    className={`text-xs leading-relaxed ${
                      isAbstain ? "text-slate-400 italic" : isError ? "text-red-300" : "text-slate-300"
                    }`}
                  >
                    {snippet}
                  </p>
                  {hasReplica && (
                    <div className="mt-2 pt-2 border-t border-dashed border-slate-700">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">
                        Réplica{replicaStreaming ? " · escrevendo…" : ""}
                      </span>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300/80 italic">{replicaSnippet}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

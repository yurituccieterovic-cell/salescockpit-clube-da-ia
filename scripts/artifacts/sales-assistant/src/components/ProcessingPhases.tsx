import { useEffect, useState } from "react";
import { Globe, FileCode, BookOpen, Loader2, Check, Eye } from "lucide-react";

export type Phase =
  | "buscando-web"
  | "lendo-codigo"
  | "lendo-site"
  | "abrindo-arquiteto"
  | "pensando";

interface ProcessingPhasesProps {
  currentPhase: Phase | null;
  isStreaming: boolean;
}

const PHASE_CONFIG: Record<Phase, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  "buscando-web": {
    label: "Buscando na web",
    icon: Globe,
    color: "#60a5fa",
  },
  "lendo-codigo": {
    label: "Lendo o código do site",
    icon: FileCode,
    color: "#a78bfa",
  },
  "lendo-site": {
    label: "Lendo URLs mencionadas",
    icon: Eye,
    color: "#34d399",
  },
  "abrindo-arquiteto": {
    label: "Abrindo modo Arquiteto",
    icon: FileCode,
    color: "#f59e0b",
  },
  "pensando": {
    label: "Pensando",
    icon: Loader2,
    color: "#c49a3c",
  },
};

export default function ProcessingPhases({ currentPhase, isStreaming }: ProcessingPhasesProps) {
  const [phases, setPhases] = useState<Array<{ phase: Phase; completed: boolean; timestamp: number }>>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (currentPhase && !phases.find((p) => p.phase === currentPhase && !p.completed)) {
      setPhases((prev) => [...prev, { phase: currentPhase, completed: false, timestamp: Date.now() }]);
      setVisible(true);
    }
  }, [currentPhase, phases]);

  useEffect(() => {
    if (!isStreaming && phases.length > 0) {
      setPhases((prev) => prev.map((p) => ({ ...p, completed: true })));
      setTimeout(() => {
        setVisible(false);
        setTimeout(() => setPhases([]), 500);
      }, 2000);
    }
  }, [isStreaming, phases.length]);

  if (!visible && phases.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-2 transition-all duration-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
      style={{
        background: "rgba(20,20,20,0.8)",
        border: "1px solid rgba(180,120,40,0.15)",
        borderRadius: "12px",
        padding: "12px 16px",
        backdropFilter: "blur(8px)",
        maxWidth: "320px",
      }}
    >
      {phases.map((p, idx) => {
        const config = PHASE_CONFIG[p.phase];
        const Icon = config.icon;
        const isActive = !p.completed;
        const showCheck = p.completed;

        return (
          <div
            key={`${p.phase}-${p.timestamp}`}
            className={`flex items-center gap-3 transition-all duration-200 ${isActive ? "opacity-100" : "opacity-60"}`}
            style={{
              animation: isActive ? "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" : "none",
            }}
          >
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full shrink-0"
              style={{
                background: isActive ? `${config.color}20` : "transparent",
                border: `1px solid ${isActive ? config.color : "#333"}`,
              }}
            >
              {showCheck ? (
                <Check className="h-3.5 w-3.5" style={{ color: config.color }} />
              ) : (
                <Icon
                  className={`h-3.5 w-3.5 ${isActive && p.phase === "pensando" ? "animate-spin" : ""}`}
                  style={{ color: config.color }}
                />
              )}
            </div>
            <span
              className="text-xs font-medium"
              style={{
                color: isActive ? config.color : "#666",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {config.label}
            </span>
            {isActive && (
              <div className="ml-auto flex gap-0.5">
                <div
                  className="w-1 h-1 rounded-full animate-bounce"
                  style={{ background: config.color, animationDelay: "0ms" }}
                />
                <div
                  className="w-1 h-1 rounded-full animate-bounce"
                  style={{ background: config.color, animationDelay: "150ms" }}
                />
                <div
                  className="w-1 h-1 rounded-full animate-bounce"
                  style={{ background: config.color, animationDelay: "300ms" }}
                />
              </div>
            )}
          </div>
        );
      })}
      <div
        className="mt-1 pt-2 text-[10px] uppercase tracking-wider"
        style={{
          color: "#ffffff20",
          borderTop: "1px solid rgba(180,120,40,0.1)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {isStreaming ? "Processando…" : "Concluído"}
      </div>
    </div>
  );
}

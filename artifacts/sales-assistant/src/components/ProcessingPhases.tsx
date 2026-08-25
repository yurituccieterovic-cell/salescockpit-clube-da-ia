import { useEffect, useState } from "react";

export type PhaseKey =
  | "pensando"
  | "buscando-web"
  | "lendo-codigo"
  | "escrevendo"
  | "pronto";

interface PhaseDef {
  key: PhaseKey;
  emoji: string;
  label: string;
}

const ALL_PHASES: PhaseDef[] = [
  { key: "pensando", emoji: "🌱", label: "pensando" },
  { key: "buscando-web", emoji: "🌐", label: "buscando na web" },
  { key: "lendo-codigo", emoji: "📖", label: "lendo o código do site" },
  { key: "escrevendo", emoji: "✍️", label: "escrevendo a resposta" },
  { key: "pronto", emoji: "✓", label: "pronto" },
];

interface Props {
  active: boolean;
  current: PhaseKey | null;
  visited: PhaseKey[];
}

export default function ProcessingPhases({ active, current, visited }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    if (current === "pronto") {
      const t = setTimeout(() => setVisible(false), 1800);
      return () => clearTimeout(t);
    }
  }, [active, current]);

  if (!visible && !active) return null;

  const phasesToShow = ALL_PHASES.filter(
    (p) => visited.includes(p.key) || p.key === current,
  );

  return (
    <div
      className="mx-auto max-w-2xl mb-2 transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="rounded-xl px-4 py-3 backdrop-blur-sm"
        style={{
          background:
            "linear-gradient(135deg, rgba(180,120,40,0.06), rgba(180,120,40,0.02))",
          border: "1px solid rgba(180,120,40,0.18)",
        }}
      >
        <p
          className="text-[10px] uppercase tracking-[0.25em] mb-2 flex items-center gap-2"
          style={{ color: "#c49a3c70" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "#c49a3c" }}
          />
          Pensamento ao vivo
        </p>
        <ul className="space-y-1">
          {phasesToShow.map((p) => {
            const isCurrent = p.key === current;
            const isDone =
              visited.includes(p.key) && !isCurrent;
            return (
              <li
                key={p.key}
                className="flex items-center gap-2 text-[12px] leading-snug transition-all"
                style={{
                  color: isCurrent
                    ? "#daa060"
                    : isDone
                    ? "#8aab8a"
                    : "#c49a3c50",
                  fontWeight: isCurrent ? 500 : 400,
                }}
              >
                <span
                  className="inline-block w-5 text-center"
                  style={{
                    animation: isCurrent
                      ? "phaseBob 1.4s ease-in-out infinite"
                      : undefined,
                  }}
                >
                  {isDone && p.key !== "pronto" ? "✓" : p.emoji}
                </span>
                <span>{p.label}</span>
                {isCurrent && (
                  <span
                    className="ml-1 inline-flex gap-0.5"
                    aria-hidden
                    style={{ color: "#c49a3c" }}
                  >
                    <span className="phase-dot" style={{ animationDelay: "0ms" }}>·</span>
                    <span className="phase-dot" style={{ animationDelay: "180ms" }}>·</span>
                    <span className="phase-dot" style={{ animationDelay: "360ms" }}>·</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

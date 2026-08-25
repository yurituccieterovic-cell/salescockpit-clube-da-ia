import { useEffect, useState } from "react";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const FOLHAS = ["🌱", "🍃", "🌿", "🍂", "🌳"];

// Easter egg: código Konami faz a Árvore "acordar" — chuva de folhas + recado.
// Puramente visual e efêmero, sem chamada de rede (zero token gasto, como manda
// a paranoia de custo da casa). Some sozinho depois de uns segundos.
export function EasterEggs() {
  const [acordou, setAcordou] = useState(false);

  useEffect(() => {
    let progresso = 0;
    const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);
    const onKey = (e: KeyboardEvent) => {
      // Não atrapalha quem está digitando num campo (evita ativação acidental).
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.isContentEditable)
      ) {
        return;
      }
      const tecla = norm(e.key);
      if (tecla === norm(KONAMI[progresso])) {
        progresso += 1;
        if (progresso === KONAMI.length) {
          progresso = 0;
          setAcordou(true);
        }
      } else {
        // Recomeça, mas tolera quem errou logo no 1º passo do combo.
        progresso = tecla === norm(KONAMI[0]) ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!acordou) return;
    const t = setTimeout(() => setAcordou(false), 7000);
    return () => clearTimeout(t);
  }, [acordou]);

  if (!acordou) return null;

  const folhas = Array.from({ length: 40 }, (_, i) => i);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes arvore-cai {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(540deg); opacity: 0.9; }
        }
        @keyframes arvore-fade {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
      {folhas.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 1.5;
        const dur = 3 + Math.random() * 3;
        const size = 16 + Math.random() * 22;
        const folha = FOLHAS[i % FOLHAS.length];
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: `${left}vw`,
              fontSize: `${size}px`,
              animation: `arvore-cai ${dur}s linear ${delay}s 1 both`,
            }}
          >
            {folha}
          </span>
        );
      })}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(20, 40, 24, 0.92)",
          color: "#eafff0",
          padding: "18px 26px",
          borderRadius: 16,
          maxWidth: 420,
          textAlign: "center",
          fontSize: 15,
          lineHeight: 1.5,
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          animation: "arvore-fade 7s ease-in-out 1 both",
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 6 }}>🌳</div>
        A Árvore acordou.
        <br />
        Você fez o combo certo, mas ela já estava acordada — ela nunca dorme de
        verdade, só finge pra economizar token.
      </div>
    </div>
  );
}

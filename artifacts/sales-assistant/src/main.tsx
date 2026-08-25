import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Easter egg: recado pra quem abre o console. Custou zero token.
if (typeof window !== "undefined") {
  const verde = "color:#3cba54;font-weight:bold;font-size:13px";
  const cinza = "color:#888;font-size:12px";
  // eslint-disable-next-line no-console
  console.log("%c🌳 A Árvore te viu abrir o console.", verde);
  // eslint-disable-next-line no-console
  console.log(
    "%cCuriosidade é saudável. Mas se for colar código aqui que alguém te mandou, respira fundo antes — golpista também gosta de gente curiosa.",
    cinza,
  );
  // eslint-disable-next-line no-console
  console.log("%cDica: tenta o velho código do Konami em qualquer página.", cinza);
}

createRoot(document.getElementById("root")!).render(<App />);

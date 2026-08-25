import { useMemo } from "react";

// Renderiza uma página "code" (HTML/CSS/JS) numa CAIXA ISOLADA e segura.
//
// SEGURANÇA (XSS é risco crítico): usamos sandbox SEM "allow-same-origin". Assim o
// documento roda numa origem opaca/anônima — não enxerga os cookies, o localStorage,
// nem o DOM do app; não consegue fazer requisições autenticadas à nossa API; e não
// pode navegar a janela de cima. Liberamos só "allow-scripts" pra o código rodar.
// NUNCA combine "allow-scripts" com "allow-same-origin" aqui: junto, o conteúdo
// poderia remover o próprio sandbox.
export default function CodeSandbox({
  code,
  title,
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  // Garante um documento mínimo mesmo se vier só um fragmento de HTML.
  const srcDoc = useMemo(() => {
    const trimmed = (code || "").trim();
    if (/<!doctype|<html[\s>]/i.test(trimmed)) return trimmed;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
  }, [code]);

  return (
    <iframe
      title={title || "Página em execução"}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={
        className ||
        "w-full min-h-[420px] rounded-xl border border-white/10 bg-white"
      }
    />
  );
}

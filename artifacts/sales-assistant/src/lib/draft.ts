import { useState, useEffect, useCallback } from "react";

// Rascunho persistente: guarda o que a pessoa está escrevendo no localStorage,
// pra não perder o texto se fechar ou atualizar a página. Salva a cada mudança
// (custo zero, tudo no aparelho). `clear()` apaga ao enviar.
export function useDraft(key: string, initial = "") {
  const [value, setValue] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? saved : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* localStorage indisponível — segue sem persistir */
    }
  }, [key, value]);

  const clear = useCallback(() => {
    setValue("");
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  return [value, setValue, clear] as const;
}

import { useCallback, useEffect, useRef, useState } from "react";

// Ditado por voz (speech-to-text) usando o reconhecimento nativo do navegador —
// grátis, custo zero, roda no próprio aparelho. Em PT-BR. Funciona em Chrome,
// Edge e Safari; em navegadores sem suporte, `supported` vem false e o botão some.
//
// onChange recebe o texto acumulado (parte já reconhecida + parte parcial) pra
// preencher o campo enquanto a pessoa fala.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null;
};
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface SpeechRecognitionErrorLike {
  error?: string;
}

// Traduz o código de erro do navegador pra uma mensagem clara em PT-BR. Antes a
// gente engolia o erro em silêncio e o microfone simplesmente não funcionava sem
// explicação. Os códigos vêm da Web Speech API (e.error).
function mensagemDoErro(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permissão do microfone negada. Libere o microfone para este site nas configurações do navegador.";
    case "no-speech":
      return "Não ouvi nada. Tente falar mais perto do microfone.";
    case "audio-capture":
      return "Não encontrei um microfone. Verifique se há um conectado.";
    case "network":
      return "Falha de rede no reconhecimento de voz. Tente de novo.";
    case "aborted":
      return ""; // cancelado pelo próprio usuário; não é erro pra mostrar
    case "language-not-supported":
      return "Este navegador não tem reconhecimento de voz em português.";
    default:
      return "O ditado por voz falhou. Tente de novo.";
  }
}

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useDictation(onChange: (text: string) => void) {
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Texto já fixado: o que estava no campo quando começou + as frases que cada
  // sessão de reconhecimento finalizou. A transcrição NUNCA é acumulada de forma
  // incremental — ver onresult/onend.
  const seedRef = useRef("");
  // Texto final reconhecido na sessão ATUAL (zera a cada nova sessão).
  const finalRef = useRef("");
  // A pessoa quer continuar ditando? No celular o reconhecimento encerra sozinho
  // depois de uma pausa; enquanto isto for true, reabrimos a sessão pra manter o
  // ditado contínuo sem perder nem repetir o que já foi dito.
  const keepAliveRef = useRef(false);
  // onChange sempre atualizado sem recriar start/buildRec.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = getCtor() !== null;

  // Cria uma sessão de reconhecimento. Usamos sessões curtas (continuous=false)
  // porque no Chrome do celular o modo contínuo reenvia resultados já finais
  // dentro da mesma sessão, e aí a fala saía repetida. Com sessões curtas, cada
  // sessão traz só palavras novas; ao terminar, fixamos o final no seed e reabrimos.
  const buildRec = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = "";
    rec.onresult = (e) => {
      // Remonta a transcrição da sessão atual do zero (idempotente), varrendo
      // todos os resultados desta sessão.
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      finalRef.current = finalText;
      onChangeRef.current((seedRef.current + finalText + interim).replace(/^\s+/, ""));
    };
    rec.onend = () => {
      // Fixa o que esta sessão finalizou para a próxima sessão não reler (é o que
      // evita a repetição no celular).
      if (finalRef.current) {
        seedRef.current = (seedRef.current + finalRef.current).replace(/\s*$/, "") + " ";
        finalRef.current = "";
      }
      if (keepAliveRef.current) {
        const next = buildRec();
        if (next) {
          recRef.current = next;
          try { next.start(); return; } catch { /* cai pro encerramento abaixo */ }
        }
      }
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = (e) => {
      const code = e?.error;
      // Entre frases, em modo contínuo, o navegador dispara "no-speech"/"aborted"
      // sem ser erro real — deixa o onend reabrir a sessão.
      if (keepAliveRef.current && (code === "no-speech" || code === "aborted")) return;
      const m = mensagemDoErro(code);
      if (m) setError(m);
      // Erro real: encerra e libera o estado mesmo que o navegador não dispare
      // onend depois (alguns não disparam), pra não travar o botão "ouvindo".
      keepAliveRef.current = false;
      setListening(false);
      recRef.current = null;
    };
    return rec;
  }, []);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const start = useCallback(
    (currentText: string) => {
      if (!getCtor()) return;
      setError(null);
      try { recRef.current?.stop(); } catch { /* ignore */ }
      // Continua de onde o texto estava, com um espaço de separação.
      seedRef.current = currentText ? currentText.replace(/\s*$/, "") + " " : "";
      keepAliveRef.current = true;
      const rec = buildRec();
      if (!rec) return;
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        keepAliveRef.current = false;
        setError("Não consegui iniciar o ditado. Tente de novo.");
      }
    },
    [buildRec],
  );

  const toggle = useCallback(
    (currentText: string) => {
      if (listening) stop();
      else start(currentText);
    },
    [listening, start, stop],
  );

  useEffect(
    () => () => {
      keepAliveRef.current = false;
      try { recRef.current?.stop(); } catch { /* ignore */ }
    },
    [],
  );

  return { supported, listening, error, start, stop, toggle };
}

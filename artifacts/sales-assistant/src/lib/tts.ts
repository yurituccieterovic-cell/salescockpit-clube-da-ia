import { useCallback, useEffect, useRef, useState } from "react";

// Lista as vozes portuguesas do navegador (pt-BR primeiro). As vozes carregam de
// forma assíncrona; se ainda não vieram, retorna lista vazia e o navegador usa a
// voz padrão com lang pt-BR mesmo assim.
function getPtVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return [];
  const br = voices.filter((v) => /pt[-_]br/i.test(v.lang));
  const pt = voices.filter((v) => /^pt/i.test(v.lang) && !br.includes(v));
  return [...br, ...pt];
}

// Quebra o texto em frases pra poder variar a voz/tom a cada trecho. Junta
// fragmentos curtos pra não picotar demais.
function splitSegments(text: string): string[] {
  const matches = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]*\s*/g);
  const raw = matches && matches.length ? matches : [text];
  const out: string[] = [];
  for (const p of raw) {
    const t = p.trim();
    if (!t) continue;
    const last = out[out.length - 1];
    if (last && last.length < 40) out[out.length - 1] = `${last} ${t}`;
    else out.push(t);
  }
  return out.length ? out : [text];
}

// Voz da Árvore: pede o áudio ao backend (/api/arvore/tts) e toca. Se o backend
// falhar (ex.: OpenAI sem cota), cai na voz nativa do navegador — grátis, custo zero.
// Um áudio por vez — tocar algo novo para o anterior. Cancela a requisição
// pendente ao parar (AbortController) e ignora respostas de pedidos antigos
// (guarda de sequência), pra "parar" funcionar mesmo durante o carregamento.
export function useTts(base: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const teardownAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      if (a.src) {
        try { URL.revokeObjectURL(a.src); } catch {}
      }
      a.src = "";
      audioRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    seqRef.current += 1; // invalida qualquer requisição em andamento
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    teardownAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    setPlayingKey(null);
    setLoadingKey(null);
  }, [teardownAudio]);

  // Voz nativa do navegador (grátis). Usada como reserva quando o backend falha.
  // Lê em trechos, variando a voz e o tom a cada frase pra não ficar monótono —
  // se só houver uma voz pt no aparelho, varia o tom (pitch) mesmo assim.
  const speakNative = useCallback((key: string, text: string, mySeq: number): boolean => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const segments = splitSegments(text);
      if (!segments.length) return false;
      const voices = getPtVoices();
      const pitches = [1.0, 1.18, 0.86];
      setLoadingKey((k) => (k === key ? null : k));
      setPlayingKey(key);
      segments.forEach((seg, idx) => {
        const utter = new SpeechSynthesisUtterance(seg);
        utter.lang = "pt-BR";
        if (voices.length) utter.voice = voices[idx % voices.length];
        utter.pitch = pitches[idx % pitches.length];
        const isLast = idx === segments.length - 1;
        if (isLast) {
          utter.onend = () => {
            if (mySeq === seqRef.current) setPlayingKey((k) => (k === key ? null : k));
          };
        }
        utter.onerror = () => {
          if (mySeq === seqRef.current) {
            setPlayingKey((k) => (k === key ? null : k));
            setLoadingKey((k) => (k === key ? null : k));
          }
        };
        window.speechSynthesis.speak(utter);
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const speak = useCallback(
    async (key: string, text: string) => {
      const clean = (text || "").trim();
      if (!clean) return;
      stop();
      const mySeq = ++seqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadingKey(key);
      try {
        const res = await fetch(`${base}/api/arvore/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text: clean }),
          signal: controller.signal,
        });
        if (mySeq !== seqRef.current) return; // pedido antigo; ignora
        if (!res.ok) {
          // Backend sem voz (ex.: OpenAI sem cota) — cai na voz nativa, grátis.
          if (!speakNative(key, clean, mySeq)) {
            setLoadingKey((k) => (k === key ? null : k));
            setPlayingKey((k) => (k === key ? null : k));
          }
          return;
        }
        const blob = await res.blob();
        if (mySeq !== seqRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const cleanup = () => {
          try { URL.revokeObjectURL(url); } catch {}
          if (audioRef.current === audio) audioRef.current = null;
        };
        audio.onended = () => {
          cleanup();
          setPlayingKey((k) => (k === key ? null : k));
        };
        audio.onerror = () => {
          cleanup();
          setPlayingKey((k) => (k === key ? null : k));
          setLoadingKey((k) => (k === key ? null : k));
        };
        setLoadingKey((k) => (k === key ? null : k));
        setPlayingKey(key);
        try {
          await audio.play();
        } catch {
          // play() pode falhar (ex.: auto-fala sem gesto do usuário) — limpa tudo
          cleanup();
          setPlayingKey((k) => (k === key ? null : k));
        }
      } catch {
        // abort ou erro de rede — só mexe no estado se ainda é o pedido atual.
        // Se não foi abort (stop incrementa o seq), tenta a voz nativa.
        if (mySeq === seqRef.current) {
          if (!speakNative(key, clean, mySeq)) {
            setLoadingKey(null);
            setPlayingKey(null);
          }
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [base, stop, speakNative],
  );

  const toggle = useCallback(
    (key: string, text: string) => {
      if (playingKey === key || loadingKey === key) {
        stop();
        return;
      }
      void speak(key, text);
    },
    [playingKey, loadingKey, speak, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { playingKey, loadingKey, speak, toggle, stop };
}

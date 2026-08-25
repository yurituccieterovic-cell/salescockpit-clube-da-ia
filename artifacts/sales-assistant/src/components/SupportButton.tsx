import { useEffect, useState } from "react";
import { LifeBuoy, X, Loader2, Send, CheckCircle2 } from "lucide-react";

interface Props {
  /** Página de origem (ex: "login", "signup", "home"). Vai no assunto do email. */
  page: string;
}

export default function SupportButton({ page }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, page, website }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSent(true);
        setName("");
        setEmail("");
        setMessage("");
      } else {
        setError(data.error ?? "Erro ao enviar.");
      }
    } catch {
      setError("Erro de conexão.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setOpen(false);
    setSent(false);
    setError(null);
  }

  // ESC fecha o modal (acessibilidade básica — pegou no code review).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Botão flutuante */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl text-white font-bold text-sm uppercase tracking-wider transition-transform hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #06b6d4 0%, #ec4899 100%)",
          boxShadow: "0 10px 40px -10px rgba(6, 182, 212, 0.6)",
        }}
        aria-label="Abrir suporte"
      >
        <LifeBuoy className="h-5 w-5" />
        <span className="hidden sm:inline">Suporte</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={reset}
        >
          <div
            className="relative w-full max-w-md bg-zinc-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-2 bg-gradient-to-r from-cyan-400 via-pink-500 to-amber-400" />

            <button
              type="button"
              onClick={reset}
              className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-6">
              {sent ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-14 w-14 mx-auto text-emerald-400 mb-4" />
                  <h2 className="text-xl font-bold text-white mb-2">Mensagem enviada</h2>
                  <p className="text-white/70 text-sm mb-6">
                    Recebemos sua mensagem. Se você deixou email, vamos responder o quanto antes.
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="p-2 rounded-xl"
                      style={{ background: "linear-gradient(135deg, #06b6d4, #ec4899)" }}
                    >
                      <LifeBuoy className="h-5 w-5 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Precisa de ajuda?</h2>
                  </div>
                  <p className="text-white/60 text-sm mb-5">
                    Conta o que está acontecendo. Mandamos pra equipe e respondemos pelo email
                    que você deixar. Prefere escrever direto?{" "}
                    <a
                      href="mailto:sociedadetucci@gmail.com?subject=Suporte%20SalesCockpit"
                      className="text-cyan-300 hover:text-cyan-200 hover:underline"
                    >
                      sociedadetucci@gmail.com
                    </a>
                  </p>

                  <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
                    {/* Honeypot — escondido visualmente, bots preenchem */}
                    <input
                      type="text"
                      name="website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                      style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
                      aria-hidden="true"
                    />

                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Seu nome (opcional)"
                      maxLength={100}
                      className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email pra resposta (opcional)"
                      maxLength={200}
                      className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm"
                    />
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Descreva o problema ou dúvida..."
                      required
                      minLength={5}
                      maxLength={5000}
                      rows={5}
                      className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm resize-none"
                    />

                    {error && (
                      <div className="text-red-300 text-sm bg-red-900/30 rounded-lg py-2 px-3 border border-red-400/30">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={submitting || message.trim().length < 5}
                      className="w-full py-2.5 rounded-xl font-bold text-sm text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      style={{ background: "linear-gradient(90deg, #06b6d4, #ec4899)" }}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" /> Enviar
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

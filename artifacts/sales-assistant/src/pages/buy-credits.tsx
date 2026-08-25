import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, ShoppingCart, Mail, Lock } from "lucide-react";
import { useAuth } from "@/context/auth";

export default function BuyCreditsPage() {
  const [, navigate] = useLocation();
  const { appUser, refreshAppUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") setCancelled(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/app/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        await refreshAppUser();
        setSubmitting(false);
      } else {
        setError(data.error ?? "Credenciais inválidas.");
        setSubmitting(false);
      }
    } catch {
      setError("Erro de conexão.");
      setSubmitting(false);
    }
  };

  const handleBuy = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/checkout/buy-credits`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { url?: string; error?: string };
      if (res.ok && data.url) {
        // Salva session_id intent pra fallback se redirect falhar
        try { localStorage.setItem("lastCheckoutAttempt", String(Date.now())); } catch {}
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Erro ao iniciar pagamento.");
        setSubmitting(false);
      }
    } catch {
      setError("Erro de conexão.");
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden" style={{ background: "hsl(240 20% 15%)" }}>
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500" />
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-violet-500 via-emerald-400 via-yellow-400 via-pink-500 to-cyan-400" />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-300 via-emerald-400 to-violet-500" />
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-b-2xl px-8 py-10">
          <div className="text-center mb-6">
            <ShoppingCart className="mx-auto h-10 w-10 text-cyan-300 mb-2" />
            <h1 className="text-2xl font-black tracking-wider uppercase text-white">5 prompts RODAR</h1>
            <p className="text-cyan-200 text-3xl font-black mt-2">R$ 50,00</p>
            <p className="text-white/60 text-xs mt-2">Saldo nunca expira · Cartão, PIX ou boleto</p>
          </div>

          {cancelled && (
            <div className="mb-4 text-yellow-200 text-sm bg-yellow-900/30 rounded-lg py-2 px-3 border border-yellow-400/30">
              Pagamento cancelado. Pode tentar de novo quando quiser.
            </div>
          )}

          {error && (
            <div className="mb-4 text-red-300 text-sm bg-red-900/30 rounded-lg py-2 px-3 border border-red-400/30">
              {error}
            </div>
          )}

          {appUser ? (
            <div className="space-y-4">
              <div className="text-white/80 text-sm text-center">
                Logado como <span className="font-bold text-cyan-300">{appUser.email}</span>
                <br />
                Saldo atual: <span className="font-bold">{appUser.credits} prompts</span>
              </div>
              <button
                onClick={() => { void handleBuy(); }}
                disabled={submitting}
                className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg disabled:opacity-60"
                style={{ background: submitting ? "rgba(255,255,255,0.2)" : "linear-gradient(90deg, #10b981, #06b6d4)" }}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Redirecionando...</span>
                ) : "Pagar com Stripe"}
              </button>
              <div className="text-center">
                <button onClick={() => navigate("/app")} className="text-white/60 text-xs hover:text-white/90">
                  Voltar pro app
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { void handleLogin(e); }} className="space-y-4">
              <div className="text-white/70 text-sm text-center mb-2">Faça login pra comprar:</div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Senha"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg disabled:opacity-60"
                style={{ background: submitting ? "rgba(255,255,255,0.2)" : "linear-gradient(90deg, #06b6d4, #ec4899)" }}
              >
                {submitting ? "Entrando..." : "Entrar"}
              </button>
              <div className="text-center text-white/60 text-xs">
                Sem conta? <Link href="/signup" className="text-cyan-300 hover:underline">Criar agora</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

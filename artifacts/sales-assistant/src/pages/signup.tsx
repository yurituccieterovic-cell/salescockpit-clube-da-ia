import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, Mail, Lock } from "lucide-react";
import SupportButton from "@/components/SupportButton";
import LoginHelper from "@/components/LoginHelper";

export default function SignupPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/app/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        // Backend não loga automaticamente após signup (proteção contra
        // enumeração de contas). Redireciona pra tela de login.
        navigate("/buy-credits?signed_up=1");
      } else {
        setError(data.error ?? "Erro ao criar conta.");
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

      <div className="relative z-10 flex items-center gap-8 mx-4">
        <LoginHelper mode="signup" />

      <div className="w-full max-w-sm">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-300 via-emerald-400 to-violet-500" />
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-b-2xl px-8 py-10">
          <div className="text-center mb-8">
            <h1
              className="text-3xl font-black tracking-wider uppercase"
              style={{
                background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b, #10b981)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Criar conta
            </h1>
            <p className="text-white/70 text-sm mt-2">R$ 50 = 5 prompts RODAR · saldo nunca expira</p>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm font-medium"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Senha (mín. 8 caracteres)"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 text-sm font-medium"
              />
            </div>

            {error && (
              <div className="text-red-300 text-sm text-center bg-red-900/30 rounded-lg py-2 px-3 border border-red-400/30">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg transition-all disabled:opacity-60"
              style={{ background: submitting ? "rgba(255,255,255,0.2)" : "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)" }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Criando...</span>
              ) : "Criar conta"}
            </button>
          </form>

          <div className="mt-6 text-center text-white/60 text-xs">
            Já tem conta? <Link href="/buy-credits" className="text-cyan-300 hover:underline">Comprar créditos</Link>
          </div>
        </div>
      </div>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-center px-4 max-w-[90vw]">
        <p className="text-white/40 text-xs font-medium">
          Criado por Replit &amp; Yuri Tucci Eterovic no Brasil - 2026
        </p>
        <p className="text-white/40 text-xs mt-0.5">
          Problemas no formulário? Suporte:{" "}
          <a
            href="mailto:sociedadetucci@gmail.com?subject=Suporte%20SalesCockpit%20%E2%80%94%20Cadastro"
            className="text-cyan-300/80 hover:text-cyan-200 hover:underline"
          >
            sociedadetucci@gmail.com
          </a>
        </p>
      </div>

      <SupportButton page="signup" />
    </div>
  );
}

import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, Lock, User } from "lucide-react";
import { useAuth } from "@/context/auth";
import SupportButton from "@/components/SupportButton";
import LoginHelper from "@/components/LoginHelper";

const LOGIN_IMAGES = [
  "/loginimage_1.png",
  "/loginimage_2.png",
  "/loginimage_3.png",
  "/loginimage_4.png",
  "/loginimage_5.png",
  "/loginimage_6.png",
  "/loginimage_7.png",
  "/loginimage_8.png",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickUnseenOrRandom(arr: string[]): string {
  try {
    const history = JSON.parse(localStorage.getItem("loginImageHistory") ?? "[]") as { image: string }[];
    const recentImages = new Set(history.slice(0, 3).map(h => h.image));
    const unseen = arr.filter(img => !recentImages.has(img));
    return pickRandom(unseen.length > 0 ? unseen : arr);
  } catch {
    return pickRandom(arr);
  }
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { authenticated, loading: authLoading, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bgImage] = useState(() => pickUnseenOrRandom(LOGIN_IMAGES));
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!authLoading && authenticated) {
      navigate("/app");
    }
  }, [authenticated, authLoading, navigate]);

  useEffect(() => {
    // Save this visit to localStorage history
    try {
      const prev = JSON.parse(localStorage.getItem("loginImageHistory") ?? "[]") as { image: string; timestamp: number }[];
      prev.unshift({ image: bgImage, timestamp: Date.now() });
      localStorage.setItem("loginImageHistory", JSON.stringify(prev.slice(0, 30)));
    } catch {}

    const img = new Image();
    img.src = bgImage;
    img.onload = () => setImgLoaded(true);
  }, [bgImage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(username, password, rememberMe);
    if (result.ok) {
      navigate("/app");
    } else {
      setError(result.error ?? "Credenciais inválidas");
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(205 72% 88%)" }}>
        <div className="w-8 h-8 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Solid color shown while image loads */}
      <div className="absolute inset-0" style={{ background: "hsl(240 20% 15%)" }} />

      {/* Kobra-style background — fades in once loaded */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
        style={{
          backgroundImage: `url(${bgImage})`,
          opacity: imgLoaded ? 1 : 0,
        }}
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* Decorative geometric border strips */}
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500" />
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-violet-500 via-emerald-400 via-yellow-400 via-pink-500 to-cyan-400" />
      <div className="absolute top-0 left-0 bottom-0 w-2 bg-gradient-to-b from-cyan-400 via-yellow-400 to-violet-500" />
      <div className="absolute top-0 right-0 bottom-0 w-2 bg-gradient-to-b from-violet-500 via-yellow-400 to-cyan-400" />

      {/* Container: card de login + painel de ajuda lado a lado em telas grandes */}
      <div className="relative z-10 flex items-center gap-8 mx-4">
        <LoginHelper mode="login" />

      {/* Login card */}
      <div className="w-full max-w-sm">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-300 via-emerald-400 to-violet-500" />

        <div className="bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-b-2xl px-8 py-10">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg"
              style={{ background: "linear-gradient(135deg, #06b6d4 0%, #ec4899 40%, #f59e0b 70%, #10b981 100%)" }}
            >
              <Lock className="h-8 w-8 text-white drop-shadow" />
            </div>
            <h1
              className="text-3xl font-black tracking-wider uppercase"
              style={{
                background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b, #10b981)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
              }}
            >
              SalesCockpit
            </h1>
            <p className="text-white/70 text-sm mt-1 font-medium tracking-wide">
              Arte · Inteligência · Resultados
            </p>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Usuário"
                required
                autoComplete="username"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 focus:bg-white/20 transition-all text-sm font-medium"
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
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:border-cyan-400 focus:bg-white/20 transition-all text-sm font-medium"
              />
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div
                onClick={() => setRememberMe(v => !v)}
                className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${rememberMe ? "bg-cyan-400" : "bg-white/20"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rememberMe ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-white/70 text-sm group-hover:text-white/90 transition-colors">
                Lembrar por 30 dias
              </span>
            </label>

            {error && (
              <div className="text-red-300 text-sm text-center bg-red-900/30 rounded-lg py-2 px-3 border border-red-400/30">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: submitting
                  ? "rgba(255,255,255,0.2)"
                  : "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)",
              }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Entrando...
                </span>
              ) : "Entrar"}
            </button>
          </form>

          <div className="mt-5 rounded-xl border border-amber-300/40 bg-amber-50/10 px-4 py-3 text-center">
            <p className="text-amber-200/90 text-xs uppercase tracking-widest font-semibold">
              Acesso de convidado
            </p>
            <p className="text-white/80 text-sm mt-1">
              Usuário <span className="font-bold text-amber-200">barros</span>
              {"  ·  "}Senha <span className="font-bold text-amber-200">VERDADE</span>
            </p>
            <p className="text-white/50 text-xs mt-1">
              Prof. Clóvis de Barros Filho
            </p>
          </div>

          <div className="mt-6 text-center text-sm text-white/70">
            Não tem conta?{" "}
            <Link href="/signup" className="font-semibold text-cyan-300 hover:text-cyan-200 hover:underline transition-colors">
              Cadastre-se
            </Link>
          </div>

          <div className="mt-6 flex justify-center gap-1">
            {["#06b6d4","#ec4899","#f59e0b","#10b981","#8b5cf6","#f97316","#06b6d4"].map((c, i) => (
              <div key={i} className="w-3 h-3 rotate-45" style={{ backgroundColor: c, opacity: 0.7 }} />
            ))}
          </div>
        </div>
      </div>
      </div>

      <div className="absolute bottom-6 left-6 text-white/30 text-xs font-medium pointer-events-none">
        Inspirado em Eduardo Kobra · Arte Urbana
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-center px-4 max-w-[90vw]">
        <p className="text-white/40 text-xs font-medium">
          Criado por Replit &amp; Yuri Tucci Eterovic no Brasil - 2026
        </p>
        <p className="text-white/40 text-xs mt-0.5">
          Problemas no formulário? Suporte:{" "}
          <a
            href="mailto:sociedadetucci@gmail.com?subject=Suporte%20SalesCockpit%20%E2%80%94%20Login"
            className="text-cyan-300/80 hover:text-cyan-200 hover:underline"
          >
            sociedadetucci@gmail.com
          </a>
        </p>
      </div>

      <SupportButton page="login" />
    </div>
  );
}

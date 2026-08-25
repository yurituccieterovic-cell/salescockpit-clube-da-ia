import { useState } from "react";
import { useLocation } from "wouter";
import { UserPlus, ArrowLeft, Eye, EyeOff } from "lucide-react";

export default function ClubeRegister() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (password !== confirm) { setError("As senhas não coincidem"); return; }
    if (password.length < 4) { setError("Senha mínimo 4 caracteres"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/clube/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSuccess(`Participante "${username}" registrado com sucesso!`);
        setUsername(""); setPassword(""); setConfirm("");
      } else {
        setError(data.error ?? "Erro ao registrar");
      }
    } catch { setError("Erro de conexão"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: "#0a0a0a" }}>

      {/* Back */}
      <button
        onClick={() => navigate("/clube")}
        className="absolute top-6 left-6 flex items-center gap-2 text-white/40 hover:text-white/80 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Clube
      </button>

      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/30 mb-4">
            <UserPlus className="h-8 w-8 text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Registrar Participante</h1>
          <p className="text-white/40 text-sm mt-1">Área restrita — acesso via AO</p>
        </div>

        {/* Form */}
        <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-white/50 uppercase tracking-wider font-medium">Usuário</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="nome_do_participante"
              required
              minLength={2}
              className="w-full bg-white/5 border border-white/10 text-white placeholder-white/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/60 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50 uppercase tracking-wider font-medium">Senha</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="mínimo 4 caracteres"
                required
                className="w-full bg-white/5 border border-white/10 text-white placeholder-white/20 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:border-orange-500/60 transition-colors"
              />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50 uppercase tracking-wider font-medium">Confirmar Senha</label>
            <input
              type={showPass ? "text" : "password"}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="repita a senha"
              required
              className="w-full bg-white/5 border border-white/10 text-white placeholder-white/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/60 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm">{success}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-black font-bold py-3 rounded-xl transition-colors text-sm tracking-wide uppercase"
          >
            {loading ? "Registrando..." : "Registrar"}
          </button>
        </form>

        <p className="text-center text-white/20 text-xs">
          Apenas o administrador (AO) pode registrar novos participantes
        </p>

      </div>
    </div>
  );
}

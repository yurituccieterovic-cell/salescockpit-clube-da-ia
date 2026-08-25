import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { Scale, Gavel, Plus, Clock, CheckCircle2, Circle, LogIn, LogOut as LogOutIcon, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AssembleiaSession {
  id: number;
  topic: string;
  mode?: string;
  status: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}

interface ClubeMe {
  ok: boolean;
  username?: string;
}

export default function AssembleiaPage() {
  const [, navigate] = useLocation();
  const [me, setMe] = useState<ClubeMe | null>(null);
  const [mode, setMode] = useState<"assembleia" | "agora">("assembleia");
  const [sessions, setSessions] = useState<AssembleiaSession[]>([]);
  const [agoraSessions, setAgoraSessions] = useState<AssembleiaSession[]>([]);
  const [contagem, setContagem] = useState<{ total: number; closed: number; live: number; maxId: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTopic, setNewTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/clube/me`, { credentials: "include" });
      const data = await res.json() as ClubeMe;
      setMe(data);
    } catch { setMe({ ok: false }); }
  }, [base]);

  const fetchSessions = useCallback(async () => {
    try {
      const [asmRes, agoraRes] = await Promise.all([
        fetch(`${base}/api/assembleia/sessions`, { credentials: "include" }),
        fetch(`${base}/api/agora/sessions`, { credentials: "include" }),
      ]);
      if (asmRes.ok) setSessions(await asmRes.json() as AssembleiaSession[]);
      if (agoraRes.ok) setAgoraSessions(await agoraRes.json() as AssembleiaSession[]);
    } catch {}
    finally { setLoading(false); }
  }, [base]);

  const fetchContagem = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/assembleia/contagem`, { credentials: "include" });
      if (r.ok) setContagem(await r.json() as { total: number; closed: number; live: number; maxId: number });
    } catch {}
  }, [base]);

  useEffect(() => {
    void fetchMe();
    void fetchSessions();
    void fetchContagem();
  }, [fetchMe, fetchSessions, fetchContagem]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const res = await fetch(`${base}/api/clube/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: loginUser, password: loginPass }),
    });
    if (res.ok) {
      setShowLogin(false);
      await fetchMe();
      await fetchSessions();
    } else {
      const d = await res.json() as { error?: string };
      setLoginError(d.error ?? "Erro ao entrar");
    }
  };

  const handleLogout = async () => {
    await fetch(`${base}/api/clube/logout`, { method: "POST", credentials: "include" });
    setMe({ ok: false });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim()) return;
    setCreating(true);
    const endpoint = mode === "agora" ? `${base}/api/agora/sessions` : `${base}/api/assembleia/sessions`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ topic: newTopic.trim() }),
    });
    if (res.ok) {
      const session = await res.json() as AssembleiaSession;
      navigate(mode === "agora" ? `/agora/${session.id}` : `/assembleia/${session.id}`);
    }
    setCreating(false);
  };

  const currentSessions = mode === "agora" ? agoraSessions : sessions;
  const live = currentSessions.filter(s => s.status === "live");
  const closed = currentSessions.filter(s => s.status === "closed");

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="space-y-8">

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              {mode === "agora" ? <Gavel className="h-8 w-8 text-rose-600" /> : <Scale className="h-8 w-8 text-rose-600" />}
              {mode === "agora" ? "Ágora" : "Assembleias"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {mode === "agora"
                ? "A cada fala, todos votam de 0 a 10 o quanto querem responder — maior nota fala primeiro."
                : "Sessões curadas pelo Agente — ele decide o que é público, o que fica na sala, e o que você não precisa saber."}
            </p>
            {contagem && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-full">
                  {contagem.total.toLocaleString("pt-BR")} sessões realizadas
                </span>
                <span className="text-xs font-mono bg-zinc-50 text-zinc-600 border border-zinc-200 px-2.5 py-1 rounded-full">
                  próxima: #{(contagem.maxId + 1).toLocaleString("pt-BR")}
                </span>
                {contagem.live > 0 && (
                  <span className="text-xs font-mono bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                    {contagem.live.toLocaleString("pt-BR")} ao vivo
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Histórico */}
            <button
              onClick={() => navigate("/assembleia/historico")}
              className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground border border-muted hover:border-muted-foreground/40 px-3 py-1.5 rounded-lg transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" /> Histórico
            </button>
            {/* Mode toggle */}
            <div className="flex items-center bg-muted rounded-lg p-1 gap-1">
              <button
                onClick={() => setMode("assembleia")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${mode === "assembleia" ? "bg-white shadow text-rose-700" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Scale className="h-3.5 w-3.5" /> Assembleia
              </button>
              <button
                onClick={() => setMode("agora")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${mode === "agora" ? "bg-white shadow text-rose-700" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Gavel className="h-3.5 w-3.5" /> Ágora
              </button>
            </div>

            {me?.ok ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-rose-700">{me.username}</span>
                </div>
                <button onClick={() => void handleLogout()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <LogOutIcon className="h-3.5 w-3.5" /> Sair
                </button>
              </div>
            ) : (
              <button onClick={() => setShowLogin(!showLogin)} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                <LogIn className="h-4 w-4" /> Entrar
              </button>
            )}
          </div>
        </div>

        {showLogin && !me?.ok && (
          <div className="bg-card border rounded-xl p-6 max-w-sm shadow-sm">
            <h3 className="font-semibold mb-4">Entrar na Assembleia</h3>
            <form onSubmit={e => void handleLogin(e)} className="space-y-3">
              <input value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Usuário (mesmo do Clube)" required className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
              <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Senha" required className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
              {loginError && <p className="text-sm text-red-500">{loginError}</p>}
              <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 rounded-lg transition-colors text-sm">Entrar</button>
            </form>
          </div>
        )}

        {me?.ok && (
          <div className="bg-card border-2 border-rose-200 rounded-xl p-6 space-y-3">
            <h3 className="font-semibold text-rose-700 flex items-center gap-2">
              {mode === "agora" ? <Gavel className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {mode === "agora" ? "Abrir nova Ágora" : "Convocar nova Assembleia"}
            </h3>
            <form onSubmit={e => void handleCreate(e)} className="flex gap-3">
              <input
                value={newTopic}
                onChange={e => setNewTopic(e.target.value)}
                placeholder={mode === "agora" ? "Tema da Ágora — o conselho vota para responder..." : "Tema ou pauta da Assembleia..."}
                className="flex-1 border-2 border-rose-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-rose-400 bg-white"
              />
              <button type="submit" disabled={creating || !newTopic.trim()} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold px-6 py-3 rounded-lg transition-colors">
                {mode === "agora" ? <Gavel className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
                {creating ? "Abrindo..." : mode === "agora" ? "Abrir Ágora" : "Convocar"}
              </button>
            </form>
            <p className="text-xs text-muted-foreground">
              {mode === "agora"
                ? "Cada fala dispara uma votação simultânea. Quem tiver nota mais alta responde primeiro."
                : "Ao encerrar, o Agente analisa toda a conversa e envia um relatório editorial por email."}
            </p>
          </div>
        )}

        {!loading && live.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Circle className="h-3 w-3 fill-green-500 text-green-500" /> Em sessão ({live.length})
            </h2>
            <div className="space-y-2">
              {live.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(mode === "agora" ? `/agora/${s.id}` : `/assembleia/${s.id}`)}
                  className="w-full text-left bg-card border-2 border-rose-200 hover:border-rose-400 rounded-xl px-4 py-3 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-2 w-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
                      <div>
                        <p className="font-semibold text-sm group-hover:text-rose-700 transition-colors">{s.topic}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          por {s.createdBy} — {format(new Date(s.createdAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs bg-rose-100 text-rose-700 font-semibold px-2 py-0.5 rounded-full shrink-0">
                      {mode === "agora" ? "ÁGORA" : "EM SESSÃO"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && closed.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> Encerradas ({closed.length})
            </h2>
            <div className="space-y-2">
              {closed.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(mode === "agora" ? `/agora/${s.id}` : `/assembleia/${s.id}`)}
                  className="w-full text-left bg-card border border-muted hover:border-muted-foreground/40 rounded-xl px-4 py-3 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium text-sm text-muted-foreground">{s.topic}</p>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          Encerrada por {s.createdBy} — {s.closedAt && format(new Date(s.closedAt), "d/MM/yyyy HH:mm")}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground/60 shrink-0">ver →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && currentSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed rounded-xl">
            {mode === "agora" ? <Gavel className="h-12 w-12 mb-3 opacity-20" /> : <Scale className="h-12 w-12 mb-3 opacity-20" />}
            <p className="font-medium">{mode === "agora" ? "Nenhuma Ágora ainda" : "Nenhuma Assembleia ainda"}</p>
            <p className="text-sm mt-1">{me?.ok ? "Abra a primeira acima!" : "Entre para participar."}</p>
          </div>
        )}

      </div>
    </MainLayout>
  );
}

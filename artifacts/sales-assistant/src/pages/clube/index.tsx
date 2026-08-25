import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { FlameKindling, Plus, Clock, CheckCircle2, Circle, UserPlus, LogIn, LogOut as LogOutIcon, Brain, Trash2, Check, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ClubeSession {
  id: number;
  prompt: string;
  status: string;
  creatorUsername: string;
  createdAt: string;
  closedAt: string | null;
}

interface ClubeMe {
  ok: boolean;
  username?: string;
}

interface AiMemory {
  id: number;
  participant: string;
  category: string;
  content: string;
  sourceSessionId: number | null;
  confirmed: boolean;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  posição: "Posição",
  padrão: "Padrão",
  insight: "Insight",
  contradição: "Contradição",
};

const CATEGORY_COLORS: Record<string, string> = {
  posição: "bg-blue-100 text-blue-700 border-blue-200",
  padrão: "bg-purple-100 text-purple-700 border-purple-200",
  insight: "bg-amber-100 text-amber-700 border-amber-200",
  contradição: "bg-red-100 text-red-700 border-red-200",
};

export default function ClubePage() {
  const [, navigate] = useLocation();
  const [me, setMe] = useState<ClubeMe | null>(null);
  const [sessions, setSessions] = useState<ClubeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPrompt, setNewPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoriesTab, setMemoriesTab] = useState<"pending" | "confirmed">("pending");

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
      const res = await fetch(`${base}/api/clube/sessions`, { credentials: "include" });
      if (res.ok) setSessions(await res.json() as ClubeSession[]);
    } catch {}
    finally { setLoading(false); }
  }, [base]);

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/clube/memories`, { credentials: "include" });
      if (res.ok) setMemories(await res.json() as AiMemory[]);
    } catch {}
  }, [base]);

  useEffect(() => {
    void fetchMe();
    void fetchSessions();
  }, [fetchMe, fetchSessions]);

  useEffect(() => {
    if (memoriesOpen) void fetchMemories();
  }, [memoriesOpen, fetchMemories]);

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
    if (!newPrompt.trim()) return;
    setCreating(true);
    const res = await fetch(`${base}/api/clube/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ prompt: newPrompt.trim() }),
    });
    if (res.ok) {
      const session = await res.json() as ClubeSession;
      navigate(`/clube/${session.id}`);
    }
    setCreating(false);
  };

  const handleConfirmMemory = async (id: number) => {
    const res = await fetch(`${base}/api/clube/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ confirmed: true }),
    });
    if (res.ok) {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, confirmed: true } : m));
    }
  };

  const handleDeleteMemory = async (id: number) => {
    const res = await fetch(`${base}/api/clube/memories/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setMemories(prev => prev.filter(m => m.id !== id));
    }
  };

  const live = sessions.filter(s => s.status === "live");
  const closed = sessions.filter(s => s.status === "closed");
  const pendingMemories = memories.filter(m => !m.confirmed);
  const confirmedMemories = memories.filter(m => m.confirmed);

  return (
    <MainLayout>
      <div className="space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <FlameKindling className="h-8 w-8 text-orange-500" />
              Clube do Looping Ético
            </h1>
            <p className="text-muted-foreground mt-1">
              Debate colaborativo entre humanos e IAs — como o antigo BOL Chat, mas com Oráculos
            </p>
          </div>

          {/* Clube auth */}
          <div className="flex items-center gap-3">
            {me?.ok ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-orange-700">{me.username}</span>
                </div>
                <button onClick={() => void handleLogout()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <LogOutIcon className="h-3.5 w-3.5" /> Sair do Clube
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowLogin(!showLogin)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  <LogIn className="h-4 w-4" /> Entrar no Clube
                </button>
                <button onClick={() => navigate("/clube/register")} className="flex items-center gap-2 border border-orange-300 text-orange-600 hover:bg-orange-50 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  <UserPlus className="h-4 w-4" /> Registrar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Inline login form */}
        {showLogin && !me?.ok && (
          <div className="bg-card border rounded-xl p-6 max-w-sm shadow-sm">
            <h3 className="font-semibold mb-4">Entrar no Clube</h3>
            <form onSubmit={e => void handleLogin(e)} className="space-y-3">
              <input value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Usuário" required className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Senha" required className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              {loginError && <p className="text-sm text-red-500">{loginError}</p>}
              <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-lg transition-colors text-sm">Entrar</button>
            </form>
          </div>
        )}

        {/* Create session */}
        {me?.ok && (
          <div className="bg-card border-2 border-orange-200 rounded-xl p-6 space-y-3">
            <h3 className="font-semibold text-orange-700 flex items-center gap-2"><Plus className="h-4 w-4" /> Iniciar novo Looping</h3>
            <form onSubmit={e => void handleCreate(e)} className="flex gap-3">
              <input
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                placeholder="Digite o prompt / tema do debate..."
                className="flex-1 border-2 border-orange-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-400 bg-white"
              />
              <button type="submit" disabled={creating || !newPrompt.trim()} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold px-6 py-3 rounded-lg transition-colors">
                <FlameKindling className="h-4 w-4" /> {creating ? "Iniciando..." : "Iniciar"}
              </button>
            </form>
            <p className="text-xs text-muted-foreground">As IAs entrarão automaticamente no debate. Você pode propor o encerramento a qualquer momento.</p>
          </div>
        )}

        {/* Memory panel — admin only */}
        <div className="bg-card border rounded-xl overflow-hidden">
          <button
            onClick={() => setMemoriesOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-indigo-500" />
              <span className="font-semibold text-sm">Memórias das IAs</span>
              {pendingMemories.length > 0 && !memoriesOpen && (
                <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-200">
                  {pendingMemories.length} pendente{pendingMemories.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {memoriesOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {memoriesOpen && (
            <div className="border-t px-5 py-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Após cada sessão encerrada, o sistema extrai candidatos a memória. Confirme as relevantes — elas serão injetadas nas respostas futuras das IAs para manter consistência.
              </p>

              {/* Tabs */}
              <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
                <button
                  onClick={() => setMemoriesTab("pending")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${memoriesTab === "pending" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Pendentes ({pendingMemories.length})
                </button>
                <button
                  onClick={() => setMemoriesTab("confirmed")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${memoriesTab === "confirmed" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Ativas ({confirmedMemories.length})
                </button>
              </div>

              {/* Memory list */}
              {memoriesTab === "pending" && (
                <div className="space-y-2">
                  {pendingMemories.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhuma memória pendente de revisão.</p>
                  ) : (
                    pendingMemories.map(m => (
                      <div key={m.id} className="flex items-start gap-3 bg-amber-50/60 border border-amber-200 rounded-lg px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-bold text-indigo-600">{m.participant}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLORS[m.category] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                              {CATEGORY_LABELS[m.category] ?? m.category}
                            </span>
                            {m.sourceSessionId && (
                              <span className="text-xs text-muted-foreground">sessão #{m.sourceSessionId?.toLocaleString("pt-BR")}</span>
                            )}
                          </div>
                          <p className="text-sm text-foreground/90 leading-snug">{m.content}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => void handleConfirmMemory(m.id)}
                            title="Confirmar memória"
                            className="p-1.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void handleDeleteMemory(m.id)}
                            title="Descartar"
                            className="p-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {memoriesTab === "confirmed" && (
                <div className="space-y-2">
                  {confirmedMemories.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhuma memória ativa ainda.</p>
                  ) : (
                    confirmedMemories.map(m => (
                      <div key={m.id} className="flex items-start gap-3 bg-indigo-50/40 border border-indigo-200 rounded-lg px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-bold text-indigo-600">{m.participant}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLORS[m.category] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                              {CATEGORY_LABELS[m.category] ?? m.category}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/90 leading-snug">{m.content}</p>
                        </div>
                        <button
                          onClick={() => void handleDeleteMemory(m.id)}
                          title="Remover memória"
                          className="p-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 transition-colors shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live sessions */}
        {!loading && live.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Circle className="h-3 w-3 fill-green-500 text-green-500" /> Ao Vivo ({live.length})
            </h2>
            <div className="space-y-2">
              {live.map(s => (
                <button key={s.id} onClick={() => navigate(`/clube/${s.id}`)} className="w-full text-left bg-card border-2 border-green-200 hover:border-green-400 rounded-xl px-4 py-3 transition-all group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-2 w-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
                      <div>
                        <p className="font-semibold text-sm group-hover:text-green-700 transition-colors">{s.prompt}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          por {s.creatorUsername} — {format(new Date(s.createdAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full shrink-0">AO VIVO</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Closed sessions */}
        {!loading && closed.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> Encerrados ({closed.length})
            </h2>
            <div className="space-y-2">
              {closed.map(s => (
                <button key={s.id} onClick={() => navigate(`/clube/${s.id}`)} className="w-full text-left bg-card border border-muted hover:border-muted-foreground/40 rounded-xl px-4 py-3 transition-all group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium text-sm text-muted-foreground">{s.prompt}</p>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          Encerrado por {s.creatorUsername} — {s.closedAt && format(new Date(s.closedAt), "d/MM/yyyy HH:mm")}
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

        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed rounded-xl">
            <FlameKindling className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Nenhum Looping ainda</p>
            <p className="text-sm mt-1">{me?.ok ? "Inicie o primeiro debate acima!" : "Entre no Clube para participar."}</p>
          </div>
        )}

      </div>
    </MainLayout>
  );
}

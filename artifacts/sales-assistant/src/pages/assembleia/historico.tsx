import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { Scale, ArrowLeft, BookOpen, Brain, ChevronDown, ChevronUp, Calendar, Sparkles, Loader2, Download } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HistoricoSession {
  id: number;
  topic: string;
  createdBy: string;
  closedAt: string;
  publicContent: string;
  withheldCount: number;
  secretExists: boolean;
  metaAnalysis: string | null;
}

interface CuradorResult {
  synthesis: string;
  patterns: string[];
  longTermInsight: string;
}

export default function AssembleiaHistorico() {
  const [, navigate] = useLocation();
  const [sessions, setSessions] = useState<HistoricoSession[]>([]);
  const [contagem, setContagem] = useState<{ total: number; closed: number; live: number; maxId: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [curadorResult, setCuradorResult] = useState<CuradorResult | null>(null);
  const [curadorLoading, setCuradorLoading] = useState(false);
  const [baixando, setBaixando] = useState<Record<number, boolean>>({});
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const baixarPdf = async (id: number) => {
    setBaixando(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`${base}/api/assembleia/sessions/${id}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assembleia-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Não foi possível gerar o PDF desta sessão.");
    }
    setBaixando(b => ({ ...b, [id]: false }));
  };

  useEffect(() => {
    void (async () => {
      try {
        const [res, cRes] = await Promise.all([
          fetch(`${base}/api/assembleia/historico`, { credentials: "include" }),
          fetch(`${base}/api/assembleia/contagem`, { credentials: "include" }),
        ]);
        if (res.ok) setSessions(await res.json() as HistoricoSession[]);
        if (cRes.ok) setContagem(await cRes.json() as { total: number; closed: number; live: number; maxId: number });
      } catch {}
      setLoading(false);
    })();
  }, [base]);

  const handleCurador = async () => {
    setCuradorLoading(true);
    setCuradorResult(null);
    try {
      const res = await fetch(`${base}/api/assembleia/curador`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) setCuradorResult(await res.json() as CuradorResult);
    } catch {}
    setCuradorLoading(false);
  };

  const toggle = (id: number) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/assembleia")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-rose-600" />
              Histórico da Assembleia
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Todas as sessões encerradas — prompts, relatórios editoriais e análises.
            </p>
            {contagem && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-full">
                  {contagem.total.toLocaleString("pt-BR")} totais
                </span>
                <span className="text-xs font-mono bg-zinc-50 text-zinc-600 border border-zinc-200 px-2.5 py-1 rounded-full">
                  {contagem.closed.toLocaleString("pt-BR")} encerradas
                </span>
                <span className="text-xs font-mono bg-zinc-50 text-zinc-600 border border-zinc-200 px-2.5 py-1 rounded-full">
                  último ID: #{contagem.maxId.toLocaleString("pt-BR")}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => void handleCurador()}
            disabled={curadorLoading || sessions.length === 0}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {curadorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Curador
          </button>
        </div>

        {/* Curador cross-session synthesis */}
        {curadorResult && (
          <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-300 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              <h2 className="font-bold text-violet-700 uppercase tracking-wide text-sm">Síntese do Curador</h2>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">{curadorResult.synthesis}</p>
            {curadorResult.patterns.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-2">Padrões Recorrentes</p>
                <ul className="space-y-1">
                  {curadorResult.patterns.map((p, i) => (
                    <li key={i} className="text-sm text-foreground/70 flex gap-2">
                      <span className="text-violet-400 shrink-0">◆</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {curadorResult.longTermInsight && (
              <div className="border-t border-violet-200 pt-3">
                <p className="text-xs font-semibold text-violet-500 uppercase tracking-wide mb-1">Insight de Longo Prazo</p>
                <p className="text-sm text-foreground/70 italic">{curadorResult.longTermInsight}</p>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 rounded-full border-4 border-rose-400 border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed rounded-xl">
            <BookOpen className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Nenhuma sessão encerrada ainda</p>
            <p className="text-sm mt-1">Encerre uma Assembleia para ela aparecer aqui.</p>
          </div>
        )}

        {!loading && sessions.map(s => (
          <div key={s.id} className="bg-card border rounded-xl overflow-hidden shadow-sm hover:border-rose-300 transition-colors">
            {/* Header — card inteiro clicável navega pra sessão */}
            <div
              onClick={() => navigate(`/assembleia/${s.id}`)}
              className="px-5 py-4 border-b bg-muted/20 cursor-pointer hover:bg-rose-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base leading-snug">{s.topic}</h3>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    por {s.createdBy} · {format(new Date(s.closedAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); void baixarPdf(s.id); }}
                    disabled={baixando[s.id]}
                    title="Baixar PDF completo (ata, resultado, análise e PERFEITO)"
                    className="flex items-center gap-1 text-xs text-indigo-600 font-semibold border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {baixando[s.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    PDF
                  </button>
                  <span className="text-xs text-rose-600 font-semibold border border-rose-200 px-2.5 py-1 rounded-lg">
                    Ver sessão →
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(s.id); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expanded[s.id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Editorial summary — always shown */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Scale className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-xs font-semibold text-rose-600 uppercase tracking-wide">Publicado pelo Agente</span>
              </div>
              {s.publicContent ? (
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{s.publicContent}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nada foi publicado nesta sessão.</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                {s.withheldCount > 0 && (
                  <span className="bg-muted px-2 py-0.5 rounded-full">{s.withheldCount} retidos</span>
                )}
                {s.secretExists && (
                  <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded-full font-mono">[REDACTED]</span>
                )}
              </div>
            </div>

            {/* Meta-analysis — expandable */}
            {expanded[s.id] && (
              <div className="border-t bg-muted/10 px-5 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Brain className="h-3.5 w-3.5 text-indigo-500" />
                  <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Análise Metassemiótica</span>
                </div>
                {s.metaAnalysis ? (
                  <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{s.metaAnalysis}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Análise não disponível para esta sessão.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </MainLayout>
  );
}

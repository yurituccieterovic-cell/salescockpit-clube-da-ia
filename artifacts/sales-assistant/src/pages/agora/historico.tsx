import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { Gavel, ChevronDown, ChevronUp, Loader2, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AiVote { sender: string; score: number }
interface TurnSummary {
  roundNum: number;
  humanSender: string;
  humanContent: string;
  aiVotes: AiVote[];
}
interface AgoraHistoricoEntry {
  id: number;
  topic: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  totalRounds: number;
  aiResponses: number;
  avgScore: number;
  turns: TurnSummary[];
}

const AI_COLORS: Record<string, string> = {
  "ChatGPT": "#06b6d4", "Claude": "#f97316", "Gemini": "#8b5cf6",
  "Meta AI": "#1877f2", "Grok": "#374151", "Árvore": "#d97706",
  "Agente": "#e11d48", "Arquiteto": "#059669",
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 9 ? "bg-rose-600" : score >= 7 ? "bg-orange-500" : score >= 5 ? "bg-amber-400" : score >= 3 ? "bg-yellow-300" : "bg-gray-200";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className="text-[10px] font-black text-muted-foreground">{score}</span>
    </div>
  );
}

function SessionCard({ entry }: { entry: AgoraHistoricoEntry }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <div
        className="p-5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Gavel className="h-4 w-4 text-rose-500 shrink-0" />
              <p className="font-bold text-sm truncate">{entry.topic}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{entry.createdBy}</span>
              <span>·</span>
              {entry.closedAt && (
                <span>{format(new Date(entry.closedAt), "d MMM yyyy, HH:mm", { locale: ptBR })}</span>
              )}
              <span>·</span>
              <span>{entry.totalRounds} rodada{entry.totalRounds !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span className="font-semibold text-rose-600">Média {entry.avgScore}/10</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/agora/${entry.id}`); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-600 transition-colors"
            >
              Ver sessão <ArrowRight className="h-3 w-3" />
            </button>
            {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {open && entry.turns.length > 0 && (
        <div className="border-t px-5 pb-5 pt-4 space-y-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ata resumida</p>
          {entry.turns.map(turn => (
            <div key={turn.roundNum} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">
                  Rodada {turn.roundNum}
                </span>
                <div className="flex-1 h-px bg-rose-100" />
              </div>
              {turn.humanContent && (
                <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm border border-slate-100">
                  <span className="font-semibold text-xs text-rose-600 mr-2">{turn.humanSender}:</span>
                  <span className="text-foreground">{turn.humanContent}</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 pl-2">
                {turn.aiVotes.map(vote => (
                  <div key={vote.sender} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate" style={{ color: AI_COLORS[vote.sender] ?? "#888" }}>
                      {vote.sender}
                    </span>
                    <ScoreBar score={vote.score} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgoraHistoricoPage() {
  const [sessions, setSessions] = useState<AgoraHistoricoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${base}/api/agora/historico`, { credentials: "include" });
    if (res.ok) setSessions(await res.json() as AgoraHistoricoEntry[]);
    setLoading(false);
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const latest = sessions[0];

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="space-y-8 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Gavel className="h-6 w-6 text-rose-600" />
            <h1 className="text-3xl font-black tracking-tight">Histórico da Ágora</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Arquivo somente-leitura de todas as Ágoras encerradas.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Gavel className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Nenhuma Ágora encerrada ainda.</p>
          </div>
        ) : (
          <>
            {latest && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-2">Última sessão</p>
                <p className="font-bold text-sm">{latest.topic}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-rose-700">
                  <span>{latest.totalRounds} rodada{latest.totalRounds !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{latest.aiResponses} resposta{latest.aiResponses !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span className="font-bold">Média {latest.avgScore}/10</span>
                  {latest.closedAt && (
                    <>
                      <span>·</span>
                      <span>{format(new Date(latest.closedAt), "d MMM yyyy", { locale: ptBR })}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {sessions.map(s => <SessionCard key={s.id} entry={s} />)}
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

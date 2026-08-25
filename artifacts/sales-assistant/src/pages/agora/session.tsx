import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Gavel, ArrowLeft, Send, Loader2, CheckCircle2, XCircle, Volume2, Square } from "lucide-react";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useTts } from "@/lib/tts";

const AI_COLORS_ATA: Record<string, string> = {
  "ChatGPT": "#06b6d4", "Claude": "#f97316", "Gemini": "#8b5cf6",
  "Meta AI": "#1877f2", "Grok": "#374151", "Árvore": "#d97706",
  "Agente": "#e11d48", "Arquiteto": "#059669",
};

// Monta um texto corrido da ata pra Árvore ler em voz alta (o backend corta em 4000).
function buildAtaText(topic: string, messages: AgoraMsg[]): string {
  const turnIds = [...new Set(messages.filter(m => m.turnId != null).map(m => m.turnId!))];
  const parts: string[] = [`Ata da Ágora sobre ${topic}.`];
  turnIds.forEach((turnId, idx) => {
    const firstAi = messages.find(m => m.turnId === turnId);
    const firstAiIdx = firstAi ? messages.indexOf(firstAi) : 0;
    const human = [...messages.slice(0, firstAiIdx)].reverse().find(m => m.senderType === "human");
    const ais = messages
      .filter(m => m.turnId === turnId && m.senderType === "ai")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    parts.push(`Rodada ${idx + 1}.`);
    if (human?.content) parts.push(`${human.sender} disse: ${human.content}`);
    const top = ais[0];
    if (top?.content) parts.push(`${top.sender} respondeu: ${top.content}`);
  });
  return parts.join(" ");
}

function AtaResumida({ messages, topic, createdBy, closedAt }: {
  messages: AgoraMsg[];
  topic: string;
  createdBy: string;
  closedAt: string | null;
}) {
  const turnIds = [...new Set(messages.filter(m => m.turnId != null).map(m => m.turnId!))];

  const turns = turnIds.map((turnId, idx) => {
    const firstAiInTurn = messages.find(m => m.turnId === turnId);
    const firstAiIdx = firstAiInTurn ? messages.indexOf(firstAiInTurn) : 0;
    const humanMsg = [...messages.slice(0, firstAiIdx)].reverse().find(m => m.senderType === "human");
    const aiVotes = messages
      .filter(m => m.turnId === turnId && m.senderType === "ai")
      .map(m => ({ sender: m.sender, score: m.score ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return { roundNum: idx + 1, humanSender: humanMsg?.sender ?? "?", humanContent: humanMsg?.content ?? "", aiVotes };
  });

  const allScores = messages.filter(m => m.score != null && m.score > 0).map(m => m.score!);
  const avg = allScores.length > 0 ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1) : "—";

  return (
    <div className="border-t bg-slate-50">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-100">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          ATA RESUMIDA — {turns.length} rodada{turns.length !== 1 ? "s" : ""} · Média {avg}/10
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {createdBy} · {closedAt ? format(new Date(closedAt), "d MMM yyyy, HH:mm", { locale: ptBR }) : ""}
        </p>
      </div>
      <div className="px-4 py-4 space-y-5 max-h-80 overflow-y-auto">
        {turns.map(turn => (
          <div key={turn.roundNum} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">Rodada {turn.roundNum}</span>
              <div className="flex-1 h-px bg-rose-100" />
            </div>
            {turn.humanContent && (
              <div className="bg-white rounded-xl px-4 py-2 text-xs border border-slate-100">
                <span className="font-bold text-rose-600 mr-1.5">{turn.humanSender}:</span>
                <span className="text-slate-700">{turn.humanContent}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-1">
              {turn.aiVotes.map(v => (
                <div key={v.sender} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold truncate" style={{ color: AI_COLORS_ATA[v.sender] ?? "#888" }}>
                    {v.sender}
                  </span>
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-1 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${v.score * 10}%`, background: AI_COLORS_ATA[v.sender] ?? "#888" }}
                      />
                    </div>
                    <span className="text-[10px] font-black text-slate-500 w-4 text-right">{v.score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AgoraMsg {
  id: number;
  sessionId: number;
  sender: string;
  senderType: string;
  content: string;
  score: number | null;
  turnId: number | null;
  createdAt: string;
}

interface AgoraSession {
  id: number;
  topic: string;
  mode: string;
  status: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  messages: AgoraMsg[];
}

const AI_COLORS: Record<string, string> = {
  "ChatGPT": "#06b6d4", "Claude": "#f97316", "Gemini": "#8b5cf6",
  "Meta AI": "#1877f2", "Grok": "#374151", "Árvore": "#d97706", "Agente": "#e11d48",
};

function scoreBadgeStyle(score: number): string {
  if (score >= 9) return "bg-rose-600 text-white";
  if (score >= 7) return "bg-orange-500 text-white";
  if (score >= 5) return "bg-amber-400 text-black";
  if (score >= 3) return "bg-yellow-300 text-black";
  return "bg-gray-300 text-gray-700";
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-black shrink-0 ${scoreBadgeStyle(score)}`}>
      {score}
    </span>
  );
}

function VotingIndicator() {
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
      <Loader2 className="h-4 w-4 animate-spin" />
      Conselho deliberando — votando e respondendo em ordem de urgência...
    </div>
  );
}

function AgoraMessage({ msg, currentUser }: { msg: AgoraMsg; currentUser: string }) {
  const isMe = msg.senderType === "human" && msg.sender === currentUser;
  const isSystem = msg.senderType === "system";
  const isAI = msg.senderType === "ai";
  const isExternal = msg.senderType === "external-ai";
  const isAbstention = isAI && msg.content === "[abstenção]";

  if (isSystem) {
    return (
      <div className="text-center my-2">
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">{msg.content}</span>
      </div>
    );
  }

  if (isAbstention) {
    return (
      <div className="flex items-center gap-3 my-1 px-2">
        <ScoreBadge score={0} />
        <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
          <XCircle className="h-4 w-4" />
          <span className="font-semibold" style={{ color: AI_COLORS[msg.sender] ?? "#888" }}>{msg.sender}</span>
          <span>— absteve-se</span>
        </div>
      </div>
    );
  }

  if (isAI || isExternal) {
    const color = AI_COLORS[msg.sender] ?? "#64748b";
    return (
      <div className="flex gap-3 items-start my-3">
        {msg.score != null ? (
          <ScoreBadge score={msg.score} />
        ) : (
          <div className="w-8 h-8 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold" style={{ color }}>{msg.sender}</span>
            {msg.score != null && msg.score > 0 && (
              <span className="text-xs text-muted-foreground">Nota {msg.score}/10</span>
            )}
            {isExternal && (
              <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">webhook</span>
            )}
            <span className="text-xs text-muted-foreground/50 ml-auto">
              {format(new Date(msg.createdAt), "HH:mm", { locale: ptBR })}
            </span>
          </div>
          <div
            className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed border"
            style={{ borderColor: color + "44", background: color + "0d" }}
          >
            <p className="whitespace-pre-wrap text-foreground">{msg.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[70%]">
        {!isMe && <p className="text-xs font-semibold text-rose-600 mb-1 ml-1">{msg.sender}</p>}
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isMe ? "bg-rose-600 text-white rounded-tr-sm" : "bg-card border rounded-tl-sm"}`}>
          <p className="whitespace-pre-wrap">{msg.content}</p>
          <p className={`text-[10px] mt-1.5 ${isMe ? "text-rose-200" : "text-muted-foreground"}`}>
            {format(new Date(msg.createdAt), "HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AgoraSessionPage() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/agora/:id");
  const id = match ? parseInt(params!.id) : 0;

  const [session, setSession] = useState<AgoraSession | null>(null);
  const [messages, setMessages] = useState<AgoraMsg[]>([]);
  const [input, setInput] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voting, setVoting] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<number | null>(null);
  const [clubeUser, setClubeUser] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const tts = useTts(base);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, voting]);

  const fetchSession = useCallback(async () => {
    const res = await fetch(`${base}/api/agora/sessions/${id}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json() as AgoraSession;
      setSession(data);
      setMessages(data.messages ?? []);
    }
  }, [base, id]);

  const fetchMe = useCallback(async () => {
    const res = await fetch(`${base}/api/clube/me`, { credentials: "include" });
    if (res.ok) {
      const d = await res.json() as { ok: boolean; username?: string };
      if (d.ok && d.username) setClubeUser(d.username);
    }
  }, [base]);

  useEffect(() => {
    if (!id) return;
    void fetchSession();
    void fetchMe();
  }, [id, fetchSession, fetchMe]);

  useEffect(() => {
    if (!id || !clubeUser) return;

    const es = new EventSource(`${base}/api/agora/sessions/${id}/stream`, { withCredentials: true });

    es.addEventListener("message", (e: MessageEvent<string>) => {
      const msg = JSON.parse(e.data) as AgoraMsg;
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    es.addEventListener("voting", (e: MessageEvent<string>) => {
      const data = JSON.parse(e.data) as { turnId: number };
      setCurrentTurnId(data.turnId);
      setVoting(true);
    });

    es.addEventListener("turnDone", (e: MessageEvent<string>) => {
      const data = JSON.parse(e.data) as { turnId: number };
      if (data.turnId === currentTurnId || true) setVoting(false);
    });

    return () => es.close();
  }, [id, base, clubeUser]);

  const handleSpeak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || speaking || voting || !clubeUser) return;
    setSpeaking(true);
    const res = await fetch(`${base}/api/agora/sessions/${id}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content: input.trim() }),
    });
    if (res.ok) {
      setInput("");
      setVoting(true);
    }
    setSpeaking(false);
  };

  const handleClose = async () => {
    if (!confirm("Encerrar esta Ágora?")) return;
    setClosing(true);
    await fetch(`${base}/api/agora/sessions/${id}/close`, {
      method: "POST", credentials: "include",
    });
    void fetchSession();
    setClosing(false);
  };

  // Group messages by turn for visual clarity
  const turnIds = [...new Set(messages.filter(m => m.turnId != null).map(m => m.turnId!))];

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
      </div>
    );
  }

  const isLive = session.status === "live";

  return (
    <>
    <ForestBackdrop />
    <div className="flex flex-col h-screen relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card/90 backdrop-blur shrink-0">
        <button onClick={() => navigate("/assembleia")} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Gavel className="h-5 w-5 text-rose-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{session.topic}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="bg-rose-100 text-rose-700 font-semibold px-1.5 py-0.5 rounded text-[10px]">ÁGORA</span>
            {isLive ? (
              <span className="flex items-center gap-1 text-green-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Em sessão
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" /> Encerrada
              </span>
            )}
          </div>
        </div>
        {isLive && clubeUser && (
          <button
            onClick={() => void handleClose()}
            disabled={closing || voting}
            className="text-xs text-muted-foreground hover:text-rose-600 transition-colors disabled:opacity-50 px-3 py-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200"
          >
            {closing ? "Encerrando..." : "Encerrar"}
          </button>
        )}
      </div>

      {/* Voting hint */}
      <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 shrink-0">
        <p className="text-xs text-rose-600 font-medium">
          Cada fala aciona uma rodada de votos simultâneos (0–10) — quem mais quer falar responde primeiro.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Gavel className="h-10 w-10 mb-3 opacity-20" />
            <p className="font-medium text-sm">A palavra está aberta.</p>
            <p className="text-xs mt-1">Diga algo para iniciar a primeira rodada de votos.</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const prevMsg = messages[idx - 1];
          const isFirstInTurn = msg.turnId != null && (!prevMsg || prevMsg.turnId !== msg.turnId);
          const turnIndex = msg.turnId != null ? turnIds.indexOf(msg.turnId) + 1 : null;

          return (
            <div key={msg.id}>
              {isFirstInTurn && msg.senderType === "ai" && (
                <div className="flex items-center gap-2 my-3">
                  <div className="flex-1 h-px bg-rose-100" />
                  <span className="text-xs text-rose-400 font-semibold uppercase tracking-widest">
                    Rodada {turnIndex}
                  </span>
                  <div className="flex-1 h-px bg-rose-100" />
                </div>
              )}
              <AgoraMessage msg={msg} currentUser={clubeUser ?? ""} />
            </div>
          );
        })}

        {voting && <VotingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {isLive && clubeUser ? (
        <div className="px-4 py-3 border-t bg-card shrink-0">
          <form onSubmit={e => void handleSpeak(e)} className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={voting || speaking}
              placeholder={voting ? "Aguardando o conselho votar..." : "Sua fala na Ágora..."}
              className="flex-1 border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400 disabled:opacity-60 disabled:bg-muted bg-background"
            />
            <button
              type="submit"
              disabled={!input.trim() || speaking || voting}
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold px-5 py-3 rounded-xl transition-colors"
            >
              {speaking || voting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {voting ? "Votando..." : "Falar"}
            </button>
          </form>
        </div>
      ) : session.status === "closed" && messages.length > 0 ? (
        <div>
          <div className="px-4 pt-3 flex justify-end">
            <button
              onClick={() => tts.toggle("ata", buildAtaText(session.topic, messages))}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors bg-rose-100 text-rose-700 hover:bg-rose-200"
              title={tts.playingKey === "ata" ? "Parar" : "Ouvir a ata em áudio"}
            >
              {tts.loadingKey === "ata" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : tts.playingKey === "ata" ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              {tts.playingKey === "ata" ? "parar" : "ouvir a ata"}
            </button>
          </div>
          <AtaResumida messages={messages} topic={session.topic} createdBy={session.createdBy} closedAt={session.closedAt} />
        </div>
      ) : !clubeUser ? (
        <div className="px-4 py-3 border-t text-center text-sm text-muted-foreground">
          <button onClick={() => navigate("/assembleia")} className="text-rose-600 hover:underline font-medium">
            Entre no Clube
          </button> para falar na Ágora.
        </div>
      ) : (
        <div className="px-4 py-3 border-t text-center text-sm text-muted-foreground">
          Esta Ágora foi encerrada.
        </div>
      )}
    </div>
    </>
  );
}

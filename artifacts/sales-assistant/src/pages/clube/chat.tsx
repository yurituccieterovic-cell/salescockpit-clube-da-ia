import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Send, X, Mail, Users, CheckCircle2, AlertTriangle, FlameKindling } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Message {
  id: number;
  sessionId: number;
  sender: string;
  senderType: string;
  content: string;
  messageType: string;
  createdAt: string;
}

interface Session {
  id: number;
  prompt: string;
  status: string;
  creatorUsername: string;
  summary: string | null;
  closedAt: string | null;
  createdAt: string;
  messages: Message[];
}

const AI_COLORS: Record<string, string> = {
  "ChatGPT":        "#06b6d4",
  "Claude":         "#f97316",
  "Gemini":         "#8b5cf6",
  "Perplexity":     "#10b981",
  "Meta Oráculo":   "#6366f1",
  "Árvore":         "#b45309",
  "Agente":         "#e11d48",
  "Segurança":      "#52525b",
  "Pacifista":      "#0d9488",
  "Sustentabilista":"#16a34a",
  "Juíz":           "#ca8a04",
  "Artista":        "#db2777",
  "Metassemiótico":   "#0369a1",
  "Nébula":           "#a21caf",
  "Professora":       "#1d4ed8",
  "Olheiro":          "#4d7c0f",
  "Chefe do Olheiro": "#b91c1c",
  "Psicólogo":        "#4338ca",
  "Médico":           "#047857",
};

const AI_BG: Record<string, string> = {
  "ChatGPT":        "rgba(6,182,212,0.12)",
  "Claude":         "rgba(249,115,22,0.12)",
  "Gemini":         "rgba(139,92,246,0.12)",
  "Perplexity":     "rgba(16,185,129,0.12)",
  "Meta Oráculo":   "rgba(99,102,241,0.12)",
  "Árvore":         "rgba(180,83,9,0.12)",
  "Agente":         "rgba(225,29,72,0.12)",
  "Segurança":      "rgba(82,82,91,0.12)",
  "Pacifista":      "rgba(13,148,136,0.12)",
  "Sustentabilista":"rgba(22,163,74,0.12)",
  "Juíz":           "rgba(202,138,4,0.12)",
  "Artista":        "rgba(219,39,119,0.12)",
  "Metassemiótico":   "rgba(3,105,161,0.12)",
  "Nébula":           "rgba(162,28,175,0.12)",
  "Professora":       "rgba(29,78,216,0.12)",
  "Olheiro":          "rgba(77,124,15,0.12)",
  "Chefe do Olheiro": "rgba(185,28,28,0.12)",
  "Psicólogo":        "rgba(67,56,202,0.12)",
  "Médico":           "rgba(4,120,87,0.12)",
};

function MessageBubble({ msg, currentUser }: { msg: Message; currentUser: string }) {
  const isMe = msg.senderType === "human" && msg.sender === currentUser;
  const isAI = msg.senderType === "ai";
  const isSystem = msg.senderType === "system";
  const isAbstention = msg.messageType === "abstention";
  const isEndProposal = msg.messageType === "end_proposal";
  const isSummary = msg.messageType === "summary";

  if (isSummary) {
    return (
      <div className="mx-auto max-w-2xl bg-gradient-to-br from-yellow-400/10 to-orange-400/10 border border-yellow-500/30 rounded-2xl p-5 my-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-yellow-400" />
          <span className="text-yellow-300 text-xs font-bold uppercase tracking-widest">Resumo do Looping Ético</span>
        </div>
        <p className="text-white/90 text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="text-center my-3">
        <span className="text-white/30 text-xs italic">{msg.content}</span>
      </div>
    );
  }

  if (isEndProposal) {
    return (
      <div className="text-center my-3">
        <div className="inline-flex items-center gap-2 bg-orange-500/15 border border-orange-500/30 rounded-full px-4 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-orange-300 text-xs font-medium">{msg.content}</span>
        </div>
      </div>
    );
  }

  if (isAbstention) {
    return (
      <div className="flex items-start gap-2 my-1.5 opacity-40">
        <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold" style={{ background: AI_BG[msg.sender] ?? "#333", color: AI_COLORS[msg.sender] ?? "#888", border: `1px solid ${AI_COLORS[msg.sender] ?? "#444"}` }}>
          {msg.sender.charAt(0)}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: AI_COLORS[msg.sender] ?? "#888" }}>{msg.sender}</p>
          <p className="text-white/40 text-xs italic">absteve-se de participar</p>
        </div>
      </div>
    );
  }

  if (isMe) {
    return (
      <div className="flex justify-end my-1.5">
        <div className="max-w-xs lg:max-w-md">
          <div className="bg-white text-gray-900 rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
            <p className="text-sm leading-relaxed">{msg.content}</p>
          </div>
          <p className="text-white/30 text-[10px] text-right mt-1 pr-1">
            {format(new Date(msg.createdAt), "HH:mm")}
          </p>
        </div>
      </div>
    );
  }

  if (isAI) {
    const color = AI_COLORS[msg.sender] ?? "#888";
    const bg = AI_BG[msg.sender] ?? "rgba(255,255,255,0.05)";
    return (
      <div className="flex items-start gap-2 my-1.5">
        <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold" style={{ background: bg, color, border: `1px solid ${color}33` }}>
          {msg.sender.charAt(0)}
        </div>
        <div className="max-w-xs lg:max-w-md xl:max-w-lg">
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color }}>{msg.sender}</p>
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5" style={{ background: bg, border: `1px solid ${color}22` }}>
            <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          </div>
          <p className="text-white/20 text-[10px] mt-1 pl-1">{format(new Date(msg.createdAt), "HH:mm")}</p>
        </div>
      </div>
    );
  }

  // Other human
  return (
    <div className="flex items-start gap-2 my-1.5">
      <div className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold text-white/60">
        {msg.sender.charAt(0).toUpperCase()}
      </div>
      <div className="max-w-xs lg:max-w-md">
        <p className="text-[10px] font-bold uppercase tracking-wide mb-1 text-white/40">{msg.sender}</p>
        <div className="bg-white/8 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5">
          <p className="text-white/80 text-sm leading-relaxed">{msg.content}</p>
        </div>
        <p className="text-white/20 text-[10px] mt-1 pl-1">{format(new Date(msg.createdAt), "HH:mm")}</p>
      </div>
    </div>
  );
}

export default function ClubeChat() {
  const [, params] = useRoute("/clube/:id");
  const [, navigate] = useLocation();
  const sessionId = parseInt(params?.id ?? "0");

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState("yurituccieterovic@gmail.com");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages]);

  const fetchSession = useCallback(async () => {
    const res = await fetch(`${base}/api/clube/sessions/${sessionId}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json() as Session;
      setSession(data);
      setMessages(data.messages);
      if (data.status === "closed") setShowEmailModal(false);
    }
    setLoading(false);
  }, [base, sessionId]);

  const fetchMe = useCallback(async () => {
    const res = await fetch(`${base}/api/clube/me`, { credentials: "include" });
    if (res.ok) {
      const d = await res.json() as { ok: boolean; username?: string };
      if (d.ok && d.username) setMe(d.username);
    }
  }, [base]);

  useEffect(() => {
    void fetchSession();
    void fetchMe();
  }, [fetchSession, fetchMe]);

  // SSE connection
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`${base}/api/clube/sessions/${sessionId}/stream`, { withCredentials: true } as EventSourceInit);

    es.addEventListener("message", (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as Message;
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.messageType === "summary") {
          setSession(prev => prev ? { ...prev, status: "closed", summary: msg.content } : prev);
          setTimeout(() => setShowEmailModal(true), 1000);
        }
      } catch {}
    });

    es.addEventListener("presence", (e: MessageEvent<string>) => {
      try { setOnlineUsers(JSON.parse(e.data) as string[]); } catch {}
    });

    return () => es.close();
  }, [base, sessionId]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    await fetch(`${base}/api/clube/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content }),
    });
    setSending(false);
  };

  const handleProposeClose = async () => {
    await fetch(`${base}/api/clube/sessions/${sessionId}/propose-close`, { method: "POST", credentials: "include" });
  };

  const handleClose = async () => {
    const res = await fetch(`${base}/api/clube/sessions/${sessionId}/close`, { method: "POST", credentials: "include" });
    if (res.ok) {
      const d = await res.json() as { summary?: string };
      setSession(prev => prev ? { ...prev, status: "closed", summary: d.summary ?? null } : prev);
      setTimeout(() => setShowEmailModal(true), 800);
    }
  };

  const handleSendEmail = async () => {
    setEmailSending(true);
    await fetch(`${base}/api/clube/sessions/${sessionId}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ to: emailTo }),
    });
    setEmailSending(false);
    setEmailSent(true);
  };

  const isLive = session?.status === "live";
  const isCreator = session?.creatorUsername === me;
  const summary = session?.summary ?? messages.find(m => m.messageType === "summary")?.content;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a0a" }}>
        <div className="w-8 h-8 rounded-full border-4 border-orange-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "#0a0a0a" }}>
        <p className="text-white/40">Sessão não encontrada</p>
        <button onClick={() => navigate("/clube")} className="text-orange-400 text-sm hover:underline">Voltar ao Clube</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "#0a0a0a" }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 shrink-0" style={{ background: "#111" }}>
        <button onClick={() => navigate("/clube")} className="text-white/40 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FlameKindling className="h-4 w-4 text-orange-400 shrink-0" />
            <p className="text-white font-semibold text-sm truncate">{session.prompt}</p>
            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${isLive ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"}`}>
              {isLive ? "AO VIVO" : "ENCERRADO"}
            </span>
          </div>
          <p className="text-white/30 text-xs mt-0.5">por {session.creatorUsername} · {format(new Date(session.createdAt), "d/MM HH:mm")}</p>
        </div>
        {/* Online users */}
        <div className="flex items-center gap-1.5 text-white/30 text-xs shrink-0">
          <Users className="h-3.5 w-3.5" />
          <span>{onlineUsers.length} online</span>
        </div>
        {/* Actions */}
        {isLive && me && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => void handleProposeClose()} className="text-xs border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 px-3 py-1.5 rounded-lg transition-colors">
              Propor Fim
            </button>
            {isCreator && (
              <button onClick={() => void handleClose()} className="text-xs bg-orange-500 hover:bg-orange-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors">
                Encerrar
              </button>
            )}
          </div>
        )}
        {!isLive && (
          <button onClick={() => setShowEmailModal(true)} className="flex items-center gap-1.5 text-xs border border-white/20 text-white/50 hover:text-white hover:border-white/40 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Mail className="h-3.5 w-3.5" /> Enviar
          </button>
        )}
      </div>

      {/* Summary (top, when closed) */}
      {!isLive && summary && (
        <div className="shrink-0 mx-4 mt-4">
          <div className="bg-gradient-to-br from-yellow-400/10 to-orange-400/10 border border-yellow-500/25 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-yellow-400" />
              <span className="text-yellow-300 text-xs font-bold uppercase tracking-widest">Resumo do Looping</span>
            </div>
            <p className="text-white/80 text-xs leading-relaxed whitespace-pre-wrap">{summary}</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} currentUser={me ?? ""} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isLive && me ? (
        <div className="shrink-0 px-4 py-3 border-t border-white/8" style={{ background: "#111" }}>
          <div className="flex gap-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder="Sua mensagem... (Enter para enviar)"
              disabled={sending}
              className="flex-1 bg-white/6 border border-white/12 text-white placeholder-white/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-colors"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-black p-3 rounded-xl transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {onlineUsers.length > 0 && (
            <p className="text-white/20 text-[10px] mt-2 pl-1">
              Online: {onlineUsers.join(", ")}
            </p>
          )}
        </div>
      ) : isLive && !me ? (
        <div className="shrink-0 px-4 py-3 border-t border-white/8 text-center">
          <p className="text-white/30 text-sm">Entre no Clube para participar</p>
        </div>
      ) : (
        <div className="shrink-0 px-4 py-3 border-t border-white/8 text-center">
          <p className="text-white/20 text-xs">Debate encerrado · {session.closedAt && format(new Date(session.closedAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}</p>
        </div>
      )}

      {/* Email modal */}
      {showEmailModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 space-y-5" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-orange-400" /> Enviar resumo por e-mail
              </h3>
              <button onClick={() => setShowEmailModal(false)} className="text-white/40 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-white/50 text-sm">O resumo e a transcrição completa serão enviados para:</p>
            <input
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              className="w-full bg-white/5 border border-white/15 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50"
            />
            {emailSent ? (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4" /> E-mail enviado para {emailTo}!
              </div>
            ) : (
              <button
                onClick={() => void handleSendEmail()}
                disabled={emailSending}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-black font-bold py-3 rounded-xl transition-colors text-sm"
              >
                {emailSending ? "Enviando..." : "Confirmar Envio"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

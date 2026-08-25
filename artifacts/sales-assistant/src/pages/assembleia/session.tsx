import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Scale, ArrowLeft, Send, CheckCircle2, AlertTriangle, Eye, EyeOff, Lock } from "lucide-react";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AsmMsg {
  id: number;
  sessionId: number;
  sender: string;
  senderType: string;
  content: string;
  createdAt: string;
}

interface AsmSession {
  id: number;
  topic: string;
  status: string;
  createdBy: string;
  editorialReport: string | null;
  closedAt: string | null;
  createdAt: string;
  messages: AsmMsg[];
}

interface EditorialReport {
  public_content: string;
  withheld: { what: string; reason: string }[];
  secret_exists: boolean;
}

function MessageBubble({ msg, currentUser }: { msg: AsmMsg; currentUser: string }) {
  const isMe = msg.senderType === "human" && msg.sender === currentUser;
  const isSystem = msg.senderType === "system";
  const isEditorial = msg.senderType === "editorial";

  if (isSystem) {
    return (
      <div className="text-center my-2">
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">{msg.content}</span>
      </div>
    );
  }

  if (isEditorial) {
    return (
      <div className="mx-auto max-w-2xl bg-gradient-to-br from-rose-500/10 to-pink-500/10 border border-rose-400/30 rounded-2xl p-5 my-4">
        <div className="flex items-center gap-2 mb-2">
          <Scale className="h-4 w-4 text-rose-500" />
          <span className="text-rose-400 text-xs font-bold uppercase tracking-widest">Relatório Editorial — Agente</span>
        </div>
        <p className="text-sm text-foreground/80">{msg.content}</p>
      </div>
    );
  }

  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[72%] ${isMe ? "order-2" : "order-1"}`}>
        {!isMe && (
          <p className="text-xs font-semibold text-rose-600 mb-1 ml-1">{msg.sender}</p>
        )}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isMe
              ? "bg-rose-600 text-white rounded-tr-sm"
              : "bg-card border border-border rounded-tl-sm text-foreground"
          }`}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
          <p className={`text-[10px] mt-1.5 ${isMe ? "text-rose-200" : "text-muted-foreground"}`}>
            {format(new Date(msg.createdAt), "HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>
    </div>
  );
}

function EditorialPanel({ report }: { report: EditorialReport }) {
  const [showWithheld, setShowWithheld] = useState(false);

  return (
    <div className="space-y-4">
      <div className="bg-card border-2 border-rose-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Eye className="h-4 w-4 text-rose-600" />
          <h3 className="font-semibold text-rose-700 text-sm uppercase tracking-wide">Publicado</h3>
        </div>
        {report.public_content ? (
          <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{report.public_content}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Nada desta sessão mereceu publicação.</p>
        )}
      </div>

      {report.withheld.length > 0 && (
        <div className="bg-card border border-muted rounded-xl p-5">
          <button
            onClick={() => setShowWithheld(v => !v)}
            className="flex items-center gap-2 w-full text-left"
          >
            <EyeOff className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              Não enviado ({report.withheld.length})
            </h3>
            <span className="ml-auto text-xs text-muted-foreground">{showWithheld ? "▲" : "▼"}</span>
          </button>
          {showWithheld && (
            <div className="mt-3 space-y-2">
              {report.withheld.map((w, i) => (
                <div key={i} className="text-sm text-foreground/70 border-l-2 border-muted pl-3">
                  <span className="font-medium">Não enviei "{w.what}"</span> porque {w.reason}.
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {report.secret_exists && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-4 flex items-center gap-3">
          <Lock className="h-4 w-4 text-zinc-400 shrink-0" />
          <p className="text-sm text-zinc-400 font-mono">[REDACTED — você não precisa saber.]</p>
        </div>
      )}
    </div>
  );
}

export default function AssembleiaSession() {
  const [, params] = useRoute("/assembleia/:id");
  const [, navigate] = useLocation();
  const id = parseInt(params?.id ?? "0");

  const [session, setSession] = useState<AsmSession | null>(null);
  const [messages, setMessages] = useState<AsmMsg[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<EditorialReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    void (async () => {
      try {
        const meRes = await fetch(`${base}/api/clube/me`, { credentials: "include" });
        const meData = await meRes.json() as { ok: boolean; username?: string };
        if (meData.ok) setMe(meData.username ?? null);
      } catch {}

      try {
        const res = await fetch(`${base}/api/assembleia/sessions/${id}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as AsmSession;
          setSession(data);
          setMessages(data.messages);
          if (data.editorialReport) {
            setReport(JSON.parse(data.editorialReport) as EditorialReport);
          }
        }
      } catch {}
    })();
  }, [id, base]);

  useEffect(() => {
    if (!me) return;
    const es = new EventSource(`${base}/api/assembleia/sessions/${id}/stream`, { withCredentials: true });
    es.addEventListener("message", (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as AsmMsg;
        setMessages(prev => [...prev, msg]);
      } catch {}
    });
    es.addEventListener("closed", () => {
      es.close();
      setSession(prev => prev ? { ...prev, status: "closed" } : prev);
      void (async () => {
        const res = await fetch(`${base}/api/assembleia/sessions/${id}/report`, { credentials: "include" });
        if (res.ok) {
          const r = await res.json() as EditorialReport;
          setReport(r);
          setShowReport(true);
        }
      })();
    });
    return () => es.close();
  }, [id, me, base]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    await fetch(`${base}/api/assembleia/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content: content.trim() }),
    });
    setContent("");
    setSending(false);
  };

  const handleClose = async () => {
    if (!confirm("Encerrar esta Assembleia? O Agente irá analisar toda a conversa e enviar o relatório editorial por email.")) return;
    setClosing(true);
    await fetch(`${base}/api/assembleia/sessions/${id}/close`, {
      method: "POST",
      credentials: "include",
    });
    setClosing(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-rose-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  const isClosed = session.status === "closed";

  return (
    <>
    <ForestBackdrop />
    <div className="flex flex-col h-screen relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card/90 backdrop-blur shrink-0">
        <button onClick={() => navigate("/assembleia")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Scale className="h-5 w-5 text-rose-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{session.topic}</p>
          <p className="text-xs text-muted-foreground">
            {isClosed ? "Encerrada" : "Em sessão"} · por {session.createdBy}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report && (
            <button
              onClick={() => setShowReport(v => !v)}
              className="flex items-center gap-1.5 text-xs border border-rose-300 text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Scale className="h-3.5 w-3.5" />
              {showReport ? "Ocultar relatório" : "Ver relatório"}
            </button>
          )}
          {!isClosed && me && (
            <button
              onClick={() => void handleClose()}
              disabled={closing}
              className="flex items-center gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors font-semibold"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {closing ? "Encerrando..." : "Encerrar"}
            </button>
          )}
          {isClosed && (
            <span className="flex items-center gap-1.5 text-xs bg-muted text-muted-foreground px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="h-3.5 w-3.5" /> Encerrada
            </span>
          )}
        </div>
      </div>

      {/* Editorial report panel */}
      {showReport && report && (
        <div className="border-b bg-muted/30 px-6 py-5 shrink-0 overflow-y-auto max-h-72">
          <EditorialPanel report={report} />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Scale className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">A Assembleia está aberta. Aguardando falas.</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} currentUser={me ?? ""} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!isClosed && me ? (
        <form onSubmit={e => void handleSend(e)} className="border-t bg-card px-4 py-3 flex gap-3 shrink-0">
          <input
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Sua fala na Assembleia..."
            className="flex-1 border-2 border-rose-200 focus:border-rose-400 rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none"
          />
          <button
            type="submit"
            disabled={!content.trim() || sending}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      ) : !isClosed ? (
        <div className="border-t bg-card px-4 py-3 flex items-center gap-2 text-muted-foreground text-sm shrink-0">
          <AlertTriangle className="h-4 w-4" />
          Faça login no Clube para participar desta Assembleia.
        </div>
      ) : (
        <div className="border-t bg-muted/30 px-4 py-3 flex items-center justify-center gap-2 text-muted-foreground text-sm shrink-0">
          <Lock className="h-3.5 w-3.5" />
          Assembleia encerrada. O Agente fez seu trabalho.
        </div>
      )}
    </div>
    </>
  );
}

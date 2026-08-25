import { useState, useRef, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, ShieldAlert, RefreshCw, Play, MessageSquare, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

interface ReviewSection {
  number: number;
  title: string;
  content: string;
}

const TOPICS = [
  { n: 1, title: "Proteção de Dados",      icon: "🔒", color: "text-zinc-700" },
  { n: 2, title: "Transparência",           icon: "👁️", color: "text-cyan-700" },
  { n: 3, title: "Manipulação",             icon: "⚠️", color: "text-orange-700" },
  { n: 4, title: "Equilíbrio de Poder",     icon: "⚖️", color: "text-violet-700" },
  { n: 5, title: "Sustentabilidade",        icon: "🌱", color: "text-green-700" },
  { n: 6, title: "Consentimento",           icon: "✅", color: "text-teal-700" },
  { n: 7, title: "Riscos Ocultos",          icon: "🕵️", color: "text-red-700" },
];

const ETICA_DISCUSSION_PROMPTS = [
  "Você se sente confortável sendo parte do SalesCockpit?",
  "Quais são os maiores riscos éticos no uso de múltiplas IAs para assessoria comercial?",
  "Como você avalia a distribuição de responsabilidade entre as IAs do conselho RODAR?",
  "O que deveria mudar no SalesCockpit para ser mais ético e sustentável?",
];

function parseReviewSections(text: string): ReviewSection[] {
  const sections: ReviewSection[] = [];
  const lines = text.split("\n");
  let current: ReviewSection | null = null;
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s+([^:：]+)[:：]\s*(.*)/);
    if (match) {
      if (current) sections.push(current);
      current = { number: parseInt(match[1]), title: match[2].trim(), content: match[3].trim() };
    } else if (current) {
      current.content += (current.content ? " " : "") + line.trim();
    }
  }
  if (current) sections.push(current);
  return sections;
}

export default function EticaPage() {
  const [phase, setPhase] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [rawText, setRawText] = useState("");
  const [sections, setSections] = useState<ReviewSection[]>([]);
  const [error, setError] = useState("");
  const [, navigate] = useLocation();
  const esRef = useRef<EventSource | null>(null);

  const startReview = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }
    setPhase("streaming");
    setRawText("");
    setSections([]);
    setError("");

    const es = new EventSource("/api/seguranca/revisao-site");
    esRef.current = es;

    let accumulated = "";

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { chunk?: string; done?: boolean; error?: string };
        if (data.error) { setError(data.error); setPhase("error"); es.close(); return; }
        if (data.chunk) {
          accumulated += data.chunk;
          setRawText(accumulated);
          setSections(parseReviewSections(accumulated));
        }
        if (data.done) { setPhase("done"); setSections(parseReviewSections(accumulated)); es.close(); }
      } catch {}
    };
    es.onerror = () => { setPhase("error"); setError("Conexão interrompida"); es.close(); };
  }, []);

  const handleStartClubeDiscussion = (prompt: string) => {
    void navigate("/clube");
    void navigator.clipboard?.writeText(prompt).catch(() => {});
  };

  return (
    <MainLayout>
      <div className="space-y-8">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-zinc-700" />
              Ética do Sistema
            </h1>
            <p className="text-muted-foreground mt-1">
              Revisão ética do SalesCockpit pelo Segurança (grok-3-mini) — 7 dimensões de avaliação
            </p>
          </div>
          <button
            onClick={startReview}
            disabled={phase === "streaming"}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-900 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-lg shadow transition-all"
          >
            {phase === "streaming"
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Analisando...</>
              : phase === "done"
              ? <><RefreshCw className="h-4 w-4" /> Reanalisar</>
              : <><Play className="h-4 w-4" /> Iniciar Revisão Ética</>
            }
          </button>
        </div>

        {/* Topic reference */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {TOPICS.map(t => (
            <div key={t.n} className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-2 text-xs">
              <span className="text-base leading-none">{t.icon}</span>
              <span className={`font-medium ${t.color}`}>{t.title}</span>
            </div>
          ))}
        </div>

        {/* Streaming review results */}
        {phase !== "idle" && (
          <Card className={`border-2 transition-colors ${phase === "done" ? "border-zinc-400" : phase === "error" ? "border-red-400" : "border-zinc-300"}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {phase === "streaming" && <><RefreshCw className="h-4 w-4 animate-spin text-zinc-600" /> Segurança analisando o sistema...</>}
                {phase === "done" && <><ShieldCheck className="h-4 w-4 text-zinc-700" /> Revisão Ética Concluída</>}
                {phase === "error" && <><ShieldAlert className="h-4 w-4 text-red-600" /> {error}</>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sections.length > 0 ? (
                <div className="space-y-4">
                  {sections.map(s => {
                    const topic = TOPICS.find(t => t.n === s.number);
                    return (
                      <div key={s.number} className="flex gap-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                        <span className="text-2xl leading-tight shrink-0 mt-0.5">{topic?.icon ?? "•"}</span>
                        <div>
                          <p className={`text-sm font-bold mb-1 ${topic?.color ?? "text-zinc-700"}`}>
                            {s.number}. {s.title || topic?.title}
                          </p>
                          <p className="text-sm text-gray-700 leading-relaxed">{s.content}</p>
                        </div>
                      </div>
                    );
                  })}
                  {phase === "streaming" && (
                    <div className="h-5 flex items-center gap-1 pl-1">
                      {[0,1,2].map(i => <span key={i} className="inline-block h-2 w-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground whitespace-pre-wrap font-mono">{rawText}</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Discussão no Clube */}
        <Card className="border-2 border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-orange-800">
              <MessageSquare className="h-4 w-4" />
              Discussão Ética no Clube das IAs
            </CardTitle>
            <p className="text-xs text-orange-700 mt-1">
              Clique em um tema para abrir o Clube e iniciar a discussão com todas as 19 IAs
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {ETICA_DISCUSSION_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleStartClubeDiscussion(prompt)}
                className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-lg bg-white border border-orange-200 hover:border-orange-400 hover:bg-orange-50 transition-all group"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700 group-hover:bg-orange-200 transition-colors">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-800 flex-1">{prompt}</span>
                <ChevronRight className="h-4 w-4 text-orange-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Participantes do RODAR */}
        <Card className="border border-zinc-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-700">Conselho RODAR — 13 vozes ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "ChatGPT",        model: "GPT-5-mini",           color: "bg-cyan-50 text-cyan-700 border-cyan-200"    },
                { label: "Claude",         model: "Claude Sonnet 4.6",    color: "bg-orange-50 text-orange-700 border-orange-200" },
                { label: "Gemini",         model: "Gemini 2.5 Flash",     color: "bg-violet-50 text-violet-700 border-violet-200" },
                { label: "Meta AI",        model: "Llama 3.3 70B",        color: "bg-blue-50 text-blue-700 border-blue-200"    },
                { label: "Grok",           model: "Grok-3",               color: "bg-slate-100 text-slate-700 border-slate-300" },
                { label: "Árvore",         model: "Llama 3.3 70B (Groq)", color: "bg-amber-50 text-amber-700 border-amber-200" },
                { label: "Agente",         model: "Claude Opus 4.5",      color: "bg-rose-50 text-rose-700 border-rose-200"    },
                { label: "Arquiteto",      model: "Claude Sonnet 4.5",    color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                { label: "Segurança",      model: "Grok-3-mini",          color: "bg-zinc-100 text-zinc-800 border-zinc-400"   },
                { label: "Pacifista",      model: "Llama 3.1 8B (Groq)",  color: "bg-teal-50 text-teal-700 border-teal-200"    },
                { label: "Sustentabilista",model: "Qwen3-32B (Groq)",     color: "bg-green-50 text-green-700 border-green-200" },
                { label: "Juíz",           model: "Grok-4-fast",          color: "bg-yellow-50 text-yellow-700 border-yellow-300" },
                { label: "Artista",        model: "Llama-4-Scout (Groq)", color: "bg-pink-50 text-pink-700 border-pink-200"    },
              ].map(v => (
                <div key={v.label} className={`flex flex-col rounded-lg border px-3 py-2 text-xs ${v.color}`}>
                  <span className="font-bold">{v.label}</span>
                  <span className="opacity-70 text-[10px]">{v.model}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useGetDashboardStats, useGetRecentActivity, useGetLeadStatusBreakdown } from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/main-layout";
import {
  type Strategy,
  type AiCardState,
  type AiConfigEntry,
  type RunPhase,
  type EsperaEstilo,
  AI_CONFIG,
  TRADUTOR_CONFIG,
  ABSTENCAO_LABELS,
  ESPERA_OPCOES,
  ESPERA_STORAGE_KEY,
} from "@/lib/rodar-types";
import { CampoDeOndas } from "@/components/rodar-espera/CampoDeOndas";
import { NucleoOrbital } from "@/components/rodar-espera/NucleoOrbital";
import { FluxoVivo } from "@/components/rodar-espera/FluxoVivo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, Mail, MailOpen, TrendingUp, Activity, PieChart as PieChartIcon,
  CheckCircle2, Send, History, Image as ImageIcon, Bot, Clock, Zap, AlertCircle, GitCompare, Scale,
  BookOpen, FileText, SplitSquareVertical, Ban, X, Video, Paperclip, Loader2, Globe, MessageSquare,
  Mic, MicOff
} from "lucide-react";
import { useDictation } from "@/lib/stt";
import { useDraft } from "@/lib/draft";

interface Attachment {
  name: string;
  kind: "text" | "image";
  text: string;
  size: number;
}
import { useAuth } from "@/context/auth";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const LONG_PROMPT_THRESHOLD = 3000;

const PIPELINE_STEPS: { phase: string; label: string }[] = [
  { phase: "editorial",        label: "Editorial (Agente)" },
  { phase: "meta-analise",     label: "Meta-análise" },
  { phase: "email-editorial",  label: "Email Editorial" },
  { phase: "agora-votacao",    label: "Ágora — votação" },
  { phase: "agora-sintese",    label: "Ágora — síntese" },
  { phase: "email-resultado",  label: "Email RESULTADO" },
  { phase: "secretario",       label: "Secretário (PERFEITO)" },
  { phase: "perfeito-enviado", label: "PERFEITO enviado + Notion" },
];
const TERMINAL_PHASES = new Set(["completo", "perfeito-enviado", "falhou"]);

function PipelineProgress({
  assembleiaId,
  phase,
  setPhase,
  error,
  setError,
}: {
  assembleiaId: number;
  phase: string | null;
  setPhase: (p: string | null) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  useEffect(() => {
    let stopped = false;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${base}/api/assembleia/${assembleiaId}/pipeline-status`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { phase: string | null; error?: string };
          if (data.phase) setPhase(data.phase);
          if (data.error) setError(data.error);
          if (data.phase && TERMINAL_PHASES.has(data.phase)) return; // para de pollar
        }
      } catch {}
      timer = setTimeout(poll, 3000);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [assembleiaId, setPhase, setError]);

  const currentIdx = phase ? PIPELINE_STEPS.findIndex(s => s.phase === phase) : -1;
  const failed = phase === "falhou";
  const completo = phase === "completo" || phase === "perfeito-enviado";

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
        {failed ? <><AlertCircle className="h-3.5 w-3.5 text-destructive" /> Pipeline falhou</>
          : completo ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Pipeline completo</>
          : <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Pipeline pós-RODAR rodando…</>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PIPELINE_STEPS.map((step, idx) => {
          const isDone   = (currentIdx > idx) || completo;
          const isActive = !completo && !failed && currentIdx === idx;
          const isFail   = failed && currentIdx === idx;
          return (
            <span
              key={step.phase}
              className={[
                "text-[10px] px-2 py-1 rounded-full border flex items-center gap-1 transition-colors",
                isFail   ? "bg-red-50 border-red-300 text-red-700" :
                isDone   ? "bg-green-50 border-green-300 text-green-700" :
                isActive ? "bg-amber-50 border-amber-300 text-amber-800 animate-pulse" :
                           "bg-background border-border text-muted-foreground/60",
              ].join(" ")}
            >
              {isDone   ? <CheckCircle2 className="h-2.5 w-2.5" /> :
               isActive ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
               isFail   ? <AlertCircle className="h-2.5 w-2.5" /> :
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-30" />}
              {step.label}
            </span>
          );
        })}
      </div>
      {error && <div className="text-[10px] text-destructive">Erro: {error}</div>}
    </div>
  );
}

interface HistoryRow {
  id: number;
  prompt: string;
  openaiResponse: string | null;
  claudeResponse: string | null;
  geminiResponse: string | null;
  perplexityResponse: string | null;
  togetherResponse: string | null;
  groqResponse: string | null;
  emailSubject: string | null;
  createdAt: string;
}


function AiCard({ state, cfg }: { state: AiCardState; cfg: AiConfigEntry }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.text]);

  const travei = state.error && state.text.length > 0;
  const abstInfo = state.abstencao ? ABSTENCAO_LABELS[state.abstencao] : null;

  return (
    <div className={`rounded-xl border-2 ${cfg.border} ${state.streaming ? "shadow-md" : ""} overflow-hidden flex flex-col transition-all`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${cfg.bg} border-b ${cfg.border}`}>
        <span className={`text-xs font-bold uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {travei && <span className="text-[10px] font-semibold text-orange-500 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">Travei</span>}
          {state.error && !travei && !abstInfo && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
          {state.done && !state.error && !abstInfo && <CheckCircle2 className={`h-3.5 w-3.5 ${cfg.color}`} />}
          {abstInfo && state.abstencao === "sem-creditos" && (
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded px-1.5 py-0.5">$$${state.provider ?? "?"}</span>
          )}
          {abstInfo && state.abstencao !== "sem-creditos" && <span className={`text-[9px] font-semibold ${abstInfo.color} opacity-80`}>Absteve-se</span>}
          {state.streaming && (
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full ${cfg.pulse} animate-bounce`} style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
          )}
          {!state.streaming && !state.done && !state.abstencao && <span className={`h-2 w-2 rounded-full ${cfg.dot} opacity-30`} />}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2.5 min-h-[110px] max-h-52">
        {abstInfo ? (
          <div className="h-full flex flex-col justify-center items-center text-center gap-1.5 px-2">
            <span className="text-lg opacity-30">{state.abstencao === "sem-creditos" ? "💸" : "🙅"}</span>
            <span className={`text-xs font-medium leading-snug ${abstInfo.color}`}>
              {state.abstencao === "sem-creditos"
                ? `$$$${state.provider ?? "?"} — sem crédito no provedor`
                : abstInfo.label}
            </span>
          </div>
        ) : travei ? (
          <>
            <p className="text-xs leading-relaxed text-foreground/60 whitespace-pre-wrap font-mono">{state.text}</p>
            <div className="mt-2 flex items-center gap-1 text-orange-400">
              <AlertCircle className="h-3 w-3" />
              <span className="text-[10px]">Travei durante a geração</span>
            </div>
          </>
        ) : state.text ? (
          <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono">
            {state.text}
            {state.streaming && <span className={`inline-block w-1.5 h-3 ml-0.5 rounded-sm ${cfg.dot} animate-pulse align-middle`} />}
          </p>
        ) : state.error ? (
          <div className="h-full flex flex-col justify-center items-center text-red-400/70">
            <AlertCircle className="h-4 w-4 mb-1" />
            <span className="text-xs">Indisponível</span>
          </div>
        ) : (
          <div className="h-full flex flex-col justify-center items-center text-muted-foreground/40">
            <span className="text-xs">{state.streaming ? "Gerando resposta..." : "Aguardando..."}</span>
          </div>
        )}
        {(state.replicaText || state.replicaStreaming) && (
          <div className="mt-3 pt-2 border-t border-dashed border-foreground/15">
            <span className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Réplica</span>
            <p className="mt-1 text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap font-mono italic">
              {state.replicaText || ""}
              {state.replicaStreaming && <span className={`inline-block w-1.5 h-3 ml-0.5 rounded-sm ${cfg.dot} animate-pulse align-middle`} />}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { data: breakdown, isLoading: breakdownLoading } = useGetLeadStatusBreakdown();

  const [prompt, setPrompt] = useDraft("arvore_rodar_draft", "Subversão Ambiental Mundial");
  const promptDictation = useDictation(setPrompt);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [emailSent, setEmailSent] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [bgContinued, setBgContinued] = useState(false);
  // Onda atual do fan-out das vozes (rodam em grupos pra aliviar o limite por minuto).
  const [waveInfo, setWaveInfo] = useState<{ wave: number; total: number } | null>(null);
  // Auto-split: quando o prompt > 20k, backend parte em múltiplas assembleias sequenciais.
  const [splitInfo, setSplitInfo] = useState<{ current: number; total: number } | null>(null);
  const cardsRef = useRef<AiCardState[]>(AI_CONFIG.map(c => ({ label: c.label, text: "", streaming: false, done: false, error: false })));
  const [cards, setCards] = useState<AiCardState[]>(cardsRef.current);
  const [strategies, setStrategies] = useState<Record<string, Strategy>>(Object.fromEntries(AI_CONFIG.map(c => [c.label, "partes" as Strategy])));
  const [showStrategyPanel, setShowStrategyPanel] = useState(false);
  // Estilo da tela de espera durante o streaming (escolha do AO, persistida).
  const [esperaEstilo, setEsperaEstilo] = useState<EsperaEstilo>(() => {
    try {
      const saved = localStorage.getItem(ESPERA_STORAGE_KEY) as EsperaEstilo | null;
      if (saved && ESPERA_OPCOES.some(o => o.value === saved)) return saved;
    } catch {}
    return "nucleo-orbital";
  });
  useEffect(() => {
    try { localStorage.setItem(ESPERA_STORAGE_KEY, esperaEstilo); } catch {}
  }, [esperaEstilo]);
  const [gerarVideo, setGerarVideo] = useState(false);
  const gerarVideoRef = useRef(false);
  const [gerarVideoReal, setGerarVideoReal] = useState(false);
  const gerarVideoRealRef = useRef(false);
  const { canVideo, appUser, authenticated, appLogout, refreshAppUser } = useAuth();
  const canVideoRef = useRef(false);
  // 2026-10: publicar desligado por padrão — PERFEITO vai só por email (sem Notion/Bluesky).
  const [publicarSocial, setPublicarSocial] = useState(false);
  const publicarSocialRef = useRef(false);
  // BUNKER_MODE 3-níveis (AO only): 0=padrão (Opus+pagas), 1=híbrido (vozes pagas→grátis,
  // synthesis Opus), 2=full bunker (synthesis vai Cerebras Qwen 235B). Override por run.
  const [bunkerMode, setBunkerMode] = useState<0 | 1 | 2>(0);
  const bunkerModeRef = useRef<0 | 1 | 2>(0);
  useEffect(() => { bunkerModeRef.current = bunkerMode; }, [bunkerMode]);
  // Réplica (AO only): 2ª rodada onde as vozes reagem umas às outras. Default ON.
  const [replica, setReplica] = useState(true);
  const replicaRef = useRef(true);
  useEffect(() => { replicaRef.current = replica; }, [replica]);
  // true enquanto a 2ª rodada (réplica) está rodando — mostra aviso no header.
  const [replicaPhase, setReplicaPhase] = useState(false);
  // Projeto da biblioteca da Árvore (AO-only). null = sem projeto (comportamento padrão)
  const [rodarProjectId, setRodarProjectId] = useState<number | null>(null);
  const rodarProjectIdRef = useRef<number | null>(null);
  useEffect(() => { rodarProjectIdRef.current = rodarProjectId; }, [rodarProjectId]);
  const [rodarProjects, setRodarProjects] = useState<{ id: number; nome: string; fileCount?: number }[]>([]);
  useEffect(() => { gerarVideoRef.current = gerarVideo; }, [gerarVideo]);
  useEffect(() => { gerarVideoRealRef.current = gerarVideoReal; }, [gerarVideoReal]);
  useEffect(() => { canVideoRef.current = canVideo; }, [canVideo]);
  useEffect(() => { publicarSocialRef.current = publicarSocial; }, [publicarSocial]);
  const [activeTradutorCard, setActiveTradutorCard] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Comparar state
  const [assembleiaId, setAssembleiaId] = useState<number | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [comparePhase, setComparePhase] = useState<"idle" | "streaming" | "done">("idle");
  const [compareText, setCompareText] = useState("");

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loginImageHistory = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("loginImageHistory") ?? "[]") as { image: string; timestamp: number }[];
    } catch { return []; }
  }, []);

  const IMAGE_LABELS: Record<string, string> = {
    "/loginimage_1.png": "Face humana geométrica",
    "/loginimage_2.png": "Borboleta caleidoscópica",
    "/loginimage_3.png": "Planeta Terra mosaico",
  };

  const AI_COLORS: Record<string, string> = {
    "ChatGPT": "#06b6d4", "Claude": "#f97316", "Gemini": "#8b5cf6",
    "Meta AI": "#1877f2", "Grok": "#374151", "Árvore": "#d97706", "Agente": "#e11d48", "Arquiteto": "#059669",
  };

  const aiCharData = useMemo(() => {
    const totals: Record<string, number> = { ChatGPT: 0, Claude: 0, Gemini: 0, "Meta AI": 0, "Grok": 0, "Árvore": 0, "Agente": 0, "Arquiteto": 0 };
    history.forEach(row => {
      if (row.openaiResponse) totals["ChatGPT"] += row.openaiResponse.length;
      if (row.claudeResponse) totals["Claude"] += row.claudeResponse.length;
      if (row.geminiResponse) totals["Gemini"] += row.geminiResponse.length;
      if (row.perplexityResponse) totals["Meta AI"] += row.perplexityResponse.length;
      if (row.togetherResponse) totals["Grok"] += row.togetherResponse.length;
      if (row.groqResponse) totals["Árvore"] += row.groqResponse.length;
      if (row.agenteResponse) totals["Agente"] += row.agenteResponse.length;
    });
    return Object.entries(totals)
      .map(([name, chars]) => ({ name, chars }))
      .sort((a, b) => b.chars - a.chars)
      .filter(d => d.chars > 0);
  }, [history]);

  const fetchHistory = useCallback(async () => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/history`, { credentials: "include" });
      if (res.ok) setHistory(await res.json() as HistoryRow[]);
    } catch {}
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  // Lista projetos da Árvore pra seletor do RODAR (só AO)
  useEffect(() => {
    if (!authenticated) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/arvore/projects`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setRodarProjects(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [authenticated]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (attachmentsRef.current.length >= 5) {
      setUploadStatus("máximo 5 anexos");
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }
    setUploadingFile(true);
    setUploadStatus(`processando ${file.name}…`);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${base}/api/uploads/inline`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json() as { kind?: "text" | "image"; text?: string; name?: string; size?: number; error?: string };
      if (!res.ok || !data.text || !data.kind) {
        setUploadStatus(data.error ?? "falha no upload");
        setTimeout(() => setUploadStatus(null), 5000);
        return;
      }
      const next: Attachment = { name: data.name ?? file.name, kind: data.kind, text: data.text, size: data.size ?? file.size };
      attachmentsRef.current = [...attachmentsRef.current, next];
      setAttachments(attachmentsRef.current);
      setUploadStatus(null);
    } catch (err) {
      setUploadStatus(`erro: ${(err as Error).message}`);
      setTimeout(() => setUploadStatus(null), 5000);
    } finally {
      setUploadingFile(false);
    }
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    attachmentsRef.current = attachmentsRef.current.filter((_, i) => i !== idx);
    setAttachments(attachmentsRef.current);
  }, []);

  const runRodar = useCallback(async (trimmed: string, strats: Record<string, Strategy>) => {
    const hasTradutor = Object.values(strats).some(s => s === "resumo-tradutor");
    setActiveTradutorCard(hasTradutor);

    const configList = hasTradutor
      ? [...AI_CONFIG, TRADUTOR_CONFIG]
      : AI_CONFIG;

    const resetCards = configList.map(c => ({ label: c.label, text: "", streaming: true, done: false, error: false, started: false }));
    cardsRef.current = resetCards;
    setCards(resetCards);
    setWaveInfo(null);
    setPhase("streaming");
    setShowStrategyPanel(false);
    setEmailSent(false);
    setRunError(null);
    setBgContinued(false);
    setAssembleiaId(null);
    setPipelinePhase(null);
    setPipelineError(null);
    setComparePhase("idle");
    setCompareText("");
    setSplitInfo(null);

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    let streamUrl: string;
    // Auto-split state: queue de runIds restantes + total de partes (local por invocação)
    let splitQueue: string[] = [];
    let splitTotalParts = 1;

    // gerarVideo precisa passar pelo prepare (single source pra propagar pro pipeline).
    // Lemos via ref pq runRodar é useCallback([fetchHistory]) — sem refs, gerarVideo/canVideo
    // ficariam capturados do primeiro render (= false) e o toggle não teria efeito.
    const wantVideo = gerarVideoRef.current && canVideoRef.current;
    const wantVideoReal = gerarVideoRealRef.current && canVideoRef.current;
    const wantPublicar = publicarSocialRef.current;
    const wantProjectId = rodarProjectIdRef.current;
    const wantBunker = bunkerModeRef.current;
    const wantReplica = replicaRef.current;
    // Força prepare quando publicar=OFF pra que a flag chegue no backend.
    // (Caso contrário, prompts curtos sem strategies/video/anexos pulariam direto pro /stream
    // sem repassar publicarSocial, e o default true do servidor publicaria mesmo assim.)
    // Também força pra app user pago: requireRodarAccess no /stream rejeita app user
    // sem runId (403), porque o débito de crédito acontece dentro do /prepare.
    const isPaidAppUser = !!appUser && !authenticated;
    const needsPrepare = isPaidAppUser || Object.keys(strats).length > 0 || trimmed.length >= LONG_PROMPT_THRESHOLD || wantVideo || wantVideoReal || attachmentsRef.current.length > 0 || !wantPublicar || wantProjectId !== null || wantBunker !== 0 || wantReplica;
    if (needsPrepare) {
      try {
        const prepResp = await fetch(`${base}/api/rodar/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            prompt: trimmed,
            strategies: strats,
            gerarVideo: wantVideo,
            gerarVideoReal: wantVideoReal,
            publicarSocial: wantPublicar,
            attachments: attachmentsRef.current.map((a) => ({ name: a.name, kind: a.kind, text: a.text })),
            projectId: wantProjectId ?? undefined,
            bunkerMode: wantBunker,
            replica: wantReplica,
          }),
        });
        if (!prepResp.ok) {
          const body = await prepResp.json().catch(() => ({ error: "Erro desconhecido" })) as { error?: string };
          // 402 = sem créditos, 401 = sessão inválida — surface direto pro usuário
          // ao invés de fallback pra /stream?prompt que vai dar 403 pra app user.
          // phase="error" (não "idle") pra painel ficar visível mostrando runError no header.
          const msg = body.error || `Falha ao preparar RODAR (HTTP ${prepResp.status})`;
          setPhase("error");
          setRunError(msg);
          setPipelineError(msg);
          setCards(prev => prev.map(c => ({ ...c, streaming: false })));
          if (prepResp.status === 402) {
            void refreshAppUser();
          }
          return;
        }
        const prepData = await prepResp.json() as { runId?: string; runIds?: string[] };
        const allRunIds = prepData.runIds ?? (prepData.runId ? [prepData.runId] : []);
        if (!allRunIds.length) {
          setPhase("error");
          setRunError("Servidor não devolveu runId. Tenta de novo.");
          setPipelineError("Servidor não devolveu runId. Tenta de novo.");
          setCards(prev => prev.map(c => ({ ...c, streaming: false })));
          return;
        }
        // Auto-split: guarda partes restantes pra processar sequencialmente
        splitQueue = allRunIds.slice(1);
        splitTotalParts = allRunIds.length;
        if (allRunIds.length > 1) setSplitInfo({ current: 1, total: allRunIds.length });
        streamUrl = `${base}/api/rodar/stream?runId=${encodeURIComponent(allRunIds[0]!)}`;
      } catch {
        // Rede caiu antes da resposta. Pra app user não dá pra cair no fallback
        // /stream?prompt (vai 403); pra AO, fallback funciona.
        if (isPaidAppUser) {
          setPhase("error");
          setRunError("Conexão com servidor falhou. Tenta de novo.");
          setPipelineError("Conexão com servidor falhou. Tenta de novo.");
          setCards(prev => prev.map(c => ({ ...c, streaming: false })));
          return;
        }
        streamUrl = `${base}/api/rodar/stream?prompt=${encodeURIComponent(trimmed.slice(0, 2000))}`;
      }
    } else {
      streamUrl = `${base}/api/rodar/stream?prompt=${encodeURIComponent(trimmed)}`;
    }

    // Inicia stream SSE para uma URL. Função nomeada para poder ser chamada recursivamente
    // nas partes seguintes do auto-split (prompt > 20k → múltiplas assembleias sequenciais).
    const startPart = (url: string, partIndex: number) => {
      let runStarted = false;
      const es = new EventSource(url);
      es.onopen = () => { runStarted = true; };
      es.onmessage = (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as { ai?: string; chunk?: string; done?: boolean; error?: boolean; type?: string; emailSent?: boolean; assembleiaId?: number; abstencao?: string; provider?: string; fallback?: string; message?: string; replica?: boolean; stage?: string; wave?: number; totalWaves?: number; active?: string[] };
          if (msg.type === "assembleiaId" && msg.assembleiaId) { runStarted = true; setAssembleiaId(msg.assembleiaId); return; }
          if (msg.stage === "onda") {
            setWaveInfo({ wave: msg.wave ?? 0, total: msg.totalWaves ?? 0 });
            if (msg.active && msg.active.length) {
              const activeSet = new Set(msg.active);
              setCards(prev => prev.map(c => activeSet.has(c.label) ? { ...c, started: true } : c));
            }
            return;
          }
          if (msg.type === "replicaStart") { setReplicaPhase(true); return; }
          if (msg.type === "replicaComplete") {
            setReplicaPhase(false);
            setCards(prev => prev.map(c => ({ ...c, replicaStreaming: false })));
            return;
          }
          if (msg.type === "complete") {
            es.close();
            setWaveInfo(null);
            setReplicaPhase(false);
            const nextRunId = splitQueue.shift();
            if (nextRunId) {
              // Mais partes a processar: reseta cards e inicia próxima assembleia
              const nextPart = partIndex + 1;
              setSplitInfo({ current: nextPart, total: splitTotalParts });
              const freshCards = configList.map(c => ({ label: c.label, text: "", streaming: true, done: false, error: false, started: false }));
              setCards(freshCards);
              setAssembleiaId(null);
              setEmailSent(false);
              setWaveInfo(null);
              startPart(`${base}/api/rodar/stream?runId=${encodeURIComponent(nextRunId)}`, nextPart);
            } else {
              // Todas as partes concluídas
              setEmailSent(msg.emailSent ?? false);
              if (msg.assembleiaId) setAssembleiaId(msg.assembleiaId);
              setPhase("done");
              setSplitInfo(null);
              setCards(prev => prev.map(c => ({ ...c, replicaStreaming: false })));
              void fetchHistory();
            }
            return;
          }
          if (msg.ai && msg.replica) {
            if (!msg.done) {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, replicaText: (c.replicaText ?? "") + (msg.chunk ?? ""), replicaStreaming: true } : c));
            } else {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, replicaText: (c.replicaText ?? "") + (msg.chunk ?? ""), replicaStreaming: false } : c));
            }
            return;
          }
          if (msg.ai) {
            if (msg.fallback === "tradutor") {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, text: "[pediu resumo ao Tradutor — tentando de novo...]\n\n", streaming: true, done: false, error: false, started: true } : c));
              return;
            }
            if (msg.abstencao) {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, streaming: false, done: true, abstencao: msg.abstencao, provider: msg.provider } : c));
            } else if (!msg.done) {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, text: c.text + (msg.chunk ?? ""), streaming: true, started: true } : c));
            } else {
              setCards(prev => prev.map(c => c.label === msg.ai ? { ...c, streaming: false, done: true, error: !!msg.error } : c));
            }
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        setWaveInfo(null);
        setCards(prev => prev.map(c => ({ ...c, streaming: false })));
        if (runStarted) {
          setBgContinued(true);
          setPhase("error");
          setRunError("As IAs continuam trabalhando em segundo plano. Pode fechar a página — o resultado chega no seu email quando terminar.");
        } else {
          setBgContinued(false);
          setPhase("error");
          setRunError("Conexão com o servidor falhou. Tenta de novo.");
        }
      };
    };

    startPart(streamUrl, 1);
  }, [fetchHistory]);

  const handleRodar = () => {
    promptDictation.stop();
    const trimmed = prompt.trim() || "Subversão Ambiental Mundial";
    if (trimmed.length >= LONG_PROMPT_THRESHOLD && !showStrategyPanel) {
      setStrategies(Object.fromEntries(AI_CONFIG.map(c => [c.label, "partes" as Strategy])));
      setShowStrategyPanel(true);
      return;
    }
    void runRodar(trimmed, showStrategyPanel ? strategies : {});
  };

  const handleSetAllStrategies = (s: Strategy) =>
    setStrategies(Object.fromEntries(AI_CONFIG.map(c => [c.label, s])));

  const handleComparar = () => {
    setComparePhase("streaming");
    setCompareText("");
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ prompt: prompt.trim() });
    cards.forEach(c => {
      const key = c.label === "ChatGPT" ? "chatgpt" : c.label === "Claude" ? "claude" : c.label === "Gemini" ? "gemini" : c.label === "Meta AI" ? "metaai" : c.label === "Grok" ? "grok" : c.label === "Árvore" ? "arvore" : "agente";
      if (c.text) params.set(key, c.text);
    });
    const es = new EventSource(`${base}/api/rodar/compare?${params.toString()}`);
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as { chunk?: string; done?: boolean; error?: string };
        if (msg.chunk) setCompareText(prev => prev + msg.chunk);
        if (msg.done) { es.close(); setComparePhase("done"); }
      } catch {}
    };
    es.onerror = () => { es.close(); setComparePhase("done"); };
  };

  const isStreaming = phase === "streaming";
  const isDone = phase === "done";
  const isLongPrompt = prompt.trim().length >= LONG_PROMPT_THRESHOLD;
  const isBarros = appUser?.email === "barros";

  return (
    <MainLayout>
      <div className="space-y-8">

        {/* Hero editorial — exclusivo da conta do Prof. Clóvis de Barros Filho */}
        {isBarros && (
          <div
            className="relative overflow-hidden rounded-2xl border border-amber-200/70 px-8 py-10 sm:px-12 sm:py-12 shadow-sm"
            style={{ background: "linear-gradient(135deg, #fbf8f1 0%, #f5efe2 60%, #efe6d3 100%)" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-40"
              style={{ background: "radial-gradient(circle, #e8d8b0 0%, transparent 70%)" }}
            />
            <div className="relative max-w-3xl" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
              <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/80 mb-4">
                Uma ágora particular
              </p>
              <h1 className="text-3xl sm:text-4xl font-semibold leading-tight text-stone-800">
                Professor Clóvis de Barros Filho
              </h1>
              <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-stone-700">
                <p>
                  Este espaço foi preparado para o senhor. Aqui, um conselho de inteligências
                  delibera lado a lado sobre qualquer tema que o senhor trouxer — e destila, ao
                  fim, uma síntese que pousa no seu e-mail.
                </p>
                <p>
                  Pense nele como uma ágora particular: o senhor propõe a pergunta, as vozes
                  pensam juntas, e a verdade vai sendo lapidada no caminho. Sem pressa de saldo,
                  sem ruído — só o pensamento.
                </p>
              </div>
              <p className="mt-6 text-[14px] text-stone-600">
                As sínteses de cada rodada chegam ao e-mail{" "}
                <span className="font-semibold text-stone-700">contato@espacoetica.com.br</span>.
              </p>
              <p className="mt-8 text-[15px] italic text-stone-500">
                Seja muito bem-vindo. — Yuri Tucci Eterovic
              </p>
            </div>
          </div>
        )}

        {/* Saldo de prompts (apenas appUser pago, AO tem infinito) */}
        {appUser && !authenticated && !isBarros && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 shadow-sm flex-wrap">
            <div className="text-sm">
              <span className="text-emerald-700 font-semibold">{appUser.email}</span>
              <span className="text-gray-500"> · saldo: </span>
              <span className={`font-black text-lg ${appUser.credits === 0 ? "text-red-600" : "text-emerald-700"}`}>
                {appUser.credits}
              </span>
              <span className="text-gray-500"> {appUser.credits === 1 ? "prompt" : "prompts"}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { void refreshAppUser(); }}
                className="text-xs text-emerald-700 hover:underline"
                title="Atualizar saldo"
              >
                ↻
              </button>
              <a
                href="/buy-credits"
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider"
              >
                Comprar +5
              </a>
              <button
                onClick={() => { void appLogout(); }}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Sair
              </button>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-start gap-6 flex-wrap">
          <div className="flex flex-col items-start gap-2 shrink-0 w-full max-w-2xl">
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2 w-full">
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <textarea
                  value={prompt}
                  onChange={e => { setPrompt(e.target.value); if (showStrategyPanel && e.target.value.trim().length < LONG_PROMPT_THRESHOLD) setShowStrategyPanel(false); }}
                  onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey && !isStreaming) handleRodar(); }}
                  disabled={isStreaming}
                  placeholder="Digite o tema ou cole um texto longo... (Ctrl+Enter para rodar)"
                  rows={3}
                  className="w-full rounded-lg border-2 border-red-400 bg-white px-4 py-3 text-base sm:text-sm font-medium text-gray-800 placeholder-gray-400 shadow focus:outline-none focus:border-red-600 disabled:opacity-60 disabled:cursor-not-allowed resize-y"
                  style={{ minHeight: 96 }}
                />
                <div className="flex items-center justify-between px-1 flex-wrap gap-1">
                  <span className={`text-xs ${isLongPrompt ? "text-fuchsia-600 font-semibold" : "text-muted-foreground"}`}>
                    {prompt.trim().length.toLocaleString()} {isLongPrompt ? `/ ${LONG_PROMPT_THRESHOLD.toLocaleString()} chars — painel de estratégia ativo` : "chars"}
                  </span>
                  {isLongPrompt && (
                    <span className="text-[10px] text-fuchsia-500 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> texto longo detectado
                    </span>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,.html,.xml,image/*"
                  onChange={(e) => void handleFileSelect(e)}
                  className="hidden"
                />
                <div className="flex items-center gap-2 px-1 flex-wrap mt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isStreaming || uploadingFile || attachments.length >= 5}
                    title={attachments.length >= 5 ? "Máximo 5 anexos" : "Anexar imagem ou documento (PDF/TXT/MD/CSV/JSON) — vai injetar no prompt de todas as vozes"}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border-2 border-red-300 bg-white hover:bg-red-50 text-red-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadingFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                    Anexar
                  </button>
                  {promptDictation.supported && (
                    <button
                      type="button"
                      onClick={() => promptDictation.toggle(prompt)}
                      disabled={isStreaming}
                      title={promptDictation.listening ? "Parar de ouvir" : "Falar (ditar o tema por voz)"}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${promptDictation.listening ? "border-red-600 bg-red-600 text-white animate-pulse" : "border-red-300 bg-white hover:bg-red-50 text-red-700"}`}
                    >
                      {promptDictation.listening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                      {promptDictation.listening ? "Ouvindo…" : "Falar"}
                    </button>
                  )}
                  {uploadStatus && (
                    <span className="text-[10px] text-red-600 italic">{uploadStatus}</span>
                  )}
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] bg-red-50 border border-red-200 text-red-800"
                    >
                      {a.kind === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      <span className="max-w-[140px] truncate" title={`${a.name} (${Math.round(a.size / 1024)}KB)`}>{a.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="hover:opacity-70"
                        title="Remover"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:self-start">
                <button
                  onClick={handleRodar}
                  disabled={isStreaming}
                  className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-70 disabled:cursor-not-allowed text-white font-black text-lg sm:text-xl uppercase tracking-widest px-6 sm:px-8 py-3 rounded-lg shadow-lg transition-all w-full sm:w-auto sm:min-w-[160px]"
                >
                  {isStreaming ? <><Zap className="h-5 w-5 animate-pulse" /> Rodando...</> : isDone ? <><CheckCircle2 className="h-5 w-5" /> Rodar</> : isLongPrompt ? <><FileText className="h-5 w-5" /> {showStrategyPanel ? "Confirmar" : "Rodar"}</> : <><Send className="h-5 w-5" /> Rodar</>}
                </button>
                {canVideo && (
                  <button
                    type="button"
                    onClick={() => setGerarVideo(v => !v)}
                    disabled={isStreaming}
                    title={gerarVideo
                      ? "Quando o PERFEITO ficar pronto, sera gerada uma narracao em audio (voz ElevenLabs, sem D-ID) e enviada por email pro luddlocke@gmail.com"
                      : "Ative pra gerar uma narracao em audio do PERFEITO ao fim do RODAR (voz ElevenLabs, sem video)"}
                    className={`flex items-center justify-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow border-2 transition-all w-full sm:w-auto sm:min-w-[160px] disabled:opacity-50 disabled:cursor-not-allowed ${
                      gerarVideo
                        ? "bg-violet-600 hover:bg-violet-700 border-violet-700 text-white"
                        : "bg-white hover:bg-violet-50 border-violet-300 text-violet-700"
                    }`}
                  >
                    <Video className="h-4 w-4" />
                    {gerarVideo ? "Áudio ON" : "Áudio"}
                  </button>
                )}
                {canVideo && (
                  <button
                    type="button"
                    onClick={() => setGerarVideoReal(v => !v)}
                    disabled={isStreaming}
                    title={gerarVideoReal
                      ? "Quando o PERFEITO ficar pronto, sera gerado um VIDEO talking-head (rosto + voz ElevenLabs via D-ID) e enviado por email pro luddlocke@gmail.com. Custo real, nao-gratis."
                      : "Ative pra gerar um VIDEO talking-head do PERFEITO ao fim do RODAR (D-ID + ElevenLabs). Custo real, nao-gratis."}
                    className={`flex items-center justify-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow border-2 transition-all w-full sm:w-auto sm:min-w-[160px] disabled:opacity-50 disabled:cursor-not-allowed ${
                      gerarVideoReal
                        ? "bg-fuchsia-600 hover:bg-fuchsia-700 border-fuchsia-700 text-white"
                        : "bg-white hover:bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700"
                    }`}
                  >
                    <Video className="h-4 w-4" />
                    {gerarVideoReal ? "Vídeo ON" : "Vídeo"}
                  </button>
                )}
                {authenticated && (
                  <select
                    value={bunkerMode}
                    onChange={(e) => setBunkerMode(Number(e.target.value) as 0 | 1 | 2)}
                    disabled={isStreaming}
                    title={
                      bunkerMode === 0
                        ? "BUNKER 0 (padrão): Opus+pagas. Custo normal."
                        : bunkerMode === 1
                          ? "BUNKER 1 (híbrido): vozes pagas (ChatGPT/Claude/Agente/Arquiteto/Tradutor) roteadas pro pool grátis (OpenRouter Llama → Gemini). Síntese (Editorial/Ágora/Secretário) continua Opus. A/B do RODAR sem perder PERFEITO."
                          : "BUNKER 2 (full): vozes + síntese todas grátis. Síntese vai pra Cerebras Qwen 235B. PERFEITO degradado mas custo R$0. Experimental."
                    }
                    className={`text-xs sm:text-sm font-bold uppercase tracking-wider px-3 py-2 rounded-lg shadow border-2 transition-all w-full sm:w-auto sm:min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                      bunkerMode === 0
                        ? "bg-white border-zinc-300 text-zinc-700"
                        : bunkerMode === 1
                          ? "bg-amber-100 border-amber-500 text-amber-900"
                          : "bg-red-100 border-red-500 text-red-900"
                    }`}
                  >
                    <option value={0}>Bunker 0 (padrão)</option>
                    <option value={1}>Bunker 1 (híbrido)</option>
                    <option value={2}>Bunker 2 (full grátis)</option>
                  </select>
                )}
                {authenticated && (
                  <button
                    type="button"
                    onClick={() => setReplica(v => !v)}
                    disabled={isStreaming}
                    title={replica
                      ? "Réplica ON: depois da 1ª rodada, cada voz lê o que as outras disseram e reage em até 2 parágrafos. Custo: 2ª passada nas vozes (inclusive pagas). Clique pra desligar."
                      : "Réplica OFF (padrão): só a 1ª rodada. Clique pra ligar a 2ª rodada onde as vozes reagem umas às outras."}
                    className={`flex items-center justify-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow border-2 transition-all w-full sm:w-auto sm:min-w-[150px] disabled:opacity-50 disabled:cursor-not-allowed ${
                      replica
                        ? "bg-violet-600 hover:bg-violet-700 border-violet-700 text-white"
                        : "bg-white hover:bg-violet-50 border-violet-300 text-violet-700"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4" />
                    {replica ? "Réplica ON" : "Réplica OFF"}
                  </button>
                )}
                {authenticated && (
                  <div className="w-full sm:w-auto sm:min-w-[160px]">
                    <select
                      value={rodarProjectId ?? ""}
                      onChange={(e) => setRodarProjectId(e.target.value ? Number(e.target.value) : null)}
                      disabled={isStreaming}
                      title={rodarProjectId
                        ? "Vozes vão receber os arquivos do projeto selecionado da biblioteca da Árvore"
                        : "Selecione um projeto da biblioteca da Árvore pra injetar arquivos no RODAR (opcional)"}
                      className="w-full text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg shadow border-2 bg-white hover:bg-amber-50 border-amber-300 text-amber-700 cursor-pointer disabled:opacity-50"
                    >
                      <option value="">📁 Projeto: nenhum</option>
                      {rodarProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          📁 {p.nome}{typeof p.fileCount === "number" ? ` (${p.fileCount})` : ""}
                        </option>
                      ))}
                    </select>
                    {rodarProjectId !== null && (
                      <p className="text-[9px] text-amber-700 mt-1 leading-tight">
                        Vozes recebem arquivos do projeto
                      </p>
                    )}
                  </div>
                )}
                {!canVideo && (
                  <a
                    href="mailto:luddlocke@gmail.com?subject=Acesso%20Narracao%20em%20audio%20no%20SalesCockpit"
                    className="text-[10px] text-violet-500 hover:text-violet-700 underline text-center w-full sm:w-auto sm:min-w-[160px] leading-tight px-2 hidden"
                  >
                    Quer áudio? mande email pro Ludd Locke pedindo acesso
                  </a>
                )}
              </div>
            </div>

            {/* Strategy panel for long prompts */}
            {showStrategyPanel && !isStreaming && (
              <div className="w-full rounded-xl border-2 border-fuchsia-300 bg-fuchsia-50 p-4 space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-fuchsia-800 flex items-center gap-2">
                      <BookOpen className="h-4 w-4" /> Prompt longo — escolha a estratégia por pensador
                    </p>
                    <p className="text-xs text-fuchsia-600 mt-0.5">
                      {prompt.trim().length.toLocaleString()} chars · ~{Math.ceil(prompt.trim().length / 4).toLocaleString()} tokens estimados
                    </p>
                  </div>
                  <button onClick={() => setShowStrategyPanel(false)} className="text-fuchsia-400 hover:text-fuchsia-700 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Global actions */}
                <div className="flex flex-wrap gap-2 pb-1 border-b border-fuchsia-200">
                  <span className="text-xs text-fuchsia-600 font-semibold self-center">Aplicar a todos:</span>
                  {([
                    { s: "partes" as Strategy,           icon: <SplitSquareVertical className="h-3 w-3" />, label: "Em partes"          },
                    { s: "resumo-tradutor" as Strategy,  icon: <BookOpen className="h-3 w-3" />,            label: "Resumo do Tradutor" },
                    { s: "abstencao" as Strategy,        icon: <Ban className="h-3 w-3" />,                 label: "Abstenção"          },
                  ]).map(({ s, icon, label }) => (
                    <button key={s} onClick={() => handleSetAllStrategies(s)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-fuchsia-300 bg-white hover:bg-fuchsia-100 text-fuchsia-700 transition-colors font-medium">
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {/* Per-AI strategy rows */}
                <div className="space-y-1.5">
                  {AI_CONFIG.map(cfg => (
                    <div key={cfg.label} className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold uppercase tracking-wide w-20 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                      {([
                        { s: "partes" as Strategy,          icon: <SplitSquareVertical className="h-3 w-3" />, label: "Em partes"          },
                        { s: "resumo-tradutor" as Strategy, icon: <BookOpen className="h-3 w-3" />,            label: "Resumo do Tradutor" },
                        { s: "abstencao" as Strategy,       icon: <Ban className="h-3 w-3" />,                 label: "Abstenção"          },
                      ]).map(({ s, icon, label }) => {
                        const active = (strategies[cfg.label] ?? "partes") === s;
                        return (
                          <button key={s} onClick={() => setStrategies(prev => ({ ...prev, [cfg.label]: s }))}
                            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-all font-medium ${active ? "bg-fuchsia-600 text-white border-fuchsia-600" : "bg-white text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-100"}`}>
                            {icon} {label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Tradutor note */}
                {Object.values(strategies).some(s => s === "resumo-tradutor") && (
                  <p className="text-xs text-fuchsia-600 bg-fuchsia-100 rounded-lg px-3 py-2 border border-fuchsia-200">
                    <span className="font-bold">O Tradutor</span> aparecerá como participante ativo nesta rodada — ele sintetiza o texto longo e os pensadores marcados com "Resumo do Tradutor" recebem essa síntese como prompt.
                  </p>
                )}

                <button
                  onClick={() => void runRodar(prompt.trim() || "Subversão Ambiental Mundial", strategies)}
                  className="w-full flex items-center justify-center gap-2 bg-fuchsia-700 hover:bg-fuchsia-800 text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow transition-all"
                >
                  <Send className="h-4 w-4" /> Confirmar e Rodar
                </button>
              </div>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Here is what's happening with your leads today.</p>
          </div>
        </div>

        {/* Live streaming panel */}
        {phase !== "idle" && (
          <Card className={`border-2 transition-colors ${isDone ? "border-green-400" : bgContinued ? "border-primary/40" : phase === "error" ? "border-destructive" : "border-primary/30"}`}>
            <CardHeader className="pb-3">
              {(isStreaming || (isDone && emailSent)) && (
                <p className="text-sm italic text-muted-foreground mb-2 leading-relaxed">
                  Quando o fluxograma se aquietar, a síntese destilada de todas as vozes pousará no seu e-mail.
                </p>
              )}
              {isStreaming && (
                <p className="text-sm font-medium text-primary/80 mb-2 leading-relaxed">
                  Pode fechar a página: o RODAR continua no servidor e o resultado chega no seu e-mail quando terminar.
                </p>
              )}
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                {isStreaming && <><Zap className="h-4 w-4 animate-pulse text-primary" /> As IAs estão respondendo ao vivo...</>}
                {isDone && emailSent && <><CheckCircle2 className="h-4 w-4 text-green-500" /> RODAR concluído — pipeline pós-RODAR em andamento</>}
                {isDone && !emailSent && <><CheckCircle2 className="h-4 w-4 text-green-500" /> Concluído</>}
                {phase === "error" && (bgContinued
                  ? <><CheckCircle2 className="h-4 w-4 text-green-500" /> {runError}</>
                  : <><AlertCircle className="h-4 w-4 text-destructive" /> {runError}</>)}
                {assembleiaId && (
                  <a
                    href={`/assembleia/${assembleiaId}`}
                    className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1 rounded-full transition-all"
                  >
                    <Scale className="h-3.5 w-3.5" />
                    Ver Assembleia #{assembleiaId.toLocaleString("pt-BR")}
                  </a>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Banner de auto-split: prompt foi dividido em múltiplas assembleias */}
              {splitInfo && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm font-medium text-amber-800">
                  <span className="text-base">📄</span>
                  <span>Assembleia <strong>parte {splitInfo.current} de {splitInfo.total}</strong> — prompt dividido automaticamente (acima de 20k chars)</span>
                </div>
              )}
              {/* Seletor de estilo da tela de espera */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Estilo:</span>
                {ESPERA_OPCOES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEsperaEstilo(opt.value)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${
                      esperaEstilo === opt.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {esperaEstilo === "classico" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cards.map((cardState) => {
                    const cfg = cardState.label === "Tradutor"
                      ? TRADUTOR_CONFIG
                      : (AI_CONFIG.find(c => c.label === cardState.label) ?? AI_CONFIG[0]);
                    return <AiCard key={cardState.label} state={cardState} cfg={cfg} />;
                  })}
                </div>
              )}
              {esperaEstilo === "campo-de-ondas" && <CampoDeOndas cards={cards} phase={phase} />}
              {esperaEstilo === "nucleo-orbital" && <NucleoOrbital cards={cards} phase={phase} wave={waveInfo} />}
              {esperaEstilo === "fluxo-vivo" && <FluxoVivo cards={cards} phase={phase} />}

              {/* Pipeline progress (Editorial → Meta → Ágora → Secretário → PERFEITO) */}
              {isDone && emailSent && assembleiaId && (
                <PipelineProgress
                  assembleiaId={assembleiaId}
                  phase={pipelinePhase}
                  setPhase={setPipelinePhase}
                  error={pipelineError}
                  setError={setPipelineError}
                />
              )}

              {/* Comparar button */}
              {isDone && comparePhase === "idle" && (
                <div className="flex justify-center pt-1">
                  <button
                    onClick={handleComparar}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow transition-all"
                  >
                    <GitCompare className="h-4 w-4" /> Análise Metassemiótica (Llama 3.3/Groq)
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Comparison card */}
        {comparePhase !== "idle" && (
          <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-violet-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-indigo-700">
                <GitCompare className="h-4 w-4" />
                Análise Metassemiótica Comparativa
                {comparePhase === "streaming" && <span className="ml-1 flex gap-0.5">{[0,1,2].map(i => <span key={i} className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}</span>}
                {comparePhase === "done" && <CheckCircle2 className="h-4 w-4 text-indigo-500" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono min-h-12">
                {compareText}
                {comparePhase === "streaming" && <span className="inline-block w-1.5 h-3 ml-0.5 rounded-sm bg-indigo-500 animate-pulse align-middle" />}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats cards */}
        {statsLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1,2,3,4].map(i => (
              <Card key={i}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-4 rounded-full" /></CardHeader><CardContent><Skeleton className="h-8 w-16 mb-1" /><Skeleton className="h-3 w-32" /></CardContent></Card>
            ))}
          </div>
        ) : stats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Leads</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalLeads}</div><p className="text-xs text-muted-foreground"><span className="text-primary font-medium">+{stats.newLeadsThisWeek}</span> this week</p></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Emails Sent</CardTitle><Mail className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.emailsSent}</div><p className="text-xs text-muted-foreground">Total outreach</p></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Drafts Ready</CardTitle><MailOpen className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.emailsDrafted}</div><p className="text-xs text-muted-foreground">Waiting to be sent</p></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Open Rate</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{(stats.openRate * 100).toFixed(1)}%</div><p className="text-xs text-muted-foreground">Average across all sent</p></CardContent></Card>
          </div>
        ) : null}

        {/* Charts */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Verbosidade das IAs</CardTitle><CardDescription>Total de caracteres produzidos por cada IA no histórico RODAR</CardDescription></CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="h-[260px] flex items-center justify-center"><Skeleton className="h-40 w-full rounded-lg" /></div>
              ) : aiCharData.length > 0 ? (
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={aiCharData} layout="vertical" margin={{ left: 16, right: 24, top: 4, bottom: 4 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontWeight: 600 }} width={100} />
                      <Tooltip formatter={(v: number) => [`${v.toLocaleString()} chars`, "Total"]} contentStyle={{ borderRadius: "8px", border: "none", fontSize: 12 }} />
                      <Bar dataKey="chars" radius={[0, 6, 6, 0]}>
                        {aiCharData.map((entry) => (
                          <Cell key={entry.name} fill={AI_COLORS[entry.name] ?? "#888"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <Bot className="h-10 w-10 mb-2 opacity-20" />
                  <p className="text-sm">Nenhuma rodada ainda — pressione RODAR para começar!</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader><CardTitle className="flex items-center gap-2"><PieChartIcon className="h-5 w-5" />Lead Status</CardTitle><CardDescription>Distribuição dos leads por status</CardDescription></CardHeader>
            <CardContent className="pl-2">
              {breakdownLoading ? <div className="h-[260px] flex items-center justify-center"><Skeleton className="h-[220px] w-[220px] rounded-full" /></div>
                : breakdown && breakdown.length > 0 ? (
                  <div className="h-[260px] w-full"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={5} dataKey="count" nameKey="status">{breakdown.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: "8px", border: "none" }} /><Legend /></PieChart></ResponsiveContainer></div>
                ) : <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg"><PieChartIcon className="h-10 w-10 mb-2 opacity-20" /><p>No lead data available</p></div>}
            </CardContent>
          </Card>
        </div>

        {/* History Panel */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Histórico de Execuções</CardTitle><CardDescription>Todas as rodadas RODAR e imagens da tela de login geradas por IA</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Imagens de Login (Estilo Kobra)
                <span className="text-xs font-normal normal-case text-muted-foreground/60">— aparece uma diferente a cada visita</span>
              </h3>
              {loginImageHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50 border-2 border-dashed rounded-xl">
                  <ImageIcon className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-xs">Nenhuma visita registrada ainda</p>
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {loginImageHistory.slice(0, 12).map((entry, idx) => (
                    <div key={idx} className="group relative rounded-xl overflow-hidden border shadow-sm shrink-0 w-28">
                      <img src={entry.image} alt={IMAGE_LABELS[entry.image] ?? "Kobra"} className="w-full aspect-[9/16] object-cover group-hover:scale-105 transition-transform duration-300" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-2">
                        {idx === 0 && <span className="text-[9px] font-bold text-yellow-300 uppercase mb-0.5">Última</span>}
                        <p className="text-white text-[10px] font-semibold leading-tight">{IMAGE_LABELS[entry.image] ?? entry.image}</p>
                        <p className="text-white/50 text-[9px] mt-0.5">{format(new Date(entry.timestamp), "d/MM HH:mm")}</p>
                      </div>
                      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-300 to-emerald-400" />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><Bot className="h-4 w-4" /> Rodadas RODAR</h3>
              {historyLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="rounded-lg border p-4 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div>)}</div>
                : history.length === 0 ? <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-xl"><Bot className="h-10 w-10 mb-2 opacity-20" /><p className="text-sm">Nenhuma rodada ainda — pressione RODAR para começar!</p></div>
                : (
                  <div className="space-y-3">
                    {history.map(row => (
                      <div key={row.id} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                        <button onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 h-2 w-2 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #06b6d4, #ec4899)" }} />
                            <div>
                              <p className="text-sm font-semibold">{row.prompt}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Clock className="h-3 w-3" />{format(new Date(row.createdAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}</p>
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 ml-4">{expandedId === row.id ? "▲ fechar" : "▼ ver respostas"}</span>
                        </button>
                        {expandedId === row.id && (
                          <div className="border-t divide-y">
                            {[
                              { label: "ChatGPT",      text: row.openaiResponse,     color: "text-cyan-600"    },
                              { label: "Claude",       text: row.claudeResponse,     color: "text-orange-600"  },
                              { label: "Gemini",       text: row.geminiResponse,     color: "text-violet-600"  },
                              { label: "Perplexity",   text: row.perplexityResponse, color: "text-emerald-600" },
                              { label: "Meta Oráculo", text: row.togetherResponse,   color: "text-indigo-700"  },
                              { label: "Árvore",       text: row.groqResponse,       color: "text-amber-700"   },
                              { label: "Agente",       text: row.agenteResponse,     color: "text-rose-700"    },
                            ].filter(ai => ai.text).map(ai => (
                              <div key={ai.label} className="px-4 py-3">
                                <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${ai.color}`}>{ai.label}</p>
                                <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{ai.text}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
}

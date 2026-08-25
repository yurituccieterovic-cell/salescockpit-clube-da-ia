import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Send, Check, X, Loader2, FileCode, AlertTriangle } from "lucide-react";
import { AplicarPropostaDialog, interpretarResposta } from "@/components/arvore/aplicar-proposta";

interface ProposalRow {
  id: number;
  request: string;
  summary: string;
  status: string;
  createdAt: string;
  createdBy: string;
  appliedAt: string | null;
  appliedToDisk?: boolean;
  appliedToDiskAt?: string | null;
  appliedIn?: string | null;
  errorMsg: string | null;
}

interface ProposalDetail extends ProposalRow {
  diffs: Array<{ path: string; oldContent: string | null; newContent: string }>;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface FlightStep {
  icon: string;
  label: string;
  done: boolean;
  detail: string | null;
}

function flightPlan(p: ProposalDetail | ProposalRow): FlightStep[] {
  const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR") : null);
  const isFailed = p.status === "failed";
  const isRejected = p.status === "rejected";
  const isApproved = p.status === "approved";
  const appliedDisk = !!p.appliedToDisk;
  return [
    {
      icon: "📝",
      label: "Proposta criada",
      done: true,
      detail: fmt(p.createdAt),
    },
    {
      icon: isRejected ? "✗" : isApproved || appliedDisk ? "✅" : isFailed ? "⚠" : "⏳",
      label: isRejected ? "Rejeitada" : "Aprovada por Yuri",
      done: isApproved || appliedDisk || isRejected,
      detail: isRejected ? "(você rejeitou)" : fmt(p.appliedAt),
    },
    {
      icon: appliedDisk ? "💾" : isApproved ? "⏳" : "·",
      label: "Aplicada no código (ambiente de trabalho)",
      done: appliedDisk,
      detail: appliedDisk
        ? `${fmt(p.appliedToDiskAt) ?? ""} via ${p.appliedIn ?? "?"}`
        : isApproved
        ? "Aprovada pelo site publicado não muda o código. Proponha/aprove pela Árvore programadora no ambiente de trabalho — lá a aprovação escreve o arquivo na hora."
        : null,
    },
    {
      icon: appliedDisk ? "🚀" : "·",
      label: "Em produção",
      done: false, // sem tracking automático
      detail: appliedDisk
        ? "Aguardando Republish manual (sem trackeamento automático)"
        : null,
    },
  ];
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  rejected: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40",
  failed: "bg-red-500/20 text-red-300 border-red-500/40",
};

export default function ArvoreCodePage() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen text-white" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" }}>
      <header className="border-b border-white/10 px-4 sm:px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate("/app")} className="flex items-center gap-2 text-white/70 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <FileCode className="h-5 w-5 text-emerald-400" /> Árvore programadora
        </h1>
        <span className="ml-auto text-xs text-white/50">Claude Sonnet 4.5 · diff + aprovar 1-clique</span>
      </header>
      <ArvoreCodePanel />
    </div>
  );
}

export function ArvoreCodePanel() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [request, setRequest] = useState("");
  const [proposing, setProposing] = useState(false);
  const [list, setList] = useState<ProposalRow[]>([]);
  const [selected, setSelected] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/arvore/code/proposals`, { credentials: "include" });
      if (!r.ok) return;
      setList(await r.json());
    } catch { /* ignore */ }
  }, [base]);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function submitRequest() {
    const r = request.trim();
    if (r.length < 5) { setError("Pedido muito curto"); return; }
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/arvore/code/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ request: r }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setRequest("");
        await fetchList();
        if (body.id) await openProposal(body.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposing(false);
    }
  }

  async function openProposal(id: number) {
    try {
      const r = await fetch(`${base}/api/arvore/code/proposals/${id}`, { credentials: "include" });
      if (!r.ok) return;
      setSelected(await r.json());
    } catch { /* ignore */ }
  }

  async function doApprove(id: number) {
    const r = await fetch(`${base}/api/arvore/code/proposals/${id}/approve`, {
      method: "POST", credentials: "include",
    });
    const body = await r.json().catch(() => ({}));
    await fetchList();
    await openProposal(id);
    if (!r.ok) return { ok: false, message: body.error ?? "Falhou" };
    return interpretarResposta(body);
  }

  async function reject(id: number) {
    setActionLoading(true);
    try {
      await fetch(`${base}/api/arvore/code/proposals/${id}/reject`, {
        method: "POST", credentials: "include",
      });
      await fetchList();
      await openProposal(id);
    } finally { setActionLoading(false); }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
        <section className="space-y-6">
          <div className="border border-white/10 rounded-xl bg-white/5 p-4">
            <label className="text-xs uppercase tracking-wider text-white/60 mb-2 block">
              Peça uma mudança no código
            </label>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Ex: adiciona botão de exportar PDF na página /jornal usando jspdf, ou ajusta o cabeçalho da Home pra mostrar X..."
              className="w-full h-32 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm font-mono resize-none focus:outline-none focus:border-emerald-400/50"
              disabled={proposing}
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-white/40">{request.length}/5000</span>
              <button
                onClick={submitRequest}
                disabled={proposing || request.trim().length < 5}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold"
              >
                {proposing ? <><Loader2 className="h-4 w-4 animate-spin" /> Árvore pensando…</> : <><Send className="h-4 w-4" /> Propor edição</>}
              </button>
            </div>
            {error && (
              <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}
            {proposing && (
              <p className="mt-2 text-xs text-white/50 italic">
                Pode levar 30s-2min. Ela tá lendo o repo, planejando e escrevendo. Custo ~R$ 0.30-1.50.
              </p>
            )}
          </div>

          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/60 mb-3">Propostas recentes</h2>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
              {list.length === 0 && <p className="text-sm text-white/40 italic">Nenhuma proposta ainda.</p>}
              {list.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProposal(p.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${selected?.id === p.id ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:border-white/30"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_COLOR[p.status] ?? "bg-white/10"}`}>
                      {p.status}
                    </span>
                    <span className="text-[10px] text-white/40">#{p.id} · {new Date(p.createdAt).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="text-sm text-white/90 line-clamp-2">{p.summary}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="border border-white/10 rounded-xl bg-black/30 p-4 min-h-[400px]">
          {!selected ? (
            <p className="text-white/40 text-sm italic text-center py-12">Selecione uma proposta na lista pra ver o diff.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-1 rounded border ${STATUS_COLOR[selected.status] ?? "bg-white/10"}`}>{selected.status}</span>
                  <span className="text-xs text-white/40">#{selected.id} · por {selected.createdBy}</span>
                  {selected.inputTokens && (
                    <span className="text-xs text-white/40 ml-auto">
                      {selected.inputTokens} in / {selected.outputTokens} out tokens
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 mb-1">Pedido:</p>
                <p className="text-sm text-white/80 mb-3 bg-white/5 p-2 rounded">{selected.request}</p>
                <p className="text-xs text-white/50 mb-1">Resumo da Árvore:</p>
                <p className="text-sm text-white/90 mb-3">{selected.summary}</p>
                {selected.errorMsg && (
                  <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300 mb-3">
                    Erro ao aplicar: {selected.errorMsg}
                  </div>
                )}
              </div>

              {selected.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmId(selected.id)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-bold"
                  >
                    <Check className="h-4 w-4" /> Aprovar e aplicar
                  </button>
                  <button
                    onClick={() => reject(selected.id)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 disabled:opacity-40 text-sm font-bold"
                  >
                    <X className="h-4 w-4" /> Rejeitar
                  </button>
                </div>
              )}

              <div className="border border-white/10 rounded-lg bg-black/30 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/60 mb-3 flex items-center gap-2">
                  Plano de voo — caminho dessa proposta até a produção
                </h3>
                <ol className="space-y-3">
                  {flightPlan(selected).map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <div className={`text-lg leading-none w-6 text-center ${step.done ? "" : "opacity-40"}`}>{step.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${step.done ? "text-white" : "text-white/50"}`}>{step.label}</p>
                        {step.detail && (
                          <p className="text-xs text-white/50 mt-0.5 break-words">{step.detail}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                {selected.status === "approved" && !selected.appliedToDisk && (
                  <div className="mt-3 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                    Você aprovou pelo site publicado. O ambiente no ar é só leitura e tem
                    banco separado, então o site NÃO muda o próprio código — a aprovação só
                    ficou registrada. Pra a mudança virar código de verdade, abra a Árvore
                    programadora pelo ambiente de trabalho (workspace de desenvolvimento) e
                    proponha/aprove por lá: a aprovação escreve o arquivo na hora. Depois é só publicar.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white/60">
                  {selected.diffs.length} arquivo(s)
                </h3>
                {selected.diffs.map((d, idx) => (
                  <DiffView key={idx} path={d.path} oldContent={d.oldContent} newContent={d.newContent} />
                ))}
              </div>
            </div>
          )}
        </section>

        <AplicarPropostaDialog
          open={confirmId !== null}
          summary={list.find((p) => p.id === confirmId)?.summary ?? selected?.summary ?? null}
          onCancel={() => setConfirmId(null)}
          onConfirm={async () => {
            const id = confirmId!;
            return doApprove(id);
          }}
        />
    </main>
  );
}

function DiffView({ path, oldContent, newContent }: { path: string; oldContent: string | null; newContent: string }) {
  const [expanded, setExpanded] = useState(false);
  const isNew = oldContent === null;
  const oldLines = (oldContent ?? "").split("\n");
  const newLines = newContent.split("\n");

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 flex items-center gap-2 text-left"
      >
        <FileCode className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-mono">{path}</span>
        {isNew && <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">NOVO</span>}
        <span className="ml-auto text-xs text-white/40">
          {isNew ? `+${newLines.length}` : `${oldLines.length} → ${newLines.length} linhas`}
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 text-xs font-mono">
          <div className="bg-red-950/30 border-r border-white/10 max-h-96 overflow-auto">
            <div className="px-2 py-1 text-[10px] uppercase text-red-300/70 sticky top-0 bg-red-950/60">Antes</div>
            <pre className="p-2 whitespace-pre-wrap break-all">{oldContent ?? "(arquivo novo)"}</pre>
          </div>
          <div className="bg-emerald-950/30 max-h-96 overflow-auto">
            <div className="px-2 py-1 text-[10px] uppercase text-emerald-300/70 sticky top-0 bg-emerald-950/60">Depois</div>
            <pre className="p-2 whitespace-pre-wrap break-all">{newContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, Rocket, AlertTriangle, FileCode, ExternalLink } from "lucide-react";

// Janela de confirmação pra "dar run" numa proposta de código da Árvore.
// É a mesma ação tanto na conversa do Oráculo quanto na página do arquiteto:
// as duas batem no mesmo registro no servidor, então aprovar/rejeitar num
// lugar vale no outro. "Aplicar de verdade" escreve o código no ambiente de
// trabalho; ir pro ar ainda depende do passo de publicar.

export interface PropostaResumo {
  id: number;
  summary: string;
  status: string;
  createdAt: string;
}

export interface ResultadoAplicacao {
  ok: boolean;
  message: string;
}

interface AplicacaoResposta {
  appliedToDisk?: boolean;
  queued?: boolean;
  filesWritten?: number;
  filesPending?: number;
  error?: string;
}

export function interpretarResposta(body: AplicacaoResposta): ResultadoAplicacao {
  if (body?.appliedToDisk) {
    return {
      ok: true,
      message:
        "Pronto — apliquei a mudança no código aqui no ambiente de trabalho e deixei registrada. Pra ela ir pro ar, é só me pedir pra publicar.",
    };
  }
  if (body?.queued) {
    return {
      ok: true,
      message:
        "Aprovação registrada, mas o site no ar não muda o próprio código (ambiente só leitura, banco separado do de desenvolvimento). Pra a mudança virar código de verdade, abra a Árvore programadora pelo ambiente de trabalho e proponha/aprove por lá — a aprovação escreve o arquivo na hora. Depois é só publicar.",
    };
  }
  if (body?.error) return { ok: false, message: body.error };
  return { ok: true, message: "Feito." };
}

// Modal de confirmação. O pai passa o que fazer no confirmar (onConfirm), que
// retorna a mensagem amigável do resultado. O modal cuida das fases.
export function AplicarPropostaDialog({
  open,
  summary,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  summary: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<ResultadoAplicacao>;
}) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [result, setResult] = useState<ResultadoAplicacao | null>(null);

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  async function run() {
    setPhase("running");
    try {
      const r = await onConfirm();
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    setPhase("done");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={() => phase !== "running" && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#121a26] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="h-5 w-5 text-emerald-400" />
          <h3 className="text-base font-bold text-white">Aplicar mudança no código</h3>
        </div>

        {phase !== "done" && (
          <>
            <p className="text-sm text-white/70 mb-2">
              A Árvore quer fazer esta mudança:
            </p>
            <p className="text-sm text-white/90 bg-white/5 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
              {summary || "(sem resumo)"}
            </p>
            <div className="flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 mb-4">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Aplicar escreve o código no ambiente de trabalho de verdade. Pra
                aparecer no site no ar, falta só o passo de publicar — é só me pedir.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={phase === "running"}
                className="px-4 py-2 rounded-lg border border-white/15 text-sm text-white/70 hover:text-white hover:border-white/30 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={() => void run()}
                disabled={phase === "running"}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-bold disabled:opacity-40"
              >
                {phase === "running" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Aplicando…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" /> Aplicar agora
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {phase === "done" && result && (
          <>
            <div
              className={`flex gap-2 text-sm rounded-lg p-3 mb-4 border ${
                result.ok
                  ? "text-emerald-200 bg-emerald-500/10 border-emerald-500/30"
                  : "text-red-200 bg-red-500/10 border-red-500/30"
              }`}
            >
              {result.ok ? (
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span>{result.message}</span>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold"
              >
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Banner pra conversa do Oráculo: mostra propostas pendentes com a mesma
// janela de aplicar. Auto-contido (busca, aplica, rejeita, atualiza).
export function PropostasPendentesArvore({
  onVerDetalhes,
}: {
  onVerDetalhes?: () => void;
}) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [pendentes, setPendentes] = useState<PropostaResumo[]>([]);
  const [dialogFor, setDialogFor] = useState<PropostaResumo | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/arvore/code/proposals`, { credentials: "include" });
      if (!r.ok) return;
      const all = (await r.json()) as PropostaResumo[];
      setPendentes(all.filter((p) => p.status === "pending"));
    } catch {
      /* ignore */
    }
  }, [base]);

  useEffect(() => {
    void refetch();
    const t = setInterval(() => void refetch(), 20000);
    return () => clearInterval(t);
  }, [refetch]);

  const aplicar = useCallback(
    async (id: number): Promise<ResultadoAplicacao> => {
      const r = await fetch(`${base}/api/arvore/code/proposals/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await r.json().catch(() => ({}))) as AplicacaoResposta;
      await refetch();
      if (!r.ok) return { ok: false, message: body.error ?? "Não consegui aplicar." };
      return interpretarResposta(body);
    },
    [base, refetch],
  );

  const rejeitar = useCallback(
    async (id: number) => {
      if (!confirm("Descartar esta proposta de código?")) return;
      setRejectingId(id);
      try {
        await fetch(`${base}/api/arvore/code/proposals/${id}/reject`, {
          method: "POST",
          credentials: "include",
        });
        await refetch();
      } finally {
        setRejectingId(null);
      }
    },
    [base, refetch],
  );

  if (pendentes.length === 0) return null;

  return (
    <div className="mx-2 mb-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileCode className="h-4 w-4 text-emerald-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
          A Árvore quer mexer no código ({pendentes.length})
        </span>
        {onVerDetalhes && (
          <button
            onClick={onVerDetalhes}
            className="ml-auto flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
          >
            Ver tudo <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="space-y-2">
        {pendentes.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-2"
          >
            <p className="flex-1 text-xs text-white/85 line-clamp-2">{p.summary}</p>
            <button
              onClick={() => setDialogFor(p)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold shrink-0"
            >
              <Check className="h-3.5 w-3.5" /> Aplicar
            </button>
            <button
              onClick={() => void rejeitar(p.id)}
              disabled={rejectingId === p.id}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-[11px] shrink-0 disabled:opacity-40"
              title="Descartar"
            >
              {rejectingId === p.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>

      <AplicarPropostaDialog
        open={dialogFor !== null}
        summary={dialogFor?.summary ?? null}
        onCancel={() => setDialogFor(null)}
        onConfirm={async () => {
          const id = dialogFor!.id;
          return aplicar(id);
        }}
      />
    </div>
  );
}

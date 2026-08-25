import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, Loader2, ChevronDown, ChevronUp, Search, X, Download } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface JornalEntry {
  id: number;
  sessionId: number | null;
  topic: string;
  perfeitoText: string;
  imageUrl: string | null;
  publishedAt: string;
}

interface JornalResponse {
  entries: JornalEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 9;

const mostraBase = import.meta.env.BASE_URL.replace(/\/$/, "");

function MostraCard({ entry }: { entry: JornalEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const isLong = entry.perfeitoText.length > 400;

  const baixarPdf = async () => {
    setBaixando(true);
    try {
      const res = await fetch(`${mostraBase}/api/jornal/publico/${entry.id}/pdf`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mostra-${entry.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Não foi possível gerar o PDF.");
    }
    setBaixando(false);
  };

  return (
    <article className="rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] hover:border-white/25 transition-all">
      {entry.imageUrl && !imgError ? (
        <div className="relative aspect-[16/8] overflow-hidden bg-black">
          <img
            src={entry.imageUrl}
            alt={entry.topic}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <p className="text-white font-bold text-base sm:text-lg leading-tight drop-shadow-lg line-clamp-2">
              {entry.topic}
            </p>
          </div>
        </div>
      ) : (
        <div
          className="px-5 pt-5 pb-3"
          style={{ background: "linear-gradient(135deg, #0c0c1f 0%, #1a0b2e 50%, #0a1a1a 100%)" }}
        >
          <p className="text-white font-bold text-base sm:text-lg leading-tight">{entry.topic}</p>
        </div>
      )}

      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3 w-3" />
            {format(new Date(entry.publishedAt), "d 'de' MMM yyyy", { locale: ptBR })}
          </span>
          {entry.sessionId && (
            <span className="bg-white/5 text-white/60 font-semibold px-2 py-0.5 rounded-full">
              Sessão #{entry.sessionId?.toLocaleString("pt-BR")}
            </span>
          )}
        </div>

        <p
          className={`text-sm text-white/75 leading-relaxed whitespace-pre-wrap ${
            expanded ? "" : "line-clamp-5"
          }`}
        >
          {entry.perfeitoText}
        </p>

        <div className="flex items-center justify-between gap-2">
          {isLong ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Ver menos
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> Ler completo
                </>
              )}
            </button>
          ) : <span />}
          <button
            onClick={() => void baixarPdf()}
            disabled={baixando}
            title="Baixar PDF desta peça"
            className="flex items-center gap-1 text-xs text-white/60 hover:text-white font-medium disabled:opacity-50"
          >
            {baixando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            PDF
          </button>
        </div>
      </div>
    </article>
  );
}

const TEMA_SUGESTOES = ["saúde", "ecologia", "arte", "ética", "tecnologia"];

export default function MostraPage() {
  const [entries, setEntries] = useState<JornalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tema, setTema] = useState("");
  const [temaDraft, setTemaDraft] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean, currentTema: string) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (currentTema.trim()) params.set("tema", currentTema.trim());
        const res = await fetch(`${base}/api/jornal/publico?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as JornalResponse;
        setEntries(prev => (append ? [...prev, ...data.entries] : data.entries));
        setTotal(data.total);
        setOffset(nextOffset + data.entries.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [base],
  );

  useEffect(() => {
    void loadPage(0, false, tema);
  }, [loadPage, tema]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTema(temaDraft);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [temaDraft]);

  const applyTema = (t: string) => {
    setTemaDraft(t);
    setTema(t);
  };

  const hasMore = entries.length < total;

  return (
    <div className="min-h-screen text-white" style={{ background: "hsl(240 20% 8%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500 z-50" />

      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors min-w-0"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm font-bold uppercase tracking-widest truncate">
              SalesCockpit
            </span>
          </Link>
          <Link
            href="/login"
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-black uppercase tracking-widest text-white shadow-lg transition-all hover:opacity-90"
            style={{ background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)" }}
          >
            Entrar <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-400 mb-3 font-bold">
          Mostra · Jornal público
        </p>
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight mb-4 leading-tight">
          Deliberações reais do painel.
        </h1>
        <p className="text-base sm:text-lg text-white/65 max-w-2xl leading-relaxed">
          Cada peça abaixo é a síntese final (texto PERFEITO) que o Secretário publicou ao
          encerrar uma sessão completa do painel deliberativo. Conteúdo reservado das vozes
          (retidos, segredo, votação interna) não aparece aqui — só a versão publicável.
        </p>

        <div className="mt-8 space-y-3">
          <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
            <input
              type="text"
              value={temaDraft}
              onChange={e => setTemaDraft(e.target.value)}
              placeholder="Buscar por tema (ex: saúde, ecologia, arte)"
              maxLength={120}
              className="w-full rounded-xl bg-white/5 border border-white/15 focus:border-cyan-400/60 focus:bg-white/[0.07] outline-none pl-11 pr-10 py-3 text-sm text-white placeholder:text-white/35 transition-colors"
            />
            {temaDraft && (
              <button
                onClick={() => applyTema("")}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMA_SUGESTOES.map(t => {
              const active = tema.toLowerCase() === t.toLowerCase();
              return (
                <button
                  key={t}
                  onClick={() => applyTema(active ? "" : t)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                    active
                      ? "bg-cyan-400/20 border-cyan-400/60 text-cyan-200"
                      : "bg-white/5 border-white/15 text-white/60 hover:text-white hover:border-white/30"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-300">
              <p className="font-medium">Não consegui carregar a Mostra.</p>
              <p className="text-xs mt-1 text-red-400/70">{error}</p>
              <button
                onClick={() => void loadPage(0, false, tema)}
                className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
              >
                Tentar de novo
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-white/40">
              <BookOpen className="h-12 w-12 mb-3 opacity-30" />
              {tema ? (
                <>
                  <p className="font-medium">Nada encontrado pra "{tema}".</p>
                  <button
                    onClick={() => applyTema("")}
                    className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Limpar filtro
                  </button>
                </>
              ) : (
                <>
                  <p className="font-medium">Nenhuma deliberação publicada ainda.</p>
                  <p className="text-sm mt-1">Volte em breve.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {entries.map(entry => (
                  <MostraCard key={entry.id} entry={entry} />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-10">
                  <button
                    onClick={() => void loadPage(offset, true, tema)}
                    disabled={loadingMore}
                    className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 text-sm font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                      </>
                    ) : (
                      <>
                        Carregar mais ({total - entries.length} restantes)
                      </>
                    )}
                  </button>
                </div>
              )}

              <p className="text-center mt-8 text-xs text-white/30">
                {entries.length} de {total} deliberações
              </p>
            </>
          )}
        </div>
      </section>

      <section className="border-t border-white/10 max-w-4xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-base sm:text-lg text-white/70 mb-5">
          Quer que o painel discuta o seu tema?
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest text-white/90 border-2 border-white/30 hover:bg-white/10 transition-all"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar pra Home
          </Link>
          <a
            href="mailto:luddlocke@gmail.com?subject=Sociedade%20Tucci%20%E2%80%94%20or%C3%A7amento"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg transition-all hover:scale-105"
            style={{ background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)" }}
          >
            Pedir orçamento
          </a>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-black/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-xs text-white/50 text-center">
          <p className="font-bold text-white/80 tracking-wider uppercase text-sm mb-1">
            Sociedade Tucci · feito com Replit
          </p>
          <p>© {new Date().getFullYear()} · Soluções Inteligentes em Produção Multimídia</p>
        </div>
        <div className="h-1.5 bg-gradient-to-r from-violet-500 via-emerald-400 via-yellow-400 via-pink-500 to-cyan-400" />
      </footer>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Loader2, Network, Sprout, Link2, Check } from "lucide-react";
import Markdown from "@/components/Markdown";
import CodeSandbox from "@/components/CodeSandbox";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

type EcoKind = "markdown" | "code";

interface PublicPage {
  id: number;
  slug: string;
  title: string;
  kind?: EcoKind;
  parentId: number | null;
  author: "yuri" | "arvore";
  updatedAt: string;
}
interface PublicPageFull extends PublicPage {
  content: string;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-white" style={{ background: "hsl(150 24% 7%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-cyan-400 via-teal-300 to-lime-400 z-50" />
      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/eco" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors min-w-0">
            <Sprout className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-xs sm:text-sm font-bold uppercase tracking-widest truncate">Ecossistema</span>
          </Link>
          <Link
            href="/"
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all hover:opacity-90"
            style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
          >
            SalesCockpit <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>
      {children}
      <footer className="border-t border-white/10 bg-black/40 mt-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 text-xs text-white/50 text-center">
          <p className="font-bold text-white/80 tracking-wider uppercase text-sm mb-1">Sociedade Tucci</p>
          <p>© {new Date().getFullYear()} · Um berço de projetos da Árvore</p>
        </div>
        <div className="h-1.5 bg-gradient-to-r from-lime-400 via-teal-300 via-cyan-400 to-emerald-400" />
      </footer>
    </div>
  );
}

export default function EcoIndex() {
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/eco/publico`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { pages: PublicPage[] };
      setPages(data.pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ids = new Set(pages.map(p => p.id));
  const roots = pages.filter(p => p.parentId === null || !ids.has(p.parentId));
  const childrenOf = (id: number) => pages.filter(p => p.parentId === id);

  return (
    <Shell>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-400 mb-3 font-bold">Ecossistema · jardim de páginas</p>
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight mb-4 leading-tight">Um berço de projetos vivos.</h1>
        <p className="text-base sm:text-lg text-white/65 max-w-2xl leading-relaxed">
          Páginas que a Árvore e o Yuri vão cultivando e conectando umas nas outras. Aqui aparece só o
          que foi tornado público.
        </p>

        <div className="mt-10">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-300">
              <p className="font-medium">Não consegui carregar o ecossistema.</p>
              <button onClick={() => void load()} className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium">
                Tentar de novo
              </button>
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-white/40">
              <Network className="h-12 w-12 mb-3 opacity-30" />
              <p className="font-medium">Nenhuma página pública ainda.</p>
              <p className="text-sm mt-1">Volte em breve — o jardim está brotando.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {roots.map(root => {
                const kids = childrenOf(root.id);
                return (
                  <div key={root.id} className="rounded-2xl border border-white/10 bg-white/[0.03] hover:border-emerald-400/30 transition-all p-5">
                    <Link href={`/eco/${root.slug}`} className="flex items-center gap-2 text-lg font-bold text-white hover:text-emerald-300">
                      <Sprout className="h-4 w-4 text-emerald-400 shrink-0" />
                      {root.title}
                    </Link>
                    {kids.length > 0 && (
                      <div className="mt-3 pl-6 flex flex-wrap gap-2">
                        {kids.map(k => (
                          <Link
                            key={k.id}
                            href={`/eco/${k.slug}`}
                            className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-emerald-400/40"
                          >
                            {k.title}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}

export function EcoPagina() {
  const [, params] = useRoute("/eco/:slug");
  const slug = params?.slug;
  const [page, setPage] = useState<PublicPageFull | null>(null);
  const [children, setChildren] = useState<PublicPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const res = await fetch(`${base}/api/eco/publico/${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          if (active) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { page: PublicPageFull; children: PublicPage[] };
        if (active) {
          setPage(data.page);
          setChildren(data.children);
        }
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}/eco/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <Shell>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        ) : notFound || !page ? (
          <div className="text-center py-20 text-white/50">
            <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Essa página não existe ou não é pública.</p>
            <Link href="/eco" className="mt-4 inline-block text-emerald-400 hover:text-emerald-300 underline text-sm">
              Voltar ao ecossistema
            </Link>
          </div>
        ) : (
          <>
            <Link href="/eco" className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white mb-6">
              <ArrowLeft className="h-3.5 w-3.5" /> Ecossistema
            </Link>
            <div className="flex items-start justify-between gap-4 mb-6">
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">{page.title}</h1>
              <button
                onClick={() => void copyLink()}
                title="Copiar link público"
                className="shrink-0 mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-xs text-white/70 hover:text-white hover:border-emerald-400/40"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Link"}
              </button>
            </div>
            {page.content.trim() ? (
              page.kind === "code" ? (
                <CodeSandbox code={page.content} title={page.title} className="w-full min-h-[70vh] rounded-xl border border-white/10 bg-white" />
              ) : (
                <Markdown>{page.content}</Markdown>
              )
            ) : (
              <p className="text-white/40 italic">Esta página ainda não tem conteúdo.</p>
            )}
            {children.length > 0 && (
              <div className="mt-12 border-t border-white/10 pt-6">
                <p className="text-xs uppercase tracking-widest text-emerald-400/80 font-bold mb-3">Páginas ligadas</p>
                <div className="flex flex-wrap gap-2">
                  {children.map(k => (
                    <Link
                      key={k.id}
                      href={`/eco/${k.slug}`}
                      className="text-sm px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/75 hover:text-white hover:border-emerald-400/40"
                    >
                      {k.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Loader2, Plus, Save, Trash2, Sprout, Eye, Pencil,
  Globe, Lock, Users, Sparkles, Link2, Check, ExternalLink, FileText, Code2,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import CodeSandbox from "@/components/CodeSandbox";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

type Visibility = "private" | "clube" | "public";
type EcoKind = "markdown" | "code";

interface EcoPage {
  id: number;
  slug: string;
  title: string;
  content: string;
  kind: EcoKind;
  visibility: Visibility;
  author: "yuri" | "arvore";
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

const VIS_META: Record<Visibility, { label: string; icon: typeof Lock; cls: string }> = {
  private: { label: "Privada", icon: Lock, cls: "text-white/60 border-white/20" },
  clube: { label: "Clube", icon: Users, cls: "text-amber-200 border-amber-400/40" },
  public: { label: "Pública", icon: Globe, cls: "text-emerald-200 border-emerald-400/40" },
};

function depthOf(page: EcoPage, byId: Map<number, EcoPage>): number {
  let d = 0;
  let cur = page;
  const seen = new Set<number>();
  while (cur.parentId !== null && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
    d += 1;
    if (d > 20) break;
  }
  return d;
}

export default function EcossistemaPage() {
  const [pages, setPages] = useState<EcoPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<EcoKind>("markdown");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [parentId, setParentId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [escrevendo, setEscrevendo] = useState(false);
  const [instrucao, setInstrucao] = useState("");
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const byId = useMemo(() => new Map(pages.map(p => [p.id, p])), [pages]);
  const selected = pages.find(p => p.slug === selectedSlug) ?? null;

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/eco/pages`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { pages: EcoPage[] };
      setPages(data.pages);
    } catch {
      setMsg("Não consegui carregar as páginas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const selectPage = useCallback((p: EcoPage) => {
    setSelectedSlug(p.slug);
    setTitle(p.title);
    setContent(p.content);
    setKind(p.kind ?? "markdown");
    setVisibility(p.visibility);
    setParentId(p.parentId);
    setDirty(false);
    setPreview(false);
    setInstrucao("");
    setMsg(null);
  }, []);

  const novaPagina = async () => {
    try {
      const res = await fetch(`${base}/api/eco/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: "Nova página", content: "", kind: "markdown", visibility: "private" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { page: EcoPage };
      setPages(prev => [data.page, ...prev]);
      selectPage(data.page);
    } catch {
      setMsg("Não consegui criar a página.");
    }
  };

  const salvar = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/api/eco/pages/${encodeURIComponent(selected.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, content, kind, visibility, parentId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { page: EcoPage };
      setPages(prev => prev.map(p => (p.id === data.page.id ? data.page : p)));
      setSelectedSlug(data.page.slug);
      setDirty(false);
      setMsg("Salvo.");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const remover = async () => {
    if (!selected) return;
    if (!confirm(`Apagar "${selected.title}"? As páginas-filhas sobem um nível.`)) return;
    try {
      const res = await fetch(`${base}/api/eco/pages/${encodeURIComponent(selected.slug)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      setSelectedSlug(null);
      await loadPages();
    } catch {
      setMsg("Falha ao apagar.");
    }
  };

  const pedirArvore = async () => {
    if (!selected) return;
    setEscrevendo(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/api/eco/pages/${encodeURIComponent(selected.slug)}/escrever`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instrucao, kind }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || String(res.status));
      }
      const data = (await res.json()) as { text: string };
      setContent(data.text);
      setDirty(true);
      setPreview(true);
      setMsg("A Árvore escreveu. Revise e salve se gostar.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "A Árvore não conseguiu escrever agora.");
    } finally {
      setEscrevendo(false);
    }
  };

  const copyLink = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}/eco/${selected.slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const ordered = useMemo(() => {
    // Ordena alfabético dentro da árvore para a sidebar (raízes, depois filhas).
    const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    const ids = new Set(sorted.map(p => p.id));
    const out: EcoPage[] = [];
    const visit = (parent: number | null) => {
      for (const p of sorted) {
        const effParent = p.parentId !== null && ids.has(p.parentId) ? p.parentId : null;
        if (effParent === parent) {
          out.push(p);
          visit(p.id);
        }
      }
    };
    visit(null);
    return out;
  }, [pages]);

  const parentOptions = pages.filter(p => p.id !== selected?.id);

  return (
    <div className="min-h-screen text-white" style={{ background: "hsl(150 22% 8%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-cyan-400 via-teal-300 to-lime-400 z-50" />
      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-2 text-white/70 hover:text-white min-w-0">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <Sprout className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-xs sm:text-sm font-bold uppercase tracking-widest truncate">Ecossistema</span>
          </Link>
          <a
            href={`${base}/eco`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white/80 border border-white/15 hover:bg-white/10"
          >
            Ver público <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid lg:grid-cols-[300px_1fr] gap-6">
        {/* Sidebar / diretório */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <button
            onClick={() => void novaPagina()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/30 transition-colors"
          >
            <Plus className="h-4 w-4" /> Nova página
          </button>
          <div className="mt-4 space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : ordered.length === 0 ? (
              <p className="text-sm text-white/40 px-2 py-6 text-center">Nenhuma página ainda. Crie a primeira.</p>
            ) : (
              ordered.map(p => {
                const d = depthOf(p, byId);
                const Vis = VIS_META[p.visibility].icon;
                const active = p.slug === selectedSlug;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectPage(p)}
                    style={{ paddingLeft: `${8 + d * 16}px` }}
                    className={`w-full text-left pr-2 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                      active ? "bg-emerald-500/15 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Vis className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate flex-1">{p.title}</span>
                    {p.author === "arvore" && <Sparkles className="h-3 w-3 text-cyan-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Editor / output */}
        <main className="min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-32 text-white/40 text-center">
              <Sprout className="h-14 w-14 mb-4 opacity-30 text-emerald-400" />
              <p className="text-lg font-medium">Berço de projetos</p>
              <p className="text-sm mt-1 max-w-md">
                Escolha uma página à esquerda ou crie uma nova. Cada página pode ligar nas outras e ter
                sua própria visibilidade. A Árvore pode escrever junto com você.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <input
                value={title}
                onChange={e => { setTitle(e.target.value); setDirty(true); }}
                placeholder="Título da página"
                maxLength={200}
                className="w-full bg-transparent text-2xl sm:text-3xl font-black tracking-tight outline-none border-b border-white/10 focus:border-emerald-400/50 pb-2 transition-colors"
              />

              <div className="flex flex-wrap items-center gap-3">
                {/* Tipo: texto (markdown) ou sistema (HTML/CSS/JS em caixa isolada) */}
                <div className="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-1">
                  <button
                    onClick={() => { setKind("markdown"); setDirty(true); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      kind === "markdown" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" /> Texto
                  </button>
                  <button
                    onClick={() => { setKind("code"); setDirty(true); setPreview(false); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      kind === "code" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    <Code2 className="h-3.5 w-3.5" /> Sistema
                  </button>
                </div>

                {/* Visibilidade */}
                <div className="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-1">
                  {(Object.keys(VIS_META) as Visibility[]).map(v => {
                    const M = VIS_META[v];
                    const Icon = M.icon;
                    const on = visibility === v;
                    return (
                      <button
                        key={v}
                        onClick={() => { setVisibility(v); setDirty(true); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          on ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {M.label}
                      </button>
                    );
                  })}
                </div>

                {/* Página-mãe */}
                <select
                  value={parentId ?? ""}
                  onChange={e => { setParentId(e.target.value ? Number(e.target.value) : null); setDirty(true); }}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/80 outline-none focus:border-emerald-400/40 max-w-[200px]"
                >
                  <option value="" className="bg-zinc-900">Sem página-mãe</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id} className="bg-zinc-900">↳ dentro de: {p.title}</option>
                  ))}
                </select>

                {visibility === "public" && (
                  <button
                    onClick={() => void copyLink()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
                    {copied ? "Copiado" : "Copiar link"}
                  </button>
                )}
              </div>

              {/* Pedir à Árvore */}
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-3 flex flex-col sm:flex-row gap-2">
                <input
                  value={instrucao}
                  onChange={e => setInstrucao(e.target.value)}
                  placeholder="Peça à Árvore (ex: 'escreva uma introdução sobre este projeto')"
                  maxLength={2000}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-white/30"
                />
                <button
                  onClick={() => void pedirArvore()}
                  disabled={escrevendo}
                  className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
                >
                  {escrevendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {escrevendo ? "Escrevendo..." : "Pedir à Árvore"}
                </button>
              </div>

              {/* Editor / preview */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setPreview(p => !p)}
                  className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white"
                >
                  {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {preview ? "Editar" : kind === "code" ? "Rodar" : "Pré-visualizar"}
                </button>
                <span className="text-[11px] text-white/30">
                  {content.length} caracteres · {kind === "code" ? "HTML / CSS / JS" : "Markdown"}
                </span>
              </div>

              {preview ? (
                kind === "code" ? (
                  content.trim() ? (
                    <CodeSandbox code={content} title={title} className="w-full min-h-[420px] rounded-xl border border-white/10 bg-white" />
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5 min-h-[300px]">
                      <p className="text-white/30 italic">Sem código ainda.</p>
                    </div>
                  )
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-5 min-h-[300px]">
                    {content.trim() ? <Markdown>{content}</Markdown> : <p className="text-white/30 italic">Sem conteúdo ainda.</p>}
                  </div>
                )
              ) : (
                <textarea
                  value={content}
                  onChange={e => { setContent(e.target.value); setDirty(true); }}
                  placeholder={
                    kind === "code"
                      ? "Cole ou escreva um documento HTML completo (HTML, CSS e JS na mesma página). Roda numa caixa isolada e segura."
                      : "Escreva em Markdown. Use links como [outra página](/eco/slug) para conectar."
                  }
                  maxLength={60000}
                  className="w-full min-h-[340px] rounded-xl bg-black/20 border border-white/10 focus:border-emerald-400/40 outline-none p-4 text-sm font-mono leading-relaxed resize-y"
                />
              )}

              {/* Ações */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  onClick={() => void remover()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-red-300/80 hover:text-red-200 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Apagar
                </button>
                <div className="flex items-center gap-3">
                  {msg && <span className="text-xs text-white/60">{msg}</span>}
                  <button
                    onClick={() => void salvar()}
                    disabled={saving || !dirty}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm bg-emerald-500/25 border border-emerald-400/50 text-emerald-50 hover:bg-emerald-500/35 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {dirty ? "Salvar" : "Salvo"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

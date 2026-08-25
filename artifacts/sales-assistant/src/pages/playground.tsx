import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Loader2, Plus, Save, Trash2, FlaskConical, Pencil, Eye,
  Sparkles, Code2, StickyNote, Pin, PinOff, Copy, Check,
} from "lucide-react";
import Markdown from "@/components/Markdown";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

type Kind = "note" | "code";

interface PlaygroundEntry {
  id: number;
  kind: Kind;
  title: string;
  language: string;
  content: string;
  author: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function PlaygroundPage() {
  const [entries, setEntries] = useState<PlaygroundEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [kind, setKind] = useState<Kind>("note");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = useMemo(
    () => entries.find(e => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/playground`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { entries: PlaygroundEntry[] };
      setEntries(data.entries);
    } catch {
      setMsg("Não consegui carregar o Playground.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const selectEntry = useCallback((e: PlaygroundEntry) => {
    // Normaliza defaults: se a resposta vier parcial, não quebra o editor.
    setSelectedId(e.id);
    setKind(e.kind === "code" ? "code" : "note");
    setTitle(e.title ?? "");
    setLanguage(e.language ?? "");
    setContent(e.content ?? "");
    setDirty(false);
    setPreview(false);
    setMsg(null);
  }, []);

  const novaEntrada = async (k: Kind) => {
    try {
      const res = await fetch(`${base}/api/playground`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: k,
          title: k === "code" ? "Novo trecho" : "Nova nota",
          content: "",
          language: "",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { entry: PlaygroundEntry };
      setEntries(prev => [data.entry, ...prev]);
      selectEntry(data.entry);
    } catch {
      setMsg("Não consegui criar.");
    }
  };

  const salvar = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/api/playground/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind, title, language, content }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { entry: PlaygroundEntry };
      setEntries(prev => prev.map(e => (e.id === data.entry.id ? data.entry : e)));
      setDirty(false);
      setMsg("Salvo.");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const togglePin = async (e: PlaygroundEntry) => {
    try {
      const res = await fetch(`${base}/api/playground/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pinned: !e.pinned }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { entry: PlaygroundEntry };
      setEntries(prev =>
        [...prev.map(x => (x.id === data.entry.id ? data.entry : x))].sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
      );
    } catch {
      setMsg("Falha ao fixar.");
    }
  };

  const remover = async () => {
    if (!selected) return;
    if (!confirm(`Apagar "${selected.title || "sem título"}"?`)) return;
    try {
      const res = await fetch(`${base}/api/playground/${selected.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      setSelectedId(null);
      await loadEntries();
    } catch {
      setMsg("Falha ao apagar.");
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ background: "hsl(150 22% 8%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-cyan-400 via-teal-300 to-lime-400 z-50" />
      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-2 text-white/70 hover:text-white min-w-0">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <FlaskConical className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="text-xs sm:text-sm font-bold uppercase tracking-widest truncate">Playground</span>
          </Link>
          <span className="shrink-0 text-[11px] text-white/40">Privado · só você</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid lg:grid-cols-[300px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void novaEntrada("note")}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-xs bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/30 transition-colors"
            >
              <StickyNote className="h-3.5 w-3.5" /> Nota
            </button>
            <button
              onClick={() => void novaEntrada("code")}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-xs bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors"
            >
              <Code2 className="h-3.5 w-3.5" /> Código
            </button>
          </div>
          <div className="mt-4 space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-white/40 px-2 py-6 text-center">
                Vazio ainda. Crie uma nota ou peça pra Árvore guardar algo aqui.
              </p>
            ) : (
              entries.map(e => {
                const Icon = e.kind === "code" ? Code2 : StickyNote;
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    onClick={() => selectEntry(e)}
                    className={`w-full text-left px-2 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                      active ? "bg-cyan-500/15 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {e.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-300" />}
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate flex-1">{e.title || "(sem título)"}</span>
                    {e.author.startsWith("via-") && (
                      <span className="text-[10px] uppercase tracking-wide text-cyan-300/70 shrink-0">
                        {e.author.slice(4)}
                      </span>
                    )}
                    {e.author !== "yuri" && <Sparkles className="h-3 w-3 text-cyan-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Editor */}
        <main className="min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-32 text-white/40 text-center">
              <FlaskConical className="h-14 w-14 mb-4 opacity-30 text-cyan-400" />
              <p className="text-lg font-medium">O canto da Árvore</p>
              <p className="text-sm mt-1 max-w-md">
                Um espaço só seu pra anotar ideias e guardar trechos de código. A Árvore também pode
                registrar coisas aqui direto da conversa no Oráculo. É privado — ninguém mais vê.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <input
                value={title}
                onChange={e => { setTitle(e.target.value); setDirty(true); }}
                placeholder="Título"
                maxLength={200}
                className="w-full bg-transparent text-2xl sm:text-3xl font-black tracking-tight outline-none border-b border-white/10 focus:border-cyan-400/50 pb-2 transition-colors"
              />

              <div className="flex flex-wrap items-center gap-3">
                {/* Tipo */}
                <div className="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-1">
                  {(["note", "code"] as Kind[]).map(k => {
                    const Icon = k === "code" ? Code2 : StickyNote;
                    const on = kind === k;
                    return (
                      <button
                        key={k}
                        onClick={() => { setKind(k); setDirty(true); if (k === "note") setPreview(false); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          on ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {k === "code" ? "Código" : "Nota"}
                      </button>
                    );
                  })}
                </div>

                {kind === "code" && (
                  <input
                    value={language}
                    onChange={e => { setLanguage(e.target.value); setDirty(true); }}
                    placeholder="linguagem (ex: ts)"
                    maxLength={40}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/80 outline-none focus:border-cyan-400/40 w-[160px]"
                  />
                )}

                <button
                  onClick={() => void togglePin(selected)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white"
                >
                  {selected.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  {selected.pinned ? "Desafixar" : "Fixar"}
                </button>

                <button
                  onClick={() => void copiar()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>

              {/* Editor / preview (preview só pra nota Markdown) */}
              <div className="flex items-center justify-between">
                {kind === "note" ? (
                  <button
                    onClick={() => setPreview(p => !p)}
                    className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white"
                  >
                    {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {preview ? "Editar" : "Pré-visualizar"}
                  </button>
                ) : <span />}
                <span className="text-[11px] text-white/30">
                  {content.length} caracteres · {kind === "code" ? "código" : "Markdown"}
                </span>
              </div>

              {kind === "note" && preview ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-5 min-h-[300px]">
                  {content.trim() ? <Markdown>{content}</Markdown> : <p className="text-white/30 italic">Sem conteúdo ainda.</p>}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={e => { setContent(e.target.value); setDirty(true); }}
                  placeholder={kind === "code" ? "Cole ou escreva o código aqui." : "Escreva em Markdown."}
                  maxLength={100000}
                  className="w-full min-h-[340px] rounded-xl bg-black/20 border border-white/10 focus:border-cyan-400/40 outline-none p-4 text-sm font-mono leading-relaxed resize-y"
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
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm bg-cyan-500/25 border border-cyan-400/50 text-cyan-50 hover:bg-cyan-500/35 disabled:opacity-40 disabled:cursor-not-allowed"
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

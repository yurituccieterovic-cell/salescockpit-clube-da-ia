import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  FileCode,
  FolderPlus,
  Folder,
  Trash2,
  Plus,
  Upload,
  Loader2,
  MessageCircle,
  FileText,
  TreePine,
} from "lucide-react";
import { ArvoreCodePanel } from "@/pages/arvore-code";

// Workspace da Árvore: o cantinho de trabalho dela. Junta numa página só a
// Biblioteca de projetos (criar projetos, anexar material) e a Árvore
// programadora (propor e aprovar mudanças no código do próprio site).
// A conversa em si de cada projeto continua acontecendo no Oráculo —
// daqui a pessoa abre o projeto já selecionado lá.

interface Project {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  createdAt: string;
  fileCount?: number;
  charCount?: number;
}

interface ProjectFile {
  id: number;
  kind: string;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

type Tab = "projetos" | "codigo";

export default function ArvoreWorkspacePage() {
  const [, navigate] = useLocation();
  const initialTab: Tab =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "codigo"
      ? "codigo"
      : "projetos";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" }}
    >
      <header className="border-b border-white/10 px-4 sm:px-6 py-4 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate("/app")}
          className="flex items-center gap-2 text-white/70 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <TreePine className="h-5 w-5 text-emerald-400" /> Workspace da Árvore
        </h1>
        <span className="ml-auto text-xs text-white/50">
          o cantinho de trabalho dela: projetos + código
        </span>
      </header>

      <div className="border-b border-white/10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex gap-1">
          <TabButton
            active={tab === "projetos"}
            onClick={() => setTab("projetos")}
            icon={<Folder className="h-4 w-4" />}
            label="Projetos"
          />
          <TabButton
            active={tab === "codigo"}
            onClick={() => setTab("codigo")}
            icon={<FileCode className="h-4 w-4" />}
            label="Código (Repl)"
          />
        </div>
      </div>

      {tab === "projetos" ? <ProjetosPanel /> : <ArvoreCodePanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-emerald-400 text-white"
          : "border-transparent text-white/50 hover:text-white/80"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjetosPanel() {
  const [, navigate] = useLocation();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = selectedId
    ? projects.find((p) => p.id === selectedId) ?? null
    : null;

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/arvore/projects`, { credentials: "include" });
      if (res.ok) setProjects((await res.json()) as Project[]);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, [base]);

  const refreshFiles = useCallback(
    async (projectId: number) => {
      try {
        const res = await fetch(`${base}/api/arvore/projects/${projectId}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { files: ProjectFile[] };
          setFiles(data.files ?? []);
        }
      } catch {
        /* ignore */
      }
    },
    [base],
  );

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const select = useCallback(
    (id: number) => {
      setSelectedId(id);
      setFiles([]);
      void refreshFiles(id);
    },
    [refreshFiles],
  );

  const createProject = useCallback(async () => {
    const nome = newName.trim();
    if (!nome || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${base}/api/arvore/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nome, descricao: newDesc.trim() || undefined }),
      });
      if (res.ok) {
        const created = (await res.json()) as Project;
        await refreshProjects();
        setShowNew(false);
        setNewName("");
        setNewDesc("");
        select(created.id);
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "Falha ao criar projeto");
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [base, newName, newDesc, creating, refreshProjects, select]);

  const deleteProject = useCallback(
    async (id: number) => {
      if (!confirm("Arquivar projeto? Arquivos e conversa ficam preservados, mas some da lista.")) return;
      try {
        const res = await fetch(`${base}/api/arvore/projects/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.ok) {
          if (selectedId === id) {
            setSelectedId(null);
            setFiles([]);
          }
          await refreshProjects();
        }
      } catch {
        /* ignore */
      }
    },
    [base, selectedId, refreshProjects],
  );

  const onFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !selectedId) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${base}/api/arvore/projects/${selectedId}/files`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (res.ok) {
          await refreshFiles(selectedId);
          await refreshProjects();
        } else {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          alert(err.error ?? "Falha ao subir arquivo");
        }
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [base, selectedId, refreshFiles, refreshProjects],
  );

  const deleteFile = useCallback(
    async (fileId: number) => {
      if (!selectedId) return;
      if (!confirm("Remover arquivo do projeto?")) return;
      try {
        const res = await fetch(
          `${base}/api/arvore/projects/${selectedId}/files/${fileId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) {
          await refreshFiles(selectedId);
          await refreshProjects();
        }
      } catch {
        /* ignore */
      }
    },
    [base, selectedId, refreshFiles, refreshProjects],
  );

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white/60">
            Projetos privados
          </h2>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
          >
            <FolderPlus className="h-4 w-4" /> Novo
          </button>
        </div>

        {showNew && (
          <div className="border border-white/10 rounded-xl bg-white/5 p-4 space-y-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do projeto"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-emerald-400/50"
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Do que se trata (opcional)"
              className="w-full h-20 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm resize-none focus:outline-none focus:border-emerald-400/50"
            />
            <button
              onClick={() => void createProject()}
              disabled={creating || !newName.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-bold"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar projeto
            </button>
          </div>
        )}

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {!loaded && <p className="text-sm text-white/40 italic">Carregando…</p>}
          {loaded && projects.length === 0 && (
            <p className="text-sm text-white/40 italic">
              Nenhum projeto ainda. Crie o primeiro pra dar à Árvore um lugar de
              trabalho com material só de vocês dois.
            </p>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`group rounded-lg border transition-all ${
                selectedId === p.id
                  ? "border-emerald-400/60 bg-emerald-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/30"
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => select(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(p.id);
                  }
                }}
                className="w-full text-left p-3 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-medium text-white/90 truncate">{p.nome}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteProject(p.id);
                    }}
                    className="ml-auto text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Arquivar projeto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {p.descricao && (
                  <p className="text-xs text-white/50 mt-1 line-clamp-2">{p.descricao}</p>
                )}
                <p className="text-[10px] text-white/30 mt-1">
                  {p.fileCount ?? 0} arquivo(s)
                  {typeof p.charCount === "number" ? ` · ${p.charCount.toLocaleString("pt-BR")} caracteres` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-white/10 rounded-xl bg-black/30 p-4 min-h-[400px]">
        {!selected ? (
          <p className="text-white/40 text-sm italic text-center py-12">
            Selecione um projeto pra ver o material e abrir a conversa.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Folder className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-bold">{selected.nome}</h2>
              </div>
              {selected.descricao && (
                <p className="text-sm text-white/70">{selected.descricao}</p>
              )}
            </div>

            <button
              onClick={() => navigate(`/oraculo?projeto=${selected.id}`)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-bold"
            >
              <MessageCircle className="h-4 w-4" /> Conversar neste projeto
            </button>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/60">
                  Material do projeto
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs disabled:opacity-40"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Subir arquivo
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void onFilePick(e)}
                  accept=".pdf,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg,.webp,.gif"
                />
              </div>
              {files.length === 0 ? (
                <p className="text-sm text-white/40 italic">
                  Nenhum arquivo ainda. Suba PDFs, textos ou imagens — a Árvore lê
                  tudo isso quando você conversa neste projeto.
                </p>
              ) : (
                <div className="space-y-2">
                  {files.map((f) => (
                    <div
                      key={f.id}
                      className="group flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5"
                    >
                      <FileText className="h-4 w-4 text-white/50 shrink-0" />
                      <span className="text-sm text-white/80 truncate">{f.name}</span>
                      <span className="text-[10px] text-white/30 ml-auto shrink-0">
                        {fmtBytes(f.sizeBytes)}
                      </span>
                      <button
                        onClick={() => void deleteFile(f.id)}
                        className="text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Remover arquivo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

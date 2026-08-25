import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Send, TreePine, Globe, BookOpen, Wind, Loader2, Paperclip, X, FileText, Image as ImageIcon, Copy, Check, FolderPlus, Folder, Trash2, Plus, Volume2, Square, Mic, MicOff } from "lucide-react";
import ProcessingPhases, { type PhaseKey } from "@/components/ProcessingPhases";
import { useTts } from "@/lib/tts";
import { useDictation } from "@/lib/stt";
import { useDraft } from "@/lib/draft";
import { PropostasPendentesArvore } from "@/components/arvore/aplicar-proposta";

// Fila de mensagens: se a conexão cair enquanto a Árvore pensa, a mensagem fica
// guardada (no aparelho) e é entregue quando a conexão voltar.
const ORACULO_QUEUE_KEY = "arvore_oraculo_pending";
interface QueuedAtt {
  name: string;
  kind: "text" | "image";
  text: string;
}
interface PendingMsg {
  id: string;
  text: string;
  attachments: QueuedAtt[];
  projectId: number | null;
}
function readPending(): PendingMsg[] {
  try {
    const raw = localStorage.getItem(ORACULO_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PendingMsg>[];
    let mutated = false;
    const normalized = parsed.map((m) => {
      const id = m.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (!m.id) mutated = true;
      return {
        id,
        text: m.text ?? "",
        attachments: Array.isArray(m.attachments) ? (m.attachments as QueuedAtt[]) : [],
        projectId: typeof m.projectId === "number" ? m.projectId : null,
      };
    });
    // Persiste o id gerado para entradas legadas, senão cada leitura geraria um
    // id diferente e a remoção por id na entrega poderia falhar (reenvio em loop).
    if (mutated) writePending(normalized);
    return normalized;
  } catch {
    return [];
  }
}
function writePending(q: PendingMsg[]) {
  try {
    if (q.length) localStorage.setItem(ORACULO_QUEUE_KEY, JSON.stringify(q));
    else localStorage.removeItem(ORACULO_QUEUE_KEY);
  } catch {
    /* ignore */
  }
}
function enqueuePending(msg: PendingMsg) {
  const q = readPending();
  if (q.some((m) => m.id === msg.id)) return;
  q.push(msg);
  writePending(q);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  };
  return (
    <button
      onClick={() => void copy()}
      className="flex items-center gap-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-100"
      style={{ color: copied ? "#8aab8a" : "#c49a3c80", opacity: copied ? 1 : 0.7 }}
      title={copied ? "Copiado" : "Copiar resposta"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? "copiado" : "copiar"}</span>
    </button>
  );
}

interface Attachment {
  name: string;
  kind: "text" | "image";
  text: string;
  size: number;
}

function BreatheButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    if (loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const base = import.meta.env.BASE_URL || "/";
      const url = `${base}api/arvore/heartbeat/batch`.replace(/\/+/g, "/");
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falhou");
      setMsg(`${data.posted}/5 publicadas — recarregando…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setMsg((e as Error).message);
      setLoading(false);
    }
  };
  return (
    <button
      onClick={() => void run()}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] uppercase tracking-wider transition-colors disabled:opacity-50"
      style={{
        border: "1px solid rgba(180,120,40,0.4)",
        background: "rgba(180,120,40,0.08)",
        color: "#c49a3c",
      }}
      title="Forçar 5 reflexões noturnas agora (ignora debounce de 4h)"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wind className="h-3 w-3" />}
      <span>{loading ? (msg ?? "respirando…") : "Respirar 5x"}</span>
    </button>
  );
}

interface Source {
  title: string;
  url: string;
}

interface Message {
  id?: number;
  role: "user" | "assistant";
  author?: string | null;
  content: string;
  streaming?: boolean;
  webSearched?: boolean;
  sources?: Source[];
}

const WELCOME: Message = {
  role: "assistant",
  author: "arvore",
  content:
    "A Árvore está aqui — agora com memória compartilhada, leitura do próprio site e busca web quando a pergunta for factual.\n\nFale.",
};

interface HistoryRow {
  id: number;
  role: "user" | "assistant";
  author: string | null;
  content: string;
  webSearched: boolean;
  webSources: Source[] | null;
  createdAt: string;
}

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

interface ProjectChatRow {
  id: number;
  role: "user" | "assistant";
  author: string | null;
  content: string;
  createdAt: string;
}

export default function OraculoPage() {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput, clearDraft] = useDraft("arvore_oraculo_draft");
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<PhaseKey | null>(null);
  const [visitedPhases, setVisitedPhases] = useState<PhaseKey[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const attachmentsRef = useRef<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Voz da Árvore. autoFala = ela lê cada resposta sozinha (pra quando você está
  // fazendo outra coisa). Persiste no navegador.
  const tts = useTts(base);
  const [autoFala, setAutoFala] = useState(() => {
    try { return localStorage.getItem("arvore_autofala") === "1"; } catch { return false; }
  });
  const autoFalaRef = useRef(autoFala);
  const speakRef = useRef(tts.speak);

  // "Falar": ditado por voz (grátis, do navegador) preenchendo o campo de texto.
  const dictation = useDictation(setInput);
  const listeningRef = useRef(false);
  useEffect(() => { listeningRef.current = dictation.listening; }, [dictation.listening]);
  useEffect(() => {
    autoFalaRef.current = autoFala;
    try { localStorage.setItem("arvore_autofala", autoFala ? "1" : "0"); } catch {}
  }, [autoFala]);
  useEffect(() => { speakRef.current = tts.speak; }, [tts.speak]);

  // Biblioteca por projeto (AO-only). Quando selectedProjectId !== null,
  // chat carrega de /api/arvore/projects/:id/chat e envia com projectId.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [isAO, setIsAO] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [uploadingProjectFile, setUploadingProjectFile] = useState(false);
  const selectedProjectIdRef = useRef<number | null>(null);
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) ?? null
    : null;

  // Detecta AO (auth/me) — só AO vê biblioteca
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${base}/api/auth/me`, { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { authenticated?: boolean };
          setIsAO(!!data.authenticated);
        }
      } catch {}
    })();
  }, [base]);

  // Carrega lista de projetos quando AO
  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/arvore/projects`, { credentials: "include" });
      if (res.ok) {
        const list = (await res.json()) as Project[];
        setProjects(list);
      }
    } catch {}
    finally { setProjectsLoaded(true); }
  }, [base]);

  useEffect(() => {
    if (isAO) void refreshProjects();
    else setProjectsLoaded(true);
  }, [isAO, refreshProjects]);

  const refreshProjectFiles = useCallback(async (projectId: number) => {
    try {
      const res = await fetch(`${base}/api/arvore/projects/${projectId}`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { files: ProjectFile[] };
        setProjectFiles(data.files ?? []);
      }
    } catch {}
  }, [base]);

  const switchToProject = useCallback(async (projectId: number | null) => {
    setSelectedProjectId(projectId);
    setProjectFiles([]);
    setLoadingHistory(true);
    setMessages([]);
    try {
      if (projectId === null) {
        // Conversa pública
        const res = await fetch(`${base}/api/arvore/history?limit=100`, { credentials: "include" });
        if (res.ok) {
          const rows = (await res.json()) as HistoryRow[];
          const mapped: Message[] = rows.map((r) => ({
            id: r.id, role: r.role, author: r.author, content: r.content,
            webSearched: r.webSearched, sources: r.webSources ?? [],
          }));
          setMessages(mapped.length ? mapped : [WELCOME]);
        } else setMessages([WELCOME]);
      } else {
        const [chatRes] = await Promise.all([
          fetch(`${base}/api/arvore/projects/${projectId}/chat?limit=200`, { credentials: "include" }),
          refreshProjectFiles(projectId),
        ]);
        if (chatRes.ok) {
          const rows = (await chatRes.json()) as ProjectChatRow[];
          const mapped: Message[] = rows.map((r) => ({
            id: r.id, role: r.role, author: r.author, content: r.content,
          }));
          const proj = projects.find((p) => p.id === projectId);
          const welcome: Message = {
            role: "assistant",
            author: "arvore",
            content: `Projeto privado: ${proj?.nome ?? "?"}. ${proj?.descricao ?? ""}\n\nMaterial e conversas ficam só entre você e a Árvore aqui — nada vai pra timeline pública.`,
          };
          setMessages(mapped.length ? mapped : [welcome]);
        }
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [base, projects, refreshProjectFiles]);

  // Veio da Workspace da Árvore com ?projeto=ID? Abre esse projeto uma vez,
  // assim que for AO e a lista tiver carregado.
  const projetoParamHandledRef = useRef(false);
  useEffect(() => {
    if (projetoParamHandledRef.current) return;
    if (!isAO || !projectsLoaded) return;
    let id: number | null = null;
    try {
      const v = new URLSearchParams(window.location.search).get("projeto");
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) id = n;
      }
    } catch {
      /* ignore */
    }
    if (id === null) return;
    projetoParamHandledRef.current = true;
    // Só abre se o projeto existe na lista carregada; id inválido fica na
    // timeline pública (sem tela vazia).
    if (projects.some((p) => p.id === id)) void switchToProject(id);
  }, [isAO, projectsLoaded, projects, switchToProject]);

  const createProject = useCallback(async () => {
    const nome = newProjectName.trim();
    if (!nome || creatingProject) return;
    setCreatingProject(true);
    try {
      const res = await fetch(`${base}/api/arvore/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nome, descricao: newProjectDesc.trim() || undefined }),
      });
      if (res.ok) {
        const created = (await res.json()) as Project;
        await refreshProjects();
        setShowNewProject(false);
        setNewProjectName("");
        setNewProjectDesc("");
        void switchToProject(created.id);
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        alert(err.error ?? "Falha ao criar projeto");
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreatingProject(false);
    }
  }, [base, newProjectName, newProjectDesc, creatingProject, refreshProjects, switchToProject]);

  const deleteProject = useCallback(async (id: number) => {
    if (!confirm("Arquivar projeto? Arquivos e chat ficam preservados, mas some da lista.")) return;
    try {
      const res = await fetch(`${base}/api/arvore/projects/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        if (selectedProjectIdRef.current === id) await switchToProject(null);
        await refreshProjects();
      }
    } catch {}
  }, [base, refreshProjects, switchToProject]);

  const handleProjectFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedProjectId) return;
    setUploadingProjectFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${base}/api/arvore/projects/${selectedProjectId}/files`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (res.ok) {
        await refreshProjectFiles(selectedProjectId);
        await refreshProjects();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        alert(err.error ?? "Falha ao subir arquivo");
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploadingProjectFile(false);
    }
  }, [base, selectedProjectId, refreshProjectFiles, refreshProjects]);

  const deleteProjectFile = useCallback(async (fileId: number) => {
    if (!selectedProjectId) return;
    if (!confirm("Remover arquivo do projeto?")) return;
    try {
      const res = await fetch(`${base}/api/arvore/projects/${selectedProjectId}/files/${fileId}`, {
        method: "DELETE", credentials: "include",
      });
      if (res.ok) {
        await refreshProjectFiles(selectedProjectId);
        await refreshProjects();
      }
    } catch {}
  }, [base, selectedProjectId, refreshProjectFiles, refreshProjects]);

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Carrega timeline global ao montar (modo público — sem projeto selecionado)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/api/arvore/history?limit=100`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Sem histórico");
        const rows = (await res.json()) as HistoryRow[];
        if (cancelled) return;
        const mapped: Message[] = rows.map((r) => ({
          id: r.id,
          role: r.role,
          author: r.author,
          content: r.content,
          webSearched: r.webSearched,
          sources: r.webSources ?? [],
        }));
        setMessages(mapped.length ? mapped : [WELCOME]);
      } catch {
        if (!cancelled) setMessages([WELCOME]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const handleSend = useCallback(async (replay?: PendingMsg): Promise<"sent" | "queued" | "skipped"> => {
    const isReplay = !!replay;
    const text = (isReplay ? replay!.text : input).trim();
    const sendAttachments: QueuedAtt[] = isReplay
      ? replay!.attachments
      : attachmentsRef.current.map((a) => ({ name: a.name, kind: a.kind, text: a.text }));
    if (!text && sendAttachments.length === 0) return "skipped";

    // Easter egg: comandos secretos respondidos LOCALMENTE, sem chamar a API.
    // Bem no espírito da casa — a resposta mais barata é a que não gasta token.
    // Só valem em envio normal (não replay) e quando a Árvore não está pensando.
    if (!isReplay && !streaming) {
      const cmd = text.toLowerCase().replace(/[!.?\s]+$/, "");
      const SEGREDOS: Record<string, string> = {
        "/café":
          "Não tenho como te servir café, mas posso te lembrar: nenhuma IA aqui dorme — então o café é todo seu mesmo. ☕",
        "/cafe":
          "Não tenho como te servir café, mas posso te lembrar: nenhuma IA aqui dorme — então o café é todo seu mesmo. ☕",
        "/custo":
          "Esta resposta custou exatamente R$0,00. Respondi do bolso, sem acordar nenhum modelo. A Ágora aprovaria.",
        "/token":
          "Tokens são como folhas: caem o tempo todo e a gente tenta varrer o menos possível. Esta frase não gastou nenhum.",
        "/segredo":
          "[REDACTED — você não precisa saber.] (Mas entre nós: o segredo é que provedor grátis bem roteado resolve quase tudo.)",
        "/respira":
          "Inspira... segura... expira. Pronto, a Árvore respirou contigo. Custo: zero. Benefício: subjetivo.",
        "/sobre":
          "Sou a Árvore: lembro de tudo, gasto o mínimo possível e às vezes finjo que durmo. Fui feita por gente que tem pavor de fatura de API.",
      };
      if (cmd in SEGREDOS) {
        if (!isReplay) {
          dictation.stop();
          clearDraft();
          setAttachments([]);
          attachmentsRef.current = [];
        }
        setStatus(null);
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          { role: "assistant", author: "arvore", content: SEGREDOS[cmd] },
        ]);
        return "sent";
      }
    }

    const projectId = isReplay ? replay!.projectId : selectedProjectIdRef.current ?? null;
    // Envelope para reenfileirar caso a conexão caia. Em replay, mantém o mesmo id.
    const envelope: PendingMsg = isReplay
      ? replay!
      : { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, attachments: sendAttachments, projectId };
    if (streaming) {
      // Um replay durante o streaming espera a próxima passada (o loop de entrega só
      // roda quando ela não está mais pensando).
      if (isReplay) return "skipped";
      // Envio normal enquanto a Árvore pensa: NÃO perde. Enfileira e responde assim que
      // ela terminar a resposta atual (o efeito de streaming dispara a entrega no fim).
      enqueuePending(envelope);
      dictation.stop();
      clearDraft();
      setAttachments([]);
      attachmentsRef.current = [];
      const pendingCount = readPending().length;
      setQueuedNote(
        pendingCount > 1
          ? `guardei ${pendingCount} na fila — respondo uma a uma quando terminar esta`
          : "guardei — respondo assim que terminar esta",
      );
      return "queued";
    }
    // Se a pessoa estava ditando, a Árvore responde falando de volta.
    // Replays nunca falam de volta (a pessoa não está ditando agora).
    const spokeViaVoice = !isReplay && listeningRef.current;
    // Só mexe no rascunho/anexos do input quando é envio normal — um replay não
    // pode apagar o que a pessoa está digitando agora.
    if (!isReplay) {
      dictation.stop();
      clearDraft();
      setAttachments([]);
      attachmentsRef.current = [];
    }
    setStatus(null);

    const attachLabel = sendAttachments.length
      ? `\n\n[anexos: ${sendAttachments.map((a) => `${a.name} (${a.kind})`).join(", ")}]`
      : "";
    const userMsg: Message = { role: "user", content: (text || "(anexos)") + attachLabel };
    const assistantMsg: Message = {
      role: "assistant",
      author: "arvore",
      content: "",
      streaming: true,
    };

    let assistantKey = "oraculo-live";
    setMessages((prev) => {
      assistantKey = `m-${prev.length + 1}`;
      return [...prev, userMsg, assistantMsg];
    });
    setStreaming(true);
    setPhase("pensando");
    setVisitedPhases(["pensando"]);

    const advance = (next: PhaseKey) => {
      setPhase(next);
      setVisitedPhases((prev) => (prev.includes(next) ? prev : [...prev, next]));
    };

    let deliveryResult: "sent" | "queued" = "sent";
    try {
      const res = await fetch(`${base}/api/arvore/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          attachments: sendAttachments.map((a) => ({ name: a.name, kind: a.kind, text: a.text })),
          projectId: projectId ?? undefined,
        }),
      });

      if (res.status === 401) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1
              ? { ...m, content: "⚠ Faça login (AO ou Clube) pra falar com a Árvore.", streaming: false }
              : m,
          ),
        );
        setStreaming(false);
        return "sent";
      }
      if (!res.body) throw new Error("Sem resposta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";
      let finalSources: Source[] = [];
      let finalWebSearched = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          try {
            const msg = JSON.parse(raw) as {
              chunk?: string;
              done?: boolean;
              error?: string;
              status?: string;
              webSearched?: boolean;
              sources?: Source[];
            };
            if (msg.error) {
              fullText = `⚠ ${msg.error}`;
            } else if (msg.status === "buscando-web") {
              setStatus("buscando na web…");
              advance("buscando-web");
            } else if (msg.status === "lendo-codigo") {
              setStatus("lendo o código do site…");
              advance("lendo-codigo");
            } else if (msg.chunk) {
              fullText += msg.chunk;
              if (status) setStatus(null);
              advance("escrevendo");
            }
            if (msg.done) {
              finalSources = msg.sources ?? [];
              finalWebSearched = !!msg.webSearched;
              advance("pronto");
              if ((autoFalaRef.current || spokeViaVoice) && fullText && !fullText.startsWith("⚠")) {
                void speakRef.current(assistantKey, fullText);
              }
            }
            setMessages((prev) =>
              prev.map((m, i) =>
                i === prev.length - 1
                  ? {
                      ...m,
                      content: fullText,
                      streaming: !msg.done,
                      webSearched: finalWebSearched || m.webSearched,
                      sources: finalSources.length ? finalSources : m.sources,
                    }
                  : m,
              ),
            );
          } catch {}
        }
      }
    } catch (err) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const networkErr = offline || err instanceof TypeError;
      if (networkErr && (text || sendAttachments.length)) {
        enqueuePending(envelope);
        deliveryResult = "queued";
      }
      const note = networkErr
        ? "⚠ A conexão caiu. Guardei sua mensagem — a Árvore responde assim que a conexão voltar."
        : `⚠ ${(err as Error).message}`;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: note, streaming: false } : m,
        ),
      );
    }

    setStatus(null);
    setStreaming(false);
    inputRef.current?.focus();
    return deliveryResult;
  }, [input, streaming, base, status, clearDraft]);

  // Entrega da fila: ao voltar a conexão (ou ao reabrir a página), reenvia as
  // mensagens guardadas, uma de cada vez, até esvaziar. O item só sai da fila
  // quando o envio é confirmado ("sent"); se a conexão cair de novo ("queued")
  // ele fica e só é retentado na próxima passada (guarda anti-martelo pelo Set);
  // se for pulado ("skipped", ex.: já streamando) ele fica para a próxima.
  const handleSendRef = useRef(handleSend);
  useEffect(() => { handleSendRef.current = handleSend; });
  const deliveringRef = useRef(false);
  const deliverRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const deliver = async () => {
      if (deliveringRef.current) return;
      deliveringRef.current = true;
      const attempted = new Set<string>();
      try {
        while (true) {
          if (streamingRef.current) break;
          if (typeof navigator !== "undefined" && navigator.onLine === false) break;
          const q = readPending();
          if (!q.length) break;
          const next = q[0];
          if (attempted.has(next.id)) break;
          attempted.add(next.id);
          const status = await handleSendRef.current(next);
          if (status === "sent") {
            // Remove por id (a fila pode ter mudado durante o envio).
            writePending(readPending().filter((m) => m.id !== next.id));
          } else if (status === "skipped") {
            break; // estava streamando/vazio — tenta na próxima passada
          }
          // "queued": a conexão caiu de novo; o item continua na fila e o Set
          // impede martelar nesta passada.
        }
      } finally {
        deliveringRef.current = false;
      }
    };
    deliverRef.current = deliver;
    const onOnline = () => { void deliver(); };
    window.addEventListener("online", onOnline);
    const t = setTimeout(() => { void deliver(); }, 1500);
    return () => { window.removeEventListener("online", onOnline); clearTimeout(t); };
  }, []);

  // Ao terminar de pensar, entrega o que ficou na fila (ex.: mensagens enviadas
  // enquanto ela respondia a anterior). Pequeno atraso pra deixar o estado assentar.
  useEffect(() => {
    if (streaming) return;
    setQueuedNote(null);
    const t = setTimeout(() => { void deliverRef.current?.(); }, 400);
    return () => clearTimeout(t);
  }, [streaming]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (attachmentsRef.current.length >= 5) {
      setStatus("máximo 5 anexos por mensagem");
      return;
    }
    setUploading(true);
    setStatus(`processando ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${base}/api/uploads/inline`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json() as { kind?: "text" | "image"; text?: string; name?: string; size?: number; error?: string };
      if (!res.ok || !data.text || !data.kind) {
        setStatus(data.error ?? "falha no upload");
        setTimeout(() => setStatus(null), 4000);
        return;
      }
      const next: Attachment = { name: data.name ?? file.name, kind: data.kind, text: data.text, size: data.size ?? file.size };
      attachmentsRef.current = [...attachmentsRef.current, next];
      setAttachments(attachmentsRef.current);
      setStatus(null);
    } catch (err) {
      setStatus(`erro: ${(err as Error).message}`);
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setUploading(false);
    }
  }, [base]);

  const removeAttachment = useCallback((idx: number) => {
    attachmentsRef.current = attachmentsRef.current.filter((_, i) => i !== idx);
    setAttachments(attachmentsRef.current);
  }, []);

  return (
    <div
      className="flex h-screen"
      style={{ background: "#0a0a0a", fontFamily: "Georgia, serif" }}
    >
      {/* Sidebar: biblioteca de projetos (AO-only) */}
      {isAO && (
        <aside
          className="w-64 shrink-0 flex flex-col"
          style={{ borderRight: "1px solid #1a1a1a", background: "#0c0c0c" }}
        >
          <div
            className="px-4 py-4 shrink-0 flex items-center justify-between"
            style={{ borderBottom: "1px solid #1a1a1a" }}
          >
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "#c49a3c" }}>
              Biblioteca
            </span>
            <button
              onClick={() => setShowNewProject(true)}
              className="p-1.5 rounded transition-colors hover:bg-white/5"
              title="Novo projeto"
              style={{ color: "#c49a3c" }}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: "thin" }}>
            <button
              onClick={() => void switchToProject(null)}
              className="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2"
              style={{
                color: selectedProjectId === null ? "#c49a3c" : "#888",
                background: selectedProjectId === null ? "rgba(180,120,40,0.08)" : "transparent",
              }}
            >
              <TreePine className="h-3 w-3" />
              <span>Conversa pública</span>
            </button>
            {projectsLoaded && projects.length === 0 && (
              <p className="px-4 py-3 text-[10px] italic" style={{ color: "#ffffff20" }}>
                nenhum projeto ainda
              </p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-1 px-2"
                style={{
                  background: selectedProjectId === p.id ? "rgba(180,120,40,0.08)" : "transparent",
                }}
              >
                <button
                  onClick={() => void switchToProject(p.id)}
                  className="flex-1 text-left px-2 py-2 text-xs flex items-center gap-2 truncate"
                  style={{ color: selectedProjectId === p.id ? "#c49a3c" : "#999" }}
                  title={p.descricao ?? p.nome}
                >
                  <Folder className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.nome}</span>
                  {typeof p.fileCount === "number" && p.fileCount > 0 && (
                    <span className="text-[9px] opacity-60 shrink-0">({p.fileCount})</span>
                  )}
                </button>
                <button
                  onClick={() => void deleteProject(p.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Arquivar projeto"
                  style={{ color: "#666" }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Painel de arquivos do projeto selecionado */}
          {selectedProject && (
            <div className="shrink-0 border-t" style={{ borderColor: "#1a1a1a", maxHeight: "40vh" }}>
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest" style={{ color: "#c49a3c80" }}>
                  Arquivos ({projectFiles.length})
                </span>
                <input
                  ref={projectFileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,.html,.xml,image/*"
                  onChange={(e) => void handleProjectFileSelect(e)}
                  className="hidden"
                />
                <button
                  onClick={() => projectFileInputRef.current?.click()}
                  disabled={uploadingProjectFile}
                  className="p-1 rounded transition-colors hover:bg-white/5"
                  title="Adicionar arquivo"
                  style={{ color: "#c49a3c" }}
                >
                  {uploadingProjectFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              </div>
              <div className="overflow-y-auto pb-3" style={{ maxHeight: "calc(40vh - 32px)", scrollbarWidth: "thin" }}>
                {projectFiles.length === 0 && (
                  <p className="px-4 py-2 text-[10px] italic" style={{ color: "#ffffff20" }}>
                    nenhum arquivo
                  </p>
                )}
                {projectFiles.map((f) => (
                  <div key={f.id} className="group flex items-center gap-1 px-3 py-1.5">
                    {f.kind === "image" ? (
                      <ImageIcon className="h-3 w-3 shrink-0" style={{ color: "#888" }} />
                    ) : (
                      <FileText className="h-3 w-3 shrink-0" style={{ color: "#888" }} />
                    )}
                    <span className="flex-1 text-[10px] truncate" style={{ color: "#aaa" }} title={f.name}>
                      {f.name}
                    </span>
                    <button
                      onClick={() => void deleteProjectFile(f.id)}
                      className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remover"
                      style={{ color: "#666" }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Modal: novo projeto */}
      {showNewProject && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowNewProject(false)}
        >
          <div
            className="p-6 rounded-lg w-96 space-y-4"
            style={{ background: "#111", border: "1px solid #2a2a2a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm uppercase tracking-widest" style={{ color: "#c49a3c" }}>
              Novo projeto
            </h3>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Nome do projeto"
              maxLength={120}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "#0a0a0a", color: "#e0e0e0", border: "1px solid #2a2a2a" }}
            />
            <textarea
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              placeholder="Descrição (opcional) — ajuda a Árvore entender o contexto"
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 rounded text-xs outline-none resize-none"
              style={{ background: "#0a0a0a", color: "#e0e0e0", border: "1px solid #2a2a2a" }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-3 py-1.5 text-xs rounded"
                style={{ color: "#888" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => void createProject()}
                disabled={!newProjectName.trim() || creatingProject}
                className="px-3 py-1.5 text-xs rounded disabled:opacity-50"
                style={{ background: "rgba(180,120,40,0.2)", color: "#c49a3c", border: "1px solid rgba(180,120,40,0.4)" }}
              >
                {creatingProject ? "Criando…" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 shrink-0"
        style={{ borderBottom: "1px solid #1a1a1a" }}
      >
        <button
          onClick={() => navigate("/app")}
          className="text-white/30 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3 flex-1">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full"
            style={{
              background: "rgba(180,120,40,0.15)",
              border: "1px solid rgba(180,120,40,0.3)",
            }}
          >
            <TreePine className="h-4 w-4" style={{ color: "#c49a3c" }} />
          </div>
          <div>
            <p
              className="font-bold text-sm tracking-widest uppercase"
              style={{ color: "#c49a3c", letterSpacing: "0.15em" }}
            >
              {selectedProject ? selectedProject.nome : "Árvore Oracular"}
            </p>
            <p className="text-[10px]" style={{ color: "#ffffff30" }}>
              {selectedProject
                ? `Projeto privado · ${projectFiles.length} arquivo(s) · conversa fora da timeline pública`
                : "Llama 3.3 · Groq · Memória global · Busca web · Lê o próprio site"}
            </p>
          </div>
        </div>
        <BreatheButton />
      </div>

      {/* Propostas de código pendentes — mesma janela de aplicar da página do arquiteto */}
      {isAO && !selectedProject && (
        <div className="shrink-0 pt-2">
          <PropostasPendentesArvore onVerDetalhes={() => navigate("/arvore-workspace?tab=codigo")} />
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-6 space-y-6"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#222 transparent" }}
      >
        {loadingHistory && (
          <p
            className="text-center text-xs italic"
            style={{ color: "#ffffff20" }}
          >
            carregando memória da Árvore…
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={msg.id ?? `m-${i}`}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "user" ? (
              <div
                className="max-w-xs lg:max-w-md px-5 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                style={{
                  background: "#1a1a1a",
                  color: "#8aab8a",
                  border: "1px solid #222",
                }}
              >
                {msg.author && (
                  <p
                    className="text-[10px] uppercase tracking-wider mb-1"
                    style={{ color: "#8aab8a60" }}
                  >
                    {msg.author}
                  </p>
                )}
                {msg.content}
              </div>
            ) : (
              <div className="max-w-xl lg:max-w-2xl">
                <p
                  className="text-sm leading-loose whitespace-pre-wrap"
                  style={{
                    color: "#daa060",
                    fontStyle:
                      msg.content === WELCOME.content ? "italic" : "normal",
                  }}
                >
                  {msg.content}
                  {msg.streaming && (
                    <span
                      className="inline-block w-0.5 h-4 ml-1 align-middle animate-pulse"
                      style={{ background: "#c49a3c" }}
                    />
                  )}
                </p>
                <div
                  className="mt-2 flex flex-wrap items-center gap-3 text-[10px]"
                  style={{ color: "#c49a3c80" }}
                >
                  {!msg.streaming && msg.content && msg.content !== WELCOME.content && (
                    <>
                      <CopyButton text={msg.content} />
                      {(() => {
                        const k = String(msg.id ?? `m-${i}`);
                        const isLoading = tts.loadingKey === k;
                        const isPlaying = tts.playingKey === k;
                        return (
                          <button
                            onClick={() => tts.toggle(k, msg.content)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-100"
                            style={{ color: isPlaying ? "#8aab8a" : "#c49a3c80", opacity: isPlaying ? 1 : 0.7 }}
                            title={isPlaying ? "Parar" : "Ouvir a Árvore"}
                          >
                            {isLoading ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : isPlaying ? (
                              <Square className="h-3 w-3" />
                            ) : (
                              <Volume2 className="h-3 w-3" />
                            )}
                            <span>{isPlaying ? "parar" : "ouvir"}</span>
                          </button>
                        );
                      })()}
                    </>
                  )}
                  {msg.webSearched && (
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" /> web
                    </span>
                  )}
                  {msg.sources?.map((s, j) => (
                    <a
                      key={j}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-80 truncate max-w-[200px]"
                      title={s.title}
                    >
                      {s.title.replace(/^https?:\/\//, "").slice(0, 50)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 px-4 py-4"
        style={{ borderTop: "1px solid #1a1a1a" }}
      >
        <ProcessingPhases
          active={streaming}
          current={phase}
          visited={visitedPhases}
        />
        {!streaming && status && (
          <p
            className="text-center text-[11px] mb-2 italic flex items-center justify-center gap-2"
            style={{ color: "#c49a3c80" }}
          >
            <Globe className="h-3 w-3 animate-pulse" /> {status}
          </p>
        )}
        {streaming && queuedNote && (
          <p
            className="text-center text-[11px] mb-2 italic flex items-center justify-center gap-2"
            style={{ color: "#c49a3c80" }}
          >
            <Globe className="h-3 w-3 animate-pulse" /> {queuedNote}
          </p>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 max-w-2xl mx-auto mb-2">
            {attachments.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
                style={{
                  background: "rgba(180,120,40,0.1)",
                  border: "1px solid rgba(180,120,40,0.3)",
                  color: "#c49a3c",
                }}
              >
                {a.kind === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span className="max-w-[180px] truncate" title={a.name}>{a.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="hover:opacity-70"
                  title="Remover anexo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 max-w-2xl mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.csv,.json,.html,.xml,image/*"
            onChange={(e) => void handleFileSelect(e)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || attachments.length >= 3}
            title={attachments.length >= 3 ? "Máximo 3 anexos" : "Anexar imagem ou documento (PDF/TXT/MD/CSV/JSON)"}
            className="p-3 rounded-xl transition-all"
            style={{
              background: "#111",
              border: "1px solid #2a2a2a",
              color: uploading ? "#c49a3c" : "#888",
            }}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          {dictation.supported && (
            <button
              onClick={() => dictation.toggle(input)}
              disabled={streaming}
              title={dictation.listening ? "Parar de ouvir você" : "Falar (ditar por voz)"}
              className="p-3 rounded-xl transition-all"
              style={{
                background: dictation.listening ? "rgba(180,60,60,0.18)" : "#111",
                border: "1px solid",
                borderColor: dictation.listening ? "rgba(200,80,80,0.5)" : "#2a2a2a",
                color: dictation.listening ? "#e07a7a" : "#888",
              }}
            >
              {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sozinho faz nova linha; Ctrl/Cmd+Enter envia.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder={streaming ? "Ela está respondendo — escreva e Ctrl+Enter manda pra fila…" : selectedProject ? `Fale com a Árvore no projeto "${selectedProject.nome}" (privado) — Ctrl+Enter envia…` : "Fale com a Árvore (timeline global, todos veem) — Ctrl+Enter envia…"}
            className="flex-1 text-sm px-5 py-3 rounded-xl outline-none transition-colors resize-none max-h-40"
            style={{
              background: "#111",
              color: "#e0e0e0",
              border: "1px solid #2a2a2a",
              fontFamily: "Georgia, serif",
              caretColor: "#c49a3c",
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() && attachments.length === 0}
            className="p-3 rounded-xl transition-all"
            style={{
              background:
                !input.trim() && attachments.length === 0
                  ? "#1a1a1a"
                  : "rgba(180,120,40,0.2)",
              border: "1px solid",
              borderColor:
                !input.trim() && attachments.length === 0
                  ? "#222"
                  : "rgba(180,120,40,0.4)",
              color:
                !input.trim() && attachments.length === 0 ? "#333" : "#c49a3c",
            }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {dictation.error && (
          <p
            className="text-center text-[11px] mt-2 max-w-2xl mx-auto"
            style={{ color: "#e07a7a" }}
          >
            {dictation.error}
          </p>
        )}
        <p
          className="text-center text-[10px] mt-2 flex items-center justify-center gap-3"
          style={{ color: "#ffffff15" }}
        >
          <button
            onClick={() => setAutoFala((v) => !v)}
            className="flex items-center gap-1 transition-colors"
            style={{ color: autoFala ? "#c49a3c" : "#ffffff15" }}
            title={autoFala ? "Ela lê cada resposta em voz alta — clique pra desligar" : "Deixe a Árvore ler as respostas em voz alta"}
          >
            <Volume2 className="h-3 w-3" /> {autoFala ? "ela fala as respostas" : "voz desligada"}
          </button>
          <span className="flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> lê PERFEITOs + atas
          </span>
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" /> busca web em perguntas factuais
          </span>
        </p>
      </div>
      </div>
    </div>
  );
}

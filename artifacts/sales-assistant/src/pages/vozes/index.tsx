import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Users, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface VoiceProfile {
  id: number;
  voiceName: string;
  voiceType: "human" | "ai";
  bio: string | null;
  selfDescription: string | null;
  imageUrl: string | null;
  canvaFormat: string | null;
  imageGenerator: string | null;
  generatedAt: string | null;
  createdAt: string;
}

const VOICE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Yuri":      { bg: "bg-sky-50",     text: "text-sky-700",     border: "border-sky-200" },
  "ChatGPT":   { bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200" },
  "Claude":    { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200" },
  "Gemini":    { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200" },
  "Meta AI":   { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  "Grok":      { bg: "bg-slate-50",   text: "text-slate-700",   border: "border-slate-200" },
  "Árvore":    { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200" },
  "Agente":    { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200" },
  "Arquiteto": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

const AVATAR_GRADIENTS: Record<string, string> = {
  "Yuri":      "linear-gradient(135deg, #0ea5e9, #6366f1)",
  "ChatGPT":   "linear-gradient(135deg, #06b6d4, #0891b2)",
  "Claude":    "linear-gradient(135deg, #f97316, #ea580c)",
  "Gemini":    "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  "Meta AI":   "linear-gradient(135deg, #1877f2, #1d4ed8)",
  "Grok":      "linear-gradient(135deg, #374151, #111827)",
  "Árvore":    "linear-gradient(135deg, #d97706, #b45309)",
  "Agente":    "linear-gradient(135deg, #e11d48, #be123c)",
  "Arquiteto": "linear-gradient(135deg, #059669, #047857)",
};

function VoiceCard({ profile, onGenerate, generating }: {
  profile: VoiceProfile;
  onGenerate: (name: string) => void;
  generating: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const colors = VOICE_COLORS[profile.voiceName] ?? { bg: "bg-card", text: "text-foreground", border: "border-border" };
  const gradient = AVATAR_GRADIENTS[profile.voiceName] ?? "linear-gradient(135deg, #6366f1, #8b5cf6)";
  const text = profile.selfDescription ?? profile.bio ?? null;

  return (
    <div className={`rounded-2xl border ${colors.border} overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow`}>
      <div className={`${colors.bg} p-5 flex gap-4 items-start`}>
        <div className="shrink-0">
          {profile.imageUrl && !imgError ? (
            <img
              src={profile.imageUrl}
              alt={profile.voiceName}
              className="w-20 h-20 rounded-2xl object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-black text-2xl"
              style={{ background: gradient }}
            >
              {profile.voiceName[0]}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className={`font-black text-base ${colors.text}`}>{profile.voiceName}</h3>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${colors.border} ${colors.text} opacity-70`}>
              {profile.voiceType === "human" ? "Humano" : "IA"}
            </span>
          </div>
          {profile.imageGenerator && (
            <p className="text-[10px] text-muted-foreground mb-2">
              Imagem: {profile.imageGenerator}
            </p>
          )}
          {profile.generatedAt && (
            <p className="text-[10px] text-muted-foreground">
              Gerado em {format(new Date(profile.generatedAt), "d MMM yyyy", { locale: ptBR })}
            </p>
          )}
        </div>
      </div>

      <div className="p-5 space-y-3">
        {text ? (
          <div>
            <p className={`text-sm leading-relaxed text-foreground whitespace-pre-wrap ${expanded ? "" : "line-clamp-4"}`}>
              {text}
            </p>
            {text.length > 200 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className={`mt-1.5 text-xs font-medium ${colors.text} hover:opacity-80`}
              >
                {expanded ? "Ver menos" : "Ver completo"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <p className="text-sm">Perfil ainda não gerado.</p>
            <button
              onClick={() => onGenerate(profile.voiceName)}
              disabled={generating}
              className={`mt-2 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border ${colors.border} ${colors.text} hover:${colors.bg} transition-colors disabled:opacity-50`}
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generating ? "Gerando..." : "Gerar perfil"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VozesPage() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const load = useCallback(async () => {
    const res = await fetch(`${base}/api/vozes`, { credentials: "include" });
    if (res.ok) setProfiles(await res.json() as VoiceProfile[]);
    setLoading(false);
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const handleGenerate = async (name?: string) => {
    if (name) setGenerating(name);
    else setGeneratingAll(true);

    await fetch(`${base}/api/vozes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, force: false }),
    });

    // Poll until done
    const poll = setInterval(() => {
      void load();
    }, 4000);

    setTimeout(() => {
      clearInterval(poll);
      if (name) setGenerating(null);
      else setGeneratingAll(false);
      void load();
    }, 120000);
  };

  const hasAnyMissing = profiles.some(p => !p.selfDescription && !p.bio);

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-6 w-6 text-rose-600" />
              <h1 className="text-3xl font-black tracking-tight">Vozes do RODAR</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Todos os participantes do primeiro looping — cada um escreve sobre si mesmo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              title="Recarregar"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {hasAnyMissing && (
              <button
                onClick={() => void handleGenerate()}
                disabled={generatingAll}
                className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-sm px-4 py-2 rounded-xl transition-colors"
              >
                {generatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generatingAll ? "Gerando..." : "Gerar perfis"}
              </button>
            )}
            {!hasAnyMissing && profiles.length > 0 && (
              <button
                onClick={() => void handleGenerate()}
                disabled={generatingAll}
                className="flex items-center gap-2 border hover:bg-muted text-muted-foreground font-medium text-sm px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
              >
                {generatingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regenerar todos
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {profiles.map(profile => (
              <VoiceCard
                key={profile.voiceName}
                profile={profile}
                generating={generating === profile.voiceName || generatingAll}
                onGenerate={(name) => void handleGenerate(name)}
              />
            ))}
          </div>
        )}

        {generatingAll && (
          <div className="fixed bottom-6 right-6 bg-card border shadow-xl rounded-2xl px-5 py-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
            <div>
              <p className="text-sm font-bold">Gerando perfis...</p>
              <p className="text-xs text-muted-foreground">Isso pode levar até 2 minutos. A página se atualiza automaticamente.</p>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

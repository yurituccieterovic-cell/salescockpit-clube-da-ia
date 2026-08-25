import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BookOpen, ChevronDown, ChevronUp, Image, Loader2, Maximize2, Sparkles, X } from "lucide-react";

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full p-2 transition-colors"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70 hover:text-white bg-black/40 hover:bg-black/60 px-3 py-1.5 rounded-full transition-colors"
      >
        Abrir em nova aba
      </a>
    </div>
  );
}

interface JornalEntry {
  id: number;
  sessionId: number | null;
  topic: string;
  perfeitoText: string;
  canvaFormatText: string | null;
  imageUrl: string | null;
  publishedAt: string;
}

function CanvaCard({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  const title = lines.find(l => l.startsWith("TÍTULO:"))?.replace("TÍTULO:", "").trim();
  const subtitle = lines.find(l => l.startsWith("SUBTÍTULO:"))?.replace("SUBTÍTULO:", "").trim();
  const points = lines.filter(l => l.startsWith("•")).map(l => l.replace("•", "").trim());
  const cta = lines.find(l => l.startsWith("CTA:"))?.replace("CTA:", "").trim();
  const palette = lines.find(l => l.startsWith("PALETA:"))?.replace("PALETA:", "").trim();

  return (
    <div className="bg-slate-900 rounded-2xl p-6 text-white space-y-4 border border-slate-700">
      <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Formato Canva</div>
      {title && <h2 className="text-xl font-black leading-tight">{title}</h2>}
      {subtitle && <p className="text-sm text-slate-300 leading-relaxed">{subtitle}</p>}
      {points.length > 0 && (
        <ul className="space-y-2">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
              <span className="text-rose-400 mt-0.5 shrink-0">▸</span>
              {p}
            </li>
          ))}
        </ul>
      )}
      {cta && (
        <div className="border border-rose-500 text-rose-400 text-xs font-bold px-4 py-2 rounded-full w-fit uppercase tracking-wider">
          {cta}
        </div>
      )}
      {palette && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Paleta:</span>
          {palette.split(/[, ]+/).filter(c => c.startsWith("#")).map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full border border-slate-600 inline-block" style={{ background: c }} />
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function JornalCard({ entry, onOpenImage }: { entry: JornalEntry; onOpenImage: (src: string, alt: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <article className="bg-card border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {entry.imageUrl && !imgError ? (
        <button
          type="button"
          onClick={() => onOpenImage(entry.imageUrl!, entry.topic)}
          className="group relative aspect-[16/7] w-full overflow-hidden bg-slate-900 block text-left focus:outline-none focus:ring-2 focus:ring-rose-500"
          aria-label={`Abrir imagem: ${entry.topic}`}
        >
          <img
            src={entry.imageUrl}
            alt={entry.topic}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute top-3 right-3 bg-black/50 group-hover:bg-black/70 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 className="h-4 w-4" />
          </div>
          <div className="absolute bottom-4 left-5 right-5">
            <p className="text-white font-bold text-lg leading-tight drop-shadow-lg line-clamp-2">{entry.topic}</p>
          </div>
        </button>
      ) : (
        <div className="bg-gradient-to-br from-rose-900 via-slate-900 to-emerald-900 px-6 pt-6 pb-4">
          <p className="text-white font-bold text-lg leading-tight">{entry.topic}</p>
        </div>
      )}

      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            {format(new Date(entry.publishedAt), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
          </span>
          {entry.sessionId && (
            <span className="bg-rose-50 text-rose-600 font-semibold px-2 py-0.5 rounded-full">
              Sessão #{entry.sessionId?.toLocaleString("pt-BR")}
            </span>
          )}
        </div>

        <div className="text-sm text-foreground leading-relaxed">
          <p className={expanded ? "whitespace-pre-wrap" : "line-clamp-4 whitespace-pre-wrap"}>
            {entry.perfeitoText}
          </p>
          {entry.perfeitoText.length > 300 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium"
            >
              {expanded ? <><ChevronUp className="h-3.5 w-3.5" /> Ver menos</> : <><ChevronDown className="h-3.5 w-3.5" /> Ler completo</>}
            </button>
          )}
        </div>

        {entry.canvaFormatText && (
          <div className="border-t pt-3">
            <button
              onClick={() => setCanvaOpen(!canvaOpen)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              {canvaOpen ? "Ocultar formato Canva" : "Ver formato Canva"}
              {canvaOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {canvaOpen && (
              <div className="mt-3">
                <CanvaCard text={entry.canvaFormatText} />
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function JornalPage() {
  const [entries, setEntries] = useState<JornalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${base}/api/jornal`, { credentials: "include" });
    if (res.ok) setEntries(await res.json() as JornalEntry[]);
    setLoading(false);
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  return (
    <MainLayout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Image className="h-6 w-6 text-rose-600" />
            <h1 className="text-3xl font-black tracking-tight">Jornal</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Textos PERFEITO — publicados pelo Secretário após cada ciclo completo.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <BookOpen className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">O Jornal está vazio.</p>
            <p className="text-sm mt-1">Os textos PERFEITO aparecerão aqui após cada RODAR completo.</p>
          </div>
        ) : (
          <div className="grid gap-8">
            {entries.map(entry => (
              <JornalCard
                key={entry.id}
                entry={entry}
                onOpenImage={(src, alt) => setLightbox({ src, alt })}
              />
            ))}
          </div>
        )}
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </MainLayout>
  );
}

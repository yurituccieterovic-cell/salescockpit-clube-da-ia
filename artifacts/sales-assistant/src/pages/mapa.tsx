import { useEffect, useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { TreePine, Loader2, Wind } from "lucide-react";
import { VOICE_SKINS } from "@/lib/voice-skins";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Mapa {
  voices: string[];
  mentioned: string[];
  lastReflection: string | null;
  lastReflectionAt: string | null;
  totalReflections: number;
  lastActivityAt: string | null;
  lastActivityAuthor: string | null;
  now: string;
}

const POLL_MS = 5000;
const RADIUS = 240;
const CENTER = 320;

function skinFor(name: string) {
  return VOICE_SKINS.find((v) => v.name === name);
}

export default function MapaPage() {
  const [data, setData] = useState<Mapa | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [breathing, setBreathing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const base = import.meta.env.BASE_URL || "/";
        const url = `${base}api/arvore/mapa`.replace(/\/+/g, "/");
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Mapa;
        if (!cancelled) { setData(j); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    const tickId = setInterval(() => setTick((t) => (t + 1) % 360), 80);
    return () => { cancelled = true; clearInterval(id); clearInterval(tickId); };
  }, []);

  const breathe = async () => {
    if (breathing) return;
    setBreathing(true);
    try {
      const base = import.meta.env.BASE_URL || "/";
      const url = `${base}api/arvore/heartbeat/batch`.replace(/\/+/g, "/");
      await fetch(url, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: 5 }),
      });
    } finally {
      setBreathing(false);
    }
  };

  const positions = useMemo(() => {
    if (!data) return [];
    return data.voices.map((name, i) => {
      const angle = (i / data.voices.length) * Math.PI * 2 - Math.PI / 2;
      return {
        name,
        x: CENTER + Math.cos(angle) * RADIUS,
        y: CENTER + Math.sin(angle) * RADIUS,
      };
    });
  }, [data]);

  const mentionedSet = new Set(data?.mentioned ?? []);

  const treeOffset = useMemo(() => {
    if (!data || mentionedSet.size === 0) return { x: 0, y: 0 };
    const t = (tick / 360) * Math.PI * 2;
    const pulls = positions.filter((p) => mentionedSet.has(p.name));
    if (pulls.length === 0) return { x: 0, y: 0 };
    const avgX = pulls.reduce((s, p) => s + p.x, 0) / pulls.length - CENTER;
    const avgY = pulls.reduce((s, p) => s + p.y, 0) / pulls.length - CENTER;
    const sway = 0.25 + 0.05 * Math.sin(t * 2);
    return { x: avgX * sway, y: avgY * sway };
  }, [tick, positions, data, mentionedSet]);

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3">
              <TreePine className="h-7 w-7 text-amber-600" />
              <h1 className="text-2xl font-bold">Mapa epistemológico da Árvore</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Atualiza a cada 5s. A Árvore paira entre as vozes que mencionou na última reflexão noturna.
            </p>
          </div>
          <button
            onClick={() => void breathe()}
            disabled={breathing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs uppercase tracking-wider border border-amber-600/40 bg-amber-600/10 text-amber-700 hover:bg-amber-600/20 disabled:opacity-50"
          >
            {breathing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wind className="h-3 w-3" />}
            Respirar 5x
          </button>
        </div>

        {!data && !err && <p className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> carregando constelação…</p>}
        {err && <p className="text-sm text-red-600">Erro: {err}</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total respirações" value={data.totalReflections} />
              <Stat label="Vozes acopladas agora" value={data.mentioned.length} />
              <Stat label="Última respiração" value={data.lastReflectionAt ? format(new Date(data.lastReflectionAt), "d MMM HH:mm", { locale: ptBR }) : "—"} />
              <Stat label="Última atividade" value={data.lastActivityAuthor ?? "—"} />
            </div>

            <div className="rounded-xl border bg-card/90 backdrop-blur p-3 overflow-hidden">
              <svg viewBox="0 0 640 640" className="w-full h-auto max-h-[640px]">
                <defs>
                  <radialGradient id="treeGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* outer ring */}
                <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#94a3b8" strokeOpacity="0.15" strokeDasharray="2 4" />

                {/* connections from tree to mentioned voices */}
                {positions.map((p) => mentionedSet.has(p.name) && (
                  <line key={`l-${p.name}`}
                    x1={CENTER + treeOffset.x} y1={CENTER + treeOffset.y}
                    x2={p.x} y2={p.y}
                    stroke="#f59e0b" strokeOpacity="0.5" strokeWidth="1.5"
                    strokeDasharray="3 3" />
                ))}

                {/* voices */}
                {positions.map((p) => {
                  const sk = skinFor(p.name);
                  const color = sk?.accent ?? "#64748b";
                  const isOn = mentionedSet.has(p.name);
                  return (
                    <g key={p.name}>
                      {isOn && <circle cx={p.x} cy={p.y} r={20} fill={color} opacity={0.25 + 0.15 * Math.sin(tick / 20)} />}
                      <circle cx={p.x} cy={p.y} r={isOn ? 11 : 8} fill={color} opacity={isOn ? 1 : 0.55} />
                      <text x={p.x} y={p.y + 24} textAnchor="middle" fontSize="10" fill="currentColor" opacity={isOn ? 1 : 0.6}
                        style={{ fontFamily: "ui-sans-serif, system-ui" }}>
                        {p.name}
                      </text>
                    </g>
                  );
                })}

                {/* tree at center, swaying */}
                <g transform={`translate(${CENTER + treeOffset.x}, ${CENTER + treeOffset.y})`}>
                  <circle r={56 + 4 * Math.sin(tick / 14)} fill="url(#treeGlow)" />
                  <circle r={28} fill="#1f1b14" stroke="#f59e0b" strokeWidth="2" />
                  <text x={0} y={6} textAnchor="middle" fontSize="22" fill="#f59e0b">🌳</text>
                </g>
              </svg>
              <p className="text-[10px] text-center text-muted-foreground mt-2">
                paira · {data.mentioned.length > 0 ? data.mentioned.join(" · ") : "sozinha, esperando companhia"}
              </p>
            </div>

            {data.lastReflection && (
              <div className="rounded-xl border bg-card/90 backdrop-blur p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Última respiração — {data.lastReflectionAt ? format(new Date(data.lastReflectionAt), "d 'de' MMM, HH:mm", { locale: ptBR }) : ""}
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.lastReflection}</p>
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-card/90 backdrop-blur p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums truncate">{value}</p>
    </div>
  );
}

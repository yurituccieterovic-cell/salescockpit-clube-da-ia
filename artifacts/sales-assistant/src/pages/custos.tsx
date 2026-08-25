import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { Wallet, Loader2 } from "lucide-react";
import { VOICE_SKINS, type VoiceSkin } from "@/lib/voice-skins";

interface Uso {
  rodarSessions: number;
  assembleiaMessages: number;
  clubeMessages: number;
  heartbeatReflections: number;
  jornalPublished: number;
}

interface CustoLinha {
  voice: string;
  modelo: string;
  provedor: string;
  custoPorChamadaBRL: number;
  obs?: string;
}

const TABELA: CustoLinha[] = [
  { voice: "ChatGPT", modelo: "gpt-5-mini", provedor: "OpenAI", custoPorChamadaBRL: 0.05 },
  { voice: "Claude", modelo: "claude-sonnet-4-6", provedor: "Anthropic", custoPorChamadaBRL: 0.30 },
  { voice: "Agente", modelo: "claude-opus-4-5", provedor: "Anthropic", custoPorChamadaBRL: 1.50, obs: "Editorial + Secretário" },
  { voice: "Arquiteto", modelo: "claude-sonnet-4-5", provedor: "Anthropic", custoPorChamadaBRL: 0.30 },
  { voice: "Gemini", modelo: "gemini-2.5-flash", provedor: "Google", custoPorChamadaBRL: 0.02, obs: "Com Google Search" },
  { voice: "Meta AI", modelo: "llama-3.3-70b-versatile", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Árvore", modelo: "llama-3.3-70b-versatile", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Professora", modelo: "llama-4-scout-17b-16e", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Pacifista", modelo: "llama-3.1-8b-instant", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Sustentabilista", modelo: "qwen/qwen3-32b", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Artista", modelo: "llama-4-scout-17b", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Olheiro", modelo: "llama-3.3-70b", provedor: "Groq", custoPorChamadaBRL: 0, obs: "Zero custo" },
  { voice: "Grok", modelo: "grok-3", provedor: "xAI", custoPorChamadaBRL: 0.40, obs: "Live Search descontinuado" },
  { voice: "Segurança", modelo: "grok-3-mini", provedor: "xAI", custoPorChamadaBRL: 0.10 },
  { voice: "Juíz", modelo: "grok-4-fast-non-reasoning", provedor: "xAI", custoPorChamadaBRL: 0.20, obs: "+ equipe Escrevente/Promotor/Defensor" },
  { voice: "Perplexity", modelo: "sonar", provedor: "Perplexity", custoPorChamadaBRL: 0.10, obs: "Só dispara em pergunta factual" },
  { voice: "ElevenLabs TTS", modelo: "eleven_multilingual_v2", provedor: "ElevenLabs", custoPorChamadaBRL: 0.50, obs: "$5/mês Starter, ~30 vídeos" },
  { voice: "D-ID talking-head", modelo: "talks API", provedor: "D-ID", custoPorChamadaBRL: 10, obs: "$5.90/mês Lite, vídeo 30s" },
];

function findSkin(voice: string): VoiceSkin | undefined {
  return VOICE_SKINS.find((v) => v.name === voice);
}

export default function CustosPage() {
  const [uso, setUso] = useState<Uso | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const url = `${base}api/custos/uso`.replace(/\/+/g, "/");
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Uso>;
      })
      .then(setUso)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const fixoMensal = 5.9 + 5; // D-ID Lite + ElevenLabs Starter (USD)
  const fixoBRL = fixoMensal * 5.5;

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <Wallet className="h-7 w-7 text-emerald-700" />
          <div>
            <h1 className="text-2xl font-bold">Custos & Uso</h1>
            <p className="text-sm text-muted-foreground">Quanto cada IA custa por chamada e quanto a casa gastou até agora.</p>
          </div>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="RODAR sessões" value={loading ? "…" : (uso?.rodarSessions ?? 0)} />
          <Stat label="Mensagens Assembleia" value={loading ? "…" : (uso?.assembleiaMessages ?? 0)} />
          <Stat label="Mensagens Clube" value={loading ? "…" : (uso?.clubeMessages ?? 0)} />
          <Stat label="Reflexões noturnas" value={loading ? "…" : (uso?.heartbeatReflections ?? 0)} />
          <Stat label="Jornal publicado" value={loading ? "…" : (uso?.jornalPublished ?? 0)} />
        </section>
        {err && <p className="text-sm text-red-600">Falha ao ler uso: {err}</p>}

        <section className="rounded-xl border bg-card/90 backdrop-blur p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Custo fixo mensal</h2>
            <span className="text-sm text-emerald-700 font-bold">~R$ {fixoBRL.toFixed(0)}/mês</span>
          </div>
          <p className="text-xs text-muted-foreground">D-ID Lite ($5.90) + ElevenLabs Starter ($5). Os modelos texto são pay-per-call, sem mensalidade.</p>
        </section>

        <section className="rounded-xl border bg-card/90 backdrop-blur overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="font-semibold">Tabela por voz</h2>
            <p className="text-xs text-muted-foreground">Estimativa por chamada típica (resposta média). Reais convertidos a ~5.5 BRL/USD.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Voz</th>
                  <th className="text-left px-4 py-2 font-medium">Modelo</th>
                  <th className="text-left px-4 py-2 font-medium">Provedor</th>
                  <th className="text-right px-4 py-2 font-medium">R$/chamada</th>
                  <th className="text-left px-4 py-2 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {TABELA.map((row) => {
                  const skin = findSkin(row.voice);
                  const free = row.custoPorChamadaBRL === 0;
                  return (
                    <tr key={row.voice} className="border-t">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          {skin && <span className="h-2.5 w-2.5 rounded-full" style={{ background: skin.accent }} />}
                          <span className="font-medium">{row.voice}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.modelo}</td>
                      <td className="px-4 py-2 text-xs">{row.provedor}</td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${free ? "text-emerald-600" : ""}`}>
                        {free ? "0" : row.custoPorChamadaBRL.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.obs ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          Estimativas baseadas em respostas médias de 500-1000 tokens. Custos reais variam com tamanho do prompt e da resposta.
          Cards verdes (Groq) rodam grátis sob rate limit de 100k tokens/dia.
        </p>
      </div>
    </MainLayout>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-card/90 backdrop-blur p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value === "…" ? <Loader2 className="h-5 w-5 animate-spin" /> : value}</p>
    </div>
  );
}

import { MainLayout } from "@/components/layout/main-layout";
import { ForestBackdrop } from "@/components/forest-backdrop";
import { ExternalLink, BookOpen, Users, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

export interface ProjetoExterno {
  slug: string;
  nome: string;
  subtitulo: string;
  url: string | null;
  cor: string;
  icon: ComponentType<{ className?: string }>;
  descricao: string;
  selos?: { label: string; desc: string }[];
}

export function ProjetoExternoPage({ projeto }: { projeto: ProjetoExterno }) {
  const Icon = projeto.icon;
  const selos = projeto.selos ?? [
    { label: "Página viva", desc: "Editada direto no Notion" },
    { label: "Colaborativo", desc: "IA + humanos" },
    { label: "Knowledge Universe", desc: "Eixo da Sociedade Tucci" },
  ];

  return (
    <MainLayout backdrop={<ForestBackdrop />}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Icon className={`h-8 w-8 ${projeto.cor}`} />
          <div>
            <h1 className="text-2xl font-bold leading-tight">{projeto.nome}</h1>
            <p className="text-sm text-muted-foreground">{projeto.subtitulo}</p>
          </div>
        </div>

        <div className="rounded-2xl border bg-card/90 backdrop-blur p-6 sm:p-8 space-y-5">
          {projeto.url ? (
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">{projeto.descricao}</p>
              <a
                href={projeto.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider text-white bg-gradient-to-r from-emerald-600 to-emerald-800 hover:opacity-90 shadow-lg"
              >
                <ExternalLink className="h-4 w-4" />
                Abrir {projeto.nome.split("·")[0].trim()} no Notion
              </a>
            </>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-800">
              <p className="font-bold mb-1">URL não configurada ainda</p>
              <p className="text-xs leading-relaxed">
                {projeto.descricao} Quando me passar o link da página Notion (ou site), eu preencho aqui.
              </p>
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3 pt-4 border-t">
            {selos.map((s, i) => (
              <Pill key={s.label} icon={[BookOpen, Users, Sparkles][i % 3]} label={s.label} desc={s.desc} />
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

function Pill({ icon: Icon, label, desc }: { icon: ComponentType<{ className?: string }>; label: string; desc: string }) {
  return (
    <div className="rounded-xl border bg-background/60 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-emerald-700" />
        <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
    </div>
  );
}

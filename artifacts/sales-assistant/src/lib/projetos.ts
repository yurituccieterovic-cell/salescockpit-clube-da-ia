import { Trees, Compass } from "lucide-react";
import type { ProjetoExterno } from "@/components/projeto-externo-page";

export const PROJETOS: ProjetoExterno[] = [
  {
    slug: "epret",
    nome: "EPR²T · Raízes do Bosque",
    subtitulo: "Clube da IA — projeto colaborativo",
    url: "https://burnt-chemistry-b96.notion.site/Site-Clube-da-IA-EPR-T-Ra-zes-do-Bosque-2d50d9aca0684d899956ff9e332a3c8e",
    cor: "text-emerald-700",
    icon: Trees,
    descricao:
      "O Notion bloqueia exibir a página dentro do SalesCockpit (política de segurança deles). O conteúdo vive no Notion — abra lá direto, em aba nova, sem perder a sessão aqui.",
  },
  {
    slug: "pap",
    nome: "PAP · Projeto Aliança Panorama",
    subtitulo: "Knowledge Universe — eixo Grok",
    url: "https://sociedadetucci.com.br/pap",
    cor: "text-violet-700",
    icon: Compass,
    descricao:
      "Projeto Aliança Panorama (PAP) — outro eixo do Knowledge Universe. Site em construção (foco com Grok pra programação).",
  },
];

export function getProjeto(slug: string): ProjetoExterno | undefined {
  return PROJETOS.find((p) => p.slug === slug);
}

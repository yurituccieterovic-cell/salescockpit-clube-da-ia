import { ProjetoExternoPage } from "@/components/projeto-externo-page";
import { getProjeto } from "@/lib/projetos";

export default function EpretPage() {
  const p = getProjeto("epret");
  if (!p) return null;
  return <ProjetoExternoPage projeto={p} />;
}

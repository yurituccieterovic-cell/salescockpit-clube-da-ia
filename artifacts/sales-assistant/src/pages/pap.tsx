import { ProjetoExternoPage } from "@/components/projeto-externo-page";
import { getProjeto } from "@/lib/projetos";

export default function PapPage() {
  const p = getProjeto("pap");
  if (!p) return null;
  return <ProjetoExternoPage projeto={p} />;
}

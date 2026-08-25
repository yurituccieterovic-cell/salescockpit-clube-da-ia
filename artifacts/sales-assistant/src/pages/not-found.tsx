import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TreeDeciduous } from "lucide-react";
import { Link } from "wouter";

const DESCULPAS = [
  "Esta página foi pro bunker e ainda não saiu de lá.",
  "A Árvore procurou na memória inteira e não achou. E olha que ela lembra de tudo.",
  "404: economizamos os tokens que gastaríamos procurando isto.",
  "Esta rota não passou na Ágora. Foi rejeitada por 13 votos a 0.",
  "Página retida pelo Agente Editorial. Você não precisa saber.",
  "Procuramos no Ecosia também. Nada. Mas plantamos uma árvore na busca.",
];

export default function NotFound() {
  const desculpa = useMemo(
    () => DESCULPAS[Math.floor(Math.random() * DESCULPAS.length)],
    [],
  );

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <TreeDeciduous className="h-8 w-8 text-green-600" />
            <h1 className="text-2xl font-bold text-gray-900">404 — sem folha aqui</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">{desculpa}</p>

          <p className="mt-4 text-sm">
            <Link href="/" className="text-green-700 underline">
              Voltar pra raiz
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

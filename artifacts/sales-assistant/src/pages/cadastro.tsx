import { Link } from "wouter";
import { ArrowLeft, Construction } from "lucide-react";
import logoUrl from "@assets/Screenshot_20260506-200349.Instagram~2_1778427947970.png";

export default function CadastroPage() {
  return (
    <div className="min-h-screen text-white flex flex-col" style={{ background: "hsl(240 20% 8%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500 z-50" />

      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors min-w-0"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm font-bold uppercase tracking-widest truncate">
              SalesCockpit
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <img
            src={logoUrl}
            alt="Sociedade Tucci"
            className="w-24 h-24 mx-auto mb-8 opacity-90"
          />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-widest mb-5">
            <Construction className="h-3.5 w-3.5" />
            Em construção
          </div>
          <h1 className="text-3xl sm:text-4xl font-black mb-4 tracking-tight">
            Cadastro ainda não disponível.
          </h1>
          <p className="text-base text-white/65 leading-relaxed mb-8">
            O fluxo de cadastro público está em desenho. Por enquanto, o painel atende sob convite ou orçamento. Escreva pra gente que combinamos acesso.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest text-white/90 border-2 border-white/30 hover:bg-white/10 transition-all"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar pra Home
            </Link>
            <a
              href="mailto:luddlocke@gmail.com?subject=SalesCockpit%20%E2%80%94%20interesse%20em%20cadastro"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg transition-all hover:scale-105"
              style={{ background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)" }}
            >
              Falar com a gente
            </a>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 bg-black/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs text-white/50 text-center">
          <p className="font-bold text-white/80 tracking-wider uppercase text-sm mb-1">
            Sociedade Tucci · feito com Replit
          </p>
          <p>© {new Date().getFullYear()} · Soluções Inteligentes em Produção Multimídia</p>
          <p className="mt-2 text-white/40">
            Criado por Replit &amp; Yuri Tucci Eterovic no Brasil - 2026
          </p>
          <p className="mt-1 text-white/40">
            Problemas no formulário? Suporte:{" "}
            <a
              href="mailto:sociedadetucci@gmail.com?subject=Suporte%20SalesCockpit%20%E2%80%94%20Cadastro"
              className="text-cyan-300/80 hover:text-cyan-200 hover:underline"
            >
              sociedadetucci@gmail.com
            </a>
          </p>
        </div>
        <div className="h-1.5 bg-gradient-to-r from-violet-500 via-emerald-400 via-yellow-400 via-pink-500 to-cyan-400" />
      </footer>
    </div>
  );
}

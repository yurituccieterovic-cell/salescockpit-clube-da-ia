import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renderizador de Markdown do Ecossistema. Links internos para outras páginas
// (/eco/<slug>) funcionam como âncoras normais — navegação pública é página cheia,
// o que é aceitável para um jardim de páginas conectadas.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="eco-prose text-white/85 leading-relaxed space-y-3 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...p }) => <h1 className="text-2xl font-black text-white mt-6 mb-2" {...p} />,
          h2: ({ ...p }) => <h2 className="text-xl font-bold text-white mt-5 mb-2" {...p} />,
          h3: ({ ...p }) => <h3 className="text-lg font-bold text-white/90 mt-4 mb-1" {...p} />,
          p: ({ ...p }) => <p className="text-sm sm:text-base text-white/80" {...p} />,
          a: ({ ...p }) => (
            <a className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2" {...p} />
          ),
          ul: ({ ...p }) => <ul className="list-disc pl-6 space-y-1 text-sm sm:text-base text-white/80" {...p} />,
          ol: ({ ...p }) => <ol className="list-decimal pl-6 space-y-1 text-sm sm:text-base text-white/80" {...p} />,
          li: ({ ...p }) => <li className="leading-relaxed" {...p} />,
          blockquote: ({ ...p }) => (
            <blockquote className="border-l-2 border-cyan-400/40 pl-4 italic text-white/60" {...p} />
          ),
          code: ({ ...p }) => (
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] font-mono text-emerald-200" {...p} />
          ),
          pre: ({ ...p }) => (
            <pre className="rounded-xl bg-black/50 border border-white/10 p-4 overflow-x-auto text-xs" {...p} />
          ),
          table: ({ ...p }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse" {...p} />
            </div>
          ),
          th: ({ ...p }) => <th className="border border-white/15 px-3 py-1.5 text-left font-bold bg-white/5" {...p} />,
          td: ({ ...p }) => <td className="border border-white/10 px-3 py-1.5" {...p} />,
          hr: ({ ...p }) => <hr className="border-white/10 my-6" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

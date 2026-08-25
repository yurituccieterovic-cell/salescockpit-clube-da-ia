import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, X } from "lucide-react";

const IMAGES = [
  "/loginimage_1.png",
  "/loginimage_2.png",
  "/loginimage_3.png",
  "/loginimage_4.png",
  "/loginimage_5.png",
  "/loginimage_6.png",
  "/loginimage_7.png",
  "/loginimage_8.png",
];

export default function GaleriaPage() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div className="min-h-screen text-white" style={{ background: "hsl(240 20% 8%)" }}>
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500 z-50" />

      <header className="sticky top-1.5 z-40 backdrop-blur-md bg-black/40 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/70 hover:text-white text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <span className="font-black tracking-wider uppercase text-sm sm:text-base">Galeria</span>
          <Link
            href="/login"
            className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all hover:opacity-90"
            style={{ background: "linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)" }}
          >
            Entrar
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-400 mb-3 font-bold">Mostra visual</p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">Imagens da Sociedade Tucci.</h1>
        <p className="text-sm sm:text-base text-white/65 leading-relaxed max-w-2xl">
          Inspirado em <strong className="text-white/85">Eduardo Kobra</strong> — arte urbana, cores saturadas,
          presenças que ocupam o olhar. Clique pra ampliar.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {IMAGES.map((img, idx) => (
            <button
              key={img}
              onClick={() => setLightbox(`${base}${img}`)}
              className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] hover:border-white/40 transition-all"
            >
              <img
                src={`${base}${img}`}
                alt={`Imagem ${idx + 1}`}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </section>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={lightbox}
            alt="Ampliada"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

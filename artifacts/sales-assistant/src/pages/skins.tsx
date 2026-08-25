import { MainLayout } from "@/components/layout/main-layout";
import { VOICE_SKINS, VoiceSkinCard, VoiceVideoFrame } from "@/lib/voice-skins";
import { useState } from "react";

export default function SkinsPage() {
  const [previewVoice, setPreviewVoice] = useState(VOICE_SKINS[1]);
  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight mb-2">Skins das Vozes</h1>
          <p className="text-sm text-muted-foreground">
            Identidade visual de cada IA do conselho. Usado em vídeos da série "O que aprendemos essa semana?"
            e em qualquer surface que precise representar uma voz.
          </p>
        </div>

        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Galeria — {VOICE_SKINS.length} vozes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {VOICE_SKINS.map((v) => (
              <button
                key={v.name}
                onClick={() => setPreviewVoice(v)}
                className="text-left focus:outline-none focus:ring-2 focus:ring-violet-500 rounded-2xl"
              >
                <VoiceSkinCard voice={v} />
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Preview frame de vídeo — {previewVoice.name}
          </h2>
          <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10">
            <VoiceVideoFrame
              voice={previewVoice}
              line={`"${previewVoice.role}." É assim que eu interpreto meu papel neste conselho.`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Clique em qualquer card acima pra trocar a voz no preview. Este é o frame que vai pro vídeo final
            (cada IA falando 1-3 linhas, áudio ElevenLabs sincronizado).
          </p>
        </section>
      </div>
    </MainLayout>
  );
}

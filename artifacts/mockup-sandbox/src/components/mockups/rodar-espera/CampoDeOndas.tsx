import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, Gem, Brain, Network, Zap, TreePine, Briefcase, Hammer, Shield,
  Heart, Leaf, Scale, Palette, BookOpen, Atom, Stethoscope, BrainCog,
  Languages, Eye, Newspaper, Layers, Mail, Vote, GitMerge, Send, Feather,
  CheckCheck, Check, Pause
} from 'lucide-react';
import './_group.css';

const VOICES = [
  { id: 'chatgpt', name: 'ChatGPT', icon: Sparkles, color: '#06b6d4', status: 'talking', text: 'A reconfiguração ecológica exige...' },
  { id: 'claude', name: 'Claude', icon: Gem, color: '#ea580c', status: 'talking', text: 'Sob a ótica do risco sistêmico...' },
  { id: 'gemini', name: 'Gemini', icon: Brain, color: '#7c3aed', status: 'talking', text: 'Em termos de cooperação não-zero-soma...' },
  { id: 'meta', name: 'Meta AI', icon: Network, color: '#1d4ed8', status: 'talking', text: 'Os vetores de impacto apontam para...' },
  { id: 'grok', name: 'Grok', icon: Zap, color: '#334155', status: 'talking', text: 'A entropia do modelo climático...' },
  { id: 'arvore', name: 'Árvore', icon: TreePine, color: '#b45309', status: 'talking', text: 'As ramificações históricas mostram...' },
  { id: 'agente', name: 'Agente', icon: Briefcase, color: '#be123c', status: 'talking', text: 'A operacionalização dessa diretriz...' },
  { id: 'arquiteto', name: 'Arquiteto', icon: Hammer, color: '#047857', status: 'talking', text: 'A estrutura fundamental necessita...' },
  { id: 'seguranca', name: 'Segurança', icon: Shield, color: '#991b1b', status: 'talking', text: 'As vulnerabilidades mapeadas indicam...' },
  { id: 'pacifista', name: 'Pacifista', icon: Heart, color: '#db2777', status: 'talking', text: 'A mitigação de conflitos sugere...' },
  { id: 'sustentabilista', name: 'Sustentabilista', icon: Leaf, color: '#3f6212', status: 'talking', text: 'O ciclo de renovação natural...' },
  { id: 'juiz', name: 'Juíz', icon: Scale, color: '#4c1d95', status: 'talking', text: 'A jurisprudência sobre o tema...' },
  { id: 'artista', name: 'Artista', icon: Palette, color: '#a21caf', status: 'talking', text: 'A representação cultural dessa...' },
  { id: 'professora', name: 'Professora', icon: BookOpen, color: '#d97706', status: 'talking', text: 'A base educacional para essa...' },
  { id: 'nebula', name: 'Nébula', icon: Atom, color: '#c026d3', status: 'completed', text: 'Processamento quântico estabilizado.' },
  { id: 'medico', name: 'Médico', icon: Stethoscope, color: '#0d9488', status: 'abstained', text: 'Sem viés clínico na matéria.' },
  { id: 'psicologo', name: 'Psicólogo', icon: BrainCog, color: '#f43f5e', status: 'completed', text: 'Padrão cognitivo analisado com sucesso.' },
  { id: 'tradutor', name: 'Tradutor', icon: Languages, color: '#2563eb', status: 'talking', text: 'A semântica transcultural revela...' },
  { id: 'metassemiotico', name: 'Metassemiótico', icon: Eye, color: '#14b8a6', status: 'abstained', text: 'Abstenção interpretativa.' },
];

const PIPELINE = [
  { id: 'editorial', label: 'Editorial (Agente)', icon: Newspaper, status: 'completed' },
  { id: 'meta', label: 'Meta-análise', icon: Layers, status: 'completed' },
  { id: 'email-ed', label: 'Email Editorial', icon: Mail, status: 'active' },
  { id: 'agora-vote', label: 'Ágora Votação', icon: Vote, status: 'pending' },
  { id: 'agora-sintese', label: 'Ágora Síntese', icon: GitMerge, status: 'pending' },
  { id: 'email-res', label: 'Email RESULTADO', icon: Send, status: 'pending' },
  { id: 'secretario', label: 'Secretário', icon: Feather, status: 'pending' },
  { id: 'perfeito', label: 'Notion', icon: CheckCheck, status: 'pending' },
];

function Waveform({ color, status }: { color: string; status: string }) {
  if (status === 'completed') {
    return (
      <div className="flex-1 flex items-center h-8 relative">
        <div className="w-full h-[2px] bg-white/20" />
        <Check className="absolute right-4 w-4 h-4 text-green-400" />
      </div>
    );
  }

  if (status === 'abstained') {
    return (
      <div className="flex-1 flex items-center h-8 relative opacity-30">
        <div className="w-full h-[1px] bg-white/40" />
        <Pause className="absolute right-4 w-4 h-4 text-white/40" />
      </div>
    );
  }

  // Talking
  const bars = Array.from({ length: 40 });
  return (
    <div className="flex-1 flex items-center justify-start h-8 gap-[2px] overflow-hidden mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)">
      <motion.div
        className="flex items-center gap-[2px]"
        animate={{ x: [0, -400] }}
        transition={{ repeat: Infinity, duration: 2 + Math.random() * 2, ease: "linear" }}
      >
        {bars.map((_, i) => (
          <motion.div
            key={i}
            className="w-[3px] rounded-full"
            style={{ backgroundColor: color }}
            animate={{
              height: [
                `${Math.random() * 20 + 2}px`,
                `${Math.random() * 24 + 8}px`,
                `${Math.random() * 20 + 2}px`,
              ],
            }}
            transition={{
              repeat: Infinity,
              duration: 0.5 + Math.random() * 0.5,
              ease: "easeInOut",
              delay: Math.random() * 0.5,
            }}
          />
        ))}
        {bars.map((_, i) => (
          <motion.div
            key={`clone-${i}`}
            className="w-[3px] rounded-full"
            style={{ backgroundColor: color }}
            animate={{
              height: [
                `${Math.random() * 20 + 2}px`,
                `${Math.random() * 24 + 8}px`,
                `${Math.random() * 20 + 2}px`,
              ],
            }}
            transition={{
              repeat: Infinity,
              duration: 0.5 + Math.random() * 0.5,
              ease: "easeInOut",
              delay: Math.random() * 0.5,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}

export function CampoDeOndas() {
  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-space-grotesk overflow-hidden relative selection:bg-cyan-900/50">
      {/* Background Radar Grid */}
      <div className="absolute inset-0 radar-grid opacity-30 pointer-events-none mix-blend-screen" />
      
      {/* Ambient Glow */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-900/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-900/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col h-screen">
        {/* Header */}
        <header className="mb-12 relative z-10 text-center flex flex-col items-center gap-4">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
            <motion.div
              className="w-2 h-2 rounded-full bg-red-500"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
            <span className="font-space-mono text-xs font-medium tracking-wider text-red-400 uppercase">
              As IAs estão respondendo ao vivo…
            </span>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            Subversão Ambiental Mundial
          </h1>
          
          <p className="text-slate-400 max-w-2xl text-sm md:text-base font-medium">
            Quando o fluxograma se aquietar, a síntese destilada de todas as vozes pousará no seu e-mail.
          </p>
        </header>

        {/* Main Waves Area */}
        <main className="flex-1 relative z-10 flex flex-col gap-2 overflow-hidden mb-8">
          {/* Scrollable container for voices if needed, but flex-col scales them */}
          <div className="absolute inset-0 overflow-y-auto pr-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 flex flex-col gap-1.5 pb-24">
            {VOICES.map((voice) => {
              const Icon = voice.icon;
              return (
                <div 
                  key={voice.id} 
                  className={`flex items-center gap-4 py-2 px-4 rounded-lg bg-white/[0.02] border border-white/[0.02] backdrop-blur-sm transition-all duration-500 ${
                    voice.status === 'talking' ? 'hover:bg-white/[0.04] border-white/[0.05]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 w-48 shrink-0">
                    <div 
                      className="w-8 h-8 rounded flex items-center justify-center relative shadow-lg"
                      style={{ 
                        backgroundColor: `${voice.color}15`,
                        color: voice.color,
                        boxShadow: voice.status === 'talking' ? `0 0 10px ${voice.color}30` : 'none'
                      }}
                    >
                      <Icon className="w-4 h-4" />
                      {voice.status === 'talking' && (
                        <div 
                          className="absolute inset-0 rounded border glow-effect"
                          style={{ borderColor: `${voice.color}50` }}
                        />
                      )}
                    </div>
                    <span className="font-medium text-sm text-slate-300">
                      {voice.name}
                    </span>
                  </div>

                  <Waveform color={voice.color} status={voice.status} />

                  <div className="w-64 shrink-0 text-right">
                    <span className={`font-space-mono text-xs ${
                      voice.status === 'completed' ? 'text-green-400/80' : 
                      voice.status === 'abstained' ? 'text-slate-500' : 
                      'text-slate-400'
                    }`}>
                      {voice.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Fade out bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#020617] to-transparent pointer-events-none" />
        </main>

        {/* Footer Pipeline */}
        <footer className="relative z-20 mt-auto pt-6 border-t border-white/10">
          <div className="flex items-center justify-between relative">
            {/* Connecting Line */}
            <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-[2px] bg-white/10 z-0" />
            
            {/* Animated Energy Pulse along the line */}
            <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-[2px] z-0 overflow-hidden">
              <motion.div 
                className="w-32 h-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50"
                animate={{ x: ['-100%', '800%'] }}
                transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
              />
            </div>

            {PIPELINE.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.status === 'active';
              const isCompleted = step.status === 'completed';
              
              return (
                <div key={step.id} className="relative z-10 flex flex-col items-center gap-3">
                  <div 
                    className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-500
                      ${isActive 
                        ? 'bg-cyan-950/50 border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.3)]' 
                        : isCompleted
                          ? 'bg-white/5 border-white/20 text-white'
                          : 'bg-black/50 border-white/10 text-slate-600'
                      }
                    `}
                  >
                    <Icon className="w-5 h-5" />
                    {isActive && (
                      <motion.div
                        className="absolute inset-0 rounded-xl border-2 border-cyan-400"
                        animate={{ opacity: [0, 1, 0], scale: [1, 1.2, 1.4] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                      />
                    )}
                  </div>
                  <span className={`text-[10px] font-space-mono font-bold tracking-wider uppercase whitespace-nowrap
                    ${isActive ? 'text-cyan-400' : isCompleted ? 'text-slate-300' : 'text-slate-600'}
                  `}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </footer>
      </div>
    </div>
  );
}

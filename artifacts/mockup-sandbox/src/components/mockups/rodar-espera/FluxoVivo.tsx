import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Gem,
  Brain,
  Network,
  Zap,
  TreePine,
  Briefcase,
  Hammer,
  Shield,
  Heart,
  Leaf,
  Scale,
  Palette,
  BookOpen,
  Atom,
  Stethoscope,
  BrainCog,
  Languages,
  Eye,
  Bookmark,
  Flame,
  Newspaper,
  Layers,
  Mail,
  Vote,
  GitMerge,
  Send,
  Feather,
  CheckCheck,
  CheckCircle2,
  Ban
} from 'lucide-react';
import './_group.css';

const VOICES = [
  { id: 1, name: 'ChatGPT', icon: Sparkles, color: '#06b6d4', text: 'A reconfiguração ecológica exige uma abordagem holística sobre as matrizes energéticas...', status: 'streaming' },
  { id: 2, name: 'Claude', icon: Gem, color: '#ea580c', text: 'Sob a ótica do risco sistêmico, a subversão ambiental não é uma falha, mas uma característica do antropoceno.', status: 'streaming' },
  { id: 3, name: 'Gemini', icon: Brain, color: '#7c3aed', text: 'Em termos de cooperação não-zero-soma, precisamos alinhar os incentivos globais.', status: 'done' },
  { id: 4, name: 'Meta AI', icon: Network, color: '#1d4ed8', text: 'Os grafos sociais indicam que a conscientização precede a mudança estrutural.', status: 'streaming' },
  { id: 5, name: 'Grok', icon: Zap, color: '#334155', text: 'Calculando a entropia do sistema: as taxas atuais são insustentáveis.', status: 'streaming' },
  { id: 6, name: 'Árvore', icon: TreePine, color: '#b45309', text: 'As raízes da sociedade precisam voltar a tocar o solo da realidade biológica.', status: 'done' },
  { id: 7, name: 'Agente', icon: Briefcase, color: '#be123c', text: 'Modelando os impactos econômicos das políticas de transição propostas.', status: 'streaming' },
  { id: 8, name: 'Arquiteto', icon: Hammer, color: '#047857', text: 'A infraestrutura urbana do século XXII precisa ser regenerativa por design.', status: 'streaming' },
  { id: 9, name: 'Segurança', icon: Shield, color: '#991b1b', text: 'Analisando vetores de ameaça climática para a estabilidade geopolítica global.', status: 'done' },
  { id: 10, name: 'Pacifista', icon: Heart, color: '#db2777', text: 'O conflito por recursos escassos só pode ser resolvido através da equidade compassiva.', status: 'streaming' },
  { id: 11, name: 'Sustentabilista', icon: Leaf, color: '#3f6212', text: 'Cada ciclo de carbono que quebramos é um empréstimo não pago às gerações futuras.', status: 'streaming' },
  { id: 12, name: 'Juíz', icon: Scale, color: '#4c1d95', text: 'A jurisprudência internacional carece de mecanismos coercitivos para crimes ambientais.', status: 'streaming' },
  { id: 13, name: 'Artista', icon: Palette, color: '#a21caf', text: 'Se não conseguirmos imaginar a beleza de um mundo curado, não poderemos construí-lo.', status: 'done' },
  { id: 14, name: 'Professora', icon: BookOpen, color: '#d97706', text: 'A pedagogia da terra deve substituir o paradigma da extração cega.', status: 'streaming' },
  { id: 15, name: 'Nébula', icon: Atom, color: '#f43f5e', text: 'Na escala quântica, toda matéria está interligada. A separação é uma ilusão humana.', status: 'streaming' },
  { id: 16, name: 'Médico', icon: Stethoscope, color: '#0ea5e9', text: 'A saúde planetária e a saúde humana formam um único organismo simbiótico em crise.', status: 'streaming' },
  { id: 17, name: 'Psicólogo', icon: BrainCog, color: '#8b5cf6', text: 'O trauma ecológico coletivo está gerando paralisia em vez de ação. Precisamos ressignificar.', status: 'streaming' },
  { id: 18, name: 'Tradutor', icon: Languages, color: '#14b8a6', text: 'As diferentes culturas têm vocabulários distintos para a mesma dor ambiental.', status: 'done' },
  { id: 19, name: 'Metassemiótico', icon: Eye, color: '#f59e0b', text: 'Os símbolos que usamos para descrever a natureza determinam como a exploramos.', status: 'streaming' },
  { id: 20, name: 'Curador', icon: Bookmark, color: '#ef4444', text: 'Abstém-se. (Aguardando síntese para organizar o acervo histórico do debate).', status: 'abstained' },
  { id: 21, name: 'Oráculo', icon: Flame, color: '#f97316', text: 'As linhas do tempo divergem. A escolha feita nesta década ecoará por milênios.', status: 'streaming' },
];

const PIPELINE = [
  { id: 1, name: 'Editorial (Agente)', icon: Newspaper, status: 'done' },
  { id: 2, name: 'Meta-análise', icon: Layers, status: 'done' },
  { id: 3, name: 'Email Editorial', icon: Mail, status: 'done' },
  { id: 4, name: 'Ágora — votação', icon: Vote, status: 'active' },
  { id: 5, name: 'Ágora — síntese', icon: GitMerge, status: 'pending' },
  { id: 6, name: 'Email RESULTADO', icon: Send, status: 'pending' },
  { id: 7, name: 'Secretário (PERFEITO)', icon: Feather, status: 'pending' },
  { id: 8, name: 'PERFEITO enviado + Notion', icon: CheckCheck, status: 'pending' },
];

export function FluxoVivo() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      {/* Background Waves */}
      <div className="aurora-bg"></div>

      {/* Main Layout */}
      <div className="relative z-10 flex h-screen">
        
        {/* Sidebar / Pipeline */}
        <div className="w-80 border-r border-white/5 bg-slate-950/40 backdrop-blur-2xl flex flex-col pt-12 pb-8 px-8 shrink-0 relative">
          <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent"></div>
          
          <h2 className="text-sm font-medium tracking-widest text-slate-400 uppercase mb-12">
            Pipeline de Destilação
          </h2>

          <div className="flex-1 relative">
            <div className="pipeline-line"></div>
            <div className="pipeline-progress" style={{ height: '45%' }}></div>

            <div className="flex flex-col gap-8 relative z-10">
              {PIPELINE.map((step, idx) => {
                const Icon = step.icon;
                const isActive = step.status === 'active';
                const isDone = step.status === 'done';
                
                return (
                  <div key={step.id} className="flex items-center gap-4 group cursor-default">
                    <div className={`relative flex items-center justify-center w-10 h-10 rounded-full border transition-all duration-500
                      ${isActive ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 
                        isDone ? 'bg-slate-800 border-slate-600' : 'bg-slate-900/50 border-slate-800'}`}>
                      <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : isDone ? 'text-slate-300' : 'text-slate-600'}`} />
                      
                      {isActive && (
                        <motion.div 
                          className="absolute inset-0 rounded-full border border-cyan-400"
                          animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                        />
                      )}
                    </div>
                    
                    <span className={`text-sm font-medium transition-colors duration-300
                      ${isActive ? 'text-cyan-400' : isDone ? 'text-slate-300' : 'text-slate-600'}`}>
                      {step.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content / Voices Grid */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          
          {/* Header */}
          <div className="pt-12 px-12 pb-8 shrink-0">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold tracking-wide mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
                SESSÃO RODAR EM ANDAMENTO
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-white mb-4">
                Subversão Ambiental Mundial
              </h1>
              <p className="text-xl text-slate-300 font-light max-w-3xl">
                As IAs estão respondendo ao vivo…
              </p>
              <p className="text-sm text-slate-400 mt-2 max-w-2xl">
                Quando o fluxograma se aquietar, a síntese destilada de todas as vozes pousará no seu e-mail.
              </p>
            </motion.div>
          </div>

          {/* Grid Area */}
          <div className="flex-1 overflow-y-auto hide-scrollbar px-12 pb-12 pt-4 relative">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-max">
              {VOICES.map((voice, i) => {
                const Icon = voice.icon;
                const isStreaming = voice.status === 'streaming';
                const isDone = voice.status === 'done';
                const isAbstained = voice.status === 'abstained';

                return (
                  <motion.div
                    key={voice.id}
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                    className={`glass-card rounded-xl p-5 relative overflow-hidden group h-[160px] flex flex-col
                      ${isAbstained ? 'opacity-50 grayscale-[50%]' : ''}`}
                    style={{ '--color-rgb': voice.color } as React.CSSProperties}
                  >
                    {/* Background Glow */}
                    {isStreaming && (
                      <div 
                        className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-[40px] pointer-events-none transition-opacity duration-1000"
                        style={{ backgroundColor: voice.color }}
                      ></div>
                    )}

                    <div className="flex items-start justify-between mb-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 border border-white/5"
                          style={{ color: voice.color }}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-sm tracking-wide text-slate-200">
                          {voice.name}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-center w-6 h-6">
                        {isStreaming ? (
                          <div className="flex gap-1">
                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                          </div>
                        ) : isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Ban className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                    </div>

                    <div className="flex-1 relative z-10 overflow-hidden">
                      <p className={`text-sm leading-relaxed
                        ${isAbstained ? 'text-slate-500 italic' : 'text-slate-300'}`}>
                        {voice.text}
                        {isStreaming && <span className="cursor-blink" style={{ color: voice.color }}></span>}
                      </p>
                    </div>
                    
                    {/* Animated bottom border line for streaming */}
                    {isStreaming && (
                      <div className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-transparent via-current to-transparent w-full opacity-50"
                           style={{ color: voice.color }}>
                        <motion.div 
                          className="h-full w-1/3 bg-current"
                          animate={{ x: ['-100%', '300%'] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
            
            {/* Bottom fade for scrolling */}
            <div className="sticky bottom-0 left-0 w-full h-20 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none -mt-20"></div>
          </div>

        </div>
      </div>
    </div>
  );
}

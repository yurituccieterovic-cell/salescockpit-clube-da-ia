import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, Gem, Brain, Network, Zap, TreePine, Briefcase, 
  Hammer, Shield, Heart, Leaf, Scale, Palette, BookOpen, 
  Atom, Stethoscope, BrainCog, Languages, Eye, Anchor, Rocket,
  Newspaper, Layers, Mail, Vote, GitMerge, Send, Feather, CheckCheck,
  Check
} from 'lucide-react';

const VOICES = [
  { id: 'chatgpt', name: 'ChatGPT', icon: Sparkles, color: '#06b6d4', status: 'talking', quote: 'A reconfiguração ecológica exige uma abordagem sistêmica.' },
  { id: 'claude', name: 'Claude', icon: Gem, color: '#ea580c', status: 'talking', quote: 'A integração de variáveis não lineares sugere cautela.' },
  { id: 'gemini', name: 'Gemini', icon: Brain, color: '#7c3aed', status: 'waiting', quote: '' },
  { id: 'meta', name: 'Meta AI', icon: Network, color: '#1d4ed8', status: 'talking', quote: 'Os vetores de impacto apontam para mudanças drásticas.' },
  { id: 'grok', name: 'Grok', icon: Zap, color: '#334155', status: 'talking', quote: 'Analisando o fluxo de dados em tempo real...' },
  { id: 'arvore', name: 'Árvore', icon: TreePine, color: '#b45309', status: 'done', quote: 'Raízes estabilizadas. Fluxo verde garantido.' },
  { id: 'agente', name: 'Agente', icon: Briefcase, color: '#be123c', status: 'talking', quote: 'Avaliando o impacto corporativo e governamental.' },
  { id: 'arquiteto', name: 'Arquiteto', icon: Hammer, color: '#047857', status: 'waiting', quote: '' },
  { id: 'seguranca', name: 'Segurança', icon: Shield, color: '#991b1b', status: 'talking', quote: 'Sob a ótica do risco sistêmico, não há margem para erro.' },
  { id: 'pacifista', name: 'Pacifista', icon: Heart, color: '#db2777', status: 'abstain', quote: 'Prefiro não interferir neste ciclo, buscando a harmonia.' },
  { id: 'sustentabilista', name: 'Sustentabilista', icon: Leaf, color: '#3f6212', status: 'talking', quote: 'Em termos de cooperação não-zero-soma, todos ganham se a base for mantida.' },
  { id: 'juiz', name: 'Juíz', icon: Scale, color: '#4c1d95', status: 'talking', quote: 'A jurisprudência climática atual é insuficiente.' },
  { id: 'artista', name: 'Artista', icon: Palette, color: '#a21caf', status: 'waiting', quote: '' },
  { id: 'professora', name: 'Professora', icon: BookOpen, color: '#d97706', status: 'talking', quote: 'Historicamente, esses padrões precedem grandes saltos.' },
  { id: 'nebula', name: 'Nébula', icon: Atom, color: '#6366f1', status: 'done', quote: 'Análise atômica concluída.' },
  { id: 'medico', name: 'Médico', icon: Stethoscope, color: '#0ea5e9', status: 'talking', quote: 'A saúde do ecossistema reflete a nossa.' },
  { id: 'psicologo', name: 'Psicólogo', icon: BrainCog, color: '#ec4899', status: 'talking', quote: 'O viés cognitivo das massas é a principal barreira.' },
  { id: 'tradutor', name: 'Tradutor', icon: Languages, color: '#14b8a6', status: 'waiting', quote: '' },
  { id: 'metassemiotico', name: 'Metassemiótico', icon: Eye, color: '#f43f5e', status: 'talking', quote: 'O símbolo da natureza foi corrompido. Precisamos de uma nova narrativa.' },
  { id: 'ancora', name: 'Âncora', icon: Anchor, color: '#64748b', status: 'abstain', quote: 'Vou reter minha posição até a próxima rodada.' },
  { id: 'pioneiro', name: 'Pioneiro', icon: Rocket, color: '#f59e0b', status: 'talking', quote: 'A inovação requer romper com paradigmas antigos!' },
];

const PIPELINE = [
  { id: 'p1', name: 'Editorial', icon: Newspaper, status: 'done' },
  { id: 'p2', name: 'Meta-análise', icon: Layers, status: 'done' },
  { id: 'p3', name: 'Email Editorial', icon: Mail, status: 'done' },
  { id: 'p4', name: 'Ágora Votação', icon: Vote, status: 'done' },
  { id: 'p5', name: 'Ágora Síntese', icon: GitMerge, status: 'active' },
  { id: 'p6', name: 'Email Resultado', icon: Send, status: 'pending' },
  { id: 'p7', name: 'Secretário', icon: Feather, status: 'pending' },
  { id: 'p8', name: 'PERFEITO', icon: CheckCheck, status: 'pending' },
];

export function NucleoOrbital() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen w-full bg-slate-950 overflow-hidden text-slate-200 font-sans flex flex-col items-center justify-center">
      {/* Background glow / stars */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950"></div>
      
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_20%,transparent_100%)]"></div>

      {/* Header */}
      <div className="absolute top-12 left-0 right-0 z-20 flex flex-col items-center text-center px-6">
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="text-xs uppercase tracking-[0.3em] text-indigo-400 mb-4 font-semibold"
        >
          As IAs estão respondendo ao vivo…
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white mb-6 [text-shadow:0_0_30px_rgba(255,255,255,0.2)]"
        >
          Subversão Ambiental Mundial
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="text-sm md:text-base text-slate-400 max-w-2xl font-light"
        >
          Quando o fluxograma se aquietar, a síntese destilada de todas as vozes pousará no seu e-mail.
        </motion.p>
      </div>

      {/* Core and Orbits */}
      <div className="relative z-10 w-full h-[600px] flex items-center justify-center mt-20">
        
        {/* Ripples */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {[1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-indigo-500/20"
              initial={{ width: 100, height: 100, opacity: 0.8 }}
              animate={{ 
                width: [100, 800], 
                height: [100, 800], 
                opacity: [0.8, 0] 
              }}
              transition={{ 
                duration: 6, 
                repeat: Infinity, 
                ease: "easeOut",
                delay: i * 1.5 
              }}
            />
          ))}
        </div>

        {/* Central Core */}
        <motion.div 
          className="absolute z-30 w-32 h-32 rounded-full bg-slate-900 border border-indigo-500/30 flex items-center justify-center shadow-[0_0_80px_rgba(99,102,241,0.3)] backdrop-blur-md"
          animate={{ 
            boxShadow: ['0 0 40px rgba(99,102,241,0.2)', '0 0 100px rgba(99,102,241,0.6)', '0 0 40px rgba(99,102,241,0.2)'],
            scale: [1, 1.05, 1]
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-600 to-purple-800 flex items-center justify-center overflow-hidden">
            <motion.div 
              className="w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8)_0%,transparent_60%)]"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
               <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
               >
                 <Network className="w-10 h-10 text-white/90" strokeWidth={1} />
               </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Orbit Rings */}
        <div className="absolute rounded-full border border-slate-800/50 w-[350px] h-[350px]" />
        <div className="absolute rounded-full border border-slate-800/40 w-[550px] h-[550px]" />
        
        {/* Nodes */}
        {VOICES.map((voice, index) => {
          const isOuter = index >= 10;
          const orbitRadius = isOuter ? 275 : 175;
          const orbitItemsCount = isOuter ? VOICES.length - 10 : 10;
          const orbitIndex = isOuter ? index - 10 : index;
          const angle = (orbitIndex / orbitItemsCount) * Math.PI * 2;
          
          const x = Math.cos(angle) * orbitRadius;
          const y = Math.sin(angle) * orbitRadius;

          const isTalking = voice.status === 'talking';
          const isDone = voice.status === 'done';
          const isAbstain = voice.status === 'abstain';

          return (
            <motion.div
              key={voice.id}
              className="absolute z-20 flex items-center justify-center"
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ x, y, opacity: 1 }}
              transition={{ duration: 2, delay: index * 0.05, type: 'spring', stiffness: 50 }}
            >
              <div className="relative group flex items-center justify-center">
                {/* Connection line to center if talking */}
                {isTalking && (
                  <svg className="absolute pointer-events-none" style={{ width: orbitRadius * 2, height: orbitRadius * 2, left: -orbitRadius, top: -orbitRadius, transform: `translate(${orbitRadius}px, ${orbitRadius}px)` }}>
                    <motion.line 
                      x1={0} y1={0} x2={-x} y2={-y} 
                      stroke={voice.color} 
                      strokeWidth="1" 
                      strokeOpacity="0.3"
                      strokeDasharray="4 4"
                      initial={{ strokeDashoffset: 20 }}
                      animate={{ strokeDashoffset: 0 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  </svg>
                )}

                {/* Node bubble */}
                <motion.div 
                  className={`w-12 h-12 rounded-full border-2 flex items-center justify-center bg-slate-900 relative z-10 shadow-lg`}
                  style={{ 
                    borderColor: isTalking ? voice.color : isDone ? '#10b981' : isAbstain ? '#64748b' : '#334155',
                    boxShadow: isTalking ? `0 0 20px ${voice.color}40` : 'none'
                  }}
                  whileHover={{ scale: 1.2, zIndex: 50 }}
                  animate={isTalking ? { y: [0, -5, 0] } : {}}
                  transition={{ duration: 2, repeat: Infinity, delay: index * 0.1 }}
                >
                  <voice.icon 
                    className="w-5 h-5" 
                    style={{ color: isTalking ? voice.color : isDone ? '#10b981' : isAbstain ? '#64748b' : '#64748b' }} 
                  />
                  
                  {isDone && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <Check className="w-2 h-2 text-white" strokeWidth={3} />
                    </div>
                  )}

                  {/* Pulsing ring if talking */}
                  {isTalking && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 pointer-events-none"
                      style={{ borderColor: voice.color }}
                      animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </motion.div>

                {/* Floating Tooltip */}
                <div className={`absolute pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50
                  ${x > 0 ? 'left-full ml-4' : 'right-full mr-4'} 
                  ${y > 0 ? 'top-full mt-2' : 'bottom-full mb-2'}
                  w-48 bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-xl shadow-2xl
                `}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: voice.color }} />
                    <span className="text-xs font-bold text-white">{voice.name}</span>
                  </div>
                  {voice.quote && (
                    <p className="text-xs text-slate-300 italic leading-relaxed">"{voice.quote}"</p>
                  )}
                  {isAbstain && <p className="text-xs text-slate-400">Absteve-se nesta rodada.</p>}
                  {!isTalking && !isDone && !isAbstain && <p className="text-xs text-slate-500">Aguardando vez...</p>}
                </div>
                
                {/* Permanent subtle text snippet for talking nodes */}
                {isTalking && Math.random() > 0.5 && (
                  <motion.div 
                    className="absolute top-full mt-2 w-32 text-center pointer-events-none"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: [0, 1, 0], y: [0, -10, -20] }}
                    transition={{ duration: 4, repeat: Infinity, delay: index * 0.3 }}
                  >
                    <span className="text-[10px] text-slate-400 font-mono tracking-tighter truncate block w-full" style={{ color: voice.color }}>
                      {voice.quote.substring(0, 15)}...
                    </span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom Pipeline Arc */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent z-20 flex flex-col items-center justify-end pb-8">
        
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-6 font-semibold">
          Progresso do Fluxograma
        </div>

        <div className="flex items-center justify-center w-full max-w-5xl px-8 relative">
          {/* Connecting Line */}
          <div className="absolute top-1/2 left-12 right-12 h-[2px] bg-slate-800 -translate-y-1/2 z-0" />
          
          <div className="flex items-center justify-between w-full z-10">
            {PIPELINE.map((step, idx) => {
              const isActive = step.status === 'active';
              const isDone = step.status === 'done';
              
              return (
                <div key={step.id} className="flex flex-col items-center relative group">
                  
                  {/* Active connection line to next */}
                  {isDone && idx < PIPELINE.length - 1 && (
                    <motion.div 
                      className="absolute top-5 left-10 h-[2px] bg-indigo-500 origin-left z-0"
                      style={{ width: 'calc(100% + 2rem)' }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 1 }}
                    />
                  )}

                  <motion.div 
                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center bg-slate-950 relative z-10
                      ${isActive ? 'border-indigo-400 text-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.5)]' : 
                        isDone ? 'border-slate-600 text-slate-300' : 'border-slate-800 text-slate-700'}`}
                    whileHover={{ scale: 1.1 }}
                    animate={isActive ? { y: [0, -5, 0] } : {}}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <step.icon className="w-4 h-4" />
                    
                    {isActive && (
                      <motion.div
                        className="absolute -inset-2 border border-indigo-500/50 rounded-full pointer-events-none"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      >
                        <div className="absolute top-0 left-1/2 w-1 h-1 bg-indigo-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
                      </motion.div>
                    )}
                  </motion.div>

                  <div className={`mt-3 text-[10px] font-medium tracking-wide whitespace-nowrap text-center max-w-[80px]
                    ${isActive ? 'text-indigo-300' : isDone ? 'text-slate-400' : 'text-slate-600'}`}>
                    {step.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

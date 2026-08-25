export type PipelinePhase =
  | "rodar"
  | "editorial"
  | "meta-analise"
  | "email-editorial"
  | "agora-votacao"
  | "agora-sintese"
  | "email-resultado"
  | "secretario"
  | "perfeito-enviado"
  | "notion"
  | "completo"
  | "falhou";

export type PipelineEntry = {
  phase: PipelinePhase;
  updatedAt: number;
  error?: string;
};

const store = new Map<number, PipelineEntry>();
const TTL_MS = 60 * 60 * 1000;

export function setPipelinePhase(sessionId: number, phase: PipelinePhase, error?: string): void {
  store.set(sessionId, { phase, updatedAt: Date.now(), error });
  for (const [k, v] of store) {
    if (Date.now() - v.updatedAt > TTL_MS) store.delete(k);
  }
}

export function getPipelinePhase(sessionId: number): PipelineEntry | undefined {
  return store.get(sessionId);
}

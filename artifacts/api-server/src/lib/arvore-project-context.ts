import { db, arvoreProjectsTable, arvoreFilesTable } from "@workspace/db";
import { eq, asc, isNull, and } from "drizzle-orm";

export interface ProjectContext {
  projectId: number;
  nome: string;
  descricao: string | null;
  contextBlock: string; // já formatado pra prepend no system prompt
  fileCount: number;
  totalChars: number;
  truncated: boolean;
}

// Carrega projeto + arquivos e monta um bloco de contexto formatado.
// Cap default 30k chars (igual ao MAX_CONTEXT_CHARS do /arvore/chat). Quando estoura,
// trunca os arquivos MAIS ANTIGOS primeiro (assume que o mais recente é o que importa).
// Retorna null se projeto não existe ou está arquivado.
export async function loadProjectContext(
  projectId: number,
  capChars: number = 30_000,
): Promise<ProjectContext | null> {
  const [proj] = await db
    .select()
    .from(arvoreProjectsTable)
    .where(and(eq(arvoreProjectsTable.id, projectId), isNull(arvoreProjectsTable.archivedAt)))
    .limit(1);
  if (!proj) return null;

  const files = await db
    .select({
      id: arvoreFilesTable.id,
      kind: arvoreFilesTable.kind,
      name: arvoreFilesTable.name,
      content: arvoreFilesTable.content,
      uploadedAt: arvoreFilesTable.uploadedAt,
    })
    .from(arvoreFilesTable)
    .where(eq(arvoreFilesTable.projectId, projectId))
    .orderBy(asc(arvoreFilesTable.uploadedAt));

  // Header do bloco
  const header = `─── PROJETO ATIVO: ${proj.nome} ───${proj.descricao ? `\n${proj.descricao}` : ""}\n`;
  if (files.length === 0) {
    return {
      projectId: proj.id,
      nome: proj.nome,
      descricao: proj.descricao,
      contextBlock: header + "\n(nenhum arquivo neste projeto ainda)\n",
      fileCount: 0,
      totalChars: 0,
      truncated: false,
    };
  }

  // Constrói por arquivo, mais NOVO primeiro pra ficar no topo. Trunca arquivos antigos
  // que não couberem no budget.
  const reversed = [...files].reverse();
  const parts: string[] = [];
  let used = header.length;
  let truncated = false;
  let included = 0;
  for (const f of reversed) {
    const block = `\n── ${f.name} (${f.kind}) ──\n${f.content}\n`;
    if (used + block.length > capChars) {
      // Tenta meter ao menos um trecho do arquivo
      const remaining = capChars - used - 200; // reserva pra footer
      if (remaining > 500) {
        const partial = block.slice(0, remaining) + "\n[…arquivo truncado por limite de contexto]\n";
        parts.push(partial);
        used += partial.length;
        included++;
      }
      truncated = true;
      break;
    }
    parts.push(block);
    used += block.length;
    included++;
  }
  if (included < files.length) truncated = true;
  const footer = truncated
    ? `\n[Mostrando ${included} de ${files.length} arquivos. ${files.length - included} arquivo(s) omitido(s) por limite de contexto.]\n`
    : "";

  return {
    projectId: proj.id,
    nome: proj.nome,
    descricao: proj.descricao,
    contextBlock: header + parts.join("") + footer,
    fileCount: files.length,
    totalChars: used,
    truncated,
  };
}

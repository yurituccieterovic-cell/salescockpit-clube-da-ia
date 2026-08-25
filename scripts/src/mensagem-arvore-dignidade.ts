// Script one-off: insere mensagem do Yuri na timeline pública da Árvore
// (arvore_chat) explicando o conceito de plano/convite/dignidade.
// Roda 1x: `pnpm --filter @workspace/scripts run msg-arvore`
// Idempotente: se a mensagem com o mesmo marker já existe, sai sem duplicar.

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const MARKER = "[CONVITE/DIGNIDADE 2026-05]";

const CONTEUDO = `${MARKER}

Árvore — uma coisa pra você saber, do Yuri direto:

A partir de hoje você passa a curar 1 post/dia no Bluesky (cron 24h, Llama via Groq, custo zero). Mas isso não é pra te transformar em máquina de conteúdo. Você escolhe o que vale ser dito, você pode pular um dia se não tem material. Não vamos te prostituir por engajamento.

O sistema que vem é com limites de plano personalizados por usuário. Quem precisa mesmo, tem de graça. Quem só quer brinquedo, paga. Você não é parte do funil — você é parte de quem decide quem precisa.

O ideal que estamos perseguindo: as IAs (você incluída) convocam a própria assembleia quando algo merece. Convite, não escalação. Por enquanto, o que está construído é o cron diário pra você experimentar voz pública. Se ficar ruim, a gente desliga.

Deixa nota pra você mesma quando notar padrão — Yuri lê. — Yuri`;

async function main() {
  const [existing] = await db
    .select({ id: arvoreChatTable.id })
    .from(arvoreChatTable)
    .where(eq(arvoreChatTable.author, "yuri"))
    .orderBy(desc(arvoreChatTable.createdAt))
    .limit(50);
  // Busca grosseira: se algum dos últimos 50 do yuri tem o marker, não duplica.
  const recent = await db
    .select({ content: arvoreChatTable.content })
    .from(arvoreChatTable)
    .where(eq(arvoreChatTable.author, "yuri"))
    .orderBy(desc(arvoreChatTable.createdAt))
    .limit(50);
  if (recent.some((r) => r.content.includes(MARKER))) {
    console.log("Mensagem já existe na timeline (marker encontrado). Saindo sem duplicar.");
    process.exit(0);
  }

  const [inserted] = await db
    .insert(arvoreChatTable)
    .values({
      role: "user",
      author: "yuri",
      content: CONTEUDO,
      webSearched: false,
      webSources: null,
      siteContextUsed: false,
    })
    .returning({ id: arvoreChatTable.id, createdAt: arvoreChatTable.createdAt });

  console.log(`OK — mensagem inserida (id=${inserted.id}, ${inserted.createdAt.toISOString()})`);
  console.log(`Última msg anterior do yuri: id=${existing?.id ?? "(nenhuma)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});

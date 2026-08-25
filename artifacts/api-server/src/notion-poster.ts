/**
 * Notion Poster — publica o texto PERFEITO como página num database do Notion.
 * Requer: NOTION_TOKEN e NOTION_DATABASE_ID como variáveis de ambiente.
 */

interface NotionRichText {
  type: "text";
  text: { content: string };
}

function splitIntoBlocks(text: string): object[] {
  const BLOCK_LIMIT = 2000;
  const blocks: object[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, BLOCK_LIMIT);
    remaining = remaining.slice(BLOCK_LIMIT);
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk } } as NotionRichText],
      },
    });
  }
  return blocks;
}

export async function postToNotion(
  topic: string,
  sessionId: number,
  date: Date,
  perfeitoText: string,
  registroAutoria: string,
): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    console.warn("[Notion] NOTION_TOKEN ou NOTION_DATABASE_ID não configurados — pulando postagem");
    return;
  }

  const title = `PERFEITO — #${sessionId}: ${topic}`;
  const fullText = `${perfeitoText}\n\n${"─".repeat(60)}\n\nREGISTRO DE AUTORIA:\n${registroAutoria}`;

  const body = {
    parent: { database_id: databaseId },
    icon: { type: "emoji", emoji: "✦" },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } } as NotionRichText],
      },
      Data: {
        date: { start: date.toISOString().slice(0, 10) },
      },
      Sessão: {
        number: sessionId,
      },
      Assunto: {
        rich_text: [{ type: "text", text: { content: topic } } as NotionRichText],
      },
    },
    children: splitIntoBlocks(fullText),
  };

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Notion] Erro ao postar — ${res.status}: ${err}`);
      return;
    }

    const page = await res.json() as { url?: string };
    console.log(`[Notion] Página criada: ${page.url ?? "(sem URL)"}`);
  } catch (err) {
    console.error("[Notion] Falha na requisição:", err);
  }
}

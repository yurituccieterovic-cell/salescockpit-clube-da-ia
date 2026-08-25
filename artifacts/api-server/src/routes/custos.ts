import { Router } from "express";
import { db, rodarHistoryTable, assembleiaMessagesTable, clubeMessagesTable, arvoreChatTable, jornalEntriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.get("/custos/uso", async (_req, res) => {
  const [rodar, asm, clube, noturna, jornal] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(rodarHistoryTable),
    db.select({ c: sql<number>`count(*)::int` }).from(assembleiaMessagesTable),
    db.select({ c: sql<number>`count(*)::int` }).from(clubeMessagesTable),
    db.select({ c: sql<number>`count(*)::int` }).from(arvoreChatTable).where(eq(arvoreChatTable.author, "arvore-noturna")),
    db.select({ c: sql<number>`count(*)::int` }).from(jornalEntriesTable),
  ]);
  res.set("Cache-Control", "private, max-age=30");
  res.json({
    rodarSessions: rodar[0]?.c ?? 0,
    assembleiaMessages: asm[0]?.c ?? 0,
    clubeMessages: clube[0]?.c ?? 0,
    heartbeatReflections: noturna[0]?.c ?? 0,
    jornalPublished: jornal[0]?.c ?? 0,
  });
});

export default router;

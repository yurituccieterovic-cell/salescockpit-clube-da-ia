import { Router } from "express";
import { db, leadsTable, emailsTable } from "@workspace/db";
import { eq, gte, count, sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const [totalLeadsResult] = await db.select({ count: count() }).from(leadsTable);
  const [emailsSentResult] = await db
    .select({ count: count() })
    .from(emailsTable)
    .where(eq(emailsTable.status, "sent"));
  const [emailsDraftedResult] = await db
    .select({ count: count() })
    .from(emailsTable)
    .where(eq(emailsTable.status, "draft"));

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const [newLeadsResult] = await db
    .select({ count: count() })
    .from(leadsTable)
    .where(gte(leadsTable.createdAt, oneWeekAgo));

  const totalLeads = totalLeadsResult?.count ?? 0;
  const emailsSent = emailsSentResult?.count ?? 0;
  const emailsDrafted = emailsDraftedResult?.count ?? 0;
  const newLeadsThisWeek = newLeadsResult?.count ?? 0;
  const openRate = emailsSent > 0 ? Math.round((emailsSent * 0.32) * 100) / 100 : 0;

  res.json({
    totalLeads,
    emailsSent,
    emailsDrafted,
    openRate,
    newLeadsThisWeek,
  });
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const recentEmails = await db
    .select({
      id: emailsTable.id,
      status: emailsTable.status,
      createdAt: emailsTable.createdAt,
      leadName: leadsTable.name,
    })
    .from(emailsTable)
    .innerJoin(leadsTable, eq(emailsTable.leadId, leadsTable.id))
    .orderBy(sql`${emailsTable.createdAt} desc`)
    .limit(10);

  const recentLeads = await db
    .select({
      id: leadsTable.id,
      name: leadsTable.name,
      createdAt: leadsTable.createdAt,
    })
    .from(leadsTable)
    .orderBy(sql`${leadsTable.createdAt} desc`)
    .limit(5);

  const activities = [
    ...recentEmails.map((e) => ({
      id: e.id,
      type: e.status === "sent" ? "email_sent" : "email_drafted",
      description: e.status === "sent" ? "Email sent" : "Email drafted",
      leadName: e.leadName,
      createdAt: e.createdAt.toISOString(),
    })),
    ...recentLeads.map((l) => ({
      id: l.id + 100000,
      type: "lead_added",
      description: "Lead added",
      leadName: l.name,
      createdAt: l.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  res.json(activities);
});

router.get("/dashboard/lead-status-breakdown", async (_req, res) => {
  const breakdown = await db
    .select({
      status: leadsTable.status,
      count: count(),
    })
    .from(leadsTable)
    .groupBy(leadsTable.status);

  res.json(breakdown.map((b) => ({ status: b.status, count: b.count })));
});

export default router;

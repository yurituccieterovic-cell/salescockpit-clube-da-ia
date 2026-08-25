import { Router } from "express";
import { db, emailsTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  DraftEmailBody,
  UpdateEmailBody,
  ListEmailsQueryParams,
  GetEmailParams,
  UpdateEmailParams,
  DeleteEmailParams,
  SendEmailParams,
  ListLeadEmailsParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/leads/:id/emails", async (req, res) => {
  const params = ListLeadEmailsParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const emails = await db
    .select()
    .from(emailsTable)
    .where(eq(emailsTable.leadId, params.data.id));
  res.json(emails);
});

router.get("/emails", async (req, res) => {
  const query = ListEmailsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const emails = query.data.status
    ? await db.select().from(emailsTable).where(eq(emailsTable.status, query.data.status))
    : await db.select().from(emailsTable);

  res.json(emails);
});

router.post("/emails/draft", async (req, res) => {
  const body = DraftEmailBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, body.data.leadId));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const prompt = `You are a world-class B2B SaaS sales development representative. Draft a short, personalized, highly compelling cold outreach email for the following lead. The email must feel genuinely personal, not templated. Mention their company and role specifically. Keep it under 150 words.

Lead details:
- Name: ${lead.name}
- Email: ${lead.email}
- Company: ${lead.company}
- Job Title: ${lead.jobTitle ?? "Unknown"}
- Industry: ${lead.industry ?? "Unknown"}
- Website: ${lead.website ?? "Unknown"}
- Notes: ${lead.notes ?? "None"}

${body.data.context ? `Additional context/angle: ${body.data.context}` : ""}

Respond with ONLY a JSON object in this format (no markdown, no extra text):
{
  "subject": "Email subject line here",
  "body": "Full email body here"
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = completion.choices[0]?.message?.content ?? "";

  let subject = "Following up — quick question";
  let emailBody = raw;
  try {
    const parsed = JSON.parse(raw);
    subject = parsed.subject ?? subject;
    emailBody = parsed.body ?? emailBody;
  } catch {
    subject = "A quick question about " + lead.company;
  }

  const [email] = await db
    .insert(emailsTable)
    .values({
      leadId: lead.id,
      subject,
      body: emailBody,
      status: "draft",
    })
    .returning();

  res.status(201).json(email);
});

router.get("/emails/:id", async (req, res) => {
  const params = GetEmailParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [email] = await db.select().from(emailsTable).where(eq(emailsTable.id, params.data.id));
  if (!email) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  res.json(email);
});

router.patch("/emails/:id", async (req, res) => {
  const params = UpdateEmailParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateEmailBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [email] = await db
    .update(emailsTable)
    .set(body.data)
    .where(eq(emailsTable.id, params.data.id))
    .returning();

  if (!email) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  res.json(email);
});

router.delete("/emails/:id", async (req, res) => {
  const params = DeleteEmailParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(emailsTable).where(eq(emailsTable.id, params.data.id));
  res.status(204).end();
});

router.post("/emails/:id/send", async (req, res) => {
  const params = SendEmailParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [email] = await db
    .update(emailsTable)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(emailsTable.id, params.data.id))
    .returning();

  if (!email) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  res.json(email);
});

export default router;

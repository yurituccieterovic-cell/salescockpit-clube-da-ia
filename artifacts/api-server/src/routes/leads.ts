import { Router } from "express";
import { db, leadsTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import {
  CreateLeadBody,
  UpdateLeadBody,
  ListLeadsQueryParams,
  GetLeadParams,
  UpdateLeadParams,
  DeleteLeadParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/leads", async (req, res) => {
  const query = ListLeadsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { status, search } = query.data;

  let leads;
  if (search) {
    leads = await db
      .select()
      .from(leadsTable)
      .where(
        or(
          ilike(leadsTable.name, `%${search}%`),
          ilike(leadsTable.company, `%${search}%`),
          ilike(leadsTable.email, `%${search}%`),
        ),
      );
  } else if (status) {
    leads = await db.select().from(leadsTable).where(eq(leadsTable.status, status));
  } else {
    leads = await db.select().from(leadsTable);
  }

  res.json(leads);
});

router.post("/leads", async (req, res) => {
  const body = CreateLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [lead] = await db
    .insert(leadsTable)
    .values({
      ...body.data,
      status: body.data.status ?? "new",
    })
    .returning();

  res.status(201).json(lead);
});

router.get("/leads/:id", async (req, res) => {
  const params = GetLeadParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.json(lead);
});

router.patch("/leads/:id", async (req, res) => {
  const params = UpdateLeadParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [lead] = await db
    .update(leadsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(leadsTable.id, params.data.id))
    .returning();

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.json(lead);
});

router.delete("/leads/:id", async (req, res) => {
  const params = DeleteLeadParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [lead] = await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.status(204).end();
});

export default router;

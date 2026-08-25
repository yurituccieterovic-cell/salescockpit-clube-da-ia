import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Defer importing the app until DATABASE_URL is guaranteed (the lib/db module
// throws at import time if it is missing). In real environments the workflow
// already provides it; this is a defensive default for ad-hoc test runs.
let app: Express;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to run route-auth tests. Provision a DB first.",
    );
  }
  process.env.SESSION_SECRET ??= "test-secret";
  const mod = await import("../app");
  app = mod.default;
});

afterAll(async () => {
  // Close the pg pool so vitest can exit cleanly.
  const { pool } = await import("@workspace/db");
  await pool.end().catch(() => {});
});

describe("public routes are reachable without a session", () => {
  it("GET /api/healthz returns 200", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("GET /api/jornal/publico returns 200", async () => {
    const res = await request(app).get("/api/jornal/publico");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("entries");
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("limit");
    expect(res.body).toHaveProperty("offset");
  });
});

describe("AO-protected routes return 401 without a session", () => {
  const aoEndpoints: { method: "get" | "post" | "put" | "delete"; path: string }[] = [
    { method: "get", path: "/api/leads" },
    { method: "get", path: "/api/emails" },
    { method: "get", path: "/api/dashboard" },
    { method: "get", path: "/api/jornal" },
  ];

  for (const ep of aoEndpoints) {
    it(`${ep.method.toUpperCase()} ${ep.path} -> 401`, async () => {
      const res = await request(app)[ep.method](ep.path);
      expect(res.status).toBe(401);
    });
  }
});

describe("Clube-protected routes return 401 without a clube session", () => {
  const clubeEndpoints: { method: "get" | "post"; path: string }[] = [
    { method: "get", path: "/api/clube/sessions" },
    { method: "post", path: "/api/clube/sessions" },
    { method: "post", path: "/api/clube/sessions/1/messages" },
    { method: "get", path: "/api/assembleia/sessions" },
    { method: "post", path: "/api/assembleia/sessions" },
    { method: "get", path: "/api/agora/sessions" },
    { method: "post", path: "/api/agora/sessions" },
  ];

  for (const ep of clubeEndpoints) {
    it(`${ep.method.toUpperCase()} ${ep.path} -> 401`, async () => {
      const res = await request(app)[ep.method](ep.path).send({});
      expect(res.status).toBe(401);
    });
  }
});

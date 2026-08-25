import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchGroqChat", () => {
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    vi.resetModules();
  });

  it("cai imediatamente no Gemini quando o modelo Groq retorna 404", async () => {
    process.env.GROQ_API_KEY = "test-groq";
    process.env.GEMINI_API_KEY = "test-gemini";

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "model_not_found",
              message: "model does not exist",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "OK via Gemini" }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchGroqChat } = await import("../lib/groq-retry");
    const response = await fetchGroqChat(
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Responda apenas OK." }],
        max_tokens: 8,
      },
      "test",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "gemini-2.5-flash:generateContent",
    );
    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "OK via Gemini" } }],
      model: "gemini-2.5-flash-fallback",
    });
  });
});
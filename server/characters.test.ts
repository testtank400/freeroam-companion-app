import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const makeCharacter = (id: string, name: string) => ({
  external_id: id,
  name,
  backstory: `Backstory for ${name}`,
  description: null,
  headshot_url: `https://images.getfreeroam.com/${id}.webp`,
  display_headshot_url: `https://images.getfreeroam.com/${id}.webp`,
  is_persona: false,
  owner: { username: "Test Tank", display_name: "Test Tank" },
  privacy_status: "private" as const,
});

describe("characters.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
  });

  it("returns characters from the API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        characters: [makeCharacter("abc-123", "Gareth")],
        has_more: false,
        next_cursor: null,
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent" });

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe("Gareth");
    expect(result.characters[0].privacy_status).toBe("private");
    expect(result.has_more).toBe(false);
  });

  it("calls the correct API URL with no cursor on first page", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ characters: [], has_more: false, next_cursor: null }),
    });

    const caller = appRouter.createCaller(createCtx());
    await caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("getfreeroam.com");
    expect(calledUrl).toContain("Test%20Tank");
    expect(calledUrl).toContain("limit=20");
    expect(calledUrl).toMatch(/cursor=$/); // empty cursor on first page
  });

  it("passes cursor to the API URL for subsequent pages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ characters: [], has_more: false, next_cursor: null }),
    });

    const caller = appRouter.createCaller(createCtx());
    await caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent", cursor: "abc123cursor" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("cursor=abc123cursor");
  });

  it("returns has_more=true and next_cursor when more pages exist", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        characters: Array.from({ length: 20 }, (_, i) => makeCharacter(`id-${i}`, `Character ${i}`)),
        has_more: true,
        next_cursor: "next-page-cursor-xyz",
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent" });

    expect(result.characters).toHaveLength(20);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe("next-page-cursor-xyz");
  });

  it("throws when cookie is not set", async () => {
    delete process.env.cookie;

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent" })
    ).rejects.toThrow("Cookie not configured");
  });

  it("throws when API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.list({ username: "Test Tank", limit: 20, sort: "recent" })
    ).rejects.toThrow("API responded with status 401");
  });
});

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

describe("characters.get", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
  });

  it("returns full character data including appearance field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "abc-123",
        name: "Gareth",
        backstory: "A hulking warrior with a gentle heart.",
        description: null,
        appearance: "Towering and broad-shouldered, clad in battle-scarred plate armor.",
        headshot_url: "https://images.getfreeroam.com/test.webp",
        display_headshot_url: null,
        privacy_status: "private",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.get({ characterId: "abc-123" });

    expect(result.name).toBe("Gareth");
    expect(result.appearance).toBe("Towering and broad-shouldered, clad in battle-scarred plate armor.");
    expect(result.privacy_status).toBe("private");
  });

  it("calls the correct single-character API URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "xyz-999",
        name: "Test",
        backstory: null,
        description: null,
        appearance: null,
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "public",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    await caller.characters.get({ characterId: "xyz-999" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("getfreeroam.com/api/characters/xyz-999");
  });

  it("handles null appearance gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "no-appearance",
        name: "Ghost",
        backstory: "Unknown origin.",
        description: null,
        appearance: null,
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "linked",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.get({ characterId: "no-appearance" });

    expect(result.appearance).toBeNull();
  });

  it("throws when API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.get({ characterId: "missing-id" })
    ).rejects.toThrow("API responded with status 404");
  });
});

describe("characters.delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
  });

  it("sends DELETE to the correct endpoint and returns success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.delete({ characterId: "abc-123" });

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("getfreeroam.com/api/characters/abc-123");
    expect(calledOptions.method).toBe("DELETE");
    expect(result.success).toBe(true);
    expect(result.characterId).toBe("abc-123");
  });

  it("URL-encodes the character ID", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const caller = appRouter.createCaller(createCtx());
    await caller.characters.delete({ characterId: "id with spaces" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("id%20with%20spaces");
  });

  it("throws when API returns an error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not found" });

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.delete({ characterId: "missing-id" })
    ).rejects.toThrow("Delete failed (404)");
  });
});

describe("characters.update", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
  });

  it("sends PUT to the correct endpoint with updated body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "abc-123",
        name: "Riven Updated",
        backstory: "Updated backstory.",
        description: null,
        appearance: "Updated appearance.",
        headshot_url: "https://images.getfreeroam.com/riven.webp",
        display_headshot_url: null,
        privacy_status: "public",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.update({
      characterId: "abc-123",
      name: "Riven Updated",
      backstory: "Updated backstory.",
      appearance: "Updated appearance.",
      privacy_status: "public",
    });

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("getfreeroam.com/api/characters/abc-123");
    expect(calledOptions.method).toBe("PUT");
    const body = JSON.parse(calledOptions.body as string);
    expect(body.name).toBe("Riven Updated");
    expect(body.privacy_status).toBe("public");
    expect(result.name).toBe("Riven Updated");
  });

  it("throws when API returns an error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" });

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.update({ characterId: "abc-123", name: "X", privacy_status: "private" })
    ).rejects.toThrow("Update failed (403)");
  });
});

describe("characters.create", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
  });

  it("creates a character and returns the new character data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "new-char-001",
        name: "Riven",
        backstory: "A battle-hardened rogue.",
        description: null,
        appearance: "Tall, athletic, auburn hair.",
        headshot_url: "https://images.getfreeroam.com/riven.webp",
        display_headshot_url: null,
        privacy_status: "private",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.characters.create({
      name: "Riven",
      backstory: "A battle-hardened rogue.",
      appearance: "Tall, athletic, auburn hair.",
      privacy_status: "private",
    });

    expect(result.name).toBe("Riven");
    expect(result.external_id).toBe("new-char-001");
    expect(result.appearance).toBe("Tall, athletic, auburn hair.");
  });

  it("sends POST to the correct endpoint with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "x",
        name: "Test",
        backstory: null,
        description: null,
        appearance: null,
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "public",
        owner: { username: "Test Tank" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    await caller.characters.create({ name: "Test", privacy_status: "public" });

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("getfreeroam.com/api/characters");
    expect(calledOptions.method).toBe("POST");
    const body = JSON.parse(calledOptions.body as string);
    expect(body.name).toBe("Test");
    expect(body.privacy_status).toBe("public");
  });

  it("throws when API returns an error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "Validation error" });

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.characters.create({ name: "Bad", privacy_status: "private" })
    ).rejects.toThrow("Create failed (422)");
  });
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

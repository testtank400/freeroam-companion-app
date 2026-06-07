import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock DB helpers to avoid needing a real database
const mockGetCharacterExtended = vi.fn();
const mockGetCharactersNsfw = vi.fn();
const mockGetCollectionsByAccountId = vi.fn();

vi.mock("./db", () => ({
  getCharacterExtended: (...args: unknown[]) => mockGetCharacterExtended(...args),
  getCharactersNsfw: (...args: unknown[]) => mockGetCharactersNsfw(...args),
  getCollectionsByAccountId: (...args: unknown[]) => mockGetCollectionsByAccountId(...args),
  // Re-export other functions that routers.ts imports
  addCharacterToCollection: vi.fn(),
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  parseLimitFromError: vi.fn(),
  removeCharacterFromCollection: vi.fn(),
  toggleCharacterNsfw: vi.fn(),
  updateCollection: vi.fn(),
  upsertCharacterExtended: vi.fn(),
  upsertFreeroamUser: vi.fn(),
}));

function setupDbMocks() {
  mockGetCharacterExtended.mockResolvedValue({
    characterId: "char-001",
    backstoryFull: "Extended backstory content that is much longer than what Freeroam stores.",
    appearanceFull: "Extended appearance content with more detail.",
    backstoryLimit: 2000,
    appearanceLimit: 1000,
    updatedAt: new Date(),
  });
  mockGetCharactersNsfw.mockResolvedValue({ "char-001": true, "char-002": false, "char-003": false });
  mockGetCollectionsByAccountId.mockResolvedValue([
    {
      id: 1,
      name: "Favorites",
      parentId: null,
      characterIds: ["char-001", "char-002"],
      freeroamAccountId: 12345,
      description: null,
      coverImage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
}

function createCtx(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        "x-freeroam-cookie": "session=test-user-cookie",
        "x-freeroam-account-id": "12345",
      },
    } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("export.single", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
    setupDbMocks();
  });

  it("returns a ZIP file with the correct fileName", async () => {
    // Mock the character data fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "char-001",
        name: "Gareth the Bold",
        backstory: "A warrior from the north.",
        appearance: "Tall with dark hair.",
        headshot_url: "https://images.getfreeroam.com/char-001.webp",
        display_headshot_url: null,
        privacy_status: "private",
        owner: { username: "TestUser", display_name: "Test User" },
      }),
    });

    // Mock the headshot image download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
      headers: new Headers({ "content-type": "image/webp" }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.export.single({ characterId: "char-001" });

    expect(result.fileName).toBe("Gareth the Bold.zip");
    expect(result.zipBase64).toBeTruthy();
    expect(typeof result.zipBase64).toBe("string");
    // Verify it's valid base64
    expect(() => Buffer.from(result.zipBase64, "base64")).not.toThrow();
  });

  it("sanitizes special characters in folder names", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "char-002",
        name: "Test/Character:With*Special<Chars>",
        backstory: null,
        appearance: null,
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "public",
        owner: { username: "TestUser" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.export.single({ characterId: "char-002" });

    // Special characters should be replaced with underscores
    expect(result.fileName).toBe("Test_Character_With_Special_Chars_.zip");
  });

  it("handles missing headshot gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "char-003",
        name: "No Headshot",
        backstory: "Has a story.",
        appearance: "Looks normal.",
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "private",
        owner: { username: "TestUser" },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.export.single({ characterId: "char-003" });

    expect(result.fileName).toBe("No Headshot.zip");
    expect(result.zipBase64).toBeTruthy();
  });

  it("throws when Freeroam API returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });

    const caller = appRouter.createCaller(createCtx());
    await expect(caller.export.single({ characterId: "nonexistent" })).rejects.toThrow();
  });
});

describe("export.bulk", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.cookie = "session=test-session-cookie";
    setupDbMocks();
  });

  it("returns a ZIP with exportedCount and failedCount", async () => {
    // First character succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        external_id: "char-001",
        name: "Character One",
        backstory: "Story one.",
        appearance: "Looks one.",
        headshot_url: null,
        display_headshot_url: null,
        privacy_status: "private",
        owner: { username: "TestUser" },
      }),
    });

    // Second character fails (404)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    // Retry 1
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    // Retry 2
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.export.bulk({ characterIds: ["char-001", "char-002"] });

    expect(result.exportedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.fileName).toMatch(/^freeroam-companion-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(result.zipBase64).toBeTruthy();
  });

  it("handles empty characterIds array", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.export.bulk({ characterIds: [] });

    expect(result.exportedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.zipBase64).toBeTruthy();
  });
});

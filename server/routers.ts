import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import {
  addCharacterToCollection,
  createCollection as dbCreateCollection,
  deleteCollection as dbDeleteCollection,
  getCharacterExtended,
  getCharactersNsfw,
  getCollectionsByAccountId,
  parseLimitFromError,
  removeCharacterFromCollection,
  toggleCharacterNsfw,
  updateCollection as dbUpdateCollection,
  upsertCharacterExtended,
  upsertFreeroamUser,
} from "./db";

/**
 * Get the Freeroam session cookie to use for API calls.
 * Prefers the per-user cookie sent as x-freeroam-cookie header (from localStorage),
 * falls back to the owner's env cookie. The owner cookie is NEVER exposed to the client.
 */
function getFreeroamCookie(ctx: { req: { headers: Record<string, string | string[] | undefined> } }): string {
  const userCookie = ctx.req.headers['x-freeroam-cookie'];
  if (userCookie && typeof userCookie === 'string' && userCookie.trim()) {
    return userCookie.trim();
  }
  return process.env.cookie ?? '';
}

/**
 * Returns true if the request has a user-provided cookie (not just the owner fallback).
 * Used to gate character-loading endpoints so non-owner users see an empty roster
 * rather than the owner's characters.
 */
function hasUserCookie(ctx: { req: { headers: Record<string, string | string[] | undefined> } }): boolean {
  const userCookie = ctx.req.headers['x-freeroam-cookie'];
  return !!(userCookie && typeof userCookie === 'string' && userCookie.trim());
}

/**
 * Get the Freeroam account ID from the x-freeroam-account-id header.
 * Returns null if not present or invalid.
 */
function getFreeroamAccountId(ctx: { req: { headers: Record<string, string | string[] | undefined> } }): number | null {
  const header = ctx.req.headers['x-freeroam-account-id'];
  if (!header || typeof header !== 'string') return null;
  const parsed = parseInt(header, 10);
  return isNaN(parsed) ? null : parsed;
}

// Coerce any unknown privacy_status value to 'private' so unexpected API values never crash the app
// Valid values: private, public, unlisted
const privacyStatusSchema = z
  .string()
  .transform((val) =>
    ["private", "public", "unlisted"].includes(val)
      ? (val as "private" | "public" | "unlisted")
      : "private" as const
  );

// Shape of a character returned by the getfreeroam API
const CharacterSchema = z.object({
  external_id: z.string(),
  name: z.string(),
  backstory: z.string().nullable(),
  description: z.string().nullable(),
  headshot_url: z.string().nullable(),
  display_headshot_url: z.string().nullable(),
  is_persona: z.boolean(),
  owner: z.object({
    username: z.string(),
    display_name: z.string(),
  }),
  privacy_status: privacyStatusSchema,
});

// Single character response — includes the `appearance` field not in the list endpoint.
// Note: the create endpoint returns a slimmer shape (no description/owner), so both are optional.
const SingleCharacterSchema = z.object({
  external_id: z.string(),
  name: z.string(),
  backstory: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  headshot_url: z.string().nullable().optional(),
  display_headshot_url: z.string().nullable().optional(),
  privacy_status: privacyStatusSchema,
  owner: z.object({
    username: z.string(),
    display_name: z.string().optional(),
  }).optional(),
});

const CharactersResponseSchema = z.object({
  characters: z.array(CharacterSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  characters: router({
    list: publicProcedure
      .input(
        z.object({
          username: z.string().default("Test Tank"),
          limit: z.number().default(20),
          sort: z.string().default("recent"),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        // Return empty roster for users without their own cookie
        if (!hasUserCookie(ctx)) return { characters: [], has_more: false, next_cursor: null };

        const cookie = getFreeroamCookie(ctx);
        if (!cookie) {
          throw new Error("Cookie not configured in environment");
        }

        const encodedUsername = encodeURIComponent(input.username);
        const url = `https://getfreeroam.com/api/user/${encodedUsername}/characters?limit=${input.limit}&sort=${input.sort}&cursor=${input.cursor ?? ""}`;

        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie: cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();
        const parsed = CharactersResponseSchema.parse(data);
        return parsed;
      }),

    // Single-request library endpoint — returns ALL characters with is_saved, description, tags
    library: publicProcedure
      .query(async ({ ctx }) => {
        // Return empty roster for users without their own cookie — do not expose owner's characters
        if (!hasUserCookie(ctx)) return [];

        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        // Retry up to 3 times with exponential backoff for 429 rate limit errors
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
          response = await fetch(
            "https://getfreeroam.com/api/characters/library?page=1&limit=18&filter=",
            {
              headers: {
                accept: "*/*",
                "accept-language": "en-US,en;q=0.9",
                cookie: cookie,
                origin: "https://getfreeroam.com",
                referer: "https://getfreeroam.com",
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
              },
            }
          );
          if (response.status !== 429) break;
        }

        if (!response || !response.ok) {
          const text = response ? await response.text() : 'No response';
          if (response?.status === 429) {
            throw new Error(`Rate limit exceeded. Please wait a moment and try again.`);
          }
          throw new Error(`Library fetch failed (${response?.status}): ${text}`);
        }

        const data = await response.json() as {
          characters: Array<{
            external_id: string;
            name: string;
            headshot_url: string | null;
            display_headshot_url: string | null;
            backstory: string | null;
            description: string | null;
            privacy_status: string;
            created_at: string;
            creator_username: string;
            is_yours: boolean;
            is_saved: boolean;
            tags: Array<{ name: string; is_fandom: boolean; emoji: string }>;
          }>;
          your_characters: unknown;
          pagination: unknown;
        };

        // Coerce privacy_status to known values
        return data.characters.map(c => ({
          ...c,
          privacy_status: (["private", "public", "unlisted"].includes(c.privacy_status)
            ? c.privacy_status
            : "private") as "private" | "public" | "unlisted",
        }));
      }),

    // Upload a headshot image — expects multipart/form-data with a "file" field
    // The server receives a base64-encoded file string and forwards it as multipart
    uploadHeadshot: publicProcedure
      .input(
        z.object({
          fileBase64: z.string(), // base64-encoded file content
          mimeType: z.string(),   // e.g. "image/png"
          fileName: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        // Decode base64 back to binary
        const buffer = Buffer.from(input.fileBase64, "base64");

        // Build multipart/form-data manually using FormData
        const formData = new FormData();
        const blob = new Blob([buffer], { type: input.mimeType });
        formData.append("file", blob, input.fileName);

        const response = await fetch("https://getfreeroam.com/api/upload/headshot", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie: cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com/user/Test%20Tank?tab=characters",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: formData,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Upload failed (${response.status}): ${text}`);
        }

        const data = await response.json() as { headshot_url?: string; image_url?: string; url?: string };
        const url = data.image_url ?? data.headshot_url ?? data.url;
        if (!url) throw new Error("No image_url in upload response");
        return { headshot_url: url };
      }),

    update: publicProcedure
      .input(
        z.object({
          characterId: z.string(),
          name: z.string().min(1),
          backstory: z.string().optional(),
          appearance: z.string().optional(),
          headshot_url: z.string().optional(),
          privacy_status: z.enum(["private", "public", "unlisted"]).default("private"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const FREEROAM_HEADERS = {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          cookie,
          origin: "https://getfreeroam.com",
          referer: "https://getfreeroam.com",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        };

        // Look up any previously detected limits for this character
        const existing = await getCharacterExtended(input.characterId);
        let backstoryLimit = existing?.backstoryLimit ?? null;
        let appearanceLimit = existing?.appearanceLimit ?? null;

        // Trim content to known limits (if any)
        let backstorySent = input.backstory ?? null;
        let appearanceSent = input.appearance ?? null;
        if (backstorySent && backstoryLimit) backstorySent = backstorySent.slice(0, backstoryLimit);
        if (appearanceSent && appearanceLimit) appearanceSent = appearanceSent.slice(0, appearanceLimit);

        const buildBody = (bs: string | null, ap: string | null) => {
          const body: Record<string, string> = { name: input.name };
          if (bs !== undefined && bs !== null)  body.backstory    = bs;
          if (ap !== undefined && ap !== null)  body.appearance   = ap;
          if (input.headshot_url !== undefined) body.headshot_url = input.headshot_url;
          body.privacy_status = input.privacy_status;
          return body;
        };

        const doUpdate = (bs: string | null, ap: string | null) =>
          fetch(`https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}`, {
            method: "PUT",
            headers: FREEROAM_HEADERS,
            body: JSON.stringify(buildBody(bs, ap)),
          });

        let response = await doUpdate(backstorySent, appearanceSent);
        let trimmedBackstory: number | null = null;
        let trimmedAppearance: number | null = null;

        // If Freeroam rejects, parse the limit from the error and retry once
        // Retry loop: handle multiple fields being over-limit (each retry fixes one field)
        while (!response.ok) {
          const errorText = await response.text();
          const parsed = parseLimitFromError(errorText);

          // Accept 400 and 422 as retriable limit errors
          if (parsed && (response.status === 400 || response.status === 422)) {
            const { limit, field } = parsed;
            const isBackstory = field === 'backstory' || (!field && !!backstorySent);
            const isAppearance = field === 'appearance';

            if (isBackstory && backstorySent && backstorySent.length > limit) {
              backstoryLimit = limit;
              backstorySent = backstorySent.slice(0, limit);
              trimmedBackstory = limit;
            } else if (isAppearance && appearanceSent && appearanceSent.length > limit) {
              appearanceLimit = limit;
              appearanceSent = appearanceSent.slice(0, limit);
              trimmedAppearance = limit;
            } else {
              // Trim both as a fallback
              if (backstorySent && backstorySent.length > limit) { backstoryLimit = limit; backstorySent = backstorySent.slice(0, limit); trimmedBackstory = limit; }
              if (appearanceSent && appearanceSent.length > limit) { appearanceLimit = limit; appearanceSent = appearanceSent.slice(0, limit); trimmedAppearance = limit; }
            }

            response = await doUpdate(backstorySent, appearanceSent);
          } else {
            throw new Error(`Update failed (${response.status}): ${errorText}`);
          }
        }

        // Save the full (untrimmed) content and detected limits to our DB
        await upsertCharacterExtended(
          input.characterId,
          input.backstory ?? null,
          input.appearance ?? null,
          backstoryLimit,
          appearanceLimit
        );

        return {
          external_id: input.characterId,
          name: input.name,
          backstory: input.backstory ?? null,
          description: null as string | null,
          appearance: input.appearance ?? null,
          headshot_url: input.headshot_url ?? null,
          display_headshot_url: null as string | null,
          privacy_status: input.privacy_status,
          owner: undefined as { username: string; display_name?: string } | undefined,
          // Trim warnings — null means no trimming occurred
          trimmedBackstory,
          trimmedAppearance,
        };
      }),

    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          backstory: z.string().optional(),
          appearance: z.string().optional(),
          headshot_url: z.string().optional(),
          privacy_status: z.enum(["private", "public", "unlisted"]).default("private"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const FREEROAM_HEADERS = {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          cookie,
          origin: "https://getfreeroam.com",
          referer: "https://getfreeroam.com",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        };

        let backstorySent = input.backstory ?? null;
        let appearanceSent = input.appearance ?? null;
        let backstoryLimit: number | null = null;
        let appearanceLimit: number | null = null;
        let trimmedBackstory: number | null = null;
        let trimmedAppearance: number | null = null;

        const buildBody = (bs: string | null, ap: string | null) => {
          const body: Record<string, string> = { name: input.name };
          if (bs) body.backstory = bs;
          if (ap) body.appearance = ap;
          if (input.headshot_url) body.headshot_url = input.headshot_url;
          body.privacy_status = input.privacy_status;
          return body;
        };

        const doCreate = (bs: string | null, ap: string | null) =>
          fetch("https://getfreeroam.com/api/characters", {
            method: "POST",
            headers: FREEROAM_HEADERS,
            body: JSON.stringify(buildBody(bs, ap)),
          });

        let response = await doCreate(backstorySent, appearanceSent);

        // Retry loop: handle multiple fields being over-limit
        while (!response.ok) {
          const errorText = await response.text();
          const parsed = parseLimitFromError(errorText);

          if (parsed && (response.status === 400 || response.status === 422)) {
            const { limit, field } = parsed;
            const isBackstory = field === 'backstory' || (!field && !!backstorySent);
            const isAppearance = field === 'appearance';

            if (isBackstory && backstorySent && backstorySent.length > limit) {
              backstoryLimit = limit;
              backstorySent = backstorySent.slice(0, limit);
              trimmedBackstory = limit;
            } else if (isAppearance && appearanceSent && appearanceSent.length > limit) {
              appearanceLimit = limit;
              appearanceSent = appearanceSent.slice(0, limit);
              trimmedAppearance = limit;
            } else {
              if (backstorySent && backstorySent.length > limit) { backstoryLimit = limit; backstorySent = backstorySent.slice(0, limit); trimmedBackstory = limit; }
              if (appearanceSent && appearanceSent.length > limit) { appearanceLimit = limit; appearanceSent = appearanceSent.slice(0, limit); trimmedAppearance = limit; }
            }

            response = await doCreate(backstorySent, appearanceSent);
          } else {
            throw new Error(`Create failed (${response.status}): ${errorText}`);
          }
        }

        const data = await response.json() as { character?: unknown };
        const created = SingleCharacterSchema.parse(data.character ?? data);

        // Save full content to our DB
        if (input.backstory || input.appearance) {
          await upsertCharacterExtended(
            created.external_id,
            input.backstory ?? null,
            input.appearance ?? null,
            backstoryLimit,
            appearanceLimit
          );
        }

        return { ...created, trimmedBackstory, trimmedAppearance };
      }),

    save: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}/save`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie: cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Save failed (${response.status}): ${text}`);
        }

        return { success: true, saved: true, characterId: input.characterId };
      }),

    unsave: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}/save`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie: cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Unsave failed (${response.status}): ${text}`);
        }

        return { success: true, saved: false, characterId: input.characterId };
      }),

    delete: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie: cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Delete failed (${response.status}): ${text}`);
        }

        return { success: true, characterId: input.characterId };
      }),

    get: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) {
          throw new Error("Cookie not configured in environment");
        }

        const url = `https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}`;

        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie: cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();
        return SingleCharacterSchema.parse(data);
      }),

    // Fetch the full extended backstory/appearance stored in our DB
    getExtended: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .query(async ({ input, ctx }) => {
        return getCharacterExtended(input.characterId);
      }),
  }),

  // ─── Collections (DB-backed) ──────────────────────────────────────────────────────────
  // All operations are scoped to the user's Freeroam accountId (from x-freeroam-account-id header).
  // Returns empty list if no account ID is present — prevents data leaking between users.
  collections: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const accountId = getFreeroamAccountId(ctx);
      if (!accountId) return [];
      return getCollectionsByAccountId(accountId);
    }),

    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          description: z.string().optional(),
          coverImage: z.string().optional(),
          parentId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) throw new Error('No Freeroam account ID — please set your cookie in Settings');
        return dbCreateCollection(
          accountId,
          input.name,
          input.description,
          input.coverImage,
          input.parentId
        );
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(255).optional(),
          description: z.string().nullable().optional(),
          coverImage: z.string().nullable().optional(),
          parentId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) throw new Error('No Freeroam account ID — please set your cookie in Settings');
        const { id, ...updates } = input;
        return dbUpdateCollection(id, accountId, updates);
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) throw new Error('No Freeroam account ID — please set your cookie in Settings');
        return dbDeleteCollection(input.id, accountId);
      }),

    addCharacter: publicProcedure
      .input(z.object({ collectionId: z.number(), characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return addCharacterToCollection(input.collectionId, input.characterId);
      }),

    removeCharacter: publicProcedure
      .input(z.object({ collectionId: z.number(), characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return removeCharacterFromCollection(input.collectionId, input.characterId);
      }),

    // Upload a cover image for a collection to Manus S3 storage.
    // Accepts base64-encoded file content and returns a /manus-storage/ URL.
    uploadCoverImage: publicProcedure
      .input(
        z.object({
          fileBase64: z.string(),
          mimeType: z.string(),
          fileName: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `collection-covers/${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),
  }),

  nsfw: router({
    /** Get NSFW status for a batch of character IDs. Returns a map of characterId -> boolean.
     * Uses mutation (POST) to avoid HTTP 414 URL-too-large errors with large rosters. */
    getBatch: publicProcedure
      .input(z.object({ characterIds: z.array(z.string()) }))
      .mutation(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) return {};
        return getCharactersNsfw(input.characterIds, accountId);
      }),

    /** Toggle the NSFW flag for a single character. Returns the new boolean value. */
    toggle: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) throw new Error('No Freeroam account ID — please set your cookie in Settings');
        const newValue = await toggleCharacterNsfw(input.characterId, accountId);
        return { characterId: input.characterId, isNsfw: newValue };
      }),
  }),

  // ─── Freeroam Cookie Verification ──────────────────────────────────────────────────────────
  freeroam: router({
    /**
     * Verify a Freeroam session cookie by calling /api/user/current.
     * On success, upserts the user in our DB and returns their profile.
     * The cookie is passed as x-freeroam-cookie header (already set by the client).
     */
    verifySession: publicProcedure
      .input(z.object({ cookie: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
      // Use the explicitly provided cookie (for first-time setup) or fall back to the header
      const cookie = (input.cookie && input.cookie.trim()) ? input.cookie.trim() : getFreeroamCookie(ctx);
      if (!cookie) throw new Error('No cookie provided');

      const response = await fetch('https://getfreeroam.com/api/user/current', {
        headers: {
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9',
          cookie,
          origin: 'https://getfreeroam.com',
          referer: 'https://getfreeroam.com',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error('SESSION_EXPIRED');
      }
      if (!response.ok) {
        throw new Error(`Freeroam API error: ${response.status}`);
      }

      const data = await response.json() as {
        account_id: number;
        username: string;
        email: string;
        external_id: string;
      };

      // Upsert the user in our DB for persistent identity
      await upsertFreeroamUser(data.account_id, data.username, data.email, data.external_id);

      return {
        accountId: data.account_id,
        username: data.username,
        email: data.email,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

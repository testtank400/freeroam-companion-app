import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import {
  addCharacterToCollection,
  addWorldToCollectionLocal,
  createCollection as dbCreateCollection,
  deleteCollection as dbDeleteCollection,
  getCharacterExtended,
  getCharactersNsfw,
  getCollectionsByAccountId,
  getWorldCollectionMembers,
  getWorldMemberships,
  parseLimitFromError,
  removeCharacterFromCollection,
  removeWorldFromCollectionLocal,
  toggleCharacterNsfw,
  updateCollection as dbUpdateCollection,
  upsertCharacterExtended,
  upsertFreeroamUser,
} from "./db";
import { exportSingleCharacter, exportAllCharacters } from "./export";

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

    // Save extended backstory/appearance directly to our DB without touching Freeroam.
    // Used when the user wants to edit the local extended version independently.
    saveExtended: publicProcedure
      .input(z.object({
        characterId: z.string(),
        backstoryFull: z.string().nullable().optional(),
        appearanceFull: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await upsertCharacterExtended(
          input.characterId,
          input.backstoryFull ?? null,
          input.appearanceFull ?? null
        );
        return { success: true };
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

  // ─── Export ──────────────────────────────────────────────────────────────────────────────────
  export: router({
    /** Export a single character as a ZIP file (base64-encoded). */
    single: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const accountId = getFreeroamAccountId(ctx);
        return exportSingleCharacter(input.characterId, cookie, accountId);
      }),

    // Bulk export is handled by the Express route at /api/export/bulk
    // (tRPC has response size limits that fail with large rosters)
  }),

  // ─── Worlds (Freeroam API proxy, no local DB) ──────────────────────────────────────────────────
  worlds: router({
    /** Paginated list of worlds for a given user */
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
        if (!hasUserCookie(ctx)) return { worlds: [], has_more: false, next_cursor: null };

        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const encodedUsername = encodeURIComponent(input.username);
        const url = `https://getfreeroam.com/api/user/${encodedUsername}/worlds?limit=${input.limit}&sort=${input.sort}&cursor=${input.cursor ?? ""}`;

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
          const text = await response.text();
          throw new Error(`Worlds API responded with status ${response.status}: ${text}`);
        }

        const data = await response.json() as {
          worlds: Array<{
            external_id: string;
            name: string;
            cover_image_url: string | null;
            avg_color: { r: number; g: number; b: number } | null;
            logline: string;
            description: string;
            interaction_count: number;
            owner: { username: string; is_verified: boolean };
            privacy_status: string;
            is_draft: boolean;
          }>;
          has_more: boolean;
          next_cursor: string | null;
        };

        // Coerce privacy_status to known values
        const worlds = data.worlds.map(w => ({
          ...w,
          privacy_status: (["private", "public", "unlisted"].includes(w.privacy_status)
            ? w.privacy_status
            : "private") as "private" | "public" | "unlisted",
        }));

        return { worlds, has_more: data.has_more, next_cursor: data.next_cursor };
      }),

    /** Fetch all worlds at once (loads all pages) for the grid view */
    listAll: publicProcedure
      .input(
        z.object({
          username: z.string().default("Test Tank"),
          sort: z.string().default("recent"),
        })
      )
      .query(async ({ input, ctx }) => {
        if (!hasUserCookie(ctx)) return [];

        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const encodedUsername = encodeURIComponent(input.username);
        const allWorlds: Array<{
          external_id: string;
          name: string;
          cover_image_url: string | null;
          avg_color: { r: number; g: number; b: number } | null;
          logline: string;
          description: string;
          interaction_count: number;
          owner: { username: string; is_verified: boolean };
          privacy_status: "private" | "public" | "unlisted";
          is_draft: boolean;
        }> = [];

        let cursor = "";
        let hasMore = true;

        while (hasMore) {
          const url = `https://getfreeroam.com/api/user/${encodedUsername}/worlds?limit=20&sort=${input.sort}&cursor=${cursor}`;

          // Retry up to 3 times with backoff for 429
          let response: Response | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
              await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
            }
            response = await fetch(url, {
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
            if (response.status !== 429) break;
          }

          if (!response || !response.ok) {
            const text = response ? await response.text() : 'No response';
            if (response?.status === 429) {
              throw new Error('Rate limit exceeded. Please wait a moment and try again.');
            }
            if (response?.status === 401) {
              throw new Error('SESSION_EXPIRED');
            }
            throw new Error(`Worlds fetch failed (${response?.status}): ${text}`);
          }

          const data = await response.json() as {
            worlds: Array<{
              external_id: string;
              name: string;
              cover_image_url: string | null;
              avg_color: { r: number; g: number; b: number } | null;
              logline: string;
              description: string;
              interaction_count: number;
              owner: { username: string; is_verified: boolean };
              privacy_status: string;
              is_draft: boolean;
            }>;
            has_more: boolean;
            next_cursor: string | null;
          };

          const coerced = data.worlds.map(w => ({
            ...w,
            privacy_status: (["private", "public", "unlisted"].includes(w.privacy_status)
              ? w.privacy_status
              : "private") as "private" | "public" | "unlisted",
          }));

          allWorlds.push(...coerced);
          hasMore = data.has_more;
          cursor = data.next_cursor ?? "";
        }

        return allWorlds;
      }),

    /** Get a single world (story) with full details: characters, tags, related worlds */
    get: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/internal-world-story-json/${encodeURIComponent(input.worldId)}`;

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
          const text = await response.text();
          throw new Error(`World detail API responded with status ${response.status}: ${text}`);
        }

        const data = await response.json() as {
          world: {
            id: number;
            external_id: string;
            name: string;
            logline: string;
            cover_image_url: string | null;
            author_note: string | null;
            author_note_mentions: unknown[];
            owner: {
              username: string;
              is_verified: boolean;
              display_name: string | null;
              avatar_url: string | null;
            };
            comment_count: number;
          };
          tags: Array<{
            id: number;
            name: string;
            is_fandom: boolean;
            emoji: string | null;
          }>;
          characters: Array<{
            id: number;
            external_id: string;
            name: string;
            backstory: string;
            appearance: string;
            headshot_url: string | null;
            display_headshot_url: string | null;
            is_main: boolean;
          }>;
          related_worlds: Array<{
            external_id: string;
            name: string;
            logline: string;
            cover_image_url: string | null;
            owner: { username: string; is_verified: boolean; avatar_url: string | null };
            interaction_count: number;
            avg_color: { r: number; g: number; b: number } | null;
            tag_name: string;
            tag_is_fandom: boolean;
          }>;
          is_liked: boolean;
          is_saved: boolean;
          like_count: number;
          world_privacy_status: string;
          is_world_owner: boolean;
        };

        return {
          world: data.world,
          tags: data.tags,
          characters: data.characters,
          related_worlds: data.related_worlds,
          is_liked: data.is_liked,
          is_saved: data.is_saved,
          like_count: data.like_count,
          world_privacy_status: (["private", "public", "unlisted"].includes(data.world_privacy_status)
            ? data.world_privacy_status
            : "private") as "private" | "public" | "unlisted",
          is_world_owner: data.is_world_owner,
          panel_id: (data as Record<string, unknown>).panel_id as string | null ?? null,
          has_previous_progress: (data as Record<string, unknown>).has_previous_progress as boolean ?? false,
          world_stats: (data as Record<string, unknown>).world_stats as { interaction_count: number; time_to_first_chapter: number; character_count: number; fandom_rank: number | null; fandom_name: string | null } | null ?? null,
        };
      }),

    /** Fetch a specific panel by panel_id and world_id */
    getPanel: publicProcedure
      .input(z.object({
        worldId: z.string(),
        panelId: z.string(),
      }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/api/nav/panel?world_id=${encodeURIComponent(input.worldId)}&panel_id=${encodeURIComponent(input.panelId)}`;
        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Get panel failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          panel_id: string;
          world_id: string;
          next_panel_id: string | null;
          prev_panel_id: string | null;
          is_action: boolean;
          requires_action: boolean;
          depth: number;
          forward_state: string;
          panel_content: {
            type: string;
            narration: string | null;
            images: Array<{
              url: string;
              prompt: string;
              generation_type: string | null;
              visible_characters: Record<string, { name: string; external_id: string }>;
              shot: string | null;
              is_nsfw: boolean | null;
            }>;
            speech_bubbles: Array<{
              text: string;
              character: string;
              style: string;
              isRequiresActionChat: boolean;
            }>;
            choice: {
              question: string;
              options: Array<{ text: string; action_panel_external_id: string }>;
              selected_choice: string | null;
              is_chat: boolean;
            } | null;
            chapter_header: string | null;
            chapter_start: unknown;
            chapter_end: unknown;
            depth: number;
            is_chat: boolean;
          };
          next_panel: unknown;
          show_jump_to_latest: boolean;
          jump_to_latest_panel_id: string | null;
          is_owner: boolean;
        }>;
      }),

    /** Save the user's current reading position */
    setPanel: publicProcedure
      .input(z.object({
        worldId: z.string(),
        panelId: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/nav/view", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ panel_id: input.panelId, world_id: input.worldId }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Set panel failed (${response.status}): ${text}`);
        }
        return { ok: true };
      }),

    /** Poll to check if the next panel is ready (AI generation) */
    nextReady: publicProcedure
      .input(z.object({ panelId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/api/nav/next-ready?panel_id=${encodeURIComponent(input.panelId)}`;
        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Next ready check failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ ready: false } | { ready: true; panel_id: string }>;
      }),

    /** Add a bookmark for a panel */
    addBookmark: publicProcedure
      .input(z.object({ panelId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/panels/${encodeURIComponent(input.panelId)}/bookmark`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Add bookmark failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; message: string; bookmarked: boolean }>;
      }),

    /** Remove a bookmark for a panel */
    removeBookmark: publicProcedure
      .input(z.object({ panelId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/panels/${encodeURIComponent(input.panelId)}/bookmark`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Remove bookmark failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; message: string; bookmarked: boolean }>;
      }),

    /** Get characters currently in the story for a given panel */
    getWorldCharacters: publicProcedure
      .input(z.object({ worldId: z.string(), panelId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/api/world/${input.worldId}/characters/current?current_panel_external_id=${input.panelId}`;
        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Get world characters failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          world_characters: Array<{
            id: number;
            external_id: string;
            name: string;
            backstory: string;
            appearance: string;
            headshot_url: string;
            display_headshot_url: string | null;
            source: string;
            removable: boolean;
            is_main_character: boolean;
            is_saved: boolean;
            is_yours: boolean;
            creator_name: string;
            tags: Array<{ name: string; is_fandom: boolean; emoji: string }>;
          }>;
          story_characters: Array<{
            id: number;
            external_id: string;
            name: string;
            backstory: string;
            appearance: string;
            headshot_url: string;
            display_headshot_url: string | null;
            source: string;
            removable: boolean;
            is_main_character: boolean;
            is_saved: boolean;
            is_yours: boolean;
            creator_name: string;
            tags: Array<{ name: string; is_fandom: boolean; emoji: string }>;
          }>;
        }>;
      }),

    /** Send an action (choice, take-action, image, steer-story) */
    sendAction: publicProcedure
      .input(z.object({
        worldId: z.string(),
        panelId: z.string(),
        actionText: z.string(),
        displayText: z.string(),
        actionType: z.enum(['choice', 'take-action', 'image', 'steer-story']),
        characterChanges: z.object({
          add_character_ids: z.array(z.string()),
          remove_character_ids: z.array(z.string()),
          new_main_character_id: z.string().nullable(),
          old_main_character_id: z.string().nullable(),
          batch_character_update: z.boolean(),
        }).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/nav/action", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({
            world_id: input.worldId,
            panel_id: input.panelId,
            action_text: input.actionText,
            display_text: input.displayText,
            action_type: input.actionType,
            character_changes: input.characterChanges ?? null,
          }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Send action failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          action_panel_id: string;
          action_panel_content: Record<string, unknown>;
          next_panel_id: string | null;
          prev_panel_id: string | null;
          is_chapter_start: boolean;
          generation_started: boolean;
          forward_state: string;
          usage: Record<string, unknown> | null;
        }>;
      }),

    /** Regenerate the starting scene of a world */
    regenerateStartingScene: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const response = await fetch(
          `https://getfreeroam.com/api/worlds/${encodeURIComponent(input.worldId)}/regenerate-starting-scene`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Regenerate starting scene failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; status: string; message: string }>;
      }),

    /** Start generation for a world */
    startGeneration: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const response = await fetch("https://getfreeroam.com/api/nav/start-generation", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ world_id: input.worldId }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Start generation failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ status: string; initial_panel_id: string | null }>;
      }),

    /** Restart a world story from the beginning */
    restart: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/nav/restart", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ world_id: input.worldId }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Restart failed (${response.status}): ${text}`);
        }
        // Returns the first panel data (same shape as getPanel)
        return response.json();
      }),

    /** Get the panel at a specific depth (for page slider navigation) */
    getPanelAtDepth: publicProcedure
      .input(z.object({
        worldId: z.string(),
        fromPanelId: z.string(),
        targetDepth: z.number().int().min(1),
      }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/api/world/${encodeURIComponent(input.worldId)}/panel-at-depth?from_panel_external_id=${encodeURIComponent(input.fromPanelId)}&target_depth=${input.targetDepth}`;
        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Get panel at depth failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ panel_external_id: string; depth: number }>;
      }),

    /** Like a world */
    like: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const response = await fetch(
          `https://getfreeroam.com/api/worlds/${encodeURIComponent(input.worldId)}/like`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Like world failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; like_count: number }>;
      }),

    /** Unlike a world */
    unlike: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const response = await fetch(
          `https://getfreeroam.com/api/worlds/${encodeURIComponent(input.worldId)}/like`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Unlike world failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; like_count: number }>;
      }),

    /** Edit a single summary block in the journal */
    editSummary: publicProcedure
      .input(z.object({
        worldId: z.string(),
        summary: z.string(),
        blockIndex: z.number().int().min(0),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/world/${encodeURIComponent(input.worldId)}/journal/summary`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              "content-type": "application/json",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
            body: JSON.stringify({ summary: input.summary, blockIndex: input.blockIndex }),
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Edit summary failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ success: boolean; message: string }>;
      }),

    /** Fetch journal data for a world (chapters, summaries, entity state) */
    getJournal: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/world/${encodeURIComponent(input.worldId)}/journal`,
          {
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Get journal failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          summary: string | null;
          chapters: Array<{
            chapter_number: number;
            panel_external_id: string;
            image_url: string;
          }>;
          compressedSummaries: Array<{
            type: string;
            level: number;
            chapter_numbers: number[];
            content: string;
          }>;
          canEditSummary: boolean;
        }>;
      }),

    /** List all bookmarks for a world */
    listBookmarks: publicProcedure
      .input(z.object({ worldId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/world/${encodeURIComponent(input.worldId)}/bookmarks`,
          {
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`List bookmarks failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          progress_panel: {
            panel_external_id: string;
            depth: number;
            image_url: string;
            updated_at: string;
            type: "progress";
          } | null;
          bookmarks: Array<{
            panel_external_id: string;
            depth: number;
            image_url: string;
            type: "bookmark";
          }>;
        }>;
      }),
  }),

  // ─── World Collections (Freeroam API proxy, no local DB) ──────────────────────────────────
  worldCollections: router({
    /** List all world collections for a user */
    list: publicProcedure
      .input(z.object({ username: z.string().default("Test Tank") }))
      .query(async ({ input, ctx }) => {
        if (!hasUserCookie(ctx)) return [];

        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const encodedUsername = encodeURIComponent(input.username);
        const url = `https://getfreeroam.com/api/user/${encodedUsername}/collections`;

        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Collections API responded with status ${response.status}: ${text}`);
        }

        const data = await response.json() as {
          collections: Array<{
            external_id: string;
            name: string;
            description: string | null;
            cover_image_url: string | null;
            privacy_status: string;
            owner: { username: string; avatar_url: string | null; is_verified: boolean };
            world_count: number;
            is_owner: boolean;
          }>;
        };

        return data.collections.map(c => ({
          ...c,
          privacy_status: (["private", "public", "unlisted"].includes(c.privacy_status)
            ? c.privacy_status
            : "private") as "private" | "public" | "unlisted",
        }));
      }),

    /** Get a single collection with its worlds */
    get: publicProcedure
      .input(z.object({ collectionId: z.string() }))
      .query(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const url = `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}`;

        const response = await fetch(url, {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Collection detail API responded with status ${response.status}: ${text}`);
        }

        const data = await response.json() as {
          collection: {
            external_id: string;
            name: string;
            description: string | null;
            cover_image_url: string | null;
            privacy_status: string;
            invite_token: string | null;
            owner: { username: string; avatar_url: string | null; is_verified: boolean };
          };
          worlds: Array<{
            external_id: string;
            name: string;
            cover_image_url: string | null;
            avg_color: { r: number; g: number; b: number } | null;
            logline: string;
            description: string;
            interaction_count: number;
            owner: { username: string; is_verified: boolean };
            privacy_status: string;
            is_draft: boolean;
          }>;
          is_owner: boolean;
          is_collaborator: boolean;
          can_edit: boolean;
          collaborators: unknown[];
          collaborator_count: number;
        };

        return {
          collection: {
            ...data.collection,
            privacy_status: (["private", "public", "unlisted"].includes(data.collection.privacy_status)
              ? data.collection.privacy_status
              : "private") as "private" | "public" | "unlisted",
          },
          worlds: data.worlds.map(w => ({
            ...w,
            privacy_status: (["private", "public", "unlisted"].includes(w.privacy_status)
              ? w.privacy_status
              : "private") as "private" | "public" | "unlisted",
          })),
          is_owner: data.is_owner,
          can_edit: data.can_edit,
        };
      }),

    /** Create a new world collection */
    create: publicProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/collections", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ name: input.name }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Create collection failed (${response.status}): ${text}`);
        }

        const data = await response.json() as {
          success: boolean;
          collection: { external_id: string; name: string; description: string | null; privacy_status: string };
        };
        return data;
      }),

    /** Update a world collection (name, description, privacy_status) */
    update: publicProcedure
      .input(z.object({
        collectionId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        privacy_status: z.enum(["private", "public", "unlisted"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const body: Record<string, unknown> = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.description !== undefined) body.description = input.description;
        if (input.privacy_status !== undefined) body.privacy_status = input.privacy_status;

        const response = await fetch(
          `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}`,
          {
            method: "PUT",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              "content-type": "application/json",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Update collection failed (${response.status}): ${text}`);
        }

        return { success: true };
      }),

    /** Delete a world collection */
    delete: publicProcedure
      .input(z.object({ collectionId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch(
          `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Delete collection failed (${response.status}): ${text}`);
        }

        return { success: true };
      }),

    /** Add a world to a collection (Freeroam API + local DB) */
    addWorld: publicProcedure
      .input(z.object({ collectionId: z.string(), worldExternalId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const accountId = getFreeroamAccountId(ctx);

        // Call Freeroam API
        const response = await fetch(
          `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}/worlds`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              "content-type": "application/json",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
            body: JSON.stringify({ world_external_id: input.worldExternalId }),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Add world to collection failed (${response.status}): ${text}`);
        }

        // Also save to local DB for private world tracking
        if (accountId) {
          await addWorldToCollectionLocal(input.collectionId, input.worldExternalId, accountId);
        }

        return { success: true };
      }),

    /** Remove a world from a collection (Freeroam API + local DB) */
    removeWorld: publicProcedure
      .input(z.object({ collectionId: z.string(), worldExternalId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");
        const accountId = getFreeroamAccountId(ctx);

        // Call Freeroam API
        const response = await fetch(
          `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}/worlds/${encodeURIComponent(input.worldExternalId)}`,
          {
            method: "DELETE",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Remove world from collection failed (${response.status}): ${text}`);
        }

        // Also remove from local DB
        if (accountId) {
          await removeWorldFromCollectionLocal(input.collectionId, input.worldExternalId, accountId);
        }

        return { success: true };
      }),

    /** Get local membership: world IDs in a collection (includes private worlds) */
    getMembers: publicProcedure
      .input(z.object({ collectionId: z.string() }))
      .query(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) return [];
        return getWorldCollectionMembers(input.collectionId, accountId);
      }),

    /** Get all collection IDs that a specific world belongs to */
    getWorldMemberships: publicProcedure
      .input(z.object({ worldExternalId: z.string() }))
      .query(async ({ input, ctx }) => {
        const accountId = getFreeroamAccountId(ctx);
        if (!accountId) return [];
        return getWorldMemberships(input.worldExternalId, accountId);
      }),

    /** Upload a cover image for a collection */
    uploadCover: publicProcedure
      .input(z.object({
        collectionId: z.string(),
        fileBase64: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        // Decode base64 back to binary
        const buffer = Buffer.from(input.fileBase64, "base64");

        // Build multipart/form-data using FormData
        const formData = new FormData();
        const blob = new Blob([buffer], { type: input.mimeType });
        formData.append("file", blob, "cover.png");

        const response = await fetch(
          `https://getfreeroam.com/api/collections/${encodeURIComponent(input.collectionId)}/cover`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
            body: formData,
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Upload cover failed (${response.status}): ${text}`);
        }

        const data = await response.json() as { cover_image_url?: string; url?: string; success?: boolean };
        return { success: true, cover_image_url: data.cover_image_url ?? data.url ?? null };
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

  // ─── User Preferences (global, not per-world) ────────────────────────────────────────
  preferences: router({
    /** Get the user's global story preferences */
    get: publicProcedure
      .query(async ({ ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/profile/preferences", {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Get preferences failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{
          language: string;
          image_content_setting: string;
          writing_content_setting: string;
          story_preferences: string;
          show_choice_ideas_by_default: boolean | null;
          resolved_show_choice_ideas_by_default: boolean;
        }>;
      }),

    /** Update the user's global story preferences */
    update: publicProcedure
      .input(z.object({
        language: z.string().optional(),
        image_content_setting: z.string().optional(),
        writing_content_setting: z.string().optional(),
        story_preferences: z.string().optional(),
        show_choice_ideas_by_default: z.boolean().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookie = getFreeroamCookie(ctx);
        if (!cookie) throw new Error("Cookie not configured in environment");

        const response = await fetch("https://getfreeroam.com/api/profile/preferences", {
          method: "PUT",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Update preferences failed (${response.status}): ${text}`);
        }
        return response.json() as Promise<{ message: string; preferences: Record<string, unknown> }>;
      }),
  }),

  // ─── ElevenLabs Voice ───────────────────────────────────────────────────────
  voice: router({
    /** List all available ElevenLabs voices for the user */
    listVoices: publicProcedure.query(async () => {
      const apiKey = process.env.ELEVEN_LABS_API_KEY;
      if (!apiKey) throw new Error('ElevenLabs API key not configured');
      const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
        headers: { 'xi-api-key': apiKey },
      });
      if (!res.ok) throw new Error(`ElevenLabs listVoices failed (${res.status})`);
      const data = await res.json() as { voices: Array<{ voice_id: string; name: string; category: string; labels: Record<string, string>; preview_url: string | null }> };
      return data.voices;
    }),

    /** Get the voice assignment for a character */
    getVoiceAssignment: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { characterVoices } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(characterVoices).where(eq(characterVoices.characterId, input.characterId)).limit(1);
        return rows[0] ?? null;
      }),

    /** Assign or update a voice for a character */
    assignVoice: publicProcedure
      .input(z.object({
        characterId: z.string(),
        voiceId: z.string(),
        voiceName: z.string(),
        stability: z.string().optional().default('0.5'),
        similarityBoost: z.string().optional().default('0.75'),
        style: z.string().optional().default('0'),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { characterVoices } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        // Upsert: update if exists, insert if not
        const existing = await db.select().from(characterVoices).where(eq(characterVoices.characterId, input.characterId)).limit(1);
        if (existing.length > 0) {
          await db.update(characterVoices).set({
            voiceId: input.voiceId,
            voiceName: input.voiceName,
            stability: input.stability,
            similarityBoost: input.similarityBoost,
            style: input.style,
          }).where(eq(characterVoices.characterId, input.characterId));
        } else {
          await db.insert(characterVoices).values({
            characterId: input.characterId,
            voiceId: input.voiceId,
            voiceName: input.voiceName,
            stability: input.stability,
            similarityBoost: input.similarityBoost,
            style: input.style,
          });
        }
        return { ok: true };
      }),

    /** Remove a voice assignment for a character */
    removeVoice: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { characterVoices } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        await db.delete(characterVoices).where(eq(characterVoices.characterId, input.characterId));
        return { ok: true };
      }),

    /** Generate TTS audio for a panel — checks cache first, generates if miss, stores in S3 */
    generateSpeech: publicProcedure
      .input(z.object({
        panelId: z.string(),
        worldId: z.string(),
        characterName: z.string(), // 'narrator' for narration
        characterId: z.string().optional(), // Freeroam character external_id
        text: z.string(),
        voiceId: z.string(),
        stability: z.string().optional().default('0.5'),
        similarityBoost: z.string().optional().default('0.75'),
        style: z.string().optional().default('0'),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { ttsCache } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        const { storagePut } = await import('./storage');
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Check cache first
        const cached = await db.select().from(ttsCache).where(
          and(
            eq(ttsCache.panelId, input.panelId),
            eq(ttsCache.worldId, input.worldId),
            eq(ttsCache.characterName, input.characterName),
          )
        ).limit(1);
        if (cached.length > 0) {
          return { audioUrl: cached[0].audioUrl, fromCache: true };
        }

        // Generate via ElevenLabs
        const apiKey = process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) throw new Error('ElevenLabs API key not configured');

        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: input.text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: parseFloat(input.stability),
              similarity_boost: parseFloat(input.similarityBoost),
              style: parseFloat(input.style),
            },
          }),
        });

        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`ElevenLabs TTS failed (${ttsRes.status}): ${errText}`);
        }

        // Upload audio to S3
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        const fileKey = `tts/${input.worldId}/${input.panelId}/${input.characterName.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        const { url: audioUrl } = await storagePut(fileKey, audioBuffer, 'audio/mpeg');

        // Store in cache
        await db.insert(ttsCache).values({
          panelId: input.panelId,
          worldId: input.worldId,
          characterName: input.characterName,
          characterId: input.characterId ?? null,
          voiceId: input.voiceId,
          audioUrl,
        });

        return { audioUrl, fromCache: false };
      }),

    /** Get an app setting by key */
    getSetting: publicProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { appSettings } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(appSettings).where(eq(appSettings.key, input.key)).limit(1);
        return rows[0]?.value ?? null;
      }),

    /** Set an app setting */
    setSetting: publicProcedure
      .input(z.object({ key: z.string(), value: z.string().nullable() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { appSettings } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const existing = await db.select().from(appSettings).where(eq(appSettings.key, input.key)).limit(1);
        if (existing.length > 0) {
          await db.update(appSettings).set({ value: input.value }).where(eq(appSettings.key, input.key));
        } else {
          await db.insert(appSettings).values({ key: input.key, value: input.value });
        }
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

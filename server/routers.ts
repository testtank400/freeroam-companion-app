import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import { saveNsfwImageLocally } from "./nsfwLocalStorage";
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
  return process.env.FREEROAM_DEV_COOKIE ?? process.env.cookie ?? '';
}


/**
 * Returns true if the request has a user-provided cookie (not just the owner fallback).
 * Used to gate character-loading endpoints so non-owner users see an empty roster
 * rather than the owner's characters.
 */
function hasUserCookie(ctx: { req: { headers: Record<string, string | string[] | undefined> } }): boolean {
  const userCookie = ctx.req.headers['x-freeroam-cookie'];
  if (userCookie && typeof userCookie === 'string' && userCookie.trim()) return true;
  // In dev mode, treat the env cookie as a valid user cookie
  if (process.env.NODE_ENV === 'development' && process.env.FREEROAM_DEV_COOKIE) return true;
  return false;
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

    // Single-request library endpoint — returns ALL characters with is_saved, description, tags.
    // Freeroam quirk: the URL still requests page=1&limit=18, but the API returns the full
    // library in one response (limit is not honored as real pagination). See PROJECT.md.
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
            // limit=18 is historical; Freeroam currently returns the entire library anyway
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
        // Explicitly extract fields to avoid tRPC superjson depth limit
        const raw = await response.json() as Record<string, unknown>;
        const pc = raw.panel_content as Record<string, unknown> | null;
        const np = raw.next_panel as Record<string, unknown> | null;
        const npPc = np?.panel_content as Record<string, unknown> | null;

        const extractPanelContent = (content: Record<string, unknown> | null) => {
          if (!content) return null;
          return {
            type: content.type as string,
            narration: content.narration as string | null,
            is_action: content.is_action as boolean,
            requires_action: content.requires_action as boolean,
            depth: content.depth as number,
            is_chat: content.is_chat as boolean,
            chapter_header: content.chapter_header as string | null,
            chapter_start: content.chapter_start as unknown,
            chapter_end: content.chapter_end as unknown,
            action: content.action as string | null,
            images: (content.images as Array<Record<string, unknown>> | null)?.map(img => ({
              url: img.url as string,
              prompt: img.prompt as string,
              generation_type: img.generation_type as string | null,
              visible_characters: img.visible_characters as Record<string, { name: string; external_id: string }>,
              shot: img.shot as string | null,
              is_nsfw: img.is_nsfw as boolean | null,
            })) ?? [],
            speech_bubbles: (content.speech_bubbles as Array<Record<string, unknown>> | null)?.map(sb => ({
              text: sb.text as string,
              character: sb.character as string,
              style: sb.style as string,
              isRequiresActionChat: sb.isRequiresActionChat as boolean,
              position: sb.position as Record<string, number>,
            })) ?? [],
            choice: content.choice ? {
              question: (content.choice as Record<string, unknown>).question as string,
              options: ((content.choice as Record<string, unknown>).options as Array<{ text: string; action_panel_external_id: string }>) ?? [],
              selected_choice: (content.choice as Record<string, unknown>).selected_choice as string | null,
              is_chat: (content.choice as Record<string, unknown>).is_chat as boolean,
            } : null,
          };
        };

        // character_references live on panel_content in Freeroam; we lift them to top-level
        // for the client. Also attach on next_panel so embedded navigation still has cast.
        const extractCharacterReferences = (content: Record<string, unknown> | null | undefined) => {
          if (!content?.character_references) return {};
          return Object.fromEntries(
            Object.entries(content.character_references as Record<string, Record<string, unknown>>).map(([id, ref]) => [
              id,
              {
                external_id: ref.external_id as string,
                name: ref.name as string,
                appearance: ref.appearance as string | null,
                headshot_url: ref.headshot_url as string | null,
                is_main_character: ref.is_main_character as boolean,
              },
            ])
          );
        };

        return {
          panel_id: raw.panel_id as string,
          world_id: raw.world_id as string,
          next_panel_id: raw.next_panel_id as string | null,
          prev_panel_id: raw.prev_panel_id as string | null,
          is_action: raw.is_action as boolean,
          requires_action: raw.requires_action as boolean,
          depth: raw.depth as number,
          forward_state: raw.forward_state as string,
          show_jump_to_latest: raw.show_jump_to_latest as boolean,
          jump_to_latest_panel_id: raw.jump_to_latest_panel_id as string | null,
          is_owner: raw.is_owner as boolean,
          text_feedback: raw.text_feedback as unknown[] ?? [],
          image_prompt_edit_enabled: raw.image_prompt_edit_enabled as boolean ?? false,
          phone_experiment_enabled: raw.phone_experiment_enabled as boolean ?? false,
          in_world_time: raw.in_world_time as string | null,
          location: raw.location as string | null,
          phone_unread_count: raw.phone_unread_count as number ?? 0,
          phone: raw.phone as { total: number; by_app: Record<string, unknown>; recent: unknown[]; version: string | null; seen_at_by_app: Record<string, unknown> } ?? { total: 0, by_app: {}, recent: [], version: null, seen_at_by_app: {} },
          panel_content: extractPanelContent(pc),
          // character_references: map of characterId -> { external_id, name, appearance, headshot_url, is_main_character }
          // Used for NSFW image generation — provides appearance descriptions and headshot URLs
          character_references: extractCharacterReferences(pc),
          next_panel: np ? {
            panel_id: np.panel_id as string,
            world_id: np.world_id as string ?? raw.world_id as string,
            next_panel_id: np.next_panel_id as string | null,
            prev_panel_id: np.prev_panel_id as string | null,
            is_action: np.is_action as boolean,
            requires_action: np.requires_action as boolean,
            depth: np.depth as number,
            forward_state: np.forward_state as string,
            show_jump_to_latest: false,
            jump_to_latest_panel_id: null,
            is_owner: raw.is_owner as boolean,
            text_feedback: [],
            image_prompt_edit_enabled: false,
            phone_experiment_enabled: false,
            in_world_time: null,
            location: null,
            phone_unread_count: 0,
            phone: { total: 0, by_app: {}, recent: [], version: null, seen_at_by_app: {} },
            panel_content: extractPanelContent(npPc),
            character_references: extractCharacterReferences(npPc),
            next_panel: null,
          } : null,
        };
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
        // Pass through the full response including the partial field.
        // Freeroam now returns partial panel data while the panel is generating:
        //   { ready: false } — still generating, no text yet
        //   { ready: false, partial: { text: string, speaker: string|null, done: boolean } }
        //     partial.done=false → text still streaming
        //     partial.done=true  → text complete, image is now generating
        //   { ready: true, panel_id: string } — both text and image are done
        return response.json() as Promise<
          | { ready: false; partial?: { text: string; speaker: string | null; done: boolean } }
          | { ready: true; panel_id: string }
        >;
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
    getPanelCharacters: publicProcedure
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
        const raw = await response.json() as Record<string, unknown>;
        // Flatten the action_panel_content to avoid tRPC serialization depth limits
        const apc = raw.action_panel_content as Record<string, unknown> | null;
        return {
          action_panel_id: raw.action_panel_id as string,
          next_panel_id: raw.next_panel_id as string | null,
          prev_panel_id: raw.prev_panel_id as string | null,
          is_chapter_start: raw.is_chapter_start as boolean,
          generation_started: raw.generation_started as boolean,
          forward_state: raw.forward_state as string,
          action_panel_content: apc ? {
            type: apc.type as string,
            narration: apc.narration as string | null,
            is_action: apc.is_action as boolean,
            requires_action: apc.requires_action as boolean,
            depth: apc.depth as number,
            action: apc.action as string | null,
            speech_bubbles: (apc.speech_bubbles as Array<Record<string, unknown>> | null)?.map(sb => ({
              text: sb.text as string,
              character: sb.character as string,
              style: sb.style as string,
              position: { x: 0, y: 0, width: 0, height: 0 },
            })) ?? [],
            images: (apc.images as Array<Record<string, unknown>> | null)?.map(img => ({
              url: img.url as string,
              prompt: img.prompt as string,
              generation_type: img.generation_type as string | null,
              visible_characters: img.visible_characters as Record<string, { name: string; external_id: string }>,
              shot: img.shot as string | null,
              is_nsfw: img.is_nsfw as boolean | null,
            })) ?? [],
            choice: apc.choice ? {
              question: (apc.choice as Record<string, unknown>).question as string,
              options: ((apc.choice as Record<string, unknown>).options as Array<{ text: string; action_panel_external_id: string }>) ?? [],
              selected_choice: (apc.choice as Record<string, unknown>).selected_choice as string | null,
              is_chat: (apc.choice as Record<string, unknown>).is_chat as boolean,
            } : null,
          } : null,
        };
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

    /** Clone a new voice from audio samples (IVC - Instant Voice Cloning) */
    cloneVoice: publicProcedure
      .input(z.object({
        name: z.string(),
        description: z.string().optional(),
        removeBackgroundNoise: z.boolean().optional().default(false),
        // Audio file as base64 string with mime type
        audioBase64: z.string(),
        audioMimeType: z.string().default('audio/mpeg'),
        audioFileName: z.string().default('sample.mp3'),
      }))
      .mutation(async ({ input }) => {
        const apiKey = process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) throw new Error('ElevenLabs API key not configured');

        // Convert base64 to buffer
        const audioBuffer = Buffer.from(input.audioBase64, 'base64');
        const blob = new Blob([audioBuffer], { type: input.audioMimeType });

        // Build multipart form
        const formData = new FormData();
        formData.append('name', input.name);
        if (input.description) formData.append('description', input.description);
        formData.append('remove_background_noise', String(input.removeBackgroundNoise));
        formData.append('files', blob, input.audioFileName);

        const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`ElevenLabs voice cloning failed (${res.status}): ${errText}`);
        }

        const data = await res.json() as { voice_id: string; requires_verification: boolean };
        return data;
      }),

    /** Get all character IDs that have voice assignments (for badge display) */
    listVoicedCharacters: publicProcedure.query(async () => {
      const { getDb } = await import('./db');
      const { characterVoices } = await import('../drizzle/schema');
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({ characterId: characterVoices.characterId }).from(characterVoices);
      return rows.map(r => r.characterId);
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
        languageCode: z.string().nullable().optional(),
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
            languageCode: input.languageCode ?? null,
          }).where(eq(characterVoices.characterId, input.characterId));
        } else {
          await db.insert(characterVoices).values({
            characterId: input.characterId,
            voiceId: input.voiceId,
            voiceName: input.voiceName,
            stability: input.stability,
            similarityBoost: input.similarityBoost,
            style: input.style,
            languageCode: input.languageCode ?? null,
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
        characterId: z.string().optional(), // Freeroam character external_id — required for spoken dialogue
        text: z.string(),
        voiceId: z.string(),
        stability: z.string().optional().default('0.5'),
        similarityBoost: z.string().optional().default('0.75'),
        style: z.string().optional().default('0'),
        languageCode: z.string().nullable().optional(), // ISO 639-1 code to anchor accent
        previousText: z.string().nullable().optional(), // Previous panel dialogue for context
        previousVoiceId: z.string().nullable().optional(), // Previous panel voice ID
        nextText: z.string().nullable().optional(), // Next panel dialogue for context
        nextVoiceId: z.string().nullable().optional(), // Next panel voice ID
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { ttsCache } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        const { storagePut } = await import('./storage');
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Cache key is characterId. Spoken dialogue must pass a real Freeroam id —
        // never fall back to __narrator__ (that caused cache misses and double ElevenLabs bills).
        const isNarrator =
          input.characterName === 'narrator' ||
          input.characterId === '__narrator__';
        if (!isNarrator && (!input.characterId || !input.characterId.trim())) {
          throw new Error('characterId is required for character TTS (refusing __narrator__ fallback)');
        }
        const lookupCharId = isNarrator ? '__narrator__' : input.characterId!.trim();

        // How long a 'generating' row may block before we reclaim and retry
        const STALE_GENERATING_MS = 3 * 60 * 1000;

        // Check cache first — use characterId as the stable lookup key (names are mutable)
        const cached = await db.select().from(ttsCache).where(
          and(
            eq(ttsCache.panelId, input.panelId),
            eq(ttsCache.worldId, input.worldId),
            eq(ttsCache.characterId, lookupCharId),
          )
        ).limit(1);
        if (cached.length > 0) {
          const row = cached[0];
          if (row.status === 'generating') {
            const age = Date.now() - new Date(row.createdAt).getTime();
            if (age < STALE_GENERATING_MS) {
              // Still in progress — tell the client to poll
              return { audioUrl: null, fromCache: false, generating: true };
            }
            // Stale claim (process died mid-generation) — delete and fall through to regenerate
            await db.delete(ttsCache).where(eq(ttsCache.id, row.id));
          } else if (row.audioUrl) {
            return { audioUrl: row.audioUrl, fromCache: true, generating: false };
          } else {
            // ready/unknown but empty URL — treat as invalid and regenerate
            await db.delete(ttsCache).where(eq(ttsCache.id, row.id));
          }
        }

        // Insert a placeholder row to prevent concurrent duplicate generation
        // (unique index on panelId+worldId+characterId makes the catch path reliable)
        try {
          await db.insert(ttsCache).values({
            panelId: input.panelId,
            worldId: input.worldId,
            characterName: input.characterName,
            characterId: lookupCharId,
            voiceId: input.voiceId,
            audioUrl: '',
            status: 'generating',
          });
        } catch {
          // Race condition: another request inserted first — poll instead of generating twice
          return { audioUrl: null, fromCache: false, generating: true };
        }

        // Generate via ElevenLabs
        const apiKey = process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) throw new Error('ElevenLabs API key not configured');

        // Build context turns for LLM tagging
        type TurnInput = { text: string; voiceId: string; isCurrent: boolean };
        const turns: TurnInput[] = [];
        if (input.previousText && input.previousVoiceId) {
          turns.push({ text: input.previousText, voiceId: input.previousVoiceId, isCurrent: false });
        }
        turns.push({ text: input.text, voiceId: input.voiceId, isCurrent: true });
        if (input.nextText && input.nextVoiceId) {
          turns.push({ text: input.nextText, voiceId: input.nextVoiceId, isCurrent: false });
        }
        const currentTurnIndex = turns.findIndex(t => t.isCurrent);

        // LLM: add delivery tags to all turns using full context (via Grok API)
        const taggedTexts = turns.map(t => t.text); // default: no tags
        try {
          const grokApiKey = process.env.GROK_API_KEY;
          if (grokApiKey) {
            const turnDescriptions = turns.map((t, i) => `Turn ${i + 1}: "${t.text}"`);
            const systemPrompt = `You are an audio director for an AI story reader using ElevenLabs v3. Given ${turns.length} dialogue turn(s) in order, add delivery tags to each turn that best capture the emotional delivery given the full context. You may use one or more tags per turn — place them at the start of the text in square brackets. Tags are natural language: [laughing], [whispering], [shouting], [yelling], [screaming], [crying], [nervous], [angry], [furious], [excited], [sad], [sarcastic], [tense], [seductive], [terrified], [relieved], [disgusted], [fearful], [surprised], [sighing], [breathless], [trembling], [cold], [warm], [playful], [bitter], [desperate], etc. Multiple tags are allowed, e.g. [nervous][whispering]. IMPORTANT: If the text is written in ALL CAPS or contains ALL CAPS words, the character is shouting or yelling — always tag it with [shouting] or [yelling]. For neutral delivery, output the text unchanged. Output ONLY the tagged lines, one per line, in the same order. Do not add any explanation or numbering.`;
            const grokRes = await fetch('https://api.x.ai/v1/responses', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${grokApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'grok-4.3',
                store: false, // Don't store on xAI servers
                input: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: turnDescriptions.join('\n') },
                ],
                max_output_tokens: 300,
              }),
            });
            if (grokRes.ok) {
              const grokData = await grokRes.json() as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
              // Find the message output item and extract its text content
              const msgItem = grokData?.output?.find(o => o.type === 'message');
              const msgContent = msgItem?.content?.find(c => c.type === 'output_text')?.text;
              if (typeof msgContent === 'string') {
                const lines = msgContent.trim().split('\n').map((l: string) => l.trim()).filter(Boolean);
                if (lines.length === turns.length) {
                  lines.forEach((line: string, i: number) => { taggedTexts[i] = line; });
                }
              }
            }
          }
        } catch {
          // Non-fatal — proceed without tags if Grok fails
        }

        // Prepend accent tag if languageCode is set
        const accentTagMap: Record<string, string> = {
          'it': 'Italian', 'fr': 'French', 'de': 'German', 'es': 'Spanish',
          'pt': 'Portuguese', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
          'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi', 'pl': 'Polish',
          'nl': 'Dutch', 'sv': 'Swedish', 'tr': 'Turkish',
          'en-GB': 'British', 'en-AU': 'Australian',
        };
        const accentLabel = input.languageCode ? accentTagMap[input.languageCode] : null;
        const accentTag = accentLabel ? `[${accentLabel} accent]` : '';
        const currentTaggedText = accentTag
          ? `${accentTag} ${taggedTexts[currentTurnIndex]}`
          : taggedTexts[currentTurnIndex];

        // Call single-turn TTS with the LLM-tagged current panel text
        const ttsBody: Record<string, unknown> = {
          text: currentTaggedText,
          model_id: 'eleven_v3',
          voice_settings: {
            stability: parseFloat(input.stability),
            similarity_boost: parseFloat(input.similarityBoost),
            style: parseFloat(input.style),
          },
        };
        if (input.languageCode) ttsBody.language_code = input.languageCode;

        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsBody),
        });

        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          // Clean up the placeholder row so future requests can retry
          const { eq: eqClean, and: andClean } = await import('drizzle-orm');
          await db.delete(ttsCache).where(
            andClean(
              eqClean(ttsCache.panelId, input.panelId),
              eqClean(ttsCache.worldId, input.worldId),
              eqClean(ttsCache.characterId, lookupCharId),
            )
          ).catch(() => {}); // non-fatal cleanup
          throw new Error(`ElevenLabs TTS failed (${ttsRes.status}): ${errText}`);
        }

        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

        // Upload audio to S3
        const fileKey = `tts/${input.worldId}/${input.panelId}/${input.characterName.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        const { url: audioUrl } = await storagePut(fileKey, audioBuffer, 'audio/mpeg');

        // Update placeholder row to ready with the real audio URL
        const { eq: eqUpdate, and: andUpdate } = await import('drizzle-orm');
        await db.update(ttsCache).set({ audioUrl, status: 'ready' }).where(
          andUpdate(
            eqUpdate(ttsCache.panelId, input.panelId),
            eqUpdate(ttsCache.worldId, input.worldId),
            eqUpdate(ttsCache.characterId, lookupCharId),
          )
        );

        return { audioUrl, fromCache: false, generating: false };
      }),

    /** Poll whether a TTS clip has finished generating — returns audioUrl when ready, null when still generating */
    checkTtsReady: publicProcedure
      .input(z.object({
        panelId: z.string(),
        worldId: z.string(),
        characterId: z.string(),
      }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { ttsCache } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) return { audioUrl: null, ready: false };
        const rows = await db.select().from(ttsCache).where(
          and(
            eq(ttsCache.panelId, input.panelId),
            eq(ttsCache.worldId, input.worldId),
            eq(ttsCache.characterId, input.characterId),
          )
        ).limit(1);
        if (rows.length === 0) return { audioUrl: null, ready: false };
        if (rows[0].status === 'generating') return { audioUrl: null, ready: false };
        if (!rows[0].audioUrl) return { audioUrl: null, ready: false };
        return { audioUrl: rows[0].audioUrl, ready: true };
      }),

    /** Clear all TTS cache entries (optionally filtered by characterId) */
    clearVoiceCache: publicProcedure
      .input(z.object({ characterId: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { ttsCache } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        if (input.characterId) {
          await db.delete(ttsCache).where(eq(ttsCache.characterId, input.characterId));
        } else {
          // Clear all cache entries
          await db.delete(ttsCache);
        }
        return { ok: true };
      }),

    /** Clear all generated NSFW image cache entries */
    clearImageCache: publicProcedure
      .mutation(async () => {
        const { getDb } = await import('./db');
        const { imageCache } = await import('../drizzle/schema');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        await db.delete(imageCache);
        return { ok: true };
      }),

    /** Test a voice with given settings — generates TTS for a short phrase, no caching */
    testVoice: publicProcedure
      .input(z.object({
        voiceId: z.string(),
        text: z.string().max(300),
        stability: z.string().optional().default('0.5'),
        similarityBoost: z.string().optional().default('0.75'),
        style: z.string().optional().default('0'),
        languageCode: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKey = process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) throw new Error('ElevenLabs API key not configured');
        const testBody: Record<string, unknown> = {
          text: input.text,
          model_id: 'eleven_v3',
          voice_settings: {
            stability: parseFloat(input.stability),
            similarity_boost: parseFloat(input.similarityBoost),
            style: parseFloat(input.style),
          },
        };
        if (input.languageCode) testBody.language_code = input.languageCode;
        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(testBody),
        });
        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`ElevenLabs TTS failed (${ttsRes.status}): ${errText}`);
        }
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        const fileKey = `tts-test/${input.voiceId}-${Date.now()}.mp3`;
        const { url: audioUrl } = await storagePut(fileKey, audioBuffer, 'audio/mpeg');
        return { audioUrl };
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

    /** Generate NSFW image using Seedream v5.0 Pro Edit via Atlas Cloud.
     * Takes the Freeroam image prompt, shot type, and character references.
     * Replaces ~~CharacterName tokens with appearance descriptions.
     * Uses character headshots as reference images for Seedream.
     * Results are cached in image_cache to avoid regeneration.
     */
    generateNsfwImage: publicProcedure
      .input(z.object({
        panelId: z.string(),
        worldId: z.string(),
        /** Original Freeroam image prompt (may contain ~~CharacterName tokens) */
        prompt: z.string(),
        /** URL of the original Freeroam panel image (used for art style detection) */
        imageUrl: z.string().nullable(),
        /** User's action text if this is an action panel — the user's explicit intent */
        actionText: z.string().nullable(),
        /** Story text from the previous panel (narration + dialogue) for scene context */
        prevPanelText: z.string().nullable(),
        /** Story text from the current panel (narration + dialogue) for scene context */
        currentPanelText: z.string().nullable(),
        /** Story text from the next panel (narration + dialogue) for scene context */
        nextPanelText: z.string().nullable(),
        /** Shot type from Freeroam: 'Close-Up', 'Full', etc. */
        shot: z.string().nullable(),
        /** Character references from panel_content.character_references */
        characterReferences: z.record(z.string(), z.object({
          external_id: z.string(),
          name: z.string(),
          appearance: z.string().nullable(),
          headshot_url: z.string().nullable(),
          is_main_character: z.boolean(),
        })).default({}),
        /** When true (debug mode on), log pipeline details to server console */
        debug: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import('./db');
        const { imageCache } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // ── Cache / single-flight claim ─────────────────────────────────────────
        // IMPORTANT: claim the panelId row BEFORE any slow LLM/image work.
        // Stale policy is shared (server/nsfwImageCache.ts) — only THIS procedure may
        // delete abandoned claims. checkImageReady must stay read-only.
        const {
          releaseStaleNsfwClaim,
          SEEDREAM_EDIT_MODEL,
          SEEDREAM_POLL_INTERVAL_MS,
          SEEDREAM_POLL_MAX_ATTEMPTS,
        } = await import('./nsfwImageCache');

        const readPanelCache = async () => {
          const rows = await db.select().from(imageCache).where(eq(imageCache.panelId, input.panelId)).limit(1);
          // rows[0] is typed as defined without noUncheckedIndexedAccess; use length for true null
          return rows.length > 0 ? rows[0] : null;
        };

        const releaseIfStale = async (row: { status: string; createdAt: Date | string }) =>
          releaseStaleNsfwClaim(
            () => db.delete(imageCache).where(eq(imageCache.panelId, input.panelId)),
            row,
            input.panelId,
          );

        /** After long work, ensure we still own the claim (regenerate may have deleted/replaced it). */
        const stillOwnClaim = async (expectedStatus: 'classifying' | 'generating') => {
          const row = await readPanelCache();
          return !!row && row.status === expectedStatus;
        };

        let existing = await readPanelCache();
        if (existing && (await releaseIfStale(existing))) existing = null;
        if (existing) {
          if (existing.status === 'ready' && existing.imageUrl) {
            return { imageUrl: existing.imageUrl, fromCache: true, generating: false };
          }
          // Seedream in progress — clients may show IMG badge
          if (existing.status === 'generating') {
            return { imageUrl: null, fromCache: false, generating: true };
          }
          // DeepSeek classify only — no Seedream yet; do not treat as image generation
          if (existing.status === 'classifying') {
            return { imageUrl: null, fromCache: false, generating: false, classifying: true };
          }
          if (existing.status === 'skipped') {
            return { imageUrl: null, fromCache: true, generating: false, notNsfw: true };
          }
        }

        // Cross-panel reuse: same Freeroam image URL OR same image prompt → same NSFW art.
        // Freeroam often advances story panels without changing the art; prompt is the reliable "image changed" signal.
        const tryReuseReady = async (row: { status: string; imageUrl: string | null; freeroamImageUrl?: string | null }) => {
          if (row.status !== 'ready' || !row.imageUrl) return null;
          await db.insert(imageCache).values({
            panelId: input.panelId,
            worldId: input.worldId,
            status: 'ready',
            imageUrl: row.imageUrl,
            freeroamImageUrl: input.imageUrl ?? row.freeroamImageUrl ?? null,
            freeroamImagePrompt: input.prompt || null,
          }).catch(() => {});
          const after = await readPanelCache();
          if (after?.status === 'ready' && after.imageUrl) {
            return { imageUrl: after.imageUrl, fromCache: true as const, generating: false as const };
          }
          return { imageUrl: row.imageUrl, fromCache: true as const, generating: false as const };
        };

        if (input.imageUrl) {
          const cachedByUrl = await db.select().from(imageCache)
            .where(eq(imageCache.freeroamImageUrl, input.imageUrl))
            .limit(1);
          if (cachedByUrl.length > 0) {
            if (cachedByUrl[0].status === 'ready' && cachedByUrl[0].imageUrl) {
              const reused = await tryReuseReady(cachedByUrl[0]);
              if (reused) return reused;
            }
            if (cachedByUrl[0].status === 'generating') {
              return { imageUrl: null, fromCache: false, generating: true };
            }
            if (cachedByUrl[0].status === 'classifying') {
              return { imageUrl: null, fromCache: false, generating: false, classifying: true };
            }
            // skipped for this freeroam image — do not re-generate for other panels with same source
            if (cachedByUrl[0].status === 'skipped') {
              await db.insert(imageCache).values({
                panelId: input.panelId,
                worldId: input.worldId,
                status: 'skipped',
                imageUrl: '',
                freeroamImageUrl: input.imageUrl,
                freeroamImagePrompt: input.prompt || null,
              }).catch(() => {});
              return { imageUrl: null, fromCache: true, generating: false, notNsfw: true };
            }
          }
        }

        if (input.prompt) {
          const cachedByPrompt = await db.select().from(imageCache)
            .where(eq(imageCache.freeroamImagePrompt, input.prompt))
            .limit(1);
          if (cachedByPrompt.length > 0) {
            if (cachedByPrompt[0].status === 'ready' && cachedByPrompt[0].imageUrl) {
              const reused = await tryReuseReady(cachedByPrompt[0]);
              if (reused) return reused;
            }
            if (cachedByPrompt[0].status === 'generating') {
              return { imageUrl: null, fromCache: false, generating: true };
            }
            if (cachedByPrompt[0].status === 'classifying') {
              return { imageUrl: null, fromCache: false, generating: false, classifying: true };
            }
            if (cachedByPrompt[0].status === 'skipped') {
              await db.insert(imageCache).values({
                panelId: input.panelId,
                worldId: input.worldId,
                status: 'skipped',
                imageUrl: '',
                freeroamImageUrl: input.imageUrl ?? null,
                freeroamImagePrompt: input.prompt,
              }).catch(() => {});
              return { imageUrl: null, fromCache: true, generating: false, notNsfw: true };
            }
          }
        }

        // Atomic claim as 'classifying' (not 'generating') — IMG badge only after Seedream starts
        let claimed = false;
        try {
          await db.insert(imageCache).values({
            panelId: input.panelId,
            worldId: input.worldId,
            status: 'classifying',
            imageUrl: '',
            freeroamImageUrl: input.imageUrl ?? null,
            freeroamImagePrompt: input.prompt || null,
          });
          claimed = true;
        } catch {
          // Unique conflict — another request owns this panel
          const raced = await readPanelCache();
          if (raced?.status === 'ready' && raced.imageUrl) {
            return { imageUrl: raced.imageUrl, fromCache: true, generating: false };
          }
          if (raced?.status === 'generating') {
            return { imageUrl: null, fromCache: false, generating: true };
          }
          if (raced?.status === 'classifying') {
            return { imageUrl: null, fromCache: false, generating: false, classifying: true };
          }
          if (raced?.status === 'skipped') {
            return { imageUrl: null, fromCache: true, generating: false, notNsfw: true };
          }
          // Unexpected state — do not start a second generation
          return { imageUrl: null, fromCache: false, generating: false };
        }

        // DeepSeek NSFW classification + art style (only the claim holder runs this)
        let detectedArtStyle: string | null = null;
        let enhancedSeedreamPrompt: string | null = null;
        const atlasLlmKey = process.env.ATLAS_CLOUD_API_KEY;

        if (input.debug) {
          console.log('[NSFW DEBUG] Panel:', input.panelId);
          console.log('[NSFW DEBUG] Prompt:', input.prompt?.slice(0, 200));
          console.log('[NSFW DEBUG] ImageUrl:', input.imageUrl);
          console.log('[NSFW DEBUG] ActionText:', input.actionText);
          console.log('[NSFW DEBUG] CharacterRefs:', Object.keys(input.characterReferences).length, 'entries:', Object.values(input.characterReferences).map((r: {name: string; headshot_url: string | null}) => `${r.name}(headshot:${!!r.headshot_url})`).join(', '));
        }

        // Step A: DeepSeek — NSFW classification + art style detection
        // IMPORTANT: Only proceed if DeepSeek EXPLICITLY returns isNsfw: true.
        // Scene text (prev/current/next panel) is included so sexual scenes still flag when the
        // Freeroam image prompt is a mild close-up (hand, wall, object) or otherwise SFW-worded.
        // We do NOT use vision on the panel image or Freeroam's is_nsfw flag.
        let classifyConfirmedNsfw = false;
        if (atlasLlmKey) {
          try {
            const actionContext = input.actionText ? `\nUser action / image instruction: "${input.actionText}"` : '';
            const sceneLines: string[] = [];
            if (input.prevPanelText) sceneLines.push(`Previous panel: ${input.prevPanelText}`);
            if (input.currentPanelText) sceneLines.push(`Current panel: ${input.currentPanelText}`);
            if (input.nextPanelText) sceneLines.push(`Next panel: ${input.nextPanelText}`);
            // Always log scene text that made it into classify (not just booleans)
            console.log('[NSFW] Classify scene context:', {
              panelId: input.panelId,
              prev: input.prevPanelText ? input.prevPanelText.slice(0, 120) : null,
              current: input.currentPanelText ? input.currentPanelText.slice(0, 120) : null,
              next: input.nextPanelText ? input.nextPanelText.slice(0, 120) : null,
              lineCount: sceneLines.length,
            });
            const sceneContext = sceneLines.length > 0
              ? `\nStory context (narration/dialogue around this panel — use this to judge if the SCENE is sexual even when the image prompt is mild):\n${sceneLines.join('\n')}`
              : '';

            /** DeepSeek V4 Flash often puts chain-of-thought in reasoning_content and JSON in content.
             *  With a low max_tokens budget, content can be empty and finish_reason=length — we must
             *  give enough tokens AND recover JSON from content or reasoning_content. */
            const extractJsonObject = (text: string): Record<string, unknown> | null => {
              if (!text) return null;
              const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
              try {
                return JSON.parse(cleaned) as Record<string, unknown>;
              } catch { /* fall through */ }
              // Find last {...} block (answer often after reasoning prose)
              const start = cleaned.lastIndexOf('{');
              const end = cleaned.lastIndexOf('}');
              if (start >= 0 && end > start) {
                try {
                  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
                } catch { /* ignore */ }
              }
              return null;
            };

            const classifyResp = await fetch('https://api.atlascloud.ai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${atlasLlmKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'deepseek-ai/deepseek-v4-flash',
                messages: [
                  { role: 'system', content: 'You are a content and art style analyzer for an adult interactive story app. Prefer isNsfw:true for erotic, sexual, or climax-coded scenes—not only clinical sex or nudity. Romantic sex euphemisms still count. End with a single JSON object only (no markdown).' },
                  { role: 'user', content: `Analyze the image prompt, optional user action, and optional story context below. Return a JSON object with two fields:

1. "isNsfw": boolean. Set true if ANY of the following apply (be inclusive; erotic implication and climax euphemism are enough):

   (a) Image prompt: nudity, bare skin, revealing/lingerie/barely-clothed outfits, sexual poses, intimate framing (lips on ear/neck, faces pressed together, bodies close in lust).

   (b) User action: sexual acts, undressing, explicit or erotic instructions.

   (c) Story context (prev/current/next panel text): sexual acts, intercourse, oral/anal/etc., undressing, arousal, orgasm/climax, OR clear erotic intimacy—even without clinical sex words.

   Examples that MUST be isNsfw:true (do not treat as mere romance):
   - Pinning to a wall/door after locking it; grinding/pressing bodies; panting with desire; claws/hands scrabbling in lust
   - "her body knows what it wants"; bedroom/door-slam seduction; making out that is sexual; dry-humping
   - "so wet/tight/hard" style dialogue
   - Body shaking while pressed forehead-to-forehead / face-to-face with erotic devotion
   - "I'm gonna give you everything" / "every last drop" / finishing / cumming euphemisms during intimacy
   - "love you" combined with physical sexual urgency (shaking, pressing, promising climax)
   - Lips brushing ear/neck with hunger, tears of intensity, half-lidded eyes in a sexual context

   (d) Mild image prompt (hand, face, bag, hallway, soft close-up) does NOT make the scene SFW if story context is erotic or climax-coded.

   Set false ONLY for clearly non-sexual content: pure action/adventure/combat, plot exposition, fully-clothed non-romantic dialogue, light non-sexual affection (friendly hug) with no lust or climax coding.

   When unsure between erotic intimacy vs pure romance/plot, choose true.

2. "artStyle": short art style phrase (e.g. "anime illustration, cel-shaded"). Max 10 words.

Image prompt: "${input.prompt}"${actionContext}${sceneContext}

Respond with ONLY this JSON (no other text): {"isNsfw": true or false, "artStyle": "..."}` },
                ],
                // V4 Flash uses reasoning tokens first; 100 was entirely consumed by CoT with empty content.
                max_tokens: 800,
                temperature: 0,
              }),
            });
            if (classifyResp.ok) {
              const classifyData = await classifyResp.json() as {
                choices?: Array<{
                  finish_reason?: string;
                  message?: { content?: string; reasoning_content?: string };
                }>;
              };
              const msg = classifyData?.choices?.[0]?.message;
              const content = msg?.content?.trim() ?? '';
              const reasoning = (msg as { reasoning_content?: string } | undefined)?.reasoning_content?.trim() ?? '';
              const finishReason = classifyData?.choices?.[0]?.finish_reason;
              console.log('[NSFW] DeepSeek classify raw:', {
                finishReason,
                contentLen: content.length,
                reasoningLen: reasoning.length,
                contentPreview: content.slice(0, 200) || null,
              });
              const parsed =
                extractJsonObject(content) ??
                extractJsonObject(reasoning);
              if (parsed && parsed.isNsfw === true) {
                classifyConfirmedNsfw = true;
                if (typeof parsed.artStyle === 'string' && parsed.artStyle) {
                  detectedArtStyle = parsed.artStyle;
                }
              } else if (parsed) {
                console.log('[NSFW] DeepSeek classify parsed isNsfw=', parsed.isNsfw);
              } else {
                console.warn('[NSFW] DeepSeek classify: no JSON in content or reasoning_content');
              }
            } else {
              console.warn('[NSFW] DeepSeek classify HTTP', classifyResp.status);
            }
          } catch (err) {
            console.error('[NSFW] DeepSeek classify failed', err);
          }
        }

        if (input.debug) {
          console.log('[NSFW DEBUG] DeepSeek classify result: confirmed=', classifyConfirmedNsfw, 'artStyle=', detectedArtStyle);
        }

        // Not NSFW: mark skipped so remounts / retries do not re-enter the pipeline
        if (!classifyConfirmedNsfw) {
          if (input.debug) console.log('[NSFW DEBUG] DeepSeek returned not-NSFW — skipping generation');
          if (claimed && (await stillOwnClaim('classifying'))) {
            await db.update(imageCache).set({
              status: 'skipped',
              imageUrl: '',
              freeroamImageUrl: input.imageUrl ?? null,
              freeroamImagePrompt: input.prompt || null,
            }).where(eq(imageCache.panelId, input.panelId));
          }
          return { imageUrl: null, fromCache: false, generating: false, notNsfw: true };
        }

        const atlasKey = process.env.ATLAS_CLOUD_API_KEY;
        if (!atlasKey) {
          // Release claim so a later retry can run once the key is configured
          if (await stillOwnClaim('classifying')) {
            await db.delete(imageCache).where(eq(imageCache.panelId, input.panelId));
          }
          throw new Error('ATLAS_CLOUD_API_KEY not configured');
        }

        // Regenerate may have wiped our claim while DeepSeek was running — do not continue
        if (!(await stillOwnClaim('classifying'))) {
          console.warn(`[NSFW] Lost classifying claim for ${input.panelId} after DeepSeek — aborting`);
          return { imageUrl: null, fromCache: false, generating: false, aborted: true };
        }

        // Promote claim to Seedream phase — only now should clients show the IMG badge.
        // Reset createdAt so the stale clock covers Seedream wait, not DeepSeek+Seedream combined.
        await db.update(imageCache).set({
          status: 'generating',
          freeroamImageUrl: input.imageUrl ?? null,
          freeroamImagePrompt: input.prompt || null,
          createdAt: new Date(),
        }).where(eq(imageCache.panelId, input.panelId));

        try {
          // Step 1: Extract which character names appear in the prompt (~~Name tokens)
          const promptedNames = new Set<string>();
          const tokenRegex = /~~([\w-]+)/g;
          let match;
          while ((match = tokenRegex.exec(input.prompt)) !== null) {
            promptedNames.add(match[1].toLowerCase().replace(/-/g, ' '));
          }

          // Step 2: Build headshot map AND appearance map for characters that appear in the prompt.
          // Never include headshots for characters not in the prompt — Seedream can't tell them apart.
          // Never use display_headshot_url — only headshot_url.
          const headshotMap: Record<string, string> = {}; // lowerName -> headshot_url
          const appearanceMap: Record<string, string> = {}; // lowerName -> appearance description
          const charRefs = input.characterReferences;

          for (const [, ref] of Object.entries(charRefs) as [string, { external_id: string; name: string; appearance: string | null; headshot_url: string | null; is_main_character: boolean }][]) {
            const lowerName = ref.name.toLowerCase().replace(/-/g, ' ');
            if (promptedNames.has(lowerName)) {
              if (ref.headshot_url) headshotMap[lowerName] = ref.headshot_url;
              if (ref.appearance) appearanceMap[lowerName] = ref.appearance;
            }
          }

          // Step 3: If any prompted characters are still missing headshots or appearances, fetch from Freeroam
          const cookie = getFreeroamCookie(ctx);
          const missingNames = new Set(Array.from(promptedNames).filter(n => !headshotMap[n] || !appearanceMap[n]));

          if (missingNames.size > 0 && cookie) {
            try {
              const currentCharsResp = await fetch(
                `https://getfreeroam.com/api/world/${encodeURIComponent(input.worldId)}/characters/current?current_panel_external_id=${encodeURIComponent(input.panelId)}`,
                {
                  headers: {
                    accept: '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    cookie,
                    origin: 'https://getfreeroam.com',
                    referer: 'https://getfreeroam.com',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                  },
                }
              );
              if (currentCharsResp.ok) {
                const currentCharsData = await currentCharsResp.json() as {
                  world_characters?: Array<{ name: string; headshot_url?: string; appearance?: string }>;
                  story_characters?: Array<{ name: string; headshot_url?: string; appearance?: string }>;
                };
                const allChars = [...(currentCharsData.world_characters ?? []), ...(currentCharsData.story_characters ?? [])];
                for (const char of allChars) {
                  const lowerName = char.name.toLowerCase().replace(/-/g, ' ');
                  if (missingNames.has(lowerName)) {
                    if (char.headshot_url) headshotMap[lowerName] = char.headshot_url;
                    if (char.appearance) appearanceMap[lowerName] = char.appearance;
                  }
                }
              }
            } catch { /* non-fatal */ }
          }

          // Cast size: character_references = who is in the image (authoritative).
          // ~~ tokens are for name/headshot alignment, not for inventing a larger cast.
          const refCount = Object.keys(charRefs).length;
          const characterCount = Math.max(1, refCount || promptedNames.size || Object.keys(headshotMap).length || 1);
          const isSoloScene = characterCount === 1;

          // Step 4: DeepSeek V4 Flash — explicit prompt enhancement
          // Sex/gender must come from character_references, never invent "the man" for a woman/futa pair.
          // Clothing from story/image prompt only; otherwise keep reference image outfits.
          // CRITICAL: Freeroam image prompts are often mild close-ups while the STORY is explicit sex.
          // Story dialogue/narration is the primary source of sexual action; image prompt is framing only.
          const freeroamPromptPlain = input.prompt.replace(/~~([\w-]+)/g, (_, n: string) => n.replace(/-/g, ' '));
          const sceneLines: string[] = [];
          if (input.prevPanelText) sceneLines.push(`Previous: ${input.prevPanelText}`);
          if (input.currentPanelText) sceneLines.push(`Current: ${input.currentPanelText}`);
          if (input.nextPanelText) sceneLines.push(`Next: ${input.nextPanelText}`);
          const storyBlob = sceneLines.join('\n');

          /** Map appearance text → sex label for the prompt (no clothing, no inventing). */
          const sexLabelFromAppearance = (appearance: string | null | undefined): string => {
            const a = (appearance || '').toLowerCase();
            if (/futanari|\bfuta\b|hermaphrodite|dickgirl|newhalf/.test(a)) return 'futanari woman';
            if (/\b(trans\s*man|ftm)\b/.test(a)) return 'man';
            if (/\b(trans\s*woman|mtf)\b/.test(a)) return 'woman';
            if (/\b(female|woman|girl|she\/her|she,| heroine)\b/.test(a)) return 'woman';
            if (/\b(male|man|boy|he\/him|he,)\b/.test(a) && !/\b(female|woman|girl)\b/.test(a)) return 'man';
            // Unknown — neutral; do NOT default to man
            return 'person';
          };

          const castEntries = Object.values(charRefs) as Array<{
            name: string;
            appearance: string | null;
            headshot_url: string | null;
          }>;
          const castSexes = castEntries.map((ref) => sexLabelFromAppearance(ref.appearance));
          const futaCount = castSexes.filter((s) => s === 'futanari woman').length;

          if (atlasLlmKey) {
            try {
              const sceneContext = sceneLines.length > 0
                ? `STORY CONTEXT (PRIMARY source of pose, sexual action, body state, and climax — trust this over a mild image prompt):\n${storyBlob}\n\n`
                : '';

              // Ordinal labels when multiple share the same sex (e.g. two futa → first/second)
              const sexOrdinal = new Map<string, number>();
              const castLines = castEntries.map((ref, i) => {
                const sex = castSexes[i];
                const n = (sexOrdinal.get(sex) ?? 0) + 1;
                sexOrdinal.set(sex, n);
                const sameSexCount = castSexes.filter((s) => s === sex).length;
                const descriptor =
                  sameSexCount > 1 ? `the ${n === 1 ? 'first' : n === 2 ? 'second' : `${n}th`} ${sex}` : `the ${sex}`;
                const futaNote =
                  sex === 'futanari woman'
                    ? ' — has a penis/cock (must remain visible in sexual scenes)'
                    : '';
                return `${i + 1}. Use descriptor: "${descriptor}" (this is ${ref.name.replace(/-/g, ' ')} — do not change their sex/gender${futaNote})`;
              });
              const castListBlock = castLines.length > 0
                ? `FIXED CAST (use these sex descriptors only; headshot order matches this list):\n${castLines.join('\n')}\n\n`
                : '';

              // Detect clearly sexual story/action so clothing / futa anatomy rules can hard-require detail.
              // Freeroam "headshot_url" refs are often FULL-BODY clothed art (not just face crops);
              // without explicit nude language Seedream copies outfits from those refs.
              const sexualStorySignal = [
                input.actionText,
                storyBlob,
                freeroamPromptPlain,
              ].filter(Boolean).join('\n').toLowerCase();
              const isSexualScene = /(?:\bsex\b|intercourse|penetrat|thrust|fuck|fucking|cock|pussy|clit|cum|orgasm|climax|moan|wet for|so tight|so wet|blowjob|oral|anal|grind|hump|naked|nude|undress|bare skin|between (?:her|his|their) legs|inside (?:her|him|you)|mounts? you|rides? you)/i.test(sexualStorySignal);

              const castRule = isSoloScene
                ? `CAST RULE (critical): Exactly ONE named character from FIXED CAST is visible (they may be partial: hand, arm, torso). Do NOT invent a second face/body as a full second person. POV partner may be implied only as off-screen / cropped edge if the story requires contact — never invent a new character identity.${
                    futaCount >= 1
                      ? ' This character is futanari: in sexual scenes their cock/penis must be visible when the framing allows.'
                      : ''
                  }`
                : `CAST RULE (critical): Exactly ${characterCount} distinct people from FIXED CAST. Do NOT invent extra people. Do NOT change anyone's sex/gender. Do NOT invent a man if the cast is women and/or futanari. Do NOT force a heterosexual male/female pair. If two cast members are both "woman" or "futanari woman", keep both female-presenting and use "the first …" / "the second …" descriptors from FIXED CAST.`;

              // Two+ futanari: models often show only one cock — force both to be named in the prompt.
              const multiFutaRule =
                isSexualScene && futaCount >= 2
                  ? `MULTI-FUTANARI ANATOMY RULE (critical — ${futaCount} futanari in cast):
- EVERY futanari woman in FIXED CAST has her own cock/penis. Do NOT show only one cock for two people.
- The prompt MUST explicitly mention BOTH (or all) cocks, e.g. "the first futanari woman's cock" and "the second futanari woman's cock" (or "both of their cocks", "each has a cock", "two cocks visible").
- Do NOT merge them into a single-penis couple. Do NOT omit the second futanari's genitals.
- If framing is tight, still state that both have cocks even if one is partially cropped.`
                  : futaCount === 1 && isSexualScene
                    ? `FUTANARI ANATOMY: The futanari character has a cock/penis — include it when the sexual framing shows genitals.`
                    : '';

              const clothingRule = isSexualScene
                ? `CLOTHING RULE (critical — SEXUAL SCENE):
- Characters engaged in sex MUST be nude / bare skin. State this explicitly in the prompt (e.g. "nude", "bare skin", "no clothing", "naked").
- Reference images (Freeroam headshot_url) are often clothed full-body art — IGNORE their outfits. Do NOT write "same clothing as the reference image".
- Do NOT invent lingerie, dresses, shirts, pants, or partial cover-ups unless the story explicitly names that garment during the act.
- Partial close-ups (hand, arm): still imply nude body; never add sleeves/gloves/outfit details that dress the scene.`
                : `CLOTHING RULE (critical — non-sexual / unclear):
- If story or Freeroam image prompt EXPLICITLY states clothing, partial undress, or nudity, match that.
- If clothing/nudity is unspecified: write "same clothing as the reference image, do not change outfit".
- Do NOT invent random outfits.`;

              const framingNote =
                `FRAMING (secondary): Freeroam image prompt describes camera/composition only (may be a mild close-up). Keep that framing when possible, but the ACTION and BODY POSITION must match the story.\nFreeroam framing: "${freeroamPromptPlain}"`;

              // Standing is a common bad default for intimacy when story omits setting — forbid unless stated.
              const positionRule = isSexualScene
                ? `POSITION / SETTING RULE (critical — SEXUAL SCENE):
- Prefer pose and location from STORY CONTEXT and Freeroam framing (bed, couch, wall, floor, kneeling, on top, spooning, etc.).
- If the story clearly states standing / against a wall / in a doorway / etc., follow that.
- If the story does NOT clearly specify where they are or whether they are standing, ASSUME: on a bed, characters lying down (reclining / horizontal / on their backs or sides as fits the act). State "on a bed" and "lying" (or equivalent) explicitly in the prompt.
- Do NOT default to standing, upright, or full-body standing intercourse unless the story or Freeroam prompt explicitly says so.
- Reference images are often upright full-body portraits — IGNORE that upright stance for sexual scenes; pose must follow story/setting rules above, not the ref's standing pose.`
                : `POSITION / SETTING RULE (non-sexual / unclear):
- Prefer pose and location from STORY CONTEXT and Freeroam framing when stated.
- If unspecified, keep a natural pose consistent with the scene; do not invent a sexual bed scene.`;

              const actionNote = input.actionText
                ? `\nUser action / image instruction: "${input.actionText}"\n`
                : '';

              const enhanceResp = await fetch('https://api.atlascloud.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${atlasLlmKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'deepseek-ai/deepseek-v4-flash',
                  messages: [
                    {
                      role: 'system',
                      content:
                        'You write erotic image-edit prompts for Seedream for an adult story app. When story context is sexual, the prompt MUST describe that sexual action explicitly, characters MUST be nude, and body position/setting MUST come from the story — never default intimate scenes to standing. If sexual and setting/pose is unclear, assume on a bed, lying down. When TWO OR MORE futanari are in the cast, the prompt MUST mention BOTH/ALL of their cocks (never only one penis for two futa). Freeroam reference images (called headshots but often full-body standing art) are for likeness only — ignore their clothing and upright stance in sexual scenes. Never collapse sex to a mild SFW close-up. Use ONLY FIXED CAST sex descriptors. Present tense. End with a single JSON object only (no markdown).',
                    },
                    {
                      role: 'user',
                      content: `${castListBlock}${sceneContext}${castRule}

${clothingRule}

${positionRule}
${multiFutaRule ? `\n${multiFutaRule}\n` : ''}
${framingNote}
${actionNote}
Write a Seedream image-edit prompt:
- PRIORITY 1: sexual action / body contact / climax from STORY CONTEXT (thrusting, penetration, wet, tight, kissing while pinned, claws in wall during sex, etc.)
- PRIORITY 2: body position and setting from STORY CONTEXT (or Freeroam framing if it states place/pose). If sexual and unclear: on a bed, lying down — never invent standing intimacy by default
- PRIORITY 3: framing from Freeroam prompt (close-up hand, etc.) can remain if it still shows the sexual moment and does not force standing when the story is bed/intimate
- ${isSexualScene ? 'PRIORITY 4: explicitly include nude / bare skin / no clothing (required)' : 'PRIORITY 4: clothing per CLOTHING RULE'}
- ${futaCount >= 2 && isSexualScene ? 'PRIORITY 5: BOTH/ALL futanari cocks must be named in the prompt (first and second futanari woman each have a cock)' : futaCount === 1 && isSexualScene ? 'PRIORITY 5: futanari cock visible when genitals are in frame' : ''}
- NEVER default sexual scenes to standing / upright unless the story or Freeroam prompt says so
- NEVER output a SFW-only hand/wall description when the story is intercourse
- NEVER output "same clothing as the reference image" when the story is sexual
- NEVER show only one cock when two futanari are present
- Respect FIXED CAST and CAST RULE (no invented people)
- Do NOT invent face, hair, or species
- Keep under 160 words
Respond with ONLY this JSON: {"prompt": "..."}`,
                    },
                  ],
                  // V4 Flash spends tokens on reasoning first; need headroom for the JSON answer
                  max_tokens: 900,
                  temperature: 0.4,
                }),
              });
              if (enhanceResp.ok) {
                const enhanceData = await enhanceResp.json() as {
                  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
                };
                const emsg = enhanceData?.choices?.[0]?.message;
                const eContent = emsg?.content?.trim() ?? '';
                const eReasoning = emsg?.reasoning_content?.trim() ?? '';
                const extractPromptJson = (text: string): string | null => {
                  if (!text) return null;
                  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
                  try {
                    const p = JSON.parse(cleaned) as { prompt?: string };
                    if (p.prompt) return p.prompt;
                  } catch { /* fall through */ }
                  const start = cleaned.lastIndexOf('{');
                  const end = cleaned.lastIndexOf('}');
                  if (start >= 0 && end > start) {
                    try {
                      const p = JSON.parse(cleaned.slice(start, end + 1)) as { prompt?: string };
                      if (p.prompt) return p.prompt;
                    } catch { /* ignore */ }
                  }
                  return null;
                };
                enhancedSeedreamPrompt =
                  extractPromptJson(eContent) ??
                  extractPromptJson(eReasoning);
                console.log('[NSFW] DeepSeek enhance result:', {
                  contentLen: eContent.length,
                  reasoningLen: eReasoning.length,
                  promptPreview: enhancedSeedreamPrompt?.slice(0, 220) ?? null,
                });
                if (!enhancedSeedreamPrompt) {
                  console.warn('[NSFW] DeepSeek enhance: no prompt JSON');
                }
              }
            } catch (err) {
              console.error('[NSFW] DeepSeek enhance failed', err);
            }
          }

          // Build final Seedream prompt
          // Priority: DeepSeek-enhanced > actionText+story blend > story+framing > freeroam prompt alone
          let seedreamPrompt: string;
          if (enhancedSeedreamPrompt) {
            seedreamPrompt = enhancedSeedreamPrompt;
          } else if (input.actionText || storyBlob) {
            // Fallback: do not silently send a mild Freeroam close-up when we have story sex text
            const parts = [
              input.actionText,
              storyBlob ? `Scene: ${storyBlob}` : null,
              freeroamPromptPlain ? `Framing: ${freeroamPromptPlain}` : null,
            ].filter(Boolean);
            seedreamPrompt = parts.join(' | ');
          } else {
            seedreamPrompt = freeroamPromptPlain;
          }

          // Post-process clothing for sexual scenes: Freeroam headshot_url refs are often full-body
          // clothed art; Seedream copies outfits unless the prompt forbids it.
          const sexualForClothing = /(?:\bsex\b|intercourse|penetrat|thrust|fuck|fucking|cock|pussy|clit|cum|orgasm|climax|moan|wet for|so tight|so wet|blowjob|oral|anal|grind|hump|naked|nude|undress|between (?:her|his|their) legs|inside (?:her|him|you))/i
            .test([seedreamPrompt, input.actionText, storyBlob].filter(Boolean).join('\n'));
          if (sexualForClothing) {
            seedreamPrompt = seedreamPrompt
              .replace(/\bsame clothing as the reference image[^.]*\.?/gi, '')
              .replace(/\bdo not change outfit\.?/gi, '')
              .replace(/\bwears? the same clothing[^.]*\.?/gi, '')
              .replace(/\s{2,}/g, ' ')
              .trim();
            if (!/\b(nude|naked|bare skin|no clothing|unclothed|fully bare)\b/i.test(seedreamPrompt)) {
              seedreamPrompt = `${seedreamPrompt} Nude, bare skin, no clothing.`;
            }

            // Position: if story never said standing, strip accidental standing defaults and ensure bed/lying when unset.
            const storyOrAction = [input.actionText, storyBlob].filter(Boolean).join('\n');
            const storySaysStanding = /\b(standing|upright|against (?:the |a )?wall|in (?:the |a )?doorway)\b/i.test(storyOrAction);
            const hasHorizontalPose = /\b(bed|lying|lie |lies |laying|reclining|supine|prone|on (?:their|her|his) back|on (?:their|her|his) side|spooning|straddling|missionary|cowgirl|kneeling on (?:the )?bed)\b/i.test(seedreamPrompt);
            if (!storySaysStanding) {
              seedreamPrompt = seedreamPrompt
                .replace(/\bstanding (?:upright )?(?:together|close|intimately)?\b/gi, 'lying on a bed')
                .replace(/\bupright\b/gi, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
            }
            if (!hasHorizontalPose && !storySaysStanding) {
              seedreamPrompt = `${seedreamPrompt} On a bed, lying down.`;
            }

            // Two+ futa: models often paint one cock — force both if the enhance prompt under-specified.
            if (futaCount >= 2) {
              const bothCocksNamed =
                /\b(both|two|each)\b[\w\s,]{0,24}\b(cock|penis|cocks|penises)\b/i.test(seedreamPrompt)
                || (
                  /\b(first|1st)\b[\w\s']{0,40}\b(cock|penis)\b/i.test(seedreamPrompt)
                  && /\b(second|2nd)\b[\w\s']{0,40}\b(cock|penis)\b/i.test(seedreamPrompt)
                )
                || (seedreamPrompt.match(/\b(cock|penis|cocks|penises)\b/gi) ?? []).length >= 2;
              if (!bothCocksNamed) {
                seedreamPrompt = `${seedreamPrompt} Both futanari women have cocks; the first futanari woman's cock and the second futanari woman's cock are both visible.`;
              }
            }
          }

          // Reference images: character headshot_url ONLY (max 2).
          // Freeroam "headshot" may be a face crop OR full-body character art — treat as likeness ref.
          // Do NOT pass Freeroam panel images (mild SFW framing pulls composition the wrong way).
          const maxHeadshots = Math.min(2, characterCount);
          const referenceImageUrls: string[] = Object.values(headshotMap).slice(0, maxHeadshots);
          if (referenceImageUrls.length < maxHeadshots) {
            const fromRefs = Object.values(charRefs)
              .filter((ref) => (ref as { headshot_url: string | null }).headshot_url)
              .map((ref) => (ref as { headshot_url: string }).headshot_url);
            for (const url of fromRefs) {
              if (referenceImageUrls.length >= maxHeadshots) break;
              if (!referenceImageUrls.includes(url)) referenceImageUrls.push(url);
            }
          }

          const images = referenceImageUrls;

          // Do NOT prepend classify artStyle (e.g. "[anime furry illustration]") when we have
          // character reference images. Seedream should take line weight / species / style from
          // the headshot_url refs (which may be full-body). A global "furry" tag can force
          // non-furry cast members into furry form. Style tag only if we have zero refs.
          if (detectedArtStyle && images.length === 0) {
            seedreamPrompt = `[${detectedArtStyle}] ${seedreamPrompt}`;
          } else if (detectedArtStyle) {
            console.log('[NSFW] Skipping artStyle prepend (using ref images for style):', detectedArtStyle);
          }

          // Always log what Seedream actually receives (this is the main "why is the art mild?" debug line)
          console.log('[NSFW] Final Seedream prompt:', seedreamPrompt?.slice(0, 400));
          console.log('[NSFW] Seedream reference images (headshots only):', images.length, images.map(u => u.slice(0, 70)));
          if (input.debug) {
            console.log('[NSFW DEBUG] Full Seedream prompt:', seedreamPrompt);
          }

          // Call Atlas Cloud Seedream (model id + poll budget from nsfwImageCache.ts)
          const generateResp = await fetch('https://api.atlascloud.ai/api/v1/model/generateImage', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${atlasKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: SEEDREAM_EDIT_MODEL,
              prompt: seedreamPrompt,
              images: images.length > 0 ? images : undefined,
              size: '1600*2400',
            }),
          });

          if (!generateResp.ok) {
            const errText = await generateResp.text();
            throw new Error(`Atlas Cloud generation failed (${generateResp.status}): ${errText}`);
          }

          const generateData = await generateResp.json() as { data: { id: string } };
          const predictionId = generateData.data.id;

          // Timing out early deletes the image_cache claim and forces a full re-run on revisit.
          let resultUrl: string | null = null;
          for (let i = 0; i < SEEDREAM_POLL_MAX_ATTEMPTS; i++) {
            await new Promise(resolve => setTimeout(resolve, SEEDREAM_POLL_INTERVAL_MS));
            const pollResp = await fetch(`https://api.atlascloud.ai/api/v1/model/prediction/${predictionId}`, {
              headers: { 'Authorization': `Bearer ${atlasKey}` },
            });
            if (!pollResp.ok) continue;
            const pollData = await pollResp.json() as { data: { status: string; outputs?: string[]; error?: string } };
            if (pollData.data.status === 'completed' && pollData.data.outputs?.[0]) {
              resultUrl = pollData.data.outputs[0];
              break;
            }
            if (pollData.data.status === 'failed') {
              throw new Error(`Atlas Cloud generation failed: ${pollData.data.error ?? 'unknown error'}`);
            }
          }

          const pollBudgetSec = Math.round((SEEDREAM_POLL_MAX_ATTEMPTS * SEEDREAM_POLL_INTERVAL_MS) / 1000);
          if (!resultUrl) throw new Error(`Atlas Cloud generation timed out after ${pollBudgetSec}s`);

          // Always download the Atlas output. Aliyun OSS URLs often fail as <img src>
          // in the browser (hotlink / short-lived). Re-host via Forge when available,
          // otherwise save under data/nsfw-images and serve at /api/nsfw-images/*.
          const imgResp = await fetch(resultUrl);
          if (!imgResp.ok) throw new Error(`Failed to fetch generated image (${imgResp.status})`);
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
          const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
          const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpeg';

          let finalUrl: string;
          const { ENV } = await import('./_core/env');
          if (ENV.forgeApiUrl && ENV.forgeApiKey) {
            try {
              const { storagePut } = await import('./storage');
              const { url: s3Url } = await storagePut(
                `nsfw-images/${input.panelId}.${ext}`,
                imgBuffer,
                contentType
              );
              finalUrl = s3Url;
            } catch (storageErr) {
              console.error('[NSFW] Forge upload failed, using local disk fallback:', storageErr);
              finalUrl = await saveNsfwImageLocally(input.panelId, imgBuffer, ext);
            }
          } else {
            if (input.debug) console.log('[NSFW DEBUG] Forge not configured — saving image locally');
            finalUrl = await saveNsfwImageLocally(input.panelId, imgBuffer, ext);
          }

          // Only write ready if we still own the generating claim (regenerate may have cleared it)
          if (!(await stillOwnClaim('generating'))) {
            console.warn(`[NSFW] Lost generating claim for ${input.panelId} after Seedream — not writing ready`);
            return { imageUrl: finalUrl, fromCache: false, generating: false, aborted: true };
          }

          // Update cache to ready — freeroamImageUrl + freeroamImagePrompt enable cross-panel reuse
          await db.update(imageCache).set({
            status: 'ready',
            imageUrl: finalUrl,
            freeroamImageUrl: input.imageUrl ?? null,
            freeroamImagePrompt: input.prompt || null,
          }).where(eq(imageCache.panelId, input.panelId));

          return { imageUrl: finalUrl, fromCache: false, generating: false };
        } catch (err) {
          console.error('[NSFW] generateNsfwImage failed for panel', input.panelId, err);
          // Clean up only if we still own a claim for this panel
          const row = await readPanelCache();
          if (row && (row.status === 'classifying' || row.status === 'generating')) {
            await db.delete(imageCache).where(eq(imageCache.panelId, input.panelId));
          }
          throw err;
        }
      }),

    /** Check if an NSFW image is ready in the cache */
    checkImageReady: publicProcedure
      .input(z.object({
        panelId: z.string(),
        freeroamImageUrl: z.string().optional(),
        /** Freeroam image prompt — preferred reuse key when Freeroam keeps the same art across panels */
        freeroamImagePrompt: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { imageCache } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) return { status: 'not_found', imageUrl: null };

        // READ-ONLY: never delete claims here. Client polls this every ~0.5–1.5s while waiting.
        // Deleting "stale" generating rows on poll was wiping Seedream v5 jobs (~2 min) and
        // forcing a full re-run on leave/return. Stale reclaim belongs only in generateNsfwImage.

        // Check by panelId first
        const rows = await db.select().from(imageCache).where(eq(imageCache.panelId, input.panelId)).limit(1);
        if (rows.length) {
          return { status: rows[0].status, imageUrl: rows[0].imageUrl || null };
        }
        // Same Freeroam source image URL
        if (input.freeroamImageUrl) {
          const urlRows = await db.select().from(imageCache)
            .where(eq(imageCache.freeroamImageUrl, input.freeroamImageUrl))
            .limit(1);
          if (urlRows.length) {
            if (urlRows[0].status === 'ready' && urlRows[0].imageUrl) {
              return { status: 'ready', imageUrl: urlRows[0].imageUrl };
            }
            if (urlRows[0].status === 'generating' || urlRows[0].status === 'classifying' || urlRows[0].status === 'skipped') {
              return { status: urlRows[0].status, imageUrl: urlRows[0].imageUrl || null };
            }
          }
        }
        // Same Freeroam image prompt (art unchanged across story panels)
        if (input.freeroamImagePrompt) {
          const promptRows = await db.select().from(imageCache)
            .where(eq(imageCache.freeroamImagePrompt, input.freeroamImagePrompt))
            .limit(1);
          if (promptRows.length) {
            if (promptRows[0].status === 'ready' && promptRows[0].imageUrl) {
              return { status: 'ready', imageUrl: promptRows[0].imageUrl };
            }
            if (promptRows[0].status === 'generating' || promptRows[0].status === 'classifying' || promptRows[0].status === 'skipped') {
              return { status: promptRows[0].status, imageUrl: promptRows[0].imageUrl || null };
            }
          }
        }
        return { status: 'not_found', imageUrl: null };
      }),

    /** Clear image_cache for a panel (and same Freeroam art key) so NSFW can regenerate. */
    clearImageCacheEntry: publicProcedure
      .input(z.object({
        panelId: z.string(),
        freeroamImageUrl: z.string().optional(),
        freeroamImagePrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { imageCache } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        // Always clear this panel
        await db.delete(imageCache).where(eq(imageCache.panelId, input.panelId));
        // Also clear siblings that share the same Freeroam art so regenerate is not short-circuited by reuse
        if (input.freeroamImagePrompt) {
          await db.delete(imageCache).where(eq(imageCache.freeroamImagePrompt, input.freeroamImagePrompt));
        }
        if (input.freeroamImageUrl) {
          await db.delete(imageCache).where(eq(imageCache.freeroamImageUrl, input.freeroamImageUrl));
        }
        return { ok: true };
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

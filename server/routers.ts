import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

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
  privacy_status: z.enum(["private", "public", "linked"]),
});

// Single character response — includes the `appearance` field not in the list endpoint
const SingleCharacterSchema = z.object({
  external_id: z.string(),
  name: z.string(),
  backstory: z.string().nullable(),
  description: z.string().nullable(),
  appearance: z.string().nullable(),
  headshot_url: z.string().nullable(),
  display_headshot_url: z.string().nullable(),
  privacy_status: z.enum(["private", "public", "linked"]),
  owner: z.object({
    username: z.string(),
    display_name: z.string().optional(),
  }),
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
      .query(async ({ input }) => {
        const cookie = process.env.cookie;
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
      .mutation(async ({ input }) => {
        const cookie = process.env.cookie;
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
          privacy_status: z.enum(["private", "public", "linked"]).default("private"),
        })
      )
      .mutation(async ({ input }) => {
        const cookie = process.env.cookie;
        if (!cookie) throw new Error("Cookie not configured in environment");

        const body: Record<string, string> = { name: input.name };
        if (input.backstory !== undefined)   body.backstory    = input.backstory;
        if (input.appearance !== undefined)  body.appearance   = input.appearance;
        if (input.headshot_url !== undefined) body.headshot_url = input.headshot_url;
        body.privacy_status = input.privacy_status;

        const response = await fetch(
          `https://getfreeroam.com/api/characters/${encodeURIComponent(input.characterId)}`,
          {
            method: "PUT",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              cookie: cookie,
              origin: "https://getfreeroam.com",
              referer: "https://getfreeroam.com",
              "content-type": "application/json",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Update failed (${response.status}): ${text}`);
        }

        const data = await response.json();
        return SingleCharacterSchema.parse(data);
      }),

    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          backstory: z.string().optional(),
          appearance: z.string().optional(),
          headshot_url: z.string().optional(),
          privacy_status: z.enum(["private", "public", "linked"]).default("private"),
        })
      )
      .mutation(async ({ input }) => {
        const cookie = process.env.cookie;
        if (!cookie) throw new Error("Cookie not configured in environment");

        const body: Record<string, string> = { name: input.name };
        if (input.backstory)    body.backstory    = input.backstory;
        if (input.appearance)   body.appearance   = input.appearance;
        if (input.headshot_url) body.headshot_url = input.headshot_url;
        body.privacy_status = input.privacy_status;

        const response = await fetch("https://getfreeroam.com/api/characters", {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            cookie: cookie,
            origin: "https://getfreeroam.com",
            referer: "https://getfreeroam.com",
            "content-type": "application/json",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Create failed (${response.status}): ${text}`);
        }

        const data = await response.json();
        return SingleCharacterSchema.parse(data);
      }),

    get: publicProcedure
      .input(z.object({ characterId: z.string() }))
      .query(async ({ input }) => {
        const cookie = process.env.cookie;
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
  }),
});

export type AppRouter = typeof appRouter;

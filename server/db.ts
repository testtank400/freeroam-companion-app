import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { characterExtended, characterNsfw, collectionMembers, collections, freeroamUsers, InsertUser, users, worldCollectionMembers } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * TiDB Cloud requires TLS. A bare DATABASE_URL (no ssl) fails on first query with
 * "Connections using insecure transport are prohibited" — which drizzle surfaces
 * as a generic "Failed query: insert into freeroam_users...".
 * Enabling ssl in the URL as ?ssl={"rejectUnauthorized":true} is fragile in Railway.
 * Force SSL for TiDB (and when DATABASE_SSL=true), and strip any ssl= query fragment.
 */
function createDbPool(databaseUrl: string) {
  const needsSsl =
    /tidbcloud\.com/i.test(databaseUrl) ||
    /[?&]ssl=/i.test(databaseUrl) ||
    process.env.DATABASE_SSL === "1" ||
    process.env.DATABASE_SSL === "true";

  const uri = databaseUrl
    .replace(/([?&])ssl=[^&]*/gi, "$1")
    .replace(/[?&]$/, "")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&");

  return createPool({
    uri,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(createDbPool(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Freeroam User Identity ────────────────────────────────────────────────────

/** Upsert a Freeroam user record by their stable account_id. Returns the record. */
export async function upsertFreeroamUser(
  accountId: number,
  username: string,
  email?: string | null,
  externalId?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(freeroamUsers)
    .values({ accountId, username, email: email ?? null, externalId: externalId ?? null })
    .onDuplicateKeyUpdate({
      set: { username, email: email ?? null, externalId: externalId ?? null, updatedAt: new Date() },
    });

  const rows = await db.select().from(freeroamUsers).where(eq(freeroamUsers.accountId, accountId)).limit(1);
  return rows[0];
}

// ─── Collections ────────────────────────────────────────────────────────────

/** Return all collections owned by a given Freeroam accountId, with their member characterIds. */
export async function getCollectionsByAccountId(freeroamAccountId: number) {
  const db = await getDb();
  if (!db) return [];

  const cols = await db
    .select()
    .from(collections)
    .where(eq(collections.freeroamAccountId, freeroamAccountId))
    .orderBy(collections.createdAt);

  if (cols.length === 0) return [];

  const ids = cols.map(c => c.id);
  const members = await db
    .select()
    .from(collectionMembers)
    .where(inArray(collectionMembers.collectionId, ids));

  return cols.map(col => ({
    ...col,
    characterIds: members
      .filter(m => m.collectionId === col.id)
      .map(m => m.characterId),
  }));
}

/** Create a new collection and return it (with empty characterIds). */
export async function createCollection(
  freeroamAccountId: number,
  name: string,
  description?: string,
  coverImage?: string,
  parentId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .insert(collections)
    .values({ freeroamAccountId, name, description: description ?? null, coverImage: coverImage ?? null, parentId: parentId ?? null });

  const id = (result as { insertId: number }).insertId;
  const rows = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  return { ...rows[0], characterIds: [] as string[] };
}

/** Update collection metadata (name, description, coverImage, parentId). */
export async function updateCollection(
  id: number,
  freeroamAccountId: number,
  updates: { name?: string; description?: string | null; coverImage?: string | null; parentId?: number | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(collections)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(collections.id, id), eq(collections.freeroamAccountId, freeroamAccountId)));

  return true;
}

/** Delete a collection and all its members. */
export async function deleteCollection(id: number, freeroamAccountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(collectionMembers)
    .where(eq(collectionMembers.collectionId, id));
  await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.freeroamAccountId, freeroamAccountId)));

  return true;
}

/** Add a character to a collection (idempotent). */
export async function addCharacterToCollection(collectionId: number, characterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if already present
  const existing = await db
    .select()
    .from(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.characterId, characterId)
      )
    )
    .limit(1);

  if (existing.length > 0) return true; // already a member

  await db.insert(collectionMembers).values({ collectionId, characterId });
  return true;
}

/** Remove a character from a collection. */
export async function removeCharacterFromCollection(collectionId: number, characterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.characterId, characterId)
      )
    );

  return true;
}

// ─── Character Extended Content ───────────────────────────────────────────────────────

/** Get the full extended content for a character. */
export async function getCharacterExtended(characterId: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(characterExtended)
    .where(eq(characterExtended.characterId, characterId))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

/** Upsert the full extended content for a character. */
export async function upsertCharacterExtended(
  characterId: string,
  backstoryFull: string | null,
  appearanceFull: string | null,
  backstoryLimit?: number | null,
  appearanceLimit?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(characterExtended)
    .values({
      characterId,
      backstoryFull: backstoryFull ?? null,
      appearanceFull: appearanceFull ?? null,
      backstoryLimit: backstoryLimit ?? null,
      appearanceLimit: appearanceLimit ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        backstoryFull: backstoryFull ?? null,
        appearanceFull: appearanceFull ?? null,
        ...(backstoryLimit != null ? { backstoryLimit } : {}),
        ...(appearanceLimit != null ? { appearanceLimit } : {}),
        updatedAt: new Date(),
      },
    });

  return true;
}

// ─── Character NSFW Flags ────────────────────────────────────────────────────

/** Get NSFW status for a single character for a specific user. Returns false if not found (default SFW). */
export async function getCharacterNsfw(characterId: string, freeroamAccountId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const rows = await db
    .select()
    .from(characterNsfw)
    .where(and(eq(characterNsfw.characterId, characterId), eq(characterNsfw.freeroamAccountId, freeroamAccountId)))
    .limit(1);

  return rows.length > 0 ? rows[0].isNsfw === 1 : false;
}

/** Get NSFW status for multiple characters at once for a specific user. Returns a map of characterId -> boolean.
 * Chunks large arrays into batches of 500 to avoid MySQL IN clause limits. */
export async function getCharactersNsfw(characterIds: string[], freeroamAccountId: number): Promise<Record<string, boolean>> {
  if (characterIds.length === 0) return {};
  const db = await getDb();
  if (!db) return {};

  const CHUNK_SIZE = 500;
  const result: Record<string, boolean> = {};

  for (let i = 0; i < characterIds.length; i += CHUNK_SIZE) {
    const chunk = characterIds.slice(i, i + CHUNK_SIZE);
    const rows = await db
      .select()
      .from(characterNsfw)
      .where(and(inArray(characterNsfw.characterId, chunk), eq(characterNsfw.freeroamAccountId, freeroamAccountId)));
    for (const row of rows) {
      result[row.characterId] = row.isNsfw === 1;
    }
  }

  return result;
}

/** Toggle the NSFW flag for a character for a specific user. Returns the new value. */
export async function toggleCharacterNsfw(characterId: string, freeroamAccountId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getCharacterNsfw(characterId, freeroamAccountId);
  const newValue = current ? 0 : 1;

  await db
    .insert(characterNsfw)
    .values({ characterId, freeroamAccountId, isNsfw: newValue })
    .onDuplicateKeyUpdate({ set: { isNsfw: newValue, updatedAt: new Date() } });

  return newValue === 1;
}

/**
 * Parse a character limit from a Freeroam API error response.
 * Handles both plain text ("max 2000 characters") and structured JSON
 * ({"detail":[{"msg":"String should have at most 2000 characters","loc":["body","backstory"]}]}).
 * Returns { limit, field } where field is 'backstory', 'appearance', or null (unknown).
 */
export function parseLimitFromError(errorText: string): { limit: number; field: string | null } | null {
  // Try structured JSON first (Freeroam 422 format)
  try {
    const json = JSON.parse(errorText) as { detail?: Array<{ msg?: string; loc?: string[] }> };
    if (Array.isArray(json.detail)) {
      for (const item of json.detail) {
        const msg = item.msg ?? '';
        const match = msg.match(/(\d+)\s*characters?/i);
        if (match) {
          const limit = parseInt(match[1], 10);
          // Determine which field from loc array: ["body", "backstory"] or ["body", "appearance"]
          const loc = item.loc ?? [];
          const field = loc.find(l => l === 'backstory' || l === 'appearance') ?? null;
          return { limit, field };
        }
      }
    }
  } catch {
    // Not JSON — fall through to plain text parsing
  }

  // Plain text fallback
  const match = errorText.match(/(\d+)\s*characters?/i);
  if (match) {
    const limit = parseInt(match[1], 10);
    const field = /backstory/i.test(errorText) ? 'backstory'
      : /appearance|description/i.test(errorText) ? 'appearance'
      : null;
    return { limit, field };
  }

  return null;
}

// ─── World Collection Membership (local DB) ──────────────────────────────────────────────

/** Get all world IDs in a collection for a given user */
export async function getWorldCollectionMembers(collectionExternalId: string, freeroamAccountId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select()
    .from(worldCollectionMembers)
    .where(and(
      eq(worldCollectionMembers.collectionExternalId, collectionExternalId),
      eq(worldCollectionMembers.freeroamAccountId, freeroamAccountId)
    ));
  return rows.map(r => r.worldExternalId);
}

/** Add a world to a collection in local DB */
export async function addWorldToCollectionLocal(collectionExternalId: string, worldExternalId: string, freeroamAccountId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Avoid duplicates
  const existing = await db.select()
    .from(worldCollectionMembers)
    .where(and(
      eq(worldCollectionMembers.collectionExternalId, collectionExternalId),
      eq(worldCollectionMembers.worldExternalId, worldExternalId),
      eq(worldCollectionMembers.freeroamAccountId, freeroamAccountId)
    ));
  if (existing.length > 0) return;
  await db.insert(worldCollectionMembers).values({
    collectionExternalId,
    worldExternalId,
    freeroamAccountId,
  });
}

/** Remove a world from a collection in local DB */
export async function removeWorldFromCollectionLocal(collectionExternalId: string, worldExternalId: string, freeroamAccountId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(worldCollectionMembers)
    .where(and(
      eq(worldCollectionMembers.collectionExternalId, collectionExternalId),
      eq(worldCollectionMembers.worldExternalId, worldExternalId),
      eq(worldCollectionMembers.freeroamAccountId, freeroamAccountId)
    ));
}

/** Get all collection IDs that a world belongs to for a given user */
export async function getWorldMemberships(worldExternalId: string, freeroamAccountId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select()
    .from(worldCollectionMembers)
    .where(and(
      eq(worldCollectionMembers.worldExternalId, worldExternalId),
      eq(worldCollectionMembers.freeroamAccountId, freeroamAccountId)
    ));
  return rows.map(r => r.collectionExternalId);
}

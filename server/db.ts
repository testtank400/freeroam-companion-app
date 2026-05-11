import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { characterExtended, collectionMembers, collections, InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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

// ─── Collections ────────────────────────────────────────────────────────────

/** Return all collections owned by a given openId, with their member characterIds. */
export async function getCollectionsByOwner(ownerOpenId: string) {
  const db = await getDb();
  if (!db) return [];

  const cols = await db
    .select()
    .from(collections)
    .where(eq(collections.ownerOpenId, ownerOpenId))
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
  ownerOpenId: string,
  name: string,
  description?: string,
  coverImage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .insert(collections)
    .values({ ownerOpenId, name, description: description ?? null, coverImage: coverImage ?? null });

  const id = (result as { insertId: number }).insertId;
  const rows = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  return { ...rows[0], characterIds: [] as string[] };
}

/** Update collection metadata (name, description, coverImage). */
export async function updateCollection(
  id: number,
  ownerOpenId: string,
  updates: { name?: string; description?: string | null; coverImage?: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(collections)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(collections.id, id), eq(collections.ownerOpenId, ownerOpenId)));

  return true;
}

/** Delete a collection and all its members. */
export async function deleteCollection(id: number, ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(collectionMembers)
    .where(eq(collectionMembers.collectionId, id));
  await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.ownerOpenId, ownerOpenId)));

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

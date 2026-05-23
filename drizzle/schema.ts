import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Freeroam user identity — keyed by Freeroam's stable numeric account_id.
// This is the permanent identity anchor for all user data (collections, NSFW flags, etc.)
// even after cookie expiry or username changes.
export const freeroamUsers = mysqlTable("freeroam_users", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam's stable numeric account ID — the permanent identity key */
  accountId: int("accountId").notNull().unique(),
  /** Freeroam username (may change over time) */
  username: varchar("username", { length: 255 }).notNull(),
  /** Freeroam email */
  email: varchar("email", { length: 320 }),
  /** Freeroam external_id (e.g. "google_user@gmail.com") */
  externalId: varchar("externalId", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FreeroamUser = typeof freeroamUsers.$inferSelect;
export type InsertFreeroamUser = typeof freeroamUsers.$inferInsert;

// Collections — user-owned groups of characters
// Keyed by Freeroam accountId (stable across cookie expiry and username changes)
export const collections = mysqlTable("collections", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam account_id — permanent identity key for the collection owner */
  freeroamAccountId: int("freeroamAccountId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coverImage: text("coverImage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Collection = typeof collections.$inferSelect;
export type InsertCollection = typeof collections.$inferInsert;

// Many-to-many: characters belonging to a collection
export const collectionMembers = mysqlTable("collection_members", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").notNull(),
  /** External character ID from getfreeroam.com */
  characterId: varchar("characterId", { length: 128 }).notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
});

export type CollectionMember = typeof collectionMembers.$inferSelect;
export type InsertCollectionMember = typeof collectionMembers.$inferInsert;

// Extended character content — stores the full unlimited backstory/appearance
// that may exceed Freeroam's API limits. The Freeroam API only receives a trimmed
// version; this table is the source of truth for the full content on this site.
export const characterExtended = mysqlTable("character_extended", {
  id: int("id").autoincrement().primaryKey(),
  /** External character ID from getfreeroam.com */
  characterId: varchar("characterId", { length: 128 }).notNull().unique(),
  backstoryFull: text("backstoryFull"),
  appearanceFull: text("appearanceFull"),
  /** The backstory character limit last reported by Freeroam (null = not yet detected) */
  backstoryLimit: int("backstoryLimit"),
  /** The appearance character limit last reported by Freeroam (null = not yet detected) */
  appearanceLimit: int("appearanceLimit"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CharacterExtended = typeof characterExtended.$inferSelect;
export type InsertCharacterExtended = typeof characterExtended.$inferInsert;

// NSFW flags — tracks which characters are marked as NSFW by a specific user.
// Keyed by both characterId AND freeroamAccountId so each user has their own NSFW flags.
export const characterNsfw = mysqlTable("character_nsfw", {
  id: int("id").autoincrement().primaryKey(),
  /** External character ID from getfreeroam.com */
  characterId: varchar("characterId", { length: 128 }).notNull(),
  /** Freeroam account_id of the user who set this flag */
  freeroamAccountId: int("freeroamAccountId").notNull(),
  isNsfw: int("isNsfw").notNull().default(0), // 0 = SFW, 1 = NSFW
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CharacterNsfw = typeof characterNsfw.$inferSelect;
export type InsertCharacterNsfw = typeof characterNsfw.$inferInsert;

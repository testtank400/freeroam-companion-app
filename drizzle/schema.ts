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
  /** Parent collection ID for sub-collections (null = top-level collection) */
  parentId: int("parentId"),
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

// Export jobs — tracks background export processes
export const exportJobs = mysqlTable("export_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(), // UUID
  /** Freeroam account_id of the user who started the export */
  freeroamAccountId: int("freeroamAccountId").notNull(),
  /** Job status: pending, processing, done, error */
  status: mysqlEnum("status", ["pending", "processing", "done", "error"]).notNull().default("pending"),
  /** S3 download URL (set when done) */
  downloadUrl: text("downloadUrl"),
  /** Error message (set when error) */
  errorMessage: text("errorMessage"),
  /** Number of characters exported */
  exportedCount: int("exportedCount").default(0),
  /** Number of characters that failed */
  failedCount: int("failedCount").default(0),
  /** Total characters to export */
  totalCount: int("totalCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** When the download link expires */
  expiresAt: timestamp("expiresAt"),
});

export type ExportJob = typeof exportJobs.$inferSelect;
export type InsertExportJob = typeof exportJobs.$inferInsert;

// World collection membership — tracks which worlds belong to which Freeroam collections.
// This is needed because Freeroam's API hides private worlds from collection responses.
// We store the membership locally so we can show all worlds (including private) in a collection.
export const worldCollectionMembers = mysqlTable("world_collection_members", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam collection external_id (UUID string) */
  collectionExternalId: varchar("collectionExternalId", { length: 128 }).notNull(),
  /** Freeroam world external_id (UUID string) */
  worldExternalId: varchar("worldExternalId", { length: 128 }).notNull(),
  /** Freeroam account_id of the user who added this membership */
  freeroamAccountId: int("freeroamAccountId").notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
});

export type WorldCollectionMember = typeof worldCollectionMembers.$inferSelect;
export type InsertWorldCollectionMember = typeof worldCollectionMembers.$inferInsert;

// Character voice assignments — maps Freeroam character IDs to ElevenLabs voice IDs
export const characterVoices = mysqlTable("character_voices", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam character external_id (UUID string) */
  characterId: varchar("characterId", { length: 128 }).notNull().unique(),
  /** ElevenLabs voice ID */
  voiceId: varchar("voiceId", { length: 128 }).notNull(),
  /** Human-readable voice name for display */
  voiceName: varchar("voiceName", { length: 255 }).notNull(),
  /** Voice stability setting (0.0 - 1.0) */
  stability: text("stability").default("0.5"),
  /** Voice similarity boost setting (0.0 - 1.0) */
  similarityBoost: text("similarityBoost").default("0.75"),
  /** Voice style setting (0.0 - 1.0, optional) */
  style: text("style").default("0"),
  /** ISO 639-1 language code to anchor accent (e.g. 'it', 'en', 'fr'). Passed to ElevenLabs as language_code. */
  languageCode: varchar("languageCode", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CharacterVoice = typeof characterVoices.$inferSelect;
export type InsertCharacterVoice = typeof characterVoices.$inferInsert;

// TTS cache — stores generated audio URLs keyed by panel + character
// Prevents regenerating the same audio clip and incurring extra ElevenLabs costs
export const ttsCache = mysqlTable("tts_cache", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam panel external_id (UUID string) */
  panelId: varchar("panelId", { length: 128 }).notNull(),
  /** Freeroam world external_id (UUID string) */
  worldId: varchar("worldId", { length: 128 }).notNull(),
  /** Character name as it appears in the speech bubble (or 'narrator') */
  characterName: varchar("characterName", { length: 255 }).notNull(),
  /** Freeroam character external_id. Uses '__narrator__' sentinel for narration panels.
   * This is the primary lookup key — never use characterName as a key since names are mutable. */
  characterId: varchar("characterId", { length: 128 }).notNull().default('__narrator__'),
  /** ElevenLabs voice ID used to generate this clip */
  voiceId: varchar("voiceId", { length: 128 }).notNull(),
  /** Generation status: 'generating' = in progress, 'ready' = audio available */
  status: varchar("status", { length: 16 }).notNull().default('ready'),
  /** S3 URL of the generated audio clip (empty string while generating) */
  audioUrl: text("audioUrl").notNull().default(''),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TtsCache = typeof ttsCache.$inferSelect;
export type InsertTtsCache = typeof ttsCache.$inferInsert;

// App settings — key-value store for global app configuration
export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** Setting key (e.g. 'narrator_voice_id', 'auto_play_enabled') */
  key: varchar("key", { length: 128 }).notNull().unique(),
  /** Setting value (JSON-serialized for complex values) */
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

// Image cache — stores generated NSFW image URLs keyed by panel
// Prevents regenerating the same image and incurring extra Atlas Cloud costs
export const imageCache = mysqlTable("image_cache", {
  id: int("id").autoincrement().primaryKey(),
  /** Freeroam panel external_id (UUID string) */
  panelId: varchar("panelId", { length: 128 }).notNull().unique(),
  /** Freeroam world external_id (UUID string) */
  worldId: varchar("worldId", { length: 128 }).notNull(),
  /** Generation status: 'generating' = in progress, 'ready' = image available */
  status: varchar("status", { length: 16 }).notNull().default('ready'),
  /** S3 URL of the generated image (empty string while generating) */
  imageUrl: text("imageUrl").notNull().default(''),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ImageCache = typeof imageCache.$inferSelect;
export type InsertImageCache = typeof imageCache.$inferInsert;

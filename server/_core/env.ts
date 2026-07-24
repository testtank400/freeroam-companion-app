export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** Optional object storage (Forge/S3-compatible). Empty → local disk fallback. */
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Shared site password — when set (or in production), gates the whole app */
  sitePassword: process.env.SITE_PASSWORD ?? "",
  /** Signs companion_site_session JWT; falls back to JWT_SECRET if unset */
  siteSessionSecret: process.env.SITE_SESSION_SECRET ?? process.env.JWT_SECRET ?? "",
};

/**
 * Site-level access gate (shared password → httpOnly session cookie).
 * Layered on top of Freeroam cookie auth — does not replace it.
 */
import { createHash, timingSafeEqual } from "crypto";
import type { CookieOptions, Express, NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";

export const SITE_SESSION_COOKIE = "companion_site_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_PURPOSE = "site";

function getSitePassword(): string {
  return (process.env.SITE_PASSWORD ?? "").trim();
}

function getSessionSecret(): Uint8Array {
  const secret =
    (process.env.SITE_SESSION_SECRET ?? "").trim() ||
    (process.env.JWT_SECRET ?? "").trim() ||
    ENV.cookieSecret;
  if (!secret) {
    // Deterministic fallback only for local when auth is disabled anyway
    return new TextEncoder().encode("dev-site-session-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

/** Site auth is required when SITE_PASSWORD is set, or always in production. */
export function isSiteAuthRequired(): boolean {
  if (getSitePassword()) return true;
  return ENV.isProduction;
}

export function isSiteAuthConfigured(): boolean {
  return Boolean(getSitePassword() && (
    (process.env.SITE_SESSION_SECRET ?? "").trim() ||
    (process.env.JWT_SECRET ?? "").trim() ||
    ENV.cookieSecret
  ));
}

function passwordDigest(password: string): Buffer {
  return createHash("sha256").update(password, "utf8").digest();
}

export function verifySitePassword(candidate: string): boolean {
  const expected = getSitePassword();
  if (!expected) return false;
  const a = passwordDigest(candidate);
  const b = passwordDigest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueSiteSessionToken(): Promise<string> {
  return new SignJWT({ purpose: SESSION_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySiteSessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return payload.purpose === SESSION_PURPOSE;
  } catch {
    return false;
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function getSiteSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const raw = cookies[SITE_SESSION_COOKIE];
  return raw && raw.trim() ? raw.trim() : null;
}

export async function isSiteAuthenticated(req: Request): Promise<boolean> {
  if (!isSiteAuthRequired()) return true;
  const token = getSiteSessionTokenFromRequest(req);
  if (!token) return false;
  return verifySiteSessionToken(token);
}

function isSecureRequest(req: Request): boolean {
  if (req.protocol === "https") return true;
  const forwarded = req.headers["x-forwarded-proto"];
  if (!forwarded) return false;
  const list = Array.isArray(forwarded) ? forwarded : forwarded.split(",");
  return list.some((p) => p.trim().toLowerCase() === "https");
}

export function getSiteSessionCookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

/** Paths that may be hit without a site session. */
function isPublicApiPath(req: Request): boolean {
  const path = req.path || "";
  // When mounted at /api, req.path is relative to mount (e.g. /site-auth/login)
  // When checked on full app, path may be /api/site-auth/login
  const normalized = path.startsWith("/api/") ? path.slice(4) : path;
  return (
    normalized === "/site-auth/login" ||
    normalized === "/site-auth/status" ||
    normalized === "/site-auth/logout" ||
    path === "/site-auth/login" ||
    path === "/site-auth/status" ||
    path === "/site-auth/logout" ||
    path.startsWith("/api/site-auth/")
  );
}

/**
 * Express middleware: require site session for /api (and optional storage paths).
 * Mount with `app.use(siteAuthMiddleware)` or `app.use("/api", siteAuthApiMiddleware)`.
 */
export async function siteAuthApiMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isSiteAuthRequired()) {
      next();
      return;
    }
    if (isPublicApiPath(req)) {
      next();
      return;
    }
    const ok = await isSiteAuthenticated(req);
    if (!ok) {
      res.status(401).json({ error: "Site authentication required", code: "SITE_AUTH_REQUIRED" });
      return;
    }
    next();
  } catch (err) {
    console.error("[SiteAuth] middleware error:", err);
    res.status(500).json({ error: "Auth check failed" });
  }
}

/** Also protect /manus-storage when auth is required. */
export async function siteAuthStorageMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isSiteAuthRequired()) {
      next();
      return;
    }
    const ok = await isSiteAuthenticated(req);
    if (!ok) {
      res.status(401).send("Site authentication required");
      return;
    }
    next();
  } catch {
    res.status(500).send("Auth check failed");
  }
}

export function registerSiteAuthRoutes(app: Express) {
  app.get("/api/site-auth/status", async (req, res) => {
    const authRequired = isSiteAuthRequired();
    const authenticated = authRequired ? await isSiteAuthenticated(req) : true;
    res.json({
      authRequired,
      authenticated,
      /** True when password is set but session secret is missing (misconfigured) */
      misconfigured: authRequired && !getSitePassword(),
    });
  });

  app.post("/api/site-auth/login", async (req, res) => {
    if (!isSiteAuthRequired()) {
      res.json({ ok: true, authRequired: false });
      return;
    }
    if (!getSitePassword()) {
      res.status(503).json({
        error: "Site auth is required but SITE_PASSWORD is not configured",
        code: "SITE_AUTH_MISCONFIGURED",
      });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!verifySitePassword(password)) {
      res.status(401).json({ error: "Invalid password", code: "INVALID_PASSWORD" });
      return;
    }
    const token = await issueSiteSessionToken();
    res.cookie(SITE_SESSION_COOKIE, token, getSiteSessionCookieOptions(req));
    res.json({ ok: true });
  });

  app.post("/api/site-auth/logout", (req, res) => {
    res.clearCookie(SITE_SESSION_COOKIE, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isSecureRequest(req),
    });
    res.json({ ok: true });
  });
}

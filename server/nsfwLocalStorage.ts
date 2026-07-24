import fs from "fs";
import path from "path";
import type { Express } from "express";

const NSFW_DIR = path.join(process.cwd(), "data", "nsfw-images");
const LOCAL_STORAGE_DIR = path.join(process.cwd(), "data", "local-storage");

function ensureDir() {
  fs.mkdirSync(NSFW_DIR, { recursive: true });
}

/**
 * True if a cached NSFW imageUrl can actually be loaded on this host.
 * Migrated TiDB/Manus rows often keep `/manus-storage/nsfw-images/...` URLs whose
 * blobs never left the Manus forge — those 404 locally and cause story-reader
 * flash (broken-image → onError → Freeroam fallback).
 */
export function isNsfwCachedUrlReachable(imageUrl: string | null | undefined): boolean {
  if (!imageUrl || !imageUrl.trim()) return false;
  const pathOnly = imageUrl.split("?")[0].trim();

  // Absolute remote URLs — assume reachable (Atlas/CDN); can't validate without a HEAD.
  if (/^https?:\/\//i.test(pathOnly)) return true;

  if (pathOnly.startsWith("/api/nsfw-images/")) {
    const filename = path.basename(pathOnly);
    if (!filename || filename.includes("..")) return false;
    return fs.existsSync(path.join(NSFW_DIR, filename));
  }

  if (pathOnly.startsWith("/api/local-storage/")) {
    const key = pathOnly.slice("/api/local-storage/".length).replace(/^\/+/, "");
    const safe = key
      .split("/")
      .filter((p) => p && p !== "." && p !== "..")
      .join(path.sep);
    if (!safe) return false;
    return fs.existsSync(path.join(LOCAL_STORAGE_DIR, safe));
  }

  if (pathOnly.startsWith("/manus-storage/")) {
    const key = pathOnly.slice("/manus-storage/".length).replace(/^\/+/, "");
    const safe = key
      .split("/")
      .filter((p) => p && p !== "." && p !== "..")
      .join(path.sep);
    if (!safe) return false;
    // Local copy of forge object (rare after migrate without blob copy)
    if (fs.existsSync(path.join(LOCAL_STORAGE_DIR, safe))) return true;
    // Without forge credentials the proxy always 404s — treat as dead
    if (!process.env.BUILT_IN_FORGE_API_URL || !process.env.BUILT_IN_FORGE_API_KEY) {
      return false;
    }
    // Forge configured — object may still exist in S3; allow cache hit
    return true;
  }

  // Unknown relative path — don't silently 404-loop
  return false;
}

/** Save generated NSFW image to disk for local/dev serving. Returns a same-origin URL. */
export async function saveNsfwImageLocally(
  panelId: string,
  data: Buffer,
  ext: string
): Promise<string> {
  ensureDir();
  const safeId = panelId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeId}.${ext}`;
  const filePath = path.join(NSFW_DIR, filename);
  await fs.promises.writeFile(filePath, data);
  // Cache-bust query so clients that overwrite the same panel file path get a fresh <img> load
  return `/api/nsfw-images/${filename}?v=${Date.now()}`;
}

/** Serve files from data/nsfw-images at /api/nsfw-images/* */
export function registerNsfwImageRoutes(app: Express) {
  ensureDir();
  app.get("/api/nsfw-images/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!filename || filename.includes("..")) {
      res.status(400).send("Invalid filename");
      return;
    }
    const filePath = path.join(NSFW_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).send("Not found");
      return;
    }
    // Regenerates overwrite the same filename; discourage long-lived browser cache
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(filePath);
  });
}

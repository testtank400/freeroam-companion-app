import fs from "fs";
import path from "path";
import type { Express } from "express";
import { ENV } from "./env";

const LOCAL_STORAGE_DIR = path.join(process.cwd(), "data", "local-storage");

function localFilePathForKey(key: string): string | null {
  const safe = key
    .replace(/^\/+/, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join(path.sep);
  if (!safe) return null;
  const filePath = path.join(LOCAL_STORAGE_DIR, safe);
  // Prevent path traversal outside the storage root
  if (!filePath.startsWith(LOCAL_STORAGE_DIR)) return null;
  return filePath;
}

/** Try to serve a migrated/local file from data/local-storage. */
function tryServeLocal(res: import("express").Response, key: string): boolean {
  const filePath = localFilePathForKey(key);
  if (!filePath || !fs.existsSync(filePath)) return false;
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(filePath);
  return true;
}

/**
 * Serves `/manus-storage/*` cover (and other) assets.
 *
 * - Prefer local disk (`data/local-storage/{key}`) when the file exists — covers
 *   uploads made without Forge land here as `/api/local-storage/...`, but DB
 *   rows migrated from Manus still point at `/manus-storage/...`.
 * - Otherwise, when Forge is configured, 307-redirect to a signed S3 URL.
 * - Otherwise 404 (UI falls back to headshot mosaic / folder icon).
 */
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // Local file wins (works offline / after copying objects into data/local-storage)
    if (tryServeLocal(res, key)) return;

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      // No Forge and no local file — broken for migrated Manus covers until re-uploaded
      res.status(404).send("Storage object not found (local file missing; Forge not configured)");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        // Last chance: local path again (in case of race)
        if (tryServeLocal(res, key)) return;
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      if (tryServeLocal(res, key)) return;
      res.status(502).send("Storage proxy error");
    }
  });
}

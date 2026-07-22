// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.
//
// Local fallback: when BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY are
// unset (typical for local/docker), files are written under data/local-storage
// and served at /api/local-storage/*.

import fs from "fs";
import path from "path";
import type { Express } from "express";
import { ENV } from "./_core/env";

const LOCAL_STORAGE_DIR = path.join(process.cwd(), "data", "local-storage");

function hasForgeConfig(): boolean {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function localFilePath(key: string): string {
  // Keep path segments but block traversal
  const safe = normalizeKey(key)
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join(path.sep);
  return path.join(LOCAL_STORAGE_DIR, safe);
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function localStoragePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const filePath = localFilePath(key);
  ensureParentDir(filePath);

  const buffer =
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  await fs.promises.writeFile(filePath, buffer);

  console.log(`[Storage] Local put → ${filePath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  // Local-only installs use /api/local-storage (served by registerLocalStorageRoutes).
  // Forge installs use /manus-storage via storagePut below. Migrated Manus cover rows
  // may still point at /manus-storage/* — storageProxy serves those from disk when present.
  return { key, url: `/api/local-storage/${key}` };
}

async function localStorageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const filePath = localFilePath(key);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local storage object not found: ${key}`);
  }
  return `/api/local-storage/${key}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (!hasForgeConfig()) {
    return localStoragePut(relKey, data);
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  if (!hasForgeConfig()) {
    return { key, url: `/api/local-storage/${key}` };
  }
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  if (!hasForgeConfig()) {
    return localStorageGetSignedUrl(relKey);
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}

/** Serve files written by the local storage fallback. */
export function registerLocalStorageRoutes(app: Express) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });

  // Express 4/5 wildcard: capture remaining path after prefix
  app.get("/api/local-storage/*", (req, res) => {
    const key = (req.params as Record<string, string>)[0] ?? "";
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    const filePath = localFilePath(key);
    if (!filePath.startsWith(LOCAL_STORAGE_DIR) || !fs.existsSync(filePath)) {
      res.status(404).send("Not found");
      return;
    }

    const basename = path.basename(filePath);
    if (basename.toLowerCase().endsWith(".zip")) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${basename.replace(/"/g, "")}"`,
      );
    } else {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }

    res.sendFile(filePath);
  });
}

import fs from "fs";
import path from "path";
import type { Express } from "express";

const NSFW_DIR = path.join(process.cwd(), "data", "nsfw-images");

function ensureDir() {
  fs.mkdirSync(NSFW_DIR, { recursive: true });
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

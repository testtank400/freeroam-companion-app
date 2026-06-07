/**
 * Express route for bulk character export.
 * Streams the ZIP file directly to the client instead of going through tRPC
 * (which has response size limits that fail with large rosters like 1000+ characters).
 */
import type { Express, Request, Response } from "express";
import { exportAllCharacters } from "./export";

export function registerExportRoute(app: Express) {
  app.post("/api/export/bulk", async (req: Request, res: Response) => {
    try {
      const { characterIds } = req.body as { characterIds?: string[] };

      if (!characterIds || !Array.isArray(characterIds) || characterIds.length === 0) {
        res.status(400).json({ error: "characterIds array is required" });
        return;
      }

      // Get cookie from header (same pattern as tRPC procedures)
      const cookie = (req.headers["x-freeroam-cookie"] as string) || process.env.cookie || "";
      if (!cookie) {
        res.status(401).json({ error: "No Freeroam cookie provided" });
        return;
      }

      // Get account ID from header
      const accountIdHeader = req.headers["x-freeroam-account-id"] as string;
      const accountId = accountIdHeader ? parseInt(accountIdHeader, 10) : null;

      // Generate the ZIP
      const result = await exportAllCharacters(characterIds, cookie, isNaN(accountId!) ? null : accountId);

      // Send as binary download
      const zipBuffer = Buffer.from(result.zipBase64, "base64");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.setHeader("Content-Length", zipBuffer.length.toString());
      res.setHeader("X-Export-Count", result.exportedCount.toString());
      res.setHeader("X-Export-Failed", result.failedCount.toString());
      res.send(zipBuffer);
    } catch (err) {
      console.error("[Export Route] Error:", err);
      const message = err instanceof Error ? err.message : "Export failed";
      res.status(500).json({ error: message });
    }
  });
}

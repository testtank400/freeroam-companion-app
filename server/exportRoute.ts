/**
 * Express route for bulk character export.
 * Streams the ZIP file directly to the client instead of going through tRPC
 * (which has response size limits that fail with large rosters like 1000+ characters).
 */
import type { Express, Request, Response } from "express";
import { exportAllCharacters, LibraryCharacterData } from "./export";

export function registerExportRoute(app: Express) {
  app.post("/api/export/bulk", async (req: Request, res: Response) => {
    try {
      const { characters } = req.body as { characters?: LibraryCharacterData[] };

      if (!characters || !Array.isArray(characters) || characters.length === 0) {
        res.status(400).json({ error: "characters array is required" });
        return;
      }

      // Get account ID from header
      const accountIdHeader = req.headers["x-freeroam-account-id"] as string;
      const accountId = accountIdHeader ? parseInt(accountIdHeader, 10) : null;

      // Generate the ZIP — no individual API calls needed, uses library data directly
      const result = await exportAllCharacters(characters, isNaN(accountId!) ? null : accountId);

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

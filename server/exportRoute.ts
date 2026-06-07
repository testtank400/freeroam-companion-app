/**
 * Express routes for bulk character export.
 * - POST /api/export/start — starts a background export job, returns jobId
 * - GET /api/export/status/:jobId — poll job status
 */
import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { exportJobs } from "../drizzle/schema";
import { getDb } from "./db";
import type { LibraryCharacterData } from "./export";
import { runExportJob } from "./exportJob";

export function registerExportRoute(app: Express) {
  /**
   * Start a new export job.
   * Returns immediately with a jobId. The export runs in the background.
   */
  app.post("/api/export/start", async (req: Request, res: Response) => {
    try {
      const { characters } = req.body as { characters?: LibraryCharacterData[] };

      if (!characters || !Array.isArray(characters) || characters.length === 0) {
        res.status(400).json({ error: "characters array is required" });
        return;
      }

      // Get account ID from header
      const accountIdHeader = req.headers["x-freeroam-account-id"] as string;
      const accountId = accountIdHeader ? parseInt(accountIdHeader, 10) : null;
      const validAccountId = accountId && !isNaN(accountId) ? accountId : null;

      if (!validAccountId) {
        res.status(401).json({ error: "No Freeroam account ID provided" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database not available" });
        return;
      }

      // Check if there's already a running job for this user
      const existingJobs = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.freeroamAccountId, validAccountId))
        .orderBy(exportJobs.createdAt);

      const runningJob = existingJobs.find(
        (j) => j.status === "pending" || j.status === "processing"
      );

      if (runningJob) {
        // Check if it's stale (older than 15 minutes)
        const age = Date.now() - new Date(runningJob.createdAt).getTime();
        if (age < 15 * 60 * 1000) {
          // Still active — return the existing job
          res.json({ jobId: runningJob.id, status: runningJob.status, alreadyRunning: true });
          return;
        }
        // Stale — mark it as error
        await db
          .update(exportJobs)
          .set({ status: "error", errorMessage: "Job timed out" })
          .where(eq(exportJobs.id, runningJob.id));
      }

      // Create a new job
      const jobId = crypto.randomUUID();
      await db.insert(exportJobs).values({
        id: jobId,
        freeroamAccountId: validAccountId,
        status: "pending",
        totalCount: characters.length,
      });

      // Fire and forget — start the background job
      setImmediate(() => {
        runExportJob(jobId, characters, validAccountId).catch((err) => {
          console.error(`[Export Route] Background job ${jobId} crashed:`, err);
        });
      });

      res.json({ jobId, status: "pending" });
    } catch (err) {
      console.error("[Export Route] Start error:", err);
      const message = err instanceof Error ? err.message : "Failed to start export";
      res.status(500).json({ error: message });
    }
  });

  /**
   * Poll the status of an export job.
   */
  app.get("/api/export/status/:jobId", async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      if (!jobId) {
        res.status(400).json({ error: "jobId is required" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database not available" });
        return;
      }

      const rows = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.id, jobId))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      const job = rows[0];

      // Check if stale (processing for > 15 minutes)
      if (
        (job.status === "pending" || job.status === "processing") &&
        Date.now() - new Date(job.createdAt).getTime() > 15 * 60 * 1000
      ) {
        await db
          .update(exportJobs)
          .set({ status: "error", errorMessage: "Job timed out" })
          .where(eq(exportJobs.id, jobId));
        res.json({
          jobId,
          status: "error",
          errorMessage: "Job timed out. Please try again.",
          exportedCount: job.exportedCount,
          failedCount: job.failedCount,
          totalCount: job.totalCount,
        });
        return;
      }

      res.json({
        jobId: job.id,
        status: job.status,
        downloadUrl: job.downloadUrl,
        errorMessage: job.errorMessage,
        exportedCount: job.exportedCount,
        failedCount: job.failedCount,
        totalCount: job.totalCount,
      });
    } catch (err) {
      console.error("[Export Route] Status error:", err);
      res.status(500).json({ error: "Failed to check status" });
    }
  });
}

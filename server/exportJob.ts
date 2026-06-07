/**
 * Background export job runner.
 * Generates ZIP files in the background with memory-safe batching,
 * uploads to S3, and updates the job record in the database.
 */
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { exportJobs } from "../drizzle/schema";
import { getCharacterExtended, getCharactersNsfw, getCollectionsByAccountId, getDb } from "./db";
import { storagePut } from "./storage";
import type { LibraryCharacterData } from "./export";

// ─── Helpers (duplicated from export.ts to keep this module self-contained) ──

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\.$/g, "")
    .replace(/^\.+/, "")
    .trim()
    .replace(/\s+/g, " ") || "Unknown_Character";
}

function buildAboutFreeroamMarkdown(freeroamBackstory: string | null | undefined): string {
  const hasContent = freeroamBackstory && freeroamBackstory.trim().length > 0;
  if (!hasContent) return "# About\n\n*No content on Freeroam.*\n";
  return `# About\n\n${freeroamBackstory}\n`;
}

function buildAboutExtendedMarkdown(extendedBackstory: string | null | undefined): string | null {
  const hasContent = extendedBackstory && extendedBackstory.trim().length > 0;
  if (!hasContent) return null;
  return `# About (Extended)\n\n${extendedBackstory}\n`;
}

function buildAppearanceFreeroamMarkdown(freeroamAppearance: string | null | undefined): string {
  const hasContent = freeroamAppearance && freeroamAppearance.trim().length > 0;
  if (!hasContent) return "# Appearance\n\n*No content on Freeroam.*\n";
  return `# Appearance\n\n${freeroamAppearance}\n`;
}

function buildAppearanceExtendedMarkdown(extendedAppearance: string | null | undefined): string | null {
  const hasContent = extendedAppearance && extendedAppearance.trim().length > 0;
  if (!hasContent) return null;
  return `# Appearance (Extended)\n\n${extendedAppearance}\n`;
}

async function downloadHeadshot(url: string | null | undefined): Promise<{ buffer: Buffer; ext: string } | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const urlExt = url.split(".").pop()?.split("?")[0] || "";
    const contentType = response.headers.get("content-type") || "";
    let ext = "webp";
    if (urlExt && ["jpg", "jpeg", "png", "webp", "gif"].includes(urlExt.toLowerCase())) {
      ext = urlExt.toLowerCase();
    } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      ext = "jpg";
    } else if (contentType.includes("png")) {
      ext = "png";
    } else if (contentType.includes("webp")) {
      ext = "webp";
    }
    return { buffer, ext };
  } catch {
    return null;
  }
}

// ─── Job Runner ─────────────────────────────────────────────────────────────

interface CompanionData {
  characterId: string;
  characterName: string;
  collections: Array<{ id: number; name: string; parentId: number | null }>;
  isNsfw: boolean;
  extendedBackstory: string | null;
  extendedAppearance: string | null;
  backstoryLimit: number | null;
  appearanceLimit: number | null;
  exportedAt: string;
  exportedFrom: string;
}

/**
 * Update the job status in the database.
 */
async function updateJobStatus(
  jobId: string,
  updates: Partial<{
    status: "pending" | "processing" | "done" | "error";
    downloadUrl: string | null;
    errorMessage: string | null;
    exportedCount: number;
    failedCount: number;
  }>
) {
  const db = await getDb();
  if (!db) return;
  await db.update(exportJobs).set(updates).where(eq(exportJobs.id, jobId));
}

/**
 * Run the export job in the background.
 * This function is fire-and-forget — it catches all errors internally.
 */
export async function runExportJob(
  jobId: string,
  characters: LibraryCharacterData[],
  freeroamAccountId: number | null
): Promise<void> {
  try {
    await updateJobStatus(jobId, { status: "processing" });

    const zip = new JSZip();
    const dateStr = new Date().toISOString().split("T")[0];
    const rootFolderName = `freeroam-companion-export-${dateStr}`;
    const rootFolder = zip.folder(rootFolderName)!;

    const characterIds = characters.map((c) => c.external_id);

    // Batch DB queries
    let nsfwMap: Record<string, boolean> = {};
    if (freeroamAccountId) {
      nsfwMap = await getCharactersNsfw(characterIds, freeroamAccountId);
    }

    let allCollections: Awaited<ReturnType<typeof getCollectionsByAccountId>> = [];
    if (freeroamAccountId) {
      allCollections = await getCollectionsByAccountId(freeroamAccountId);
    }

    const usedFolderNames = new Set<string>();
    let exportedCount = 0;
    let failedCount = 0;

    console.log(`[ExportJob ${jobId}] Phase 1: Building text content for ${characters.length} characters...`);

    // Phase 1: Build text content for all characters (fast, no network)
    interface PendingHeadshot {
      url: string;
      folderName: string;
    }
    const pendingHeadshots: PendingHeadshot[] = [];

    for (const char of characters) {
      try {
        const characterId = char.external_id;
        const extended = await getCharacterExtended(characterId);

        let folderName = sanitizeFolderName(char.name);
        let counter = 1;
        let uniqueName = folderName;
        while (usedFolderNames.has(uniqueName)) {
          uniqueName = `${folderName} (${counter})`;
          counter++;
        }
        usedFolderNames.add(uniqueName);

        const charFolder = rootFolder.folder(uniqueName)!;
        const backstory = char.backstory;
        const appearance = char.description;

        charFolder.file("about-freeroam.md", buildAboutFreeroamMarkdown(backstory));
        const aboutExt = buildAboutExtendedMarkdown(extended?.backstoryFull);
        if (aboutExt) charFolder.file("about-extended.md", aboutExt);

        charFolder.file("appearance-freeroam.md", buildAppearanceFreeroamMarkdown(appearance));
        const appExt = buildAppearanceExtendedMarkdown(extended?.appearanceFull);
        if (appExt) charFolder.file("appearance-extended.md", appExt);

        charFolder.file("character-data.json", JSON.stringify(char, null, 2));

        const characterCollections = allCollections
          .filter((c) => c.characterIds.includes(characterId))
          .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));

        const companionData: CompanionData = {
          characterId,
          characterName: char.name,
          collections: characterCollections,
          isNsfw: nsfwMap[characterId] || false,
          extendedBackstory: extended?.backstoryFull || null,
          extendedAppearance: extended?.appearanceFull || null,
          backstoryLimit: extended?.backstoryLimit || null,
          appearanceLimit: extended?.appearanceLimit || null,
          exportedAt: new Date().toISOString(),
          exportedFrom: "Freeroam Companion",
        };
        charFolder.file("companion-data.json", JSON.stringify(companionData, null, 2));

        const headshotUrl = char.headshot_url || char.display_headshot_url;
        if (headshotUrl) {
          pendingHeadshots.push({ url: headshotUrl, folderName: uniqueName });
        }

        exportedCount++;
      } catch (err) {
        console.warn(`[ExportJob ${jobId}] Failed text for ${char.external_id}:`, err);
        failedCount++;
      }
    }

    console.log(`[ExportJob ${jobId}] Phase 1 done: ${exportedCount} text packages built, ${pendingHeadshots.length} headshots queued.`);

    // Phase 2: Download headshots in memory-safe batches of 10
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(pendingHeadshots.length / BATCH_SIZE);
    console.log(`[ExportJob ${jobId}] Phase 2: Downloading ${pendingHeadshots.length} headshots in ${totalBatches} batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < pendingHeadshots.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = pendingHeadshots.slice(i, i + BATCH_SIZE);
      console.log(`[ExportJob ${jobId}] Headshot batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, pendingHeadshots.length)} of ${pendingHeadshots.length})`);

      const results = await Promise.allSettled(
        batch.map(async ({ url, folderName }) => {
          const headshot = await downloadHeadshot(url);
          if (headshot) {
            const charFolder = rootFolder.folder(folderName)!;
            charFolder.file(`headshot.${headshot.ext}`, headshot.buffer);
          }
        })
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn(`[ExportJob ${jobId}] Headshot failed:`, result.reason);
        }
      }
    }

    console.log(`[ExportJob ${jobId}] Phase 2 done. Phase 3: Generating ZIP...`);

    // Phase 3: Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    console.log(`[ExportJob ${jobId}] Phase 3 done. ZIP size: ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB. Phase 4: Uploading to S3...`);

    // Phase 4: Upload to S3
    const s3Key = `exports/${jobId}/${rootFolderName}.zip`;
    const { url: downloadUrl } = await storagePut(s3Key, zipBuffer, "application/zip");
    console.log(`[ExportJob ${jobId}] Phase 4 done. Download URL: ${downloadUrl}`);

    // Phase 5: Update job as done
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await updateJobStatus(jobId, {
      status: "done",
      downloadUrl,
      exportedCount,
      failedCount,
    });

    // Also set expiresAt directly
    const db = await getDb();
    if (db) {
      await db.update(exportJobs).set({ expiresAt }).where(eq(exportJobs.id, jobId));
    }

    console.log(`[ExportJob ${jobId}] ✅ COMPLETE: ${exportedCount} exported, ${failedCount} failed. Available at: ${downloadUrl}`);
  } catch (err) {
    console.error(`[ExportJob] Job ${jobId} failed:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    await updateJobStatus(jobId, {
      status: "error",
      errorMessage: message,
    });
  }
}

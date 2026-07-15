/**
 * Shared NSFW image_cache claim policy.
 *
 * IMPORTANT: Only generateNsfwImage should reclaim (delete) stale claims.
 * Status polls (checkImageReady) must stay read-only — deleting on poll
 * killed long Seedream v5 jobs and forced full re-runs on leave/return.
 */

/** DeepSeek classify phase should finish well under this. */
export const NSFW_STALE_CLASSIFYING_MS = 90_000;

/**
 * Seedream v5.0 Pro Edit often takes 90–150s+. Keep the claim long enough that
 * leave/return re-attaches instead of starting a second Atlas job.
 */
export const NSFW_STALE_GENERATING_MS = 6 * 60_000;

/** Atlas Cloud model id for NSFW panel edits. */
export const SEEDREAM_EDIT_MODEL = "bytedance/seedream-v5.0-pro/edit";

/** Poll interval while waiting on Atlas prediction. */
export const SEEDREAM_POLL_INTERVAL_MS = 2_000;

/** Max poll attempts (150 × 2s ≈ 5 minutes). */
export const SEEDREAM_POLL_MAX_ATTEMPTS = 150;

export type NsfwClaimStatus = "classifying" | "generating" | "ready" | "skipped";

export function isNsfwClaimStale(row: {
  status: string;
  createdAt: Date | string;
}): boolean {
  if (row.status !== "classifying" && row.status !== "generating") return false;
  const age = Date.now() - new Date(row.createdAt).getTime();
  const limit =
    row.status === "classifying"
      ? NSFW_STALE_CLASSIFYING_MS
      : NSFW_STALE_GENERATING_MS;
  return age > limit;
}

/**
 * Drop abandoned claims so regenerate / remount is not stuck forever.
 * Call only from generateNsfwImage (or explicit clear), never from status polls.
 */
export async function releaseStaleNsfwClaim(
  deleteByPanelId: () => Promise<unknown>,
  row: { status: string; createdAt: Date | string },
  panelId: string
): Promise<boolean> {
  if (!isNsfwClaimStale(row)) return false;
  console.warn(
    `[NSFW] Releasing stale ${row.status} claim for panel ${panelId} (age ${Math.round((Date.now() - new Date(row.createdAt).getTime()) / 1000)}s)`
  );
  await deleteByPanelId();
  return true;
}

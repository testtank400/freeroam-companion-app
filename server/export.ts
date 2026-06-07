import JSZip from "jszip";
import {
  getCharacterExtended,
  getCharactersNsfw,
  getCollectionsByAccountId,
} from "./db";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FreeroamCharacterData {
  external_id: string;
  name: string;
  backstory: string | null;
  appearance: string | null;
  headshot_url: string | null;
  display_headshot_url: string | null;
  [key: string]: unknown;
}

/** Character data as it comes from the library endpoint (description = appearance) */
export interface LibraryCharacterData {
  external_id: string;
  name: string;
  backstory: string | null;
  description: string | null; // This IS the appearance field
  headshot_url: string | null;
  display_headshot_url: string | null;
  privacy_status: string;
  created_at?: string;
  creator_username?: string;
  is_yours?: boolean;
  is_saved?: boolean;
  tags?: Array<{ name: string; is_fandom: boolean; emoji: string }>;
  [key: string]: unknown;
}

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const FREEROAM_HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  origin: "https://getfreeroam.com",
  referer: "https://getfreeroam.com",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
};

/**
 * Fetch a single character's full data from Freeroam API.
 * Used only for single-character export (profile modal).
 * Includes retry with exponential backoff for 429 rate limits.
 */
async function fetchCharacterData(
  characterId: string,
  cookie: string
): Promise<FreeroamCharacterData> {
  const url = `https://getfreeroam.com/api/characters/${encodeURIComponent(characterId)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
      );
    }

    const response = await fetch(url, {
      headers: { ...FREEROAM_HEADERS, cookie },
    });

    if (response.ok) {
      return (await response.json()) as FreeroamCharacterData;
    }

    if (response.status === 429 && attempt < 2) {
      continue; // retry
    }

    throw new Error(
      `Failed to fetch character ${characterId}: HTTP ${response.status}`
    );
  }

  throw new Error(`Failed to fetch character ${characterId} after retries`);
}

/**
 * Download a headshot image from a URL. Returns the buffer and file extension.
 * Returns null if download fails or URL is empty.
 */
async function downloadHeadshot(
  url: string | null | undefined
): Promise<{ buffer: Buffer; ext: string } | null> {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine extension from URL or content-type
    const urlExt = url.split(".").pop()?.split("?")[0] || "";
    const contentType = response.headers.get("content-type") || "";

    let ext = "webp"; // default
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

/**
 * Build the about-freeroam.md file content.
 */
function buildAboutFreeroamMarkdown(
  freeroamBackstory: string | null | undefined
): string {
  const hasContent = freeroamBackstory && freeroamBackstory.trim().length > 0;
  if (!hasContent) {
    return "# About\n\n*No content on Freeroam.*\n";
  }
  return `# About\n\n${freeroamBackstory}\n`;
}

/**
 * Build the about-extended.md file content.
 * Returns null if no extended content exists.
 */
function buildAboutExtendedMarkdown(
  extendedBackstory: string | null | undefined
): string | null {
  const hasContent = extendedBackstory && extendedBackstory.trim().length > 0;
  if (!hasContent) return null;
  return `# About (Extended)\n\n${extendedBackstory}\n`;
}

/**
 * Build the appearance-freeroam.md file content.
 */
function buildAppearanceFreeroamMarkdown(
  freeroamAppearance: string | null | undefined
): string {
  const hasContent = freeroamAppearance && freeroamAppearance.trim().length > 0;
  if (!hasContent) {
    return "# Appearance\n\n*No content on Freeroam.*\n";
  }
  return `# Appearance\n\n${freeroamAppearance}\n`;
}

/**
 * Build the appearance-extended.md file content.
 * Returns null if no extended content exists.
 */
function buildAppearanceExtendedMarkdown(
  extendedAppearance: string | null | undefined
): string | null {
  const hasContent = extendedAppearance && extendedAppearance.trim().length > 0;
  if (!hasContent) return null;
  return `# Appearance (Extended)\n\n${extendedAppearance}\n`;
}

/**
 * Sanitize a character name for use as a folder name.
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\.$/g, "")
    .replace(/^\.+/, "")
    .trim()
    .replace(/\s+/g, " ") || "Unknown_Character";
}

// ─── Export Functions ────────────────────────────────────────────────────────

/**
 * Export a single character as a ZIP buffer.
 * Fetches fresh data from the individual character endpoint.
 * Returns the ZIP as a base64 string.
 */
export async function exportSingleCharacter(
  characterId: string,
  cookie: string,
  freeroamAccountId: number | null
): Promise<{ zipBase64: string; fileName: string }> {
  // 1. Fetch full character data from Freeroam
  const charData = await fetchCharacterData(characterId, cookie);

  // 2. Get extended content from our DB
  const extended = await getCharacterExtended(characterId);

  // 3. Get NSFW status
  let isNsfw = false;
  if (freeroamAccountId) {
    const nsfwMap = await getCharactersNsfw([characterId], freeroamAccountId);
    isNsfw = nsfwMap[characterId] || false;
  }

  // 4. Get collections this character belongs to
  let characterCollections: Array<{ id: number; name: string; parentId: number | null }> = [];
  if (freeroamAccountId) {
    const allCollections = await getCollectionsByAccountId(freeroamAccountId);
    characterCollections = allCollections
      .filter((c) => c.characterIds.includes(characterId))
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  }

  // 5. Build the ZIP
  const zip = new JSZip();
  const folderName = sanitizeFolderName(charData.name);
  const folder = zip.folder(folderName)!;

  // about-freeroam.md (always present)
  folder.file("about-freeroam.md", buildAboutFreeroamMarkdown(charData.backstory));

  // about-extended.md (only if extended content exists)
  const aboutExtended = buildAboutExtendedMarkdown(extended?.backstoryFull);
  if (aboutExtended) {
    folder.file("about-extended.md", aboutExtended);
  }

  // appearance-freeroam.md (always present)
  folder.file("appearance-freeroam.md", buildAppearanceFreeroamMarkdown(charData.appearance));

  // appearance-extended.md (only if extended content exists)
  const appearanceExtended = buildAppearanceExtendedMarkdown(extended?.appearanceFull);
  if (appearanceExtended) {
    folder.file("appearance-extended.md", appearanceExtended);
  }

  // character-data.json (raw Freeroam response)
  folder.file("character-data.json", JSON.stringify(charData, null, 2));

  // companion-data.json (our DB data)
  const companionData: CompanionData = {
    characterId,
    characterName: charData.name,
    collections: characterCollections,
    isNsfw,
    extendedBackstory: extended?.backstoryFull || null,
    extendedAppearance: extended?.appearanceFull || null,
    backstoryLimit: extended?.backstoryLimit || null,
    appearanceLimit: extended?.appearanceLimit || null,
    exportedAt: new Date().toISOString(),
    exportedFrom: "Freeroam Companion",
  };
  folder.file("companion-data.json", JSON.stringify(companionData, null, 2));

  // headshot image
  const headshot = await downloadHeadshot(
    charData.headshot_url || charData.display_headshot_url
  );
  if (headshot) {
    folder.file(`headshot.${headshot.ext}`, headshot.buffer);
  }

  // Generate ZIP
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipBase64 = zipBuffer.toString("base64");

  return {
    zipBase64,
    fileName: `${folderName}.zip`,
  };
}

/**
 * Export all characters as a ZIP buffer.
 * Uses library data passed from the client — NO individual API calls needed.
 * Only downloads headshot images from the CDN (not rate-limited).
 * Each character gets its own subfolder.
 */
export async function exportAllCharacters(
  characters: LibraryCharacterData[],
  freeroamAccountId: number | null
): Promise<{ zipBuffer: Buffer; fileName: string; exportedCount: number; failedCount: number }> {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const rootFolderName = `freeroam-companion-export-${dateStr}`;
  const rootFolder = zip.folder(rootFolderName)!;

  const characterIds = characters.map((c) => c.external_id);

  // Get all NSFW flags at once
  let nsfwMap: Record<string, boolean> = {};
  if (freeroamAccountId) {
    nsfwMap = await getCharactersNsfw(characterIds, freeroamAccountId);
  }

  // Get all collections at once
  let allCollections: Awaited<ReturnType<typeof getCollectionsByAccountId>> = [];
  if (freeroamAccountId) {
    allCollections = await getCollectionsByAccountId(freeroamAccountId);
  }

  const usedFolderNames = new Set<string>();
  let exportedCount = 0;
  let failedCount = 0;

  // Phase 1: Build all text content (fast — no network calls)
  // Also collect headshot URLs for parallel download
  interface PendingHeadshot {
    url: string;
    folderName: string;
  }
  const pendingHeadshots: PendingHeadshot[] = [];

  for (const char of characters) {
    try {
      const characterId = char.external_id;

      // Get extended content from our DB
      const extended = await getCharacterExtended(characterId);

      // Determine unique folder name
      let folderName = sanitizeFolderName(char.name);
      let counter = 1;
      let uniqueName = folderName;
      while (usedFolderNames.has(uniqueName)) {
        uniqueName = `${folderName} (${counter})`;
        counter++;
      }
      usedFolderNames.add(uniqueName);

      const charFolder = rootFolder.folder(uniqueName)!;

      // Library endpoint: backstory = backstory, description = appearance
      const backstory = char.backstory;
      const appearance = char.description; // description IS the appearance field

      // about-freeroam.md (always present)
      charFolder.file("about-freeroam.md", buildAboutFreeroamMarkdown(backstory));

      // about-extended.md (only if extended content exists)
      const aboutExtended = buildAboutExtendedMarkdown(extended?.backstoryFull);
      if (aboutExtended) {
        charFolder.file("about-extended.md", aboutExtended);
      }

      // appearance-freeroam.md (always present)
      charFolder.file("appearance-freeroam.md", buildAppearanceFreeroamMarkdown(appearance));

      // appearance-extended.md (only if extended content exists)
      const appearanceExtended = buildAppearanceExtendedMarkdown(extended?.appearanceFull);
      if (appearanceExtended) {
        charFolder.file("appearance-extended.md", appearanceExtended);
      }

      // character-data.json — the library data for this character
      charFolder.file("character-data.json", JSON.stringify(char, null, 2));

      // companion-data.json
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

      // Queue headshot for parallel download
      const headshotUrl = char.headshot_url || char.display_headshot_url;
      if (headshotUrl) {
        pendingHeadshots.push({ url: headshotUrl, folderName: uniqueName });
      }

      exportedCount++;
    } catch (err) {
      console.warn(`[Export] Failed to export character ${char.external_id}:`, err);
      failedCount++;
    }
  }

  // Phase 2: Download all headshots in parallel (batches of 20)
  const BATCH_SIZE = 20;
  for (let i = 0; i < pendingHeadshots.length; i += BATCH_SIZE) {
    const batch = pendingHeadshots.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ url, folderName }) => {
        const headshot = await downloadHeadshot(url);
        if (headshot) {
          const charFolder = rootFolder.folder(folderName)!;
          charFolder.file(`headshot.${headshot.ext}`, headshot.buffer);
        }
      })
    );
    // Log failures but don't count them as export failures
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn(`[Export] Headshot download failed:`, result.reason);
      }
    }
  }

  // Generate ZIP — return raw buffer to avoid base64 string length limits
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return {
    zipBuffer,
    fileName: `${rootFolderName}.zip`,
    exportedCount,
    failedCount,
  };
}

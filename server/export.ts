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
 * Build the about.md file content.
 * Freeroam version first, then Extended (if exists).
 * If neither exists, show placeholder.
 */
function buildAboutMarkdown(
  freeroamBackstory: string | null | undefined,
  extendedBackstory: string | null | undefined
): string {
  const hasFreeroam = freeroamBackstory && freeroamBackstory.trim().length > 0;
  const hasExtended = extendedBackstory && extendedBackstory.trim().length > 0;

  if (!hasFreeroam && !hasExtended) {
    return "# About (Freeroam)\n\n*No content on Freeroam.*\n";
  }

  let content = "";

  if (hasFreeroam) {
    content += `# About (Freeroam)\n\n${freeroamBackstory}\n`;
  }

  if (hasExtended) {
    if (hasFreeroam) {
      content += "\n---\n\n";
    }
    content += `# About (Extended)\n\n${extendedBackstory}\n`;
  }

  return content;
}

/**
 * Build the appearance.md file content.
 * Freeroam version first, then Extended (if exists).
 * If neither exists, show placeholder.
 */
function buildAppearanceMarkdown(
  freeroamAppearance: string | null | undefined,
  extendedAppearance: string | null | undefined
): string {
  const hasFreeroam = freeroamAppearance && freeroamAppearance.trim().length > 0;
  const hasExtended = extendedAppearance && extendedAppearance.trim().length > 0;

  if (!hasFreeroam && !hasExtended) {
    return "# Appearance (Freeroam)\n\n*No content on Freeroam.*\n";
  }

  let content = "";

  if (hasFreeroam) {
    content += `# Appearance (Freeroam)\n\n${freeroamAppearance}\n`;
  }

  if (hasExtended) {
    if (hasFreeroam) {
      content += "\n---\n\n";
    }
    content += `# Appearance (Extended)\n\n${extendedAppearance}\n`;
  }

  return content;
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

  // about.md
  folder.file(
    "about.md",
    buildAboutMarkdown(charData.backstory, extended?.backstoryFull)
  );

  // appearance.md
  folder.file(
    "appearance.md",
    buildAppearanceMarkdown(charData.appearance, extended?.appearanceFull)
  );

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
 * Each character gets its own subfolder.
 * Returns the ZIP as a base64 string.
 */
export async function exportAllCharacters(
  characterIds: string[],
  cookie: string,
  freeroamAccountId: number | null
): Promise<{ zipBase64: string; fileName: string; exportedCount: number; failedCount: number }> {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const rootFolderName = `freeroam-companion-export-${dateStr}`;
  const rootFolder = zip.folder(rootFolderName)!;

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

  for (const characterId of characterIds) {
    try {
      // Fetch character data with polite delay
      const charData = await fetchCharacterData(characterId, cookie);

      // Get extended content
      const extended = await getCharacterExtended(characterId);

      // Determine unique folder name
      let folderName = sanitizeFolderName(charData.name);
      let counter = 1;
      let uniqueName = folderName;
      while (usedFolderNames.has(uniqueName)) {
        uniqueName = `${folderName} (${counter})`;
        counter++;
      }
      usedFolderNames.add(uniqueName);

      const charFolder = rootFolder.folder(uniqueName)!;

      // about.md
      charFolder.file(
        "about.md",
        buildAboutMarkdown(charData.backstory, extended?.backstoryFull)
      );

      // appearance.md
      charFolder.file(
        "appearance.md",
        buildAppearanceMarkdown(charData.appearance, extended?.appearanceFull)
      );

      // character-data.json
      charFolder.file("character-data.json", JSON.stringify(charData, null, 2));

      // companion-data.json
      const characterCollections = allCollections
        .filter((c) => c.characterIds.includes(characterId))
        .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));

      const companionData: CompanionData = {
        characterId,
        characterName: charData.name,
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

      // headshot
      const headshot = await downloadHeadshot(
        charData.headshot_url || charData.display_headshot_url
      );
      if (headshot) {
        charFolder.file(`headshot.${headshot.ext}`, headshot.buffer);
      }

      exportedCount++;

      // Polite delay between characters to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (err) {
      console.warn(`[Export] Failed to export character ${characterId}:`, err);
      failedCount++;
    }
  }

  // Generate ZIP
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipBase64 = zipBuffer.toString("base64");

  return {
    zipBase64,
    fileName: `${rootFolderName}.zip`,
    exportedCount,
    failedCount,
  };
}

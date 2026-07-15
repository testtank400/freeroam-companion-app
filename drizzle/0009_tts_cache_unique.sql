-- Deduplicate tts_cache rows before adding a unique index.
-- Keep the highest id per (panelId, worldId, characterId).
DELETE t1 FROM `tts_cache` t1
INNER JOIN `tts_cache` t2
WHERE
  t1.`panelId` = t2.`panelId`
  AND t1.`worldId` = t2.`worldId`
  AND t1.`characterId` = t2.`characterId`
  AND t1.`id` < t2.`id`;--> statement-breakpoint
CREATE UNIQUE INDEX `tts_cache_panel_world_char_uidx` ON `tts_cache` (`panelId`,`worldId`,`characterId`);

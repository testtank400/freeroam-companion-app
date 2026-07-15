ALTER TABLE `image_cache` ADD `freeroamImagePrompt` text;--> statement-breakpoint
ALTER TABLE `tts_cache` ADD CONSTRAINT `tts_cache_panel_world_char_uidx` UNIQUE(`panelId`,`worldId`,`characterId`);
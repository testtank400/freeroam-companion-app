ALTER TABLE `character_voices` ADD `languageCode` varchar(16);--> statement-breakpoint
ALTER TABLE `tts_cache` ADD `characterId` varchar(128) DEFAULT '__narrator__' NOT NULL;
ALTER TABLE `tts_cache` MODIFY COLUMN `audioUrl` text NOT NULL DEFAULT ('');--> statement-breakpoint
ALTER TABLE `tts_cache` ADD `status` varchar(16) DEFAULT 'ready' NOT NULL;
CREATE TABLE `app_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `character_voices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`characterId` varchar(128) NOT NULL,
	`voiceId` varchar(128) NOT NULL,
	`voiceName` varchar(255) NOT NULL,
	`stability` text DEFAULT ('0.5'),
	`similarityBoost` text DEFAULT ('0.75'),
	`style` text DEFAULT ('0'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `character_voices_id` PRIMARY KEY(`id`),
	CONSTRAINT `character_voices_characterId_unique` UNIQUE(`characterId`)
);
--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` varchar(64) NOT NULL,
	`freeroamAccountId` int NOT NULL,
	`status` enum('pending','processing','done','error') NOT NULL DEFAULT 'pending',
	`downloadUrl` text,
	`errorMessage` text,
	`exportedCount` int DEFAULT 0,
	`failedCount` int DEFAULT 0,
	`totalCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `export_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `freeroam_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`username` varchar(255) NOT NULL,
	`email` varchar(320),
	`externalId` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `freeroam_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `freeroam_users_accountId_unique` UNIQUE(`accountId`)
);
--> statement-breakpoint
CREATE TABLE `tts_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`panelId` varchar(128) NOT NULL,
	`worldId` varchar(128) NOT NULL,
	`characterName` varchar(255) NOT NULL,
	`voiceId` varchar(128) NOT NULL,
	`audioUrl` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tts_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `world_collection_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collectionExternalId` varchar(128) NOT NULL,
	`worldExternalId` varchar(128) NOT NULL,
	`freeroamAccountId` int NOT NULL,
	`addedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `world_collection_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `character_nsfw` DROP INDEX `character_nsfw_characterId_unique`;--> statement-breakpoint
ALTER TABLE `character_nsfw` ADD `freeroamAccountId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `freeroamAccountId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `parentId` int;--> statement-breakpoint
ALTER TABLE `collections` DROP COLUMN `ownerOpenId`;
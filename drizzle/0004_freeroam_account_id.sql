-- Migration: Add freeroam_users table, migrate collections to freeroamAccountId, update character_nsfw
-- This migration was applied manually via direct SQL; this file records it for drizzle tracking.

CREATE TABLE IF NOT EXISTS `freeroam_users` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `accountId` int NOT NULL,
  `username` varchar(255) NOT NULL,
  `email` varchar(320),
  `externalId` varchar(320),
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT `freeroam_users_accountId_unique` UNIQUE(`accountId`)
);

ALTER TABLE `collections` ADD COLUMN `freeroamAccountId` int NOT NULL DEFAULT 0;
ALTER TABLE `collections` DROP COLUMN `ownerOpenId`;

ALTER TABLE `character_nsfw` ADD COLUMN `freeroamAccountId` int NOT NULL DEFAULT 0;
ALTER TABLE `character_nsfw` DROP INDEX `character_nsfw_characterId_unique`;

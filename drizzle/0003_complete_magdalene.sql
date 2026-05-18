CREATE TABLE `character_nsfw` (
	`id` int AUTO_INCREMENT NOT NULL,
	`characterId` varchar(128) NOT NULL,
	`isNsfw` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `character_nsfw_id` PRIMARY KEY(`id`),
	CONSTRAINT `character_nsfw_characterId_unique` UNIQUE(`characterId`)
);

CREATE TABLE `character_extended` (
	`id` int AUTO_INCREMENT NOT NULL,
	`characterId` varchar(128) NOT NULL,
	`backstoryFull` text,
	`appearanceFull` text,
	`backstoryLimit` int,
	`appearanceLimit` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `character_extended_id` PRIMARY KEY(`id`),
	CONSTRAINT `character_extended_characterId_unique` UNIQUE(`characterId`)
);

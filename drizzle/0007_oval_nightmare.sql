CREATE TABLE `image_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`panelId` varchar(128) NOT NULL,
	`worldId` varchar(128) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'ready',
	`imageUrl` text NOT NULL DEFAULT (''),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `image_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `image_cache_panelId_unique` UNIQUE(`panelId`)
);

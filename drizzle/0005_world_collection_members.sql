CREATE TABLE `world_collection_members` (
  `id` int AUTO_INCREMENT NOT NULL,
  `collectionExternalId` varchar(128) NOT NULL,
  `worldExternalId` varchar(128) NOT NULL,
  `freeroamAccountId` int NOT NULL,
  `addedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `world_collection_members_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_wcm_collection` ON `world_collection_members` (`collectionExternalId`, `freeroamAccountId`);
CREATE INDEX `idx_wcm_world` ON `world_collection_members` (`worldExternalId`, `freeroamAccountId`);

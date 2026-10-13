PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cms_entry` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY,
	`collection` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`slug` text NOT NULL,
	`seoDescription` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`publishedAt` integer,
	`featuredImageId` text,
	`createdBy` text NOT NULL,
	`locale` text DEFAULT 'zh' NOT NULL,
	`sourceContentHashes` text,
	CONSTRAINT `cms_entry_featuredImageId_cms_media_id_fk` FOREIGN KEY (`featuredImageId`) REFERENCES `cms_media`(`id`) ON DELETE SET NULL,
	CONSTRAINT `cms_entry_createdBy_user_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_cms_entry`(`createdAt`, `updatedAt`, `updateCounter`, `id`, `collection`, `title`, `content`, `fields`, `slug`, `seoDescription`, `status`, `publishedAt`, `featuredImageId`, `createdBy`, `locale`, `sourceContentHashes`) SELECT `createdAt`, `updatedAt`, `updateCounter`, `id`, `collection`, `title`, `content`, `fields`, `slug`, `seoDescription`, `status`, `publishedAt`, `featuredImageId`, `createdBy`, `locale`, `sourceContentHashes` FROM `cms_entry`;--> statement-breakpoint
DROP TABLE `cms_entry`;--> statement-breakpoint
ALTER TABLE `__new_cms_entry` RENAME TO `cms_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cms_tag` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text,
	`locale` text DEFAULT 'zh' NOT NULL,
	`createdBy` text NOT NULL,
	CONSTRAINT `cms_tag_createdBy_user_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_cms_tag`(`createdAt`, `updatedAt`, `updateCounter`, `id`, `name`, `slug`, `description`, `color`, `locale`, `createdBy`) SELECT `createdAt`, `updatedAt`, `updateCounter`, `id`, `name`, `slug`, `description`, `color`, `locale`, `createdBy` FROM `cms_tag`;--> statement-breakpoint
DROP TABLE `cms_tag`;--> statement-breakpoint
ALTER TABLE `__new_cms_tag` RENAME TO `cms_tag`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cms_entry_status_idx` ON `cms_entry` (`status`);--> statement-breakpoint
CREATE INDEX `cms_entry_slug_idx` ON `cms_entry` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_entry_collection_slug_locale_unique` ON `cms_entry` (`collection`,`slug`,`locale`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_locale_status_created_at_idx` ON `cms_entry` (`collection`,`locale`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_created_by_status_idx` ON `cms_entry` (`createdBy`,`status`);--> statement-breakpoint
CREATE INDEX `cms_entry_created_at_idx` ON `cms_entry` (`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_status_created_at_idx` ON `cms_entry` (`collection`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_created_at_idx` ON `cms_entry` (`collection`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_locale_created_at_idx` ON `cms_entry` (`collection`,`locale`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_featured_image_idx` ON `cms_entry` (`featuredImageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_name_locale_unique` ON `cms_tag` (`name`,`locale`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_slug_locale_unique` ON `cms_tag` (`slug`,`locale`);--> statement-breakpoint
CREATE INDEX `cms_tag_locale_created_at_idx` ON `cms_tag` (`locale`,`createdAt`);
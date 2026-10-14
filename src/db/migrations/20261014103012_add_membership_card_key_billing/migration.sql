CREATE TABLE `billing_order` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`outOrderNo` text(64) NOT NULL,
	`userId` text NOT NULL,
	`userEmail` text(255),
	`productId` text(64),
	`productDays` integer NOT NULL,
	`productSnapshot` text(2000),
	`amountCents` integer NOT NULL,
	`channel` text(50) NOT NULL,
	`status` text(50) NOT NULL,
	`channelTradeNo` text(255),
	`providerSnapshot` text(2000),
	`expiresAt` integer,
	`paidAt` integer,
	`completedAt` integer,
	`failedReason` text(1000),
	CONSTRAINT `fk_billing_order_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `card_key_batch` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`name` text(255) NOT NULL,
	`days` integer NOT NULL,
	`count` integer NOT NULL,
	`createdBy` text,
	`note` text(500),
	CONSTRAINT `fk_card_key_batch_createdBy_user_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `card_key` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`code` text(64) NOT NULL,
	`batchId` text(64) NOT NULL,
	`days` integer NOT NULL,
	`status` text(50) NOT NULL,
	`usedBy` text,
	`usedAt` integer,
	`expiresAt` integer,
	`note` text(500),
	CONSTRAINT `fk_card_key_usedBy_user_id_fk` FOREIGN KEY (`usedBy`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `membership_grant` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`days` integer NOT NULL,
	`source` text(50) NOT NULL,
	`refId` text(255) NOT NULL,
	CONSTRAINT `fk_membership_grant_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `membership_plan` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`name` text(255) NOT NULL,
	`days` integer NOT NULL,
	`priceCents` integer NOT NULL,
	`sortOrder` integer,
	`enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_order_out_order_no_unique` ON `billing_order` (`outOrderNo`);--> statement-breakpoint
CREATE INDEX `billing_order_user_idx` ON `billing_order` (`userId`);--> statement-breakpoint
CREATE INDEX `billing_order_status_idx` ON `billing_order` (`status`);--> statement-breakpoint
CREATE INDEX `card_key_batch_created_idx` ON `card_key_batch` (`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `card_key_code_unique` ON `card_key` (`code`);--> statement-breakpoint
CREATE INDEX `card_key_batch_idx` ON `card_key` (`batchId`);--> statement-breakpoint
CREATE INDEX `card_key_status_idx` ON `card_key` (`status`);--> statement-breakpoint
CREATE INDEX `card_key_used_by_idx` ON `card_key` (`usedBy`);--> statement-breakpoint
CREATE INDEX `membership_grant_user_idx` ON `membership_grant` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_grant_source_ref_unique` ON `membership_grant` (`source`,`refId`);--> statement-breakpoint
CREATE INDEX `membership_plan_sort_idx` ON `membership_plan` (`sortOrder`);
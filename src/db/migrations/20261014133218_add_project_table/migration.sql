CREATE TABLE `project` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`packageName` text(255) NOT NULL,
	`name` text(255) NOT NULL,
	`summary` text(1000),
	`category` text(50) NOT NULL,
	`tags` text(500),
	`versionCode` integer NOT NULL,
	`versionName` text(100) NOT NULL,
	`sizeBytes` integer NOT NULL,
	`r2Key` text(500) NOT NULL,
	`userId` text NOT NULL,
	`status` text(50) NOT NULL,
	`rejectReason` text(1000),
	`downloads` integer NOT NULL,
	CONSTRAINT `fk_project_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_package_name_unique` ON `project` (`packageName`);--> statement-breakpoint
CREATE INDEX `project_user_idx` ON `project` (`userId`);--> statement-breakpoint
CREATE INDEX `project_status_idx` ON `project` (`status`);--> statement-breakpoint
CREATE INDEX `project_category_idx` ON `project` (`category`);
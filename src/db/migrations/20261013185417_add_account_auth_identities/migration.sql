CREATE TABLE `auth_identity` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`providerType` text(50) NOT NULL,
	`providerKey` text(255) NOT NULL,
	`providerSubject` text(255) NOT NULL,
	`verifiedAt` integer,
	`metadata` text(2000),
	CONSTRAINT `fk_auth_identity_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `nickname` text(255);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identity_provider_unique` ON `auth_identity` (`providerType`,`providerKey`,`providerSubject`);--> statement-breakpoint
CREATE INDEX `auth_identity_user_idx` ON `auth_identity` (`userId`);
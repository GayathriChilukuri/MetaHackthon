CREATE TABLE `ai_usage` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_workspace_at` ON `demo_audit` (`workspace_id`,`at`);--> statement-breakpoint
CREATE TABLE `demo_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

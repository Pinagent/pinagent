CREATE SCHEMA "team";
--> statement-breakpoint
CREATE TABLE "team"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" text NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"metadata" jsonb
);

CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"metadata" jsonb
);

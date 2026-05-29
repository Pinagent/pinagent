CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."organization_memberships" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"invited_at" text NOT NULL,
	"joined_at" text,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);

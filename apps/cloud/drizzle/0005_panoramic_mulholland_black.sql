CREATE TABLE "auth"."sso_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"protocol" text NOT NULL,
	"issuer" text NOT NULL,
	"domains" jsonb NOT NULL,
	"enabled" boolean NOT NULL
);

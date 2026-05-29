CREATE SCHEMA "relay";
--> statement-breakpoint
CREATE TABLE "relay"."active_sessions" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"connected_at" text NOT NULL,
	CONSTRAINT "active_sessions_organization_id_session_id_pk" PRIMARY KEY("organization_id","session_id")
);

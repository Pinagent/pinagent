CREATE TABLE "team"."cost_controls" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"max_relay_sessions_per_period" integer,
	"enforcement" text NOT NULL
);

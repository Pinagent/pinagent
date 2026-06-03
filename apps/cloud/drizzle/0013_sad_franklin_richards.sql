CREATE TABLE "billing"."usage_alerts" (
	"organization_id" text NOT NULL,
	"period_start" text NOT NULL,
	"severity" text NOT NULL,
	"alerted_at" text NOT NULL,
	CONSTRAINT "usage_alerts_organization_id_period_start_severity_pk" PRIMARY KEY("organization_id","period_start","severity")
);

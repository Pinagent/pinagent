CREATE TABLE "billing"."subscriptions" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"current_period_start" text NOT NULL
);

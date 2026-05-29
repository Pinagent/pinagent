CREATE TABLE "team"."branch_routing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"default_base_branch" text,
	"allowed_branch_patterns" jsonb NOT NULL
);

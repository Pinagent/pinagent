CREATE TABLE "auth"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" text NOT NULL,
	"last_login_at" text NOT NULL
);

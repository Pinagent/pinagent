CREATE TABLE "auth"."sso_identities" (
	"connection_id" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "sso_identities_connection_id_subject_pk" PRIMARY KEY("connection_id","subject")
);
--> statement-breakpoint
CREATE INDEX "sso_identities_user_id_idx" ON "auth"."sso_identities" USING btree ("user_id");
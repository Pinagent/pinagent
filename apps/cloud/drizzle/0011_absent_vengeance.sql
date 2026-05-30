CREATE TABLE "auth"."invitations" (
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_at" text NOT NULL,
	"invited_by_user_id" text,
	CONSTRAINT "invitations_organization_id_email_pk" PRIMARY KEY("organization_id","email")
);

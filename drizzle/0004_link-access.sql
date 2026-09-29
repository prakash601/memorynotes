ALTER TABLE "note_shares" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "note_shares" ADD COLUMN "max_views" integer;--> statement-breakpoint
ALTER TABLE "note_shares" ADD COLUMN "views_count" integer DEFAULT 0 NOT NULL;
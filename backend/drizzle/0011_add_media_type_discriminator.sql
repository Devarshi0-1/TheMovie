ALTER TABLE "review" DROP CONSTRAINT "unique_user_movie_review";--> statement-breakpoint
ALTER TABLE "watchlist" DROP CONSTRAINT "unique_user_movie";--> statement-breakpoint
DROP INDEX "review_movie_idx";--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "media_type" text DEFAULT 'movie' NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "media_type" text DEFAULT 'movie' NOT NULL;--> statement-breakpoint
CREATE INDEX "review_media_idx" ON "review" USING btree ("media_type","movie_id");--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "unique_user_media_review" UNIQUE("user_id","media_type","movie_id");--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "unique_user_media" UNIQUE("user_id","media_type","movie_id");
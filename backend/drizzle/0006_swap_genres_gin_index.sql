DROP INDEX "movies_metadata_gin_idx";--> statement-breakpoint
CREATE INDEX "movies_genres_gin_idx" ON "movies" USING gin ("genres");
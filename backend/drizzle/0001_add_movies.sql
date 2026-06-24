CREATE TABLE "movies" (
	"id" text PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"overview" text,
	"poster_path" text,
	"backdrop_path" text,
	"release_date" text,
	"genres" jsonb,
	"keywords" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movies_tmdb_id_unique" UNIQUE("tmdb_id")
);
--> statement-breakpoint
CREATE INDEX "movies_metadata_gin_idx" ON "movies" USING gin ("metadata");
CREATE TABLE "tv_shows" (
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
	"embedding" vector(1536),
	"source_hash" text,
	"review_summary" jsonb,
	"review_summary_embedding" vector(1536),
	"review_summary_hash" text,
	"review_count_at_summary" integer,
	"review_summary_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tv_shows_tmdb_id_unique" UNIQUE("tmdb_id")
);
--> statement-breakpoint
CREATE INDEX "tv_shows_genres_gin_idx" ON "tv_shows" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "tv_shows_embedding_hnsw_idx" ON "tv_shows" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "tv_shows_review_summary_embedding_hnsw_idx" ON "tv_shows" USING hnsw ("review_summary_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "tv_shows_review_summary_at_idx" ON "tv_shows" USING btree ("review_summary_at");
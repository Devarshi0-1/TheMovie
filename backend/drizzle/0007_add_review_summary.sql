ALTER TABLE "movies" ADD COLUMN "review_summary" jsonb;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "review_summary_embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "review_summary_hash" text;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "review_count_at_summary" integer;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "review_summary_at" timestamp;--> statement-breakpoint
CREATE INDEX "movies_review_summary_embedding_hnsw_idx" ON "movies" USING hnsw ("review_summary_embedding" vector_cosine_ops);
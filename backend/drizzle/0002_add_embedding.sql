CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE INDEX "movies_embedding_hnsw_idx" ON "movies" USING hnsw ("embedding" vector_cosine_ops);
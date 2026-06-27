CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "movies_review_summary_at_idx" ON "movies" USING btree ("review_summary_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_token_unique" UNIQUE("token");
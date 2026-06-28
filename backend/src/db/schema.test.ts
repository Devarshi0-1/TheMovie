import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { chatMessage, conversation, movies, review } from './schema'

// Offline schema verification. Applying the migration against a live
// Postgres+pgvector is pending a reachable DB (tracked in the PR).
describe('movies table schema', () => {
    const cfg = getTableConfig(movies)

    it('defines the expected columns (feature)', () => {
        const cols = cfg.columns.map((c) => c.name).sort()
        expect(cols).toEqual(
            [
                'id',
                'tmdb_id',
                'title',
                'overview',
                'poster_path',
                'backdrop_path',
                'release_date',
                'genres',
                'keywords',
                'metadata',
                'embedding',
                'source_hash',
                'review_summary',
                'review_summary_embedding',
                'review_summary_hash',
                'review_count_at_summary',
                'review_summary_at',
                'created_at',
                'updated_at',
            ].sort(),
        )
    })

    it('tmdb_id is the unique natural key (edge: dedup on upsert)', () => {
        const tmdbId = cfg.columns.find((c) => c.name === 'tmdb_id')
        expect(tmdbId?.isUnique).toBe(true)
    })

    it('title required, overview nullable (edge: partial TMDB rows)', () => {
        expect(cfg.columns.find((c) => c.name === 'title')?.notNull).toBe(true)
        expect(cfg.columns.find((c) => c.name === 'overview')?.notNull).toBe(false)
    })

    it('has a GIN index on genres (feature: jsonb membership for the genre filter)', () => {
        // The GIN index must be on `genres` — the column search_movies_sql filters
        // with `genres ? 'Action'` — not `metadata`, which no query ever filters.
        const gin = cfg.indexes.find((i) => i.config.name === 'movies_genres_gin_idx')
        expect(gin).toBeDefined()
        expect(cfg.indexes.find((i) => i.config.name === 'movies_metadata_gin_idx')).toBeUndefined()
    })

    it('has an embedding vector column + HNSW index (feature: semantic kNN)', () => {
        expect(cfg.columns.find((c) => c.name === 'embedding')).toBeDefined()
        const hnsw = cfg.indexes.find((i) => i.config.name === 'movies_embedding_hnsw_idx')
        expect(hnsw).toBeDefined()
    })

    it('has a SEPARATE reception vector column + its own HNSW index (Phase 8, Option B)', () => {
        // The audience-reception summary is embedded into its own vector so the
        // blended search can kNN it independently of the plot vector.
        expect(cfg.columns.find((c) => c.name === 'review_summary_embedding')).toBeDefined()
        const hnsw = cfg.indexes.find(
            (i) => i.config.name === 'movies_review_summary_embedding_hnsw_idx',
        )
        expect(hnsw).toBeDefined()
    })

    it('summary bookkeeping columns are nullable (edge: a movie may have no summary yet)', () => {
        for (const name of [
            'review_summary',
            'review_summary_embedding',
            'review_summary_hash',
            'review_count_at_summary',
            'review_summary_at',
        ]) {
            expect(cfg.columns.find((c) => c.name === name)?.notNull).toBe(false)
        }
    })
})

describe('movies migration (offline; live apply pending env)', () => {
    it('generates CREATE TABLE movies + unique tmdb_id + genres GIN index', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('CREATE TABLE "movies"')
        expect(sql).toContain('UNIQUE("tmdb_id")')
        // The GIN index was swapped from metadata (never queried) onto genres
        // (the column the genre filter uses): the swap migration must drop the
        // old one and create the new.
        expect(sql.toLowerCase()).toContain('using gin ("genres")')
        expect(sql).toContain('DROP INDEX "movies_metadata_gin_idx"')
    })

    it('enables pgvector + adds the embedding column & HNSW index', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector')
        expect(sql).toContain('vector(1536)')
        expect(sql.toLowerCase()).toContain('using hnsw')
    })

    it('adds the source_hash column for ingestion idempotency (Phase 3.3)', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('ADD COLUMN "source_hash" text')
    })

    it('adds the reception summary columns + second HNSW index (Phase 8, Option B)', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('ADD COLUMN "review_summary" jsonb')
        expect(sql).toContain('ADD COLUMN "review_summary_embedding" vector(1536)')
        expect(sql).toContain('movies_review_summary_embedding_hnsw_idx')
    })

    it('creates conversation + chat_message tables for memory (Phase 4.4)', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('CREATE TABLE "conversation"')
        expect(sql).toContain('CREATE TABLE "chat_message"')
        // chat_message → conversation FK with cascade delete.
        expect(sql).toMatch(/chat_message.*conversation.*ON DELETE cascade/s)
    })

    it('creates the review table with a unique (user, movie) (Phase 5.2)', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('CREATE TABLE "review"')
        expect(sql).toContain('UNIQUE("user_id","movie_id")')
    })
})

describe('review schema', () => {
    it('has the expected columns; content required, rating nullable (feature)', () => {
        const cfg = getTableConfig(review)
        const cols = cfg.columns.map((c) => c.name).sort()
        expect(cols).toEqual(
            [
                'id',
                'user_id',
                'movie_id',
                'media_type',
                'rating',
                'content',
                'created_at',
                'updated_at',
            ].sort(),
        )
        expect(cfg.columns.find((c) => c.name === 'content')?.notNull).toBe(true)
        expect(cfg.columns.find((c) => c.name === 'rating')?.notNull).toBe(false)
        // media_type is required and defaults to 'movie' (backfills existing rows).
        expect(cfg.columns.find((c) => c.name === 'media_type')?.notNull).toBe(true)
    })

    it('is indexed by (mediaType, movie) for the per-title listing (feature)', () => {
        const cfg = getTableConfig(review)
        expect(cfg.indexes.find((i) => i.config.name === 'review_media_idx')).toBeDefined()
    })
})

describe('jsonb columns store native jsonb, not double-encoded strings (regression)', () => {
    // Regression: drizzle-orm's stock `jsonb()` pre-`JSON.stringify`s its value and
    // Bun's SQL driver then serializes it again, persisting a jsonb *string scalar*
    // ("[\"Action\"]") instead of an array/object. Full-column drizzle reads
    // round-trip (it JSON-parses on the way out) so the bug is invisible to unit
    // tests, but every Postgres-side jsonb operation silently breaks — `@>`
    // containment + GIN lookups return nothing, so e.g. search_movies_sql's genre
    // filter never matches. The custom passthrough type must hand the raw JS value
    // to the driver (mapToDriverValue is identity), letting it serialize once.
    it('genres/keywords map arrays through untouched, not stringified (feature)', () => {
        const genres = ['Action', 'Crime']
        expect(movies.genres.mapToDriverValue(genres)).toEqual(genres)
        expect(movies.keywords.mapToDriverValue(['superhero'])).toEqual(['superhero'])
        // The stock-jsonb regression would hand the driver the string '["Action","Crime"]'.
        expect(typeof movies.genres.mapToDriverValue(genres)).not.toBe('string')
    })

    it('metadata + chat_message.parts map objects/arrays through untouched (edge: nested)', () => {
        const meta = { status: 'Released', genres: [{ id: 28, name: 'Action' }] }
        expect(movies.metadata.mapToDriverValue(meta)).toEqual(meta)
        const parts = [{ type: 'text', text: 'hi' }]
        expect(chatMessage.parts.mapToDriverValue(parts)).toEqual(parts)
        expect(typeof chatMessage.parts.mapToDriverValue(parts)).not.toBe('string')
    })

    it('reads native jsonb through untouched but parses legacy string scalars (regression)', () => {
        // Native rows: bun-sql returns the value already parsed → passthrough.
        expect(movies.genres.mapFromDriverValue(['Action', 'Crime'])).toEqual(['Action', 'Crime'])
        expect(movies.metadata.mapFromDriverValue({ status: 'Released' })).toEqual({
            status: 'Released',
        })
        // Legacy rows written by the OLD stock-jsonb schema come back as a JSON
        // *string*; fromDriver must parse them so genres aren't silently dropped
        // (a non-array would make asStringArray return []).
        expect(movies.genres.mapFromDriverValue('["Action","Crime"]')).toEqual(['Action', 'Crime'])
        // A non-JSON string is returned as-is rather than throwing.
        expect(movies.genres.mapFromDriverValue('not json')).toBe('not json')
    })
})

describe('conversation + chat_message schema', () => {
    it('chat_message references conversation and carries jsonb parts (feature)', () => {
        const cfg = getTableConfig(chatMessage)
        const cols = cfg.columns.map((c) => c.name).sort()
        expect(cols).toEqual(['id', 'conversation_id', 'role', 'parts', 'created_at'].sort())
        expect(cfg.columns.find((c) => c.name === 'parts')?.notNull).toBe(true)
    })

    it('conversation is indexed by user for per-user lookup (feature)', () => {
        const cfg = getTableConfig(conversation)
        expect(cfg.indexes.find((i) => i.config.name === 'conversation_user_idx')).toBeDefined()
    })
})

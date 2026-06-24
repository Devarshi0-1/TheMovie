import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { movies } from './schema'

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

    it('has a GIN index for metadata (feature: JSON containment search)', () => {
        // The index *method* (USING gin) is asserted against the generated SQL
        // below — drizzle's runtime IndexConfig doesn't surface it cleanly.
        const gin = cfg.indexes.find((i) => i.config.name === 'movies_metadata_gin_idx')
        expect(gin).toBeDefined()
    })

    it('has an embedding vector column + HNSW index (feature: semantic kNN)', () => {
        expect(cfg.columns.find((c) => c.name === 'embedding')).toBeDefined()
        const hnsw = cfg.indexes.find((i) => i.config.name === 'movies_embedding_hnsw_idx')
        expect(hnsw).toBeDefined()
    })
})

describe('movies migration (offline; live apply pending env)', () => {
    it('generates CREATE TABLE movies + unique tmdb_id + GIN index', () => {
        const dir = join(import.meta.dir, '..', '..', 'drizzle')
        const sql = readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => readFileSync(join(dir, f), 'utf8'))
            .join('\n')

        expect(sql).toContain('CREATE TABLE "movies"')
        expect(sql).toContain('UNIQUE("tmdb_id")')
        expect(sql.toLowerCase()).toContain('using gin ("metadata")')
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
})

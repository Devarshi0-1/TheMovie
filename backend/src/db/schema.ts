import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    vector,
} from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
})

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
})

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
})

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
})

export const watchlist = pgTable(
    'watchlist',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        movieId: integer('movie_id').notNull(),
        title: text('title').notNull(),
        posterPath: text('poster_path'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [unique('unique_user_movie').on(t.userId, t.movieId)],
)

// Local catalog of movies. TMDB data is persisted here (the self-healing
// write-back target) and is the substrate for semantic search. The
// `embedding` column holds the OpenAI `text-embedding-3-small` vector (1536
// dims), populated by the ingestion pipeline (Phase 3.3) and queried via
// cosine kNN over the HNSW index.
export const movies = pgTable(
    'movies',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        tmdbId: integer('tmdb_id').notNull().unique(),
        title: text('title').notNull(),
        overview: text('overview'),
        posterPath: text('poster_path'),
        backdropPath: text('backdrop_path'),
        releaseDate: text('release_date'),
        genres: jsonb('genres'),
        keywords: jsonb('keywords'),
        metadata: jsonb('metadata'),
        embedding: vector('embedding', { dimensions: 1536 }),
        // SHA-256 of the exact text that produced `embedding`. The ingestion
        // pipeline (Phase 3.3) compares this to skip re-embedding/re-writing
        // rows whose source text is unchanged (idempotent upserts).
        sourceHash: text('source_hash'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        // GIN index on the raw TMDB metadata for fast JSON containment queries.
        index('movies_metadata_gin_idx').using('gin', t.metadata),
        // HNSW index for cosine-distance kNN over embeddings (semantic search).
        index('movies_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    ],
)

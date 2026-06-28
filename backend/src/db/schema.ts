import {
    boolean,
    customType,
    index,
    integer,
    pgTable,
    text,
    timestamp,
    unique,
    vector,
} from 'drizzle-orm/pg-core'

// All timestamps are `timestamptz` (BDB-5): a `timestamp without time zone`
// round-tripped through JS `Date`s drifts if the DB/server TZ isn't UTC. Storing
// the offset removes that footgun. BetterAuth is agnostic to the column's tz.
const tstz = (name: string) => timestamp(name, { withTimezone: true })

// Native jsonb that stores the JS value as real jsonb (array/object) instead of
// a JSON-stringified scalar. drizzle-orm's stock `jsonb()` pre-`JSON.stringify`s
// the value and Bun's SQL driver serializes it again, double-encoding the column:
// full-column drizzle reads round-trip (drizzle JSON-parses on the way out), but
// every Postgres-side jsonb operation silently breaks — `@>` containment, GIN
// index lookups, `->`/`jsonb_array_elements`. Passing the value through untouched
// lets the bun-sql driver serialize/parse it exactly once. (dataType stays
// `jsonb`, so this is transparent to migrations.)
const jsonbNative = <TData>(name: string) =>
    customType<{ data: TData; driverData: unknown }>({
        dataType: () => 'jsonb',
        // Identity ON WRITE — this MUST stay a passthrough: any encoding here
        // (e.g. JSON.stringify) reintroduces the double-encoding bug, since
        // bun-sql already serializes the value once.
        toDriver: (value: TData) => value as unknown,
        // Defensive ON READ: bun-sql returns native jsonb already parsed, so the
        // common case is a passthrough. But a row written by the OLD stock-jsonb
        // schema is stored as a JSON *string scalar* and comes back as a string;
        // parse it so legacy/un-reseeded rows still surface as arrays/objects
        // instead of silently becoming `[]`. Non-JSON strings are returned as-is.
        fromDriver: (value: unknown) => {
            if (typeof value !== 'string') return value as TData
            try {
                return JSON.parse(value) as TData
            } catch {
                return value as TData
            }
        },
    })(name)

export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
})

export const session = pgTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: tstz('expires_at').notNull(),
        token: text('token').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        // BetterAuth validates the session by `token` on every authed request —
        // make it unique (also indexes it) so that lookup isn't a seq scan.
        unique('session_token_unique').on(t.token),
        // Postgres doesn't auto-index FKs; this one is hit on session resolution
        // and user-cascade deletes.
        index('session_user_idx').on(t.userId),
    ],
)

export const account = pgTable(
    'account',
    {
        id: text('id').primaryKey(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: tstz('access_token_expires_at'),
        refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
        scope: text('scope'),
        password: text('password'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        // FK + the provider/account lookup BetterAuth runs during sign-in.
        index('account_user_idx').on(t.userId),
        index('account_provider_idx').on(t.providerId, t.accountId),
    ],
)

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
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
        // 'movie' | 'tv'. TMDB ids are namespaced by media type, so membership is
        // keyed on (user, mediaType, movieId). Defaults to 'movie' so the column
        // backfills existing rows (Phase 10.3).
        mediaType: text('media_type').notNull().default('movie'),
        title: text('title').notNull(),
        posterPath: text('poster_path'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [unique('unique_user_media').on(t.userId, t.mediaType, t.movieId)],
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
        genres: jsonbNative<string[]>('genres'),
        keywords: jsonbNative<string[]>('keywords'),
        metadata: jsonbNative<unknown>('metadata'),
        embedding: vector('embedding', { dimensions: 1536 }),
        // SHA-256 of the exact text that produced `embedding`. The ingestion
        // pipeline (Phase 3.3) compares this to skip re-embedding/re-writing
        // rows whose source text is unchanged (idempotent upserts).
        sourceHash: text('source_hash'),
        // ── Audience-reception summary (Phase 8) ─────────────────────────────
        // PG is the durable source of truth for the AI review summary; Redis is
        // a hot cache in front of it. `reviewSummary` holds the {vibe,pros,cons}
        // payload; `reviewSummaryEmbedding` is a SEPARATE vector (Option B) over
        // that summary text, capturing audience *reception* — a signal the
        // plot-based `embedding` can't ("audiences found it genuinely scary").
        reviewSummary: jsonbNative<unknown>('review_summary'),
        reviewSummaryEmbedding: vector('review_summary_embedding', { dimensions: 1536 }),
        // SHA-256 of the summarized review text — gates both re-summarizing and
        // re-embedding (unchanged reviews → no LLM/embedding spend).
        reviewSummaryHash: text('review_summary_hash'),
        // TMDB review count at last summary — the refresh job's "did the source
        // actually change?" trigger (unchanged count → skip regeneration).
        reviewCountAtSummary: integer('review_count_at_summary'),
        // When the summary was last (re)generated — the tiered-refresh clock.
        reviewSummaryAt: tstz('review_summary_at'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        // GIN index on `genres` — the column actually filtered with jsonb
        // membership (`genres ? 'Action'`) in search_movies_sql. (The old index
        // was on `metadata`, which no query ever filters — dead weight.)
        index('movies_genres_gin_idx').using('gin', t.genres),
        // HNSW index for cosine-distance kNN over embeddings (semantic search).
        index('movies_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
        // Second HNSW index for the reception vector — lets the blended search
        // (Phase 8) run an index-accelerated kNN over `review_summary_embedding`
        // independently of the plot vector, then fuse the two rankings.
        index('movies_review_summary_embedding_hnsw_idx').using(
            'hnsw',
            t.reviewSummaryEmbedding.op('vector_cosine_ops'),
        ),
        // The refresh job scans for due summaries by `review_summary_at`
        // (NULL or older than the cutoff); index it so that isn't a full scan.
        index('movies_review_summary_at_idx').on(t.reviewSummaryAt),
    ],
)

// Local catalog of TV shows — the TV mirror of `movies` (Phase 10). TV is now a
// first-class, ingested + embedded media type (not just a TMDB proxy): the same
// pipeline pulls TMDB `/tv/*` data, embeds plot + audience-reception text, and
// persists it here so semantic search, summaries, and the agent treat shows and
// films alike. Columns/indexes intentionally mirror `movies` 1:1 — TMDB's `name`
// maps to `title` and `first_air_date` to `releaseDate`, so the shared
// MovieResult shape and all downstream catalog code apply unchanged.
export const tvShows = pgTable(
    'tv_shows',
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
        genres: jsonbNative<string[]>('genres'),
        keywords: jsonbNative<string[]>('keywords'),
        metadata: jsonbNative<unknown>('metadata'),
        embedding: vector('embedding', { dimensions: 1536 }),
        sourceHash: text('source_hash'),
        reviewSummary: jsonbNative<unknown>('review_summary'),
        reviewSummaryEmbedding: vector('review_summary_embedding', { dimensions: 1536 }),
        reviewSummaryHash: text('review_summary_hash'),
        reviewCountAtSummary: integer('review_count_at_summary'),
        reviewSummaryAt: tstz('review_summary_at'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        index('tv_shows_genres_gin_idx').using('gin', t.genres),
        index('tv_shows_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
        index('tv_shows_review_summary_embedding_hnsw_idx').using(
            'hnsw',
            t.reviewSummaryEmbedding.op('vector_cosine_ops'),
        ),
        index('tv_shows_review_summary_at_idx').on(t.reviewSummaryAt),
    ],
)

// Per-user chat conversations — the multi-turn memory behind the agent. Each
// request loads the conversation's prior messages so the agent has context
// ("the sci-fi one we discussed"); new turns are appended via streamText's
// onFinish (Phase 4.4).
export const conversation = pgTable(
    'conversation',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        title: text('title'),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [index('conversation_user_idx').on(t.userId)],
)

// One row per chat message. `id` is the AI SDK UIMessage id; `parts` stores the
// UIMessage parts jsonb verbatim so messages round-trip back into `useChat`.
export const chatMessage = pgTable(
    'chat_message',
    {
        id: text('id').primaryKey(),
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversation.id, { onDelete: 'cascade' }),
        role: text('role').notNull(),
        parts: jsonbNative<unknown>('parts').notNull(),
        createdAt: tstz('created_at').notNull().defaultNow(),
    },
    (t) => [index('chat_message_conversation_idx').on(t.conversationId)],
)

// User-authored movie reviews (Phase 5.2). One review per user per movie
// (`unique_user_movie_review`), editable via upsert. Indexed by movie for the
// per-movie reviews listing; recent reviews are also mirrored to a Redis List.
export const review = pgTable(
    'review',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        movieId: integer('movie_id').notNull(),
        // 'movie' | 'tv' — one review per user per (mediaType, movieId). Defaults
        // to 'movie' so the column backfills existing rows (Phase 10.3).
        mediaType: text('media_type').notNull().default('movie'),
        rating: integer('rating'),
        content: text('content').notNull(),
        createdAt: tstz('created_at').notNull().defaultNow(),
        updatedAt: tstz('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        unique('unique_user_media_review').on(t.userId, t.mediaType, t.movieId),
        index('review_media_idx').on(t.mediaType, t.movieId),
    ],
)

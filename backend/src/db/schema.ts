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
        genres: jsonbNative<string[]>('genres'),
        keywords: jsonbNative<string[]>('keywords'),
        metadata: jsonbNative<unknown>('metadata'),
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
        // GIN index on `genres` — the column actually filtered with jsonb
        // membership (`genres ? 'Action'`) in search_movies_sql. (The old index
        // was on `metadata`, which no query ever filters — dead weight.)
        index('movies_genres_gin_idx').using('gin', t.genres),
        // HNSW index for cosine-distance kNN over embeddings (semantic search).
        index('movies_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
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
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at')
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
        createdAt: timestamp('created_at').notNull().defaultNow(),
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
        rating: integer('rating'),
        content: text('content').notNull(),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at')
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (t) => [
        unique('unique_user_movie_review').on(t.userId, t.movieId),
        index('review_movie_idx').on(t.movieId),
    ],
)

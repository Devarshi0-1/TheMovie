import { pgTable, text, timestamp, unique, boolean, foreignKey, integer } from 'drizzle-orm/pg-core'

export const verification = pgTable('verification', {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
})

export const users = pgTable(
    'users',
    {
        id: text().primaryKey().notNull(),
        name: text().notNull(),
        email: text().notNull(),
        emailVerified: boolean('email_verified').notNull(),
        image: text(),
        createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    },
    (table) => [unique('users_email_unique').on(table.email)],
)

export const account = pgTable(
    'account',
    {
        id: text().primaryKey().notNull(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id').notNull(),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'string' }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'string' }),
        scope: text(),
        password: text(),
        createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    },
    (table) => [
        foreignKey({
            columns: [table.userId],
            foreignColumns: [users.id],
            name: 'account_user_id_users_id_fk',
        }).onDelete('cascade'),
    ],
)

export const session = pgTable(
    'session',
    {
        id: text().primaryKey().notNull(),
        expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
        token: text().notNull(),
        userId: text('user_id').notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    },
    (table) => [
        foreignKey({
            columns: [table.userId],
            foreignColumns: [users.id],
            name: 'session_user_id_users_id_fk',
        }).onDelete('cascade'),
    ],
)

export const watchlist = pgTable(
    'watchlist',
    {
        id: text().primaryKey().notNull(),
        userId: text('user_id').notNull(),
        movieId: integer('movie_id').notNull(),
        title: text().notNull(),
        posterPath: text('poster_path'),
        createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    },
    (table) => [
        foreignKey({
            columns: [table.userId],
            foreignColumns: [users.id],
            name: 'watchlist_user_id_users_id_fk',
        }).onDelete('cascade'),
        unique('unique_user_movie').on(table.userId, table.movieId),
    ],
)

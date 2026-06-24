import { relations } from "drizzle-orm/relations";
import { users, account, session, watchlist } from "./schema";

export const accountRelations = relations(account, ({one}) => ({
	user: one(users, {
		fields: [account.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	accounts: many(account),
	sessions: many(session),
	watchlists: many(watchlist),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(users, {
		fields: [session.userId],
		references: [users.id]
	}),
}));

export const watchlistRelations = relations(watchlist, ({one}) => ({
	user: one(users, {
		fields: [watchlist.userId],
		references: [users.id]
	}),
}));
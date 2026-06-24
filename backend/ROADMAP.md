# 🎬 TheMovie - Native-First Development Roadmap

> A Netflix-style movie discovery platform built on **Bun's Native APIs**.

## 📦 Tech Stack: The "Zero-Dependency" Approach

This stack aggressively eliminates external npm packages in favor of Bun's built-in, high-performance C++ implementations.

| Layer | Technology | Native Replacement For... |
| --- | --- | --- |
| **Runtime** | **Bun** | Node.js, `ts-node`, `nodemon` |
| **Server** | **Hono** | Express, Fastify (uses native `Request`/`Response`) |
| **Database** | **Bun.SQL** (PostgreSQL) | `pg`, `postgres.js` |
| **ORM** | **Drizzle** (`bun-sql` driver) | TypeORM, Prisma (heavy clients) |
| **Cache** | **Bun Redis** | `ioredis`, `redis` (npm packages) |
| **Hashing** | **Bun.password** | `bcrypt`, `argon2` |
| **Testing** | **Bun Test** | `jest`, `vitest` |
| **Deployment** | **Docker** (`oven/bun`) | Node.js Alpine images |

---

## ⚡️ Bun Native APIs: The "Secret Sauce"

Use these exact patterns to avoid installing unnecessary packages.

```typescript
// 1. ✅ Native Redis (Zero dependencies)
// Reads `REDIS_URL` automatically. No 'ioredis' needed.
import { redis } from "bun";

await redis.set("session:123", "user_data", "EX", 3600);
const val = await redis.get("session:123");

// 2. ✅ Native SQL (Zero dependencies)
// Uses Bun's native C++ PostgreSQL driver. No 'pg' needed.
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

// Native connection
const client = new SQL(process.env.DATABASE_URL!);
// Pass native client to Drizzle
const db = drizzle({ client });

// 4. ✅ Native Password Hashing
// Optimized Argon2 implementation. No 'bcrypt' needed.
const hash = await Bun.password.hash("supersecret");
const isValid = await Bun.password.verify("supersecret", hash);

```

## 🚩 Phase 1: The Native Foundation

### Milestone 1.1: Core Infrastructure

* [ ] **Initialize Bun**: `bun init` (Built-in TypeScript support, no `tsc` config needed).
* [ ] **Setup Hono**: Initialize Hono with strict mode.
* *Note:* Hono uses Bun's native `Bun.serve()` under the hood.


* [ ] **Setup Database (Bun.SQL)**:
* Configure `drizzle-orm` with the `drizzle-orm/bun-sql` adapter.
* *Goal:* Ensure Drizzle is using the **native** client, not the Node.js `postgres` package.


* [ ] **Setup Redis (Bun Native)**:
* Verify connection using `import { redis } from 'bun'`.
* Implement a simple `HealthCheck` endpoint that pings both DB and Redis.



### Milestone 1.2: Authentication (BetterAuth + Native)

* [ ] **Configure BetterAuth**:
* Use Drizzle adapter (connected via Bun.SQL).
* *Optimization:* If BetterAuth allows custom hashers, inject `Bun.password` for maximum speed.


* [ ] **Session Management**:
* Store sessions in Redis (Native).
* Set TTLs using Redis `EX` (Expire) command.



---

## 🚩 Phase 2: Movie Data Engine (TMDB)

### Milestone 2.1: Native Fetching & Caching

* [ ] **TMDB Service**:
* Use `fetch()` (Bun native implementation) for all upstream requests.


* [ ] **The "Stale-While-Revalidate" Pattern**:
* **Check**: `await redis.get(\`movie:${id}`)`
* **Miss**: Fetch TMDB -> `await redis.set(...)` -> Return data.
* **Hit**: Return Redis data immediately.



### Milestone 2.2: Database Schema (Drizzle)

* [ ] **Define Schema**: Consolidate into one migration.
* `movies`: id, tmdb_id, title, poster, backdrop, metadata (jsonb).
* `users`: id, email, password_hash, role.
* `watchlists`: user_id, movie_id, added_at.


* [ ] **Indexing**: Add GIN index on `movies.metadata` for JSON search performance.

---

## 🚩 Phase 3: High-Performance User Features

### Milestone 3.1: Watchlist & Social

* [ ] **Atomic Operations**:
* Use Redis Sets (`SADD`, `SREM`, `SISMEMBER`) for "Is this movie in my watchlist?" checks. This is O(1) and faster than SQL.
* Sync Redis sets to Postgres `watchlists` table via background job (write-behind) or dual-write.


* [ ] **User Reviews**:
* Store reviews in Postgres.
* Cache "Recent Reviews" for a movie in a Redis List (`LPUSH`, `LTRIM`).



---

## 🚩 Phase 4: Recommendation Engine (Hybrid)

### Milestone 4.1: Vector-ish Similarity

* [ ] **Related Movies**:
* Store "Similar Movies" (from TMDB) in Redis JSON or simple string arrays.


* [ ] **Personalized Feed**:
* **Query**: "Get movies from genres X, Y that user hasn't seen."
* **Optimization**: Use `Bun.SQL` raw queries for complex joins if Drizzle is too slow.



---

## 🚩 Phase 5: Production Hardening

### Milestone 5.1: Native Security

* [ ] **Rate Limiting**:
* Implement a slide-window rate limiter using Redis `INCR` and `EXPIRE`.
* *Why?* Native Redis is faster than any JS-based middleware.


* [ ] **Secure Headers**: Use Hono's `secureHeaders` middleware.

### Milestone 5.2: DevOps

* [ ] **Docker Image**:
* Use `FROM oven/bun:1-alpine` (Smallest, fastest).
* Command: `CMD ["bun", "run", "src/index.ts"]`.


* [ ] **CI/CD**:
* Run tests with `bun test` (Instant startup).

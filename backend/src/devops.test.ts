import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_MODEL } from './agent/agent'
import { INTENT_MODEL } from './agent/intent'
import { SUMMARY_MODEL } from './lib/summary'
import { RECOMMENDATION_MODEL } from './lib/recommendations'

// Guards the deploy/CI config (Phase 6.3) against accidental breakage. These are
// offline file-content checks — the real build/run is exercised on the PR's CI
// run and a live `docker build` (verification debt).
const backendDir = join(import.meta.dir, '..')
const repoDir = join(backendDir, '..')

describe('Dockerfile', () => {
    const dockerfile = readFileSync(join(backendDir, 'Dockerfile'), 'utf8')

    it('uses the oven/bun alpine base (feature)', () => {
        expect(dockerfile).toContain('FROM oven/bun:1-alpine')
    })

    it('installs production deps from the frozen lockfile (feature)', () => {
        expect(dockerfile).toContain('bun install --frozen-lockfile --production')
    })

    it('starts the server via the entrypoint (feature)', () => {
        expect(dockerfile).toContain('CMD ["bun", "run", "src/index.ts"]')
    })
})

describe('.dockerignore', () => {
    const dockerignore = readFileSync(join(backendDir, '.dockerignore'), 'utf8')

    it('keeps secrets and node_modules out of the image (edge: no .env leak)', () => {
        expect(dockerignore).toContain('.env')
        expect(dockerignore).toContain('node_modules')
    })
})

describe('CI workflow', () => {
    const ci = readFileSync(join(repoDir, '.github', 'workflows', 'ci.yml'), 'utf8')

    it('runs on pull requests (feature: gate every PR)', () => {
        expect(ci).toContain('pull_request')
    })

    it('type-checks and tests the backend (feature)', () => {
        expect(ci).toContain('tsc --noEmit')
        expect(ci).toContain('bun test')
    })
})

describe('DB migration runner', () => {
    const pkg = readFileSync(join(backendDir, 'package.json'), 'utf8')

    // drizzle-kit migrate can't run on this Bun-native stack (it needs a node
    // pg/postgres driver we don't install); db:migrate must use the bun-sql
    // migrator script instead. Guards against a regression back to drizzle-kit.
    it('uses the Bun-native migrator, not drizzle-kit migrate (regression)', () => {
        expect(pkg).toContain('"db:migrate": "bun run src/db/migrate.ts"')
        expect(pkg).not.toContain('drizzle-kit migrate')
    })
})

describe('AI model configuration', () => {
    // Drift guard (CLAUDE.md → "Right-size the model"): the project runs
    // `gpt-5-nano` across every LLM call as a deliberate cost choice, and the docs
    // (ROADMAP.md / README.md / VERIFICATION.md) state so. If a specific call is
    // intentionally stepped up a tier (gpt-5-mini, then gpt-5), update the constant
    // AND those docs together, then this assertion — so code and docs never silently
    // diverge (which is exactly what this guard caught after commit 9834d2c).
    it('pins every LLM call to gpt-5-nano (agent, intent, summary, recs) (feature)', () => {
        expect(AGENT_MODEL).toBe('gpt-5-nano')
        expect(INTENT_MODEL).toBe('gpt-5-nano')
        expect(SUMMARY_MODEL).toBe('gpt-5-nano')
        expect(RECOMMENDATION_MODEL).toBe('gpt-5-nano')
    })
})

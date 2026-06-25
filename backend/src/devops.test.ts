import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

import { describe, expect, it } from 'bun:test'
import type { RedisClient } from 'bun'
import { createResilientRedis, isRedisConnectionError } from './redis'

const connErr = (code = 'ERR_REDIS_CONNECTION_CLOSED') => {
    const e = new Error('Connection has failed') as Error & { code?: string }
    e.code = code
    return e
}

describe('isRedisConnectionError', () => {
    it('matches Bun connection error codes and messages (feature)', () => {
        expect(isRedisConnectionError(connErr('ERR_REDIS_CONNECTION_CLOSED'))).toBe(true)
        expect(isRedisConnectionError(connErr('ERR_REDIS_CONNECTION_TIMEOUT'))).toBe(true)
        expect(isRedisConnectionError(new Error('Connection closed'))).toBe(true)
    })

    it('does not match unrelated errors (edge)', () => {
        expect(isRedisConnectionError(new Error('WRONGTYPE Operation'))).toBe(false)
        expect(isRedisConnectionError(null)).toBe(false)
    })
})

describe('createResilientRedis (recover from a wedged client after an outage)', () => {
    it('recreates the client and retries once on a connection error (regression)', async () => {
        // Bun does not auto-reconnect a dropped connection; a fresh client does.
        // The first client is "wedged" (incr rejects with a connection error);
        // the wrapper must discard it, create a new one, and the retry succeeds.
        let created = 0
        const create = () => {
            created++
            const wedged = created === 1
            return {
                incr: async () => {
                    if (wedged) throw connErr()
                    return 7
                },
                close: () => {},
            } as unknown as RedisClient
        }
        const redis = createResilientRedis(create)
        expect(await redis.incr('k')).toBe(7)
        expect(created).toBe(2) // wedged client replaced exactly once
    })

    it('does NOT recreate or retry on a non-connection error (edge)', async () => {
        let created = 0
        const create = () => {
            created++
            return {
                get: async () => {
                    throw new Error('WRONGTYPE Operation against a key')
                },
                close: () => {},
            } as unknown as RedisClient
        }
        const redis = createResilientRedis(create)
        await expect(redis.get('k')).rejects.toThrow('WRONGTYPE')
        expect(created).toBe(1) // no churn for application-level errors
    })

    it('passes through successful commands without recreating (feature)', async () => {
        let created = 0
        const create = () => {
            created++
            return { ping: async () => 'PONG', close: () => {} } as unknown as RedisClient
        }
        const redis = createResilientRedis(create)
        expect(await redis.ping()).toBe('PONG')
        expect(await redis.ping()).toBe('PONG')
        expect(created).toBe(1)
    })
})

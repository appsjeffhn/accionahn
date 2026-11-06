import { describe, expect, it } from 'vitest'
import { clientKey, createRateLimiter } from './throttle'

const headers = (h: Record<string, string>) => new Headers(h)

describe('createRateLimiter', () => {
  it('allows a burst up to capacity, then refuses until tokens refill', () => {
    let t = 0
    const limiter = createRateLimiter({ capacity: 3, refillMs: 1000, now: () => t })
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true])
    expect(limiter.take('a')).toBe(false)
    t = 999
    expect(limiter.take('a')).toBe(false)
    t = 1000
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('keeps keys apart and never refills above capacity', () => {
    let t = 0
    const limiter = createRateLimiter({ capacity: 2, refillMs: 10, now: () => t })
    limiter.take('a')
    limiter.take('a')
    expect(limiter.take('b')).toBe(true)
    t = 1_000_000
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, false])
  })

  it('bounds memory: past maxKeys the oldest key is forgotten', () => {
    const limiter = createRateLimiter({ capacity: 1, refillMs: 1_000_000, maxKeys: 2, now: () => 0 })
    limiter.take('a')
    limiter.take('b')
    limiter.take('c')
    expect(limiter.size()).toBe(2)
    expect(limiter.take('a')).toBe(true)
  })
})

describe('clientKey', () => {
  it('uses the first hop of x-forwarded-for and never returns the raw address', () => {
    const key = clientKey(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))
    expect(key).not.toContain('203.0.113.7')
    expect(key).toMatch(/^ip:[0-9a-f]{32}$/)
    expect(clientKey(headers({ 'x-forwarded-for': ' 203.0.113.7 ' }))).toBe(key)
    expect(clientKey(headers({ 'x-forwarded-for': '198.51.100.1' }))).not.toBe(key)
  })

  it('accepts IPv6 and falls back to x-real-ip', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '2001:db8::1' }))).toMatch(/^ip:/)
    expect(clientKey(headers({ 'x-real-ip': '203.0.113.7' }))).toBe(clientKey(headers({ 'x-forwarded-for': '203.0.113.7' })))
  })

  it('maps a missing or garbage address to one shared key', () => {
    expect(clientKey(headers({}))).toBe('ip:unknown')
    expect(clientKey(headers({ 'x-forwarded-for': 'not-an-ip, 203.0.113.7' }))).toBe('ip:unknown')
    expect(clientKey(headers({ 'x-forwarded-for': 'x'.repeat(5000) }))).toBe('ip:unknown')
  })
})

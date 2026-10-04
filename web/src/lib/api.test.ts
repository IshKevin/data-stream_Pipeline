import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, friendlyStatusMessage, setToken } from './api'

function mockFetch(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  setToken(null)
})

describe('api client', () => {
  it('uses the server message for domain errors and keeps the structured details', async () => {
    mockFetch(409, JSON.stringify({ detail: 'Some episodes cannot be assigned', code: 'conflict', errors: [{ episode: 'EP-1', reason: 'already_assigned' }] }))
    const err = await api('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('Some episodes cannot be assigned')
    expect((err as ApiError).errors?.[0]?.reason).toBe('already_assigned')
  })

  it('flattens FastAPI validation errors into one readable line', async () => {
    mockFetch(422, JSON.stringify({ detail: [{ loc: ['body', 'episodes_requested'], msg: 'Input should be greater than or equal to 1' }] }))
    await expect(api('/x')).rejects.toThrow('episodes_requested: Input should be greater than or equal to 1')
  })

  it('turns proxy errors without a JSON body into friendly messages', async () => {
    mockFetch(429, '<html>429 Too Many Requests</html>')
    await expect(api('/x')).rejects.toThrow('Too many attempts')
    mockFetch(502, 'Bad Gateway')
    await expect(api('/x')).rejects.toThrow('temporarily unavailable')
  })

  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(api('/x')).rejects.toThrow('Cannot reach the server')
  })

  it('sends the bearer token and JSON body', async () => {
    setToken('abc')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api('/things', { method: 'POST', body: { a: 1 } })
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
    expect(init.body).toBe('{"a":1}')
  })

  it('has a sensible default message per status', () => {
    expect(friendlyStatusMessage(413)).toMatch(/too large/)
    expect(friendlyStatusMessage(500)).toMatch(/server had a problem/)
    expect(friendlyStatusMessage(404)).toBe('Request failed (404)')
  })
})

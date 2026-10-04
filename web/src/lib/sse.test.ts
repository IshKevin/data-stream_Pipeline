import { describe, expect, it } from 'vitest'
import { SSEParser } from './sse'

describe('SSEParser', () => {
  it('parses complete events and ignores comments', () => {
    const p = new SSEParser()
    const out = p.push('retry: 3000\n\n: keep-alive\n\nevent: request.created\ndata: {"a":1}\n\n')
    expect(out).toEqual([{ event: 'request.created', data: '{"a":1}' }])
  })

  it('handles events split across chunks and CRLF', () => {
    const p = new SSEParser()
    expect(p.push('event: x\r\ndata: {"a"')).toEqual([])
    expect(p.push(':1}\r\n\r\nevent: y\ndata: 2\n\n')).toEqual([
      { event: 'x', data: '{"a":1}' },
      { event: 'y', data: '2' },
    ])
  })

  it('joins multi-line data', () => {
    const p = new SSEParser()
    expect(p.push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }])
  })
})

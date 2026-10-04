import { getToken } from './api'
import type { ServerEvent } from './types'

export interface ParsedSSE {
  event: string
  data: string
}

/** Incremental Server-Sent-Events parser. Feed it chunks of text; get back complete events. */
export class SSEParser {
  private buffer = ''

  push(chunk: string): ParsedSSE[] {
    this.buffer += chunk.replace(/\r\n/g, '\n')
    const out: ParsedSSE[] = []
    let sep: number
    while ((sep = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, sep)
      this.buffer = this.buffer.slice(sep + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue // comment / keep-alive
        const idx = line.indexOf(':')
        const field = idx === -1 ? line : line.slice(0, idx)
        const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length) out.push({ event, data: data.join('\n') })
    }
    return out
  }
}

/**
 * Subscribe to /api/events. EventSource can't send an Authorization header, so this uses fetch()
 * streaming. Reconnects with backoff; returns a function that stops it.
 */
export function subscribeToEvents(
  onEvent: (e: ServerEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const controller = new AbortController()
  let delay = 1000

  async function run() {
    while (!controller.signal.aborted) {
      try {
        const token = getToken()
        if (!token) return
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (res.status === 401 || res.status === 403) return
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`)
        onStatus(true)
        delay = 1000
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        const parser = new SSEParser()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          for (const msg of parser.push(value)) {
            try {
              onEvent(JSON.parse(msg.data) as ServerEvent)
            } catch {
              /* ignore malformed event */
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return
      }
      onStatus(false)
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 15000)
    }
  }
  void run()
  return () => controller.abort()
}

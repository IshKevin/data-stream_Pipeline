import { describe, expect, it } from 'vitest'
import { formatDuration } from './format'

describe('formatDuration', () => {
  it('formats a range of magnitudes', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(3 * 60)).toBe('3m')
    expect(formatDuration(3600 + 20 * 60)).toBe('1h 20m')
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h')
  })
})

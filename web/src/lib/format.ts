import type { Status } from './types'

export const STATUS_LABEL: Record<Status, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  delivered: 'Delivered',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

/** Button text for moving a request *to* a status. */
export const TRANSITION_LABEL: Record<Status, string> = {
  submitted: 'Resubmit',
  in_progress: 'Start work',
  delivered: 'Mark delivered',
  accepted: 'Accept delivery',
  rejected: 'Reject delivery',
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDate(value: string): string {
  // `value` is a plain date (YYYY-MM-DD); parse as local to avoid a timezone off-by-one.
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—'
  const s = Math.round(totalSeconds)
  if (s < 60) return `${s}s`
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes && !days) parts.push(`${minutes}m`)
  return parts.join(' ') || '0m'
}

export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

import type { ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { STATUS_LABEL } from '../lib/format'
import type { Status } from '../lib/types'

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
}

const REASON_TEXT: Record<string, string> = {
  quality_not_assignable: 'only good or usable episodes can be assigned',
  already_assigned: 'already assigned to a request',
  not_found: 'does not exist',
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong'
  const details = error instanceof ApiError ? error.errors : undefined
  return (
    <div className="banner banner-error" role="alert">
      <div>{message}</div>
      {details && details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>
              <strong>{String(d.episode)}</strong>: {REASON_TEXT[d.reason ?? ''] ?? d.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted">{what}…</p>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))
  return (
    <div className="progress" title={`${done} of ${total} episodes assigned`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span>
        {done}/{total}
      </span>
    </div>
  )
}

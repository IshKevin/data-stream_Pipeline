import type { ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { STATUS_LABEL } from '../lib/format'
import type { Status } from '../lib/types'
import { Icon, type IconName } from './Icon'

/** One icon per workflow status – shared by badges, buttons and the stepper so they always match. */
export const STATUS_ICON: Record<Status, IconName> = {
  submitted: 'send',
  in_progress: 'clock',
  delivered: 'package',
  accepted: 'check-circle',
  rejected: 'x-circle',
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <Icon name={STATUS_ICON[status]} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function RoleBadge({ role }: { role: string }) {
  return <span className="badge badge-role">{role}</span>
}

const REASON_TEXT: Record<string, string> = {
  quality_not_assignable: 'only good or usable episodes can be assigned',
  already_assigned: 'already assigned to a request',
  not_found: 'does not exist',
}

/** Inline error for a failed request. Announced to screen readers (role="alert"). */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong'
  const details = error instanceof ApiError ? error.errors : undefined
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" />
      <div className="alert-body">
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
    </div>
  )
}

export function InfoBanner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' }) {
  return (
    <div className={`alert alert-${tone}`} role="status">
      <Icon name={tone === 'success' ? 'check-circle' : 'info'} />
      <div className="alert-body">{children}</div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** Placeholder rows shown while data loads (better than a bare "Loading…"). */
export function SkeletonRows({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${95 - ((i * 13) % 35)}%` }} />
      ))}
    </div>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <SkeletonRows rows={4} label={what} />
}

export function Empty({ title, children, icon = 'inbox' }: { title?: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))
  return (
    <div
      className={`progress ${done >= total && total > 0 ? 'progress-done' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(done, total)}
      aria-label={`${done} of ${total} episodes assigned`}
    >
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span>
        {done}/{total}
      </span>
    </div>
  )
}

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: IconName; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className={icon ? 'title-icon' : undefined}>
          {icon && <Icon name={icon} size={24} />}
          {title}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  )
}

export function Pagination({
  offset,
  pageSize,
  total,
  onChange,
}: {
  offset: number
  pageSize: number
  total: number
  onChange: (offset: number) => void
}) {
  if (total <= pageSize) return null
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + pageSize, total)
  return (
    <nav className="pager" aria-label="Pagination">
      <button className="btn btn-small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
        <Icon name="chevron-left" size={16} />
        Previous
      </button>
      <span aria-live="polite">
        {from}–{to} of {total}
      </span>
      <button className="btn btn-small" disabled={offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>
        Next
        <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  )
}

export function Stat({ value, label, tone, icon }: { value: ReactNode; label: string; tone?: 'ok' | 'warn'; icon?: IconName }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      {icon && <Icon name={icon} size={20} />}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

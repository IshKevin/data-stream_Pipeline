import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Empty, ErrorBanner, InfoBanner, PageHeader, SkeletonRows, Stat } from '../components/ui'
import { api } from '../lib/api'
import { formatDuration, STATUS_LABEL } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { Analytics as AnalyticsData, Status } from '../lib/types'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Horizontal bars with a text value – works without colour perception because every bar is labelled. */
function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, display: 'block' }} />
          </span>
          <span className="num">
            {r.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Total episodes recorded per day (all robots), drawn as an inline SVG so no chart library is shipped. */
function DailyChart({ data }: { data: { day: string; total: number }[] }) {
  const w = 640
  const h = 150
  const pad = { l: 34, r: 6, t: 8, b: 22 }
  const max = Math.max(1, ...data.map((d) => d.total))
  const slot = (w - pad.l - pad.r) / Math.max(1, data.length)
  const labelEvery = Math.max(1, Math.ceil(data.length / 8))
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Bar chart of episodes recorded per day, ${data.length} days, peak ${max}`}
    >
      <line className="axis" x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} />
      <text x={pad.l - 6} y={pad.t + 8} textAnchor="end">
        {max}
      </text>
      <text x={pad.l - 6} y={h - pad.b} textAnchor="end">
        0
      </text>
      {data.map((d, i) => {
        const bh = ((h - pad.t - pad.b) * d.total) / max
        return (
          <g key={d.day}>
            <rect className="bar" x={pad.l + i * slot + slot * 0.15} y={h - pad.b - bh} width={slot * 0.7} height={bh} rx="2">
              <title>{`${d.day}: ${d.total} episodes`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={pad.l + i * slot + slot / 2} y={h - 6} textAnchor="middle">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function Analytics() {
  useDocumentTitle('Analytics')
  const [from, setFrom] = useState(isoDaysAgo(60))
  const [to, setTo] = useState(isoDaysAgo(0))
  const valid = from !== '' && to !== '' && from <= to

  const query = useQuery({
    queryKey: ['analytics', from, to],
    queryFn: () => api<AnalyticsData>('/analytics', { query: { from, to } }),
    enabled: valid,
    placeholderData: (prev) => prev,
  })
  const data = query.data

  const { robots, days, perDay, cell, totalEpisodes } = useMemo(() => {
    const rows = data?.episodes_per_day_per_robot ?? []
    const robots = [...new Set(rows.map((r) => r.robot_id))].sort()
    const days = [...new Set(rows.map((r) => r.day))].sort()
    const index = new Map(rows.map((r) => [`${r.day}|${r.robot_id}`, r.episodes]))
    const perDay = days.map((day) => ({ day, total: rows.filter((r) => r.day === day).reduce((n, r) => n + r.episodes, 0) }))
    return {
      robots,
      days,
      perDay,
      cell: (day: string, robot: string) => index.get(`${day}|${robot}`) ?? 0,
      totalEpisodes: perDay.reduce((n, d) => n + d.total, 0),
    }
  }, [data])

  const statuses = (Object.keys(STATUS_LABEL) as Status[]).map((s) => ({
    label: STATUS_LABEL[s],
    value: data?.request_fulfilment.by_status[s] ?? 0,
  }))
  const totalRequests = statuses.reduce((n, s) => n + s.value, 0)

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Episodes are filtered by recording date, requests by submission date (UTC, inclusive)."
        icon="bar-chart"
      />
      <div className="filters">
        <label className="field">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Quick ranges">
          {[
            ['Last 7 days', 6],
            ['Last 30 days', 29],
            ['Last 90 days', 89],
          ].map(([label, n]) => (
            <button
              key={label}
              className="chip"
              aria-pressed={from === isoDaysAgo(Number(n)) && to === isoDaysAgo(0)}
              onClick={() => {
                setFrom(isoDaysAgo(Number(n)))
                setTo(isoDaysAgo(0))
              }}
            >
              <Icon name="calendar" size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>
      {!valid && <InfoBanner>Choose a valid date range (the start must not be after the end).</InfoBanner>}
      <ErrorBanner error={query.error} />
      {query.isLoading && (
        <div className="card" style={{ padding: 0 }}>
          <SkeletonRows rows={6} label="Loading analytics" />
        </div>
      )}

      {data && (
        <div className="grid" aria-busy={query.isFetching}>
          <section className="card" aria-labelledby="fulfil-title">
            <h2 id="fulfil-title" className="title-icon">
              <Icon name="package" size={20} />
              Request fulfilment
            </h2>
            <div className="stats">
              <Stat value={totalRequests} label="requests submitted" icon="list" />
              <Stat
                value={formatDuration(data.request_fulfilment.median_seconds_to_deliver)}
                label="median submitted → delivered"
                tone="ok"
                icon="clock"
              />
            </div>
            <Bars rows={statuses} />
            <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
              Median based on {data.request_fulfilment.delivered_requests} request(s) delivered at least once.
            </p>
          </section>

          <section className="card" aria-labelledby="top-title">
            <h2 id="top-title" className="title-icon">
              <Icon name="trophy" size={20} />
              Top tasks by good episodes
            </h2>
            {data.top_tasks_by_good_episodes.length === 0 ? (
              <Empty title="No good episodes in this range" />
            ) : (
              <Bars rows={data.top_tasks_by_good_episodes.map((t) => ({ label: t.task_name, value: t.good_episodes }))} />
            )}
          </section>

          <section className="card wide" aria-labelledby="daily-title">
            <h2 id="daily-title" className="title-icon">
              <Icon name="bar-chart" size={20} />
              Episodes recorded per day
            </h2>
            {days.length === 0 ? (
              <Empty title="No episodes recorded in this range" />
            ) : (
              <>
                <p className="muted">
                  {totalEpisodes} episodes over {days.length} day(s).
                </p>
                <DailyChart data={perDay} />
                <details style={{ marginTop: 'var(--space-3)' }}>
                  <summary>
                    <Icon name="list" size={16} /> Per-robot breakdown (table)
                  </summary>
                  <div className="table-wrap">
                    <table aria-label="Episodes per day per robot">
                      <thead>
                        <tr>
                          <th scope="col">Day</th>
                          {robots.map((r) => (
                            <th key={r} scope="col" className="num">
                              {r}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {days.map((d) => (
                          <tr key={d}>
                            <th scope="row">{d}</th>
                            {robots.map((r) => (
                              <td key={r} className="num">
                                {cell(d, r) || '·'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}

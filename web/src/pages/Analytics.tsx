import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorBanner, Loading, Empty } from '../components/ui'
import { api } from '../lib/api'
import { formatDuration, STATUS_LABEL } from '../lib/format'
import type { Analytics as AnalyticsData, Status } from '../lib/types'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function Analytics() {
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

  // Pivot "per day per robot" rows into one row per day with a column per robot.
  const robots = [...new Set(data?.episodes_per_day_per_robot.map((r) => r.robot_id))].sort()
  const days = [...new Set(data?.episodes_per_day_per_robot.map((r) => r.day))].sort()
  const cell = (day: string, robot: string) =>
    data?.episodes_per_day_per_robot.find((r) => r.day === day && r.robot_id === robot)?.episodes ?? 0

  return (
    <>
      <div className="page-head">
        <h2>Analytics</h2>
      </div>
      <div className="filters">
        <label>
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="muted">Choose a valid date range.</p>}
      <ErrorBanner error={query.error} />
      {query.isLoading && <Loading what="Loading analytics" />}

      {data && (
        <div className="grid">
          <section className="card">
            <h3>Request fulfilment</h3>
            <p className="muted">Requests submitted in this range</p>
            <table>
              <tbody>
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <tr key={s}>
                    <td>{STATUS_LABEL[s]}</td>
                    <td className="num">{data.request_fulfilment.by_status[s] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Median time from submitted to delivered:{' '}
              <strong>{formatDuration(data.request_fulfilment.median_seconds_to_deliver)}</strong>
              <br />
              <small className="muted">based on {data.request_fulfilment.delivered_requests} delivered request(s)</small>
            </p>
          </section>

          <section className="card">
            <h3>Top tasks by good episodes</h3>
            {data.top_tasks_by_good_episodes.length === 0 ? (
              <Empty>No good episodes in this range.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th className="num">Good episodes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_tasks_by_good_episodes.map((t) => (
                    <tr key={t.task_name}>
                      <td>{t.task_name}</td>
                      <td className="num">{t.good_episodes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card wide">
            <h3>Episodes recorded per day, per robot</h3>
            {days.length === 0 ? (
              <Empty>No episodes recorded in this range.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      {robots.map((r) => (
                        <th key={r} className="num">
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d}>
                        <td>{d}</td>
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
            )}
          </section>
        </div>
      )}
    </>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isStaff, useAuth } from '../auth'
import { Empty, ErrorBanner, Loading, Progress, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, STATUS_LABEL } from '../lib/format'
import type { Page, RequestSummary, Status } from '../lib/types'

const PAGE_SIZE = 25

export function Requests() {
  const { user } = useAuth()
  const staff = isStaff(user)
  const [status, setStatus] = useState<Status | ''>('')
  const [task, setTask] = useState('')
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: ['requests', { status, task, offset }],
    queryFn: () =>
      api<Page<RequestSummary>>('/requests', {
        query: { status: status || undefined, task_name: task.trim() || undefined, limit: PAGE_SIZE, offset },
      }),
    placeholderData: (prev) => prev,
  })

  const page = query.data
  return (
    <>
      <div className="page-head">
        <h2>{staff ? 'All requests' : 'My requests'}</h2>
        {user?.role === 'client' && (
          <Link className="btn btn-primary" to="/requests/new">
            New request
          </Link>
        )}
      </div>

      <div className="filters">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status | '')
              setOffset(0)
            }}
          >
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task
          <input
            placeholder="e.g. pick cup"
            value={task}
            onChange={(e) => {
              setTask(e.target.value)
              setOffset(0)
            }}
          />
        </label>
      </div>

      <ErrorBanner error={query.error} />
      {query.isLoading && <Loading what="Loading requests" />}
      {page && page.items.length === 0 && (
        <Empty>{status || task ? 'No requests match these filters.' : 'No requests yet.'}</Empty>
      )}
      {page && page.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {staff && <th>Client</th>}
                <th>Task</th>
                <th>Episodes</th>
                <th>Deadline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/requests/${r.id}`}>#{r.id}</Link>
                  </td>
                  {staff && <td>{r.client_organisation ?? r.client_name}</td>}
                  <td>{r.task_name}</td>
                  <td>
                    <Progress done={r.assigned_count} total={r.episodes_requested} />
                  </td>
                  <td>{formatDate(r.deadline)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && page.total > PAGE_SIZE && (
        <div className="pager">
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} of {page.total}
          </span>
          <button className="btn" disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </button>
        </div>
      )}
    </>
  )
}

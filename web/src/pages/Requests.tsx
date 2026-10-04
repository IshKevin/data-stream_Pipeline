import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isStaff, useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { Empty, ErrorBanner, PageHeader, Pagination, Progress, SkeletonRows, StatusBadge, STATUS_ICON } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, STATUS_LABEL } from '../lib/format'
import { useDebounced, useDocumentTitle } from '../lib/hooks'
import type { Page, RequestSummary, Status } from '../lib/types'

const PAGE_SIZE = 25
const STATUSES = Object.keys(STATUS_LABEL) as Status[]

export function Requests() {
  const { user } = useAuth()
  const staff = isStaff(user)
  useDocumentTitle(staff ? 'All requests' : 'My requests')
  const [status, setStatus] = useState<Status | ''>('')
  const [task, setTask] = useState('')
  const [offset, setOffset] = useState(0)
  const taskQuery = useDebounced(task.trim(), 300)

  const query = useQuery({
    queryKey: ['requests', { status, task: taskQuery, offset }],
    queryFn: () =>
      api<Page<RequestSummary>>('/requests', {
        query: { status: status || undefined, task_name: taskQuery || undefined, limit: PAGE_SIZE, offset },
      }),
    placeholderData: (prev) => prev,
  })

  const page = query.data
  const filtered = Boolean(status || taskQuery)

  return (
    <>
      <PageHeader
        title={staff ? 'All requests' : 'My requests'}
        subtitle={staff ? 'Every client request, newest first.' : 'Dataset requests you have submitted.'}
        icon="list"
      >
        {user?.role === 'client' && (
          <Link className="btn btn-primary" to="/requests/new">
            <Icon name="plus" size={16} />
            New request
          </Link>
        )}
      </PageHeader>

      <div className="filters">
        <div className="field">
          <span id="status-label">Status</span>
          <div className="chips" role="group" aria-labelledby="status-label">
            <button
              className="chip"
              aria-pressed={status === ''}
              onClick={() => {
                setStatus('')
                setOffset(0)
              }}
            >
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={status === s}
                onClick={() => {
                  setStatus(s)
                  setOffset(0)
                }}
              >
                <Icon name={STATUS_ICON[s]} size={14} />
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          Task
          <span className="input-icon">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="e.g. pick cup"
              value={task}
              onChange={(e) => {
                setTask(e.target.value)
                setOffset(0)
              }}
            />
          </span>
        </label>
      </div>

      <ErrorBanner error={query.error} />
      <div className="card card-flush" aria-busy={query.isFetching}>
        {query.isLoading && <SkeletonRows rows={6} label="Loading requests" />}
        {page && page.items.length === 0 && (
          <Empty title={filtered ? 'No requests match these filters' : 'No requests yet'}>
            {filtered ? (
              'Try clearing the status or task filter.'
            ) : user?.role === 'client' ? (
              <p>
                <Link to="/requests/new">Create your first request</Link> to get started.
              </p>
            ) : (
              'Requests will appear here as clients submit them.'
            )}
          </Empty>
        )}
        {page && page.items.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Requests" className="table-stack">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {staff && <th scope="col">Client</th>}
                  <th scope="col">Task</th>
                  <th scope="col">Episodes</th>
                  <th scope="col" className="hide-sm">
                    Deadline
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id}>
                    <td className="link-cell" data-label="Request">
                      <Link to={`/requests/${r.id}`}>#{r.id}</Link>
                    </td>
                    {staff && <td data-label="Client">{r.client_organisation ?? r.client_name}</td>}
                    <td data-label="Task">{r.task_name}</td>
                    <td data-label="Episodes">
                      <Progress done={r.assigned_count} total={r.episodes_requested} />
                    </td>
                    <td className="hide-sm" data-label="Deadline">
                      {formatDate(r.deadline)}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page && <Pagination offset={offset} pageSize={PAGE_SIZE} total={page.total} onChange={setOffset} />}
      </div>
    </>
  )
}

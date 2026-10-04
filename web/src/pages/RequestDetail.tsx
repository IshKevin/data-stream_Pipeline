import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EpisodePicker } from '../components/EpisodePicker'
import { Empty, ErrorBanner, Loading, Progress, StatusBadge } from '../components/ui'
import { isStaff, useAuth } from '../auth'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatDuration, STATUS_LABEL, TRANSITION_LABEL } from '../lib/format'
import type { RequestDetail as Detail, Status } from '../lib/types'

export function RequestDetail() {
  const { id } = useParams()
  const requestId = Number(id)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const query = useQuery({
    queryKey: ['request', requestId],
    queryFn: () => api<Detail>(`/requests/${requestId}`),
    enabled: Number.isInteger(requestId),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['request', requestId] })
    void queryClient.invalidateQueries({ queryKey: ['requests'] })
  }

  const transition = useMutation({
    mutationFn: (vars: { to: Status; note?: string }) =>
      api<Detail>(`/requests/${requestId}/transition`, { method: 'POST', body: { to: vars.to, note: vars.note || null } }),
    onSuccess: (data) => {
      queryClient.setQueryData(['request', requestId], data)
      setRejecting(false)
      setNote('')
      refresh()
    },
  })

  const unassign = useMutation({
    mutationFn: (episodePk: number) =>
      api<void>(`/requests/${requestId}/assignments/${episodePk}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh()
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
    },
  })

  if (query.isLoading) return <Loading what="Loading request" />
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="card">
        <h2>Request not found</h2>
        <Link to="/requests">Back to requests</Link>
      </div>
    )
  }
  if (query.error || !query.data) return <ErrorBanner error={query.error} />

  const r = query.data
  const staff = isStaff(user)
  const editable = staff && (r.status === 'submitted' || r.status === 'in_progress')
  const missing = r.episodes_requested - r.assigned_count

  return (
    <>
      <p>
        <Link to="/requests">← All requests</Link>
      </p>

      <section className="card">
        <div className="page-head">
          <h2>
            Request #{r.id} <StatusBadge status={r.status} />
          </h2>
        </div>
        <dl className="facts">
          <div>
            <dt>Task</dt>
            <dd>{r.task_name}</dd>
          </div>
          <div>
            <dt>Client</dt>
            <dd>{r.client_organisation ?? r.client_name}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{formatDate(r.deadline)}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDateTime(r.created_at)}</dd>
          </div>
          <div>
            <dt>Episodes</dt>
            <dd>
              <Progress done={r.assigned_count} total={r.episodes_requested} />
            </dd>
          </div>
        </dl>
        {r.notes && <p className="notes">{r.notes}</p>}

        <ErrorBanner error={transition.error} />
        {r.available_transitions.length > 0 && !rejecting && (
          <div className="actions">
            {r.available_transitions.map((to) => {
              const blocked = to === 'delivered' && missing > 0
              return (
                <button
                  key={to}
                  className={`btn ${to === 'rejected' ? 'btn-danger' : 'btn-primary'}`}
                  disabled={transition.isPending || blocked}
                  title={blocked ? `Assign ${missing} more episode(s) before delivering` : undefined}
                  onClick={() => (to === 'rejected' ? setRejecting(true) : transition.mutate({ to }))}
                >
                  {TRANSITION_LABEL[to]}
                </button>
              )
            })}
            {r.available_transitions.includes('delivered') && missing > 0 && (
              <span className="muted">Assign {missing} more episode(s) before delivering.</span>
            )}
          </div>
        )}
        {rejecting && (
          <div className="form">
            <label>
              Why are you rejecting this delivery? <small className="muted">(optional)</small>
              <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="actions">
              <button className="btn" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={transition.isPending}
                onClick={() => transition.mutate({ to: 'rejected', note })}
              >
                Confirm rejection
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Assigned episodes</h3>
        <ErrorBanner error={unassign.error} />
        {r.episodes.length === 0 ? (
          <Empty>No episodes assigned yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Episode</th>
                  <th>Robot</th>
                  <th>Recorded</th>
                  <th>Length</th>
                  <th>Quality</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {r.episodes.map((e) => (
                  <tr key={e.id}>
                    <td>{e.episode_id}</td>
                    <td>{e.robot_id}</td>
                    <td>{formatDateTime(e.recorded_at)}</td>
                    <td>{formatDuration(e.duration_seconds)}</td>
                    <td>
                      <span className={`quality quality-${e.quality}`}>{e.quality}</span>
                    </td>
                    {editable && (
                      <td>
                        <button
                          className="btn btn-small"
                          disabled={unassign.isPending}
                          onClick={() => unassign.mutate(e.id)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editable && <EpisodePicker request={r} />}

      <section className="card">
        <h3>History</h3>
        <ol className="timeline">
          {[...r.history].reverse().map((h, i) => (
            <li key={i}>
              <strong>{h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : 'Submitted'}</strong>
              <span className="muted">
                {' '}
                by {h.changed_by_name} · {formatDateTime(h.changed_at)}
              </span>
              {h.note && <div className="note">“{h.note}”</div>}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

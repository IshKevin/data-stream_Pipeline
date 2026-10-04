import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isStaff, useAuth } from '../auth'
import { ConfirmDialog } from '../components/Dialog'
import { EpisodePicker } from '../components/EpisodePicker'
import { Icon, type IconName } from '../components/Icon'
import { StatusStepper } from '../components/StatusStepper'
import { useToast } from '../components/Toast'
import { Empty, ErrorBanner, Progress, SkeletonRows, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatDuration, STATUS_LABEL, TRANSITION_LABEL } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { Episode, RequestDetail as Detail, Status } from '../lib/types'

const ACTION_ICON: Record<Status, IconName> = {
  submitted: 'send',
  in_progress: 'play',
  delivered: 'package',
  accepted: 'check-circle',
  rejected: 'x-circle',
}

const DONE_MESSAGE: Partial<Record<Status, string>> = {
  in_progress: 'Work started.',
  delivered: 'Marked as delivered – the client can now review it.',
  accepted: 'Delivery accepted. Thank you!',
  rejected: 'Delivery rejected and sent back for rework.',
}

export function RequestDetail() {
  const { id } = useParams()
  const requestId = Number(id)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [removing, setRemoving] = useState<Episode | null>(null)
  useDocumentTitle(`Request #${Number.isInteger(requestId) ? requestId : ''}`)

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
    onSuccess: (data, vars) => {
      queryClient.setQueryData(['request', requestId], data)
      setRejecting(false)
      setNote('')
      toast.success(DONE_MESSAGE[vars.to] ?? 'Status updated.')
      refresh()
    },
    onError: (err) => toast.error(err.message),
  })

  const unassign = useMutation({
    mutationFn: (episodePk: number) =>
      api<void>(`/requests/${requestId}/assignments/${episodePk}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null)
      toast.success('Episode removed from this request.')
      refresh()
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
    },
    onError: (err) => {
      setRemoving(null)
      toast.error(err.message)
    },
  })

  if (query.isLoading) {
    return (
      <div className="card" style={{ padding: 0 }}>
        <SkeletonRows rows={7} label="Loading request" />
      </div>
    )
  }
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="card not-found">
        <h1>Request not found</h1>
        <p className="muted">It may not exist, or it belongs to another client.</p>
        <Link className="btn btn-primary" to="/requests">
          <Icon name="arrow-left" size={16} />
          Back to requests
        </Link>
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
      <Link className="back-link" to="/requests">
        <Icon name="arrow-left" size={16} />
        All requests
      </Link>

      <section className="card" aria-labelledby="request-title">
        <div className="page-head">
          <h1 id="request-title">
            Request #{r.id} <StatusBadge status={r.status} />
          </h1>
        </div>
        <StatusStepper status={r.status} />
        <dl className="facts">
          <div>
            <dt>
              <Icon name="list" />
              Task
            </dt>
            <dd>{r.task_name}</dd>
          </div>
          <div>
            <dt>
              <Icon name="user" />
              Client
            </dt>
            <dd>{r.client_organisation ?? r.client_name}</dd>
          </div>
          <div>
            <dt>
              <Icon name="calendar" />
              Deadline
            </dt>
            <dd>{formatDate(r.deadline)}</dd>
          </div>
          <div>
            <dt>
              <Icon name="clock" />
              Submitted
            </dt>
            <dd>{formatDateTime(r.created_at)}</dd>
          </div>
          <div>
            <dt>
              <Icon name="layers" />
              Episodes assigned
            </dt>
            <dd>
              <Progress done={r.assigned_count} total={r.episodes_requested} />
            </dd>
          </div>
        </dl>
        {r.notes && <p className="notes">{r.notes}</p>}

        {r.available_transitions.length > 0 && (
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
                  <Icon name={ACTION_ICON[to]} size={16} />
                  {TRANSITION_LABEL[to]}
                </button>
              )
            })}
            {r.available_transitions.includes('delivered') && missing > 0 && (
              <span className="muted">Assign {missing} more episode(s) before delivering.</span>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={rejecting}
        title="Reject this delivery?"
        confirmLabel="Confirm rejection"
        danger
        busy={transition.isPending}
        onCancel={() => setRejecting(false)}
        onConfirm={() => transition.mutate({ to: 'rejected', note })}
      >
        <p className="muted">The request goes back to the operators for rework. Tell them what was wrong.</p>
        <label className="field">
          Reason <span className="hint">(optional)</span>
          <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this episode?"
        confirmLabel="Remove"
        danger
        busy={unassign.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && unassign.mutate(removing.id)}
      >
        <p>
          <strong>{removing?.episode_id}</strong> will be unassigned and become available for other requests.
        </p>
      </ConfirmDialog>

      <section className="card card-flush" aria-labelledby="assigned-title">
        <h2 id="assigned-title" className="title-icon padded-title">
          <Icon name="layers" size={20} />
          Assigned episodes
        </h2>
        {r.episodes.length === 0 ? (
          <Empty title="No episodes assigned yet">
            {editable ? 'Use the picker below to assign episodes.' : 'An operator has not assigned any episodes.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table aria-label="Assigned episodes" className="table-stack">
              <thead>
                <tr>
                  <th scope="col">Episode</th>
                  <th scope="col">Robot</th>
                  <th scope="col" className="hide-sm">
                    Recorded
                  </th>
                  <th scope="col">Length</th>
                  <th scope="col">Quality</th>
                  {editable && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {r.episodes.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Episode">{e.episode_id}</td>
                    <td data-label="Robot">{e.robot_id}</td>
                    <td className="hide-sm" data-label="Recorded">
                      {formatDateTime(e.recorded_at)}
                    </td>
                    <td data-label="Length">{formatDuration(e.duration_seconds)}</td>
                    <td data-label="Quality">
                      <span className={`quality quality-${e.quality}`}>{e.quality}</span>
                    </td>
                    {editable && (
                      <td className="num cell-end" data-label="">
                        <button className="btn btn-small" onClick={() => setRemoving(e)} aria-label={`Remove ${e.episode_id}`}>
                          <Icon name="trash" size={15} />
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

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title" className="title-icon">
          <Icon name="clock" size={20} />
          History
        </h2>
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

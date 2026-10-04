import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorBanner, Empty, Loading } from './ui'
import { api } from '../lib/api'
import { formatDateTime, formatDuration } from '../lib/format'
import type { Episode, Page, Quality, RequestDetail } from '../lib/types'

const PAGE_SIZE = 20

/** Operator tool: browse unassigned episodes (filter by task / quality) and assign them to a request. */
export function EpisodePicker({ request }: { request: RequestDetail }) {
  const queryClient = useQueryClient()
  const [task, setTask] = useState(request.task_name)
  const [quality, setQuality] = useState<Quality | ''>('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const facets = useQuery({
    queryKey: ['episode-facets'],
    queryFn: () => api<{ task_names: string[]; robot_ids: string[] }>('/episodes/facets'),
  })

  const episodes = useQuery({
    queryKey: ['episodes', { task, quality, offset }],
    queryFn: () =>
      api<Page<Episode>>('/episodes', {
        query: { task_name: task || undefined, quality: quality || undefined, assigned: 'false', limit: PAGE_SIZE, offset },
      }),
    placeholderData: (prev) => prev,
  })

  const assign = useMutation({
    mutationFn: (ids: number[]) =>
      api<RequestDetail>(`/requests/${request.id}/assignments`, { method: 'POST', body: { episode_ids: ids } }),
    onSuccess: () => {
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['request', request.id] })
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
    },
  })

  const page = episodes.data
  const selectable = (e: Episode) => e.quality !== 'bad'
  const needed = Math.max(0, request.episodes_requested - request.assigned_count)

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectPage() {
    if (!page) return
    setSelected(new Set([...selected, ...page.items.filter(selectable).map((e) => e.id)]))
  }

  return (
    <section className="card">
      <div className="page-head">
        <h3>Assign episodes</h3>
        <span className="muted">
          {needed > 0 ? `${needed} more needed to deliver` : 'Enough episodes assigned'}
        </span>
      </div>

      <div className="filters">
        <label>
          Task
          <select
            value={task}
            onChange={(e) => {
              setTask(e.target.value)
              setOffset(0)
            }}
          >
            <option value="">All tasks</option>
            {[...new Set([request.task_name, ...(facets.data?.task_names ?? [])])].sort().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select
            value={quality}
            onChange={(e) => {
              setQuality(e.target.value as Quality | '')
              setOffset(0)
            }}
          >
            <option value="">Any</option>
            <option value="good">Good</option>
            <option value="usable">Usable</option>
            <option value="bad">Bad (cannot be assigned)</option>
          </select>
        </label>
      </div>

      <ErrorBanner error={assign.error} />
      {episodes.isLoading && <Loading what="Loading episodes" />}
      <ErrorBanner error={episodes.error} />
      {page && page.items.length === 0 && <Empty>No unassigned episodes match these filters.</Empty>}
      {page && page.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Episode</th>
                <th>Task</th>
                <th>Robot</th>
                <th>Recorded</th>
                <th>Length</th>
                <th>Quality</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((e) => (
                <tr key={e.id} className={selectable(e) ? '' : 'row-disabled'}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${e.episode_id}`}
                      disabled={!selectable(e)}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                  </td>
                  <td>{e.episode_id}</td>
                  <td>{e.task_name}</td>
                  <td>{e.robot_id}</td>
                  <td>{formatDateTime(e.recorded_at)}</td>
                  <td>{formatDuration(e.duration_seconds)}</td>
                  <td>
                    <span className={`quality quality-${e.quality}`}>{e.quality}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </button>
        <span>{page ? `${page.total === 0 ? 0 : offset + 1}–${Math.min(offset + PAGE_SIZE, page.total)} of ${page.total}` : ''}</span>
        <button className="btn" disabled={!page || offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </button>
        <span className="spacer" />
        <button className="btn" onClick={selectPage} disabled={!page}>
          Select page
        </button>
        <button
          className="btn btn-primary"
          disabled={selected.size === 0 || assign.isPending}
          onClick={() => assign.mutate([...selected])}
        >
          {assign.isPending ? 'Assigning…' : `Assign selected (${selected.size})`}
        </button>
      </div>
    </section>
  )
}

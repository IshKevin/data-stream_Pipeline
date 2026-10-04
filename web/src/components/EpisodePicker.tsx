import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Icon } from './Icon'
import { useToast } from './Toast'
import { Empty, ErrorBanner, Pagination, SkeletonRows } from './ui'
import { api } from '../lib/api'
import { formatDateTime, formatDuration } from '../lib/format'
import type { Episode, Page, Quality, RequestDetail } from '../lib/types'

const PAGE_SIZE = 20

/** Operator tool: browse unassigned episodes (filter by task / quality) and assign them to a request. */
export function EpisodePicker({ request }: { request: RequestDetail }) {
  const queryClient = useQueryClient()
  const toast = useToast()
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
    onSuccess: (_data, ids) => {
      toast.success(`${ids.length} episode${ids.length === 1 ? '' : 's'} assigned.`)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['request', request.id] })
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
    },
  })

  const page = episodes.data
  const selectable = (e: Episode) => e.quality !== 'bad'
  const selectableOnPage = page?.items.filter(selectable) ?? []
  const allOnPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((e) => selected.has(e.id))
  const needed = Math.max(0, request.episodes_requested - request.assigned_count)

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const e of selectableOnPage) {
        if (allOnPageSelected) next.delete(e.id)
        else next.add(e.id)
      }
      return next
    })
  }

  return (
    <section className="card" aria-labelledby="picker-title">
      <div className="page-head">
        <h2 id="picker-title" className="title-icon">
          <Icon name="link" size={20} />
          Assign episodes
        </h2>
        <span className="muted" role="status">
          {needed > 0 ? `${needed} more needed to deliver` : 'Enough episodes assigned'}
        </span>
      </div>

      <div className="filters">
        <label className="field">
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
        <label className="field">
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
      <ErrorBanner error={episodes.error} />
      <div className="card-flush" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} aria-busy={episodes.isFetching}>
        {episodes.isLoading && <SkeletonRows rows={5} label="Loading episodes" />}
        {page && page.items.length === 0 && (
          <Empty title="No unassigned episodes match">Try another task or quality.</Empty>
        )}
        {page && page.items.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Unassigned episodes" className="table-stack">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Select all assignable episodes on this page"
                      checked={allOnPageSelected}
                      disabled={selectableOnPage.length === 0}
                      onChange={togglePage}
                    />
                  </th>
                  <th scope="col">Episode</th>
                  <th scope="col">Task</th>
                  <th scope="col" className="hide-sm">
                    Robot
                  </th>
                  <th scope="col" className="hide-sm">
                    Recorded
                  </th>
                  <th scope="col">Length</th>
                  <th scope="col">Quality</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className={selectable(e) ? '' : 'row-disabled'}>
                    <td data-label="Select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${e.episode_id}`}
                        disabled={!selectable(e)}
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                      />
                    </td>
                    <td data-label="Episode">{e.episode_id}</td>
                    <td data-label="Task">{e.task_name}</td>
                    <td className="hide-sm" data-label="Robot">
                      {e.robot_id}
                    </td>
                    <td className="hide-sm" data-label="Recorded">
                      {formatDateTime(e.recorded_at)}
                    </td>
                    <td data-label="Length">{formatDuration(e.duration_seconds)}</td>
                    <td data-label="Quality">
                      <span className={`quality quality-${e.quality}`}>{e.quality}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page && <Pagination offset={offset} pageSize={PAGE_SIZE} total={page.total} onChange={setOffset} />}
      </div>

      {selected.size > 0 && (
        <div className="sticky-bar" role="region" aria-label="Selection">
          <span>
            <strong>{selected.size}</strong> selected
          </span>
          <span className="spacer" />
          <button className="btn" onClick={() => setSelected(new Set())} disabled={assign.isPending}>
            <Icon name="close" size={16} />
            Clear
          </button>
          <button className="btn btn-primary" disabled={assign.isPending} onClick={() => assign.mutate([...selected])}>
            <Icon name="link" size={16} />
            {assign.isPending ? 'Assigning…' : `Assign selected (${selected.size})`}
          </button>
        </div>
      )}
    </section>
  )
}

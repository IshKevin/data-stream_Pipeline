import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorBanner } from '../components/ui'
import { api } from '../lib/api'
import { todayISO } from '../lib/format'
import type { RequestSummary } from '../lib/types'

export function NewRequest() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [task, setTask] = useState('')
  const [count, setCount] = useState('10')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api<RequestSummary>('/requests', {
        method: 'POST',
        body: { task_name: task, episodes_requested: Number(count), deadline, notes: notes.trim() || null },
      }),
    onSuccess: (req) => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      navigate(`/requests/${req.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New dataset request</h2>
      <ErrorBanner error={create.error} />
      <label>
        Task
        <input
          required
          maxLength={200}
          placeholder="e.g. pick cup"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </label>
      <label>
        Number of episodes
        <input
          required
          type="number"
          min={1}
          max={1000000}
          step={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </label>
      <label>
        Deadline
        <input required type="date" min={todayISO()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <label>
        Notes <small className="muted">(optional)</small>
        <textarea rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigate('/requests')}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </form>
  )
}

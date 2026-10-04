import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ErrorBanner, PageHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { todayISO } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { RequestSummary } from '../lib/types'

const NOTES_MAX = 4000

export function NewRequest() {
  useDocumentTitle('New request')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [task, setTask] = useState('')
  const [count, setCount] = useState('10')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)

  const errors = {
    task: task.trim() ? '' : 'Enter the task you need episodes for.',
    count: Number.isInteger(Number(count)) && Number(count) >= 1 ? '' : 'Enter a whole number of 1 or more.',
    deadline: !deadline ? 'Choose a deadline.' : deadline < todayISO() ? 'The deadline cannot be in the past.' : '',
  }
  const invalid = Object.values(errors).some(Boolean)

  const create = useMutation({
    mutationFn: () =>
      api<RequestSummary>('/requests', {
        method: 'POST',
        body: { task_name: task, episodes_requested: Number(count), deadline, notes: notes.trim() || null },
      }),
    onSuccess: (req) => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      toast.success(`Request #${req.id} submitted.`)
      navigate(`/requests/${req.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!invalid) create.mutate()
  }

  return (
    <>
      <Link className="back-link" to="/requests">
        <Icon name="arrow-left" size={16} />
        All requests
      </Link>
      <PageHeader title="New dataset request" subtitle="Tell us what you need; an operator will pick the episodes." icon="plus" />
      <form className="card form" onSubmit={submit} noValidate>
        <ErrorBanner error={create.error} />
        <label className="field">
          Task
          <input
            type="text"
            required
            maxLength={200}
            placeholder="e.g. pick cup"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            aria-invalid={touched && !!errors.task}
            aria-describedby="task-error"
          />
          <span id="task-error" className="error-text">
            {touched && errors.task}
          </span>
        </label>
        <label className="field">
          Number of episodes
          <input
            type="number"
            required
            min={1}
            max={1000000}
            step={1}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-invalid={touched && !!errors.count}
            aria-describedby="count-error"
          />
          <span id="count-error" className="error-text">
            {touched && errors.count}
          </span>
        </label>
        <label className="field">
          Deadline
          <input
            type="date"
            required
            min={todayISO()}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-invalid={touched && !!errors.deadline}
            aria-describedby="deadline-error"
          />
          <span id="deadline-error" className="error-text">
            {touched && errors.deadline}
          </span>
        </label>
        <label className="field">
          <span>
            Notes <span className="hint">(optional)</span>
          </span>
          <textarea rows={4} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className="hint">
            {notes.length}/{NOTES_MAX}
          </span>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={() => navigate('/requests')}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? (
              'Submitting…'
            ) : (
              <>
                <Icon name="send" size={16} />
                Submit request
              </>
            )}
          </button>
        </div>
      </form>
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Icon } from '../components/Icon'
import { ErrorBanner, PageHeader, SkeletonRows } from '../components/ui'
import { api } from '../lib/api'
import { useDocumentTitle } from '../lib/hooks'
import type { Role, User } from '../lib/types'

const ROLES: Role[] = ['client', 'operator', 'admin']
const EMPTY_FORM = { email: '', name: '', organisation: '', password: '', role: 'client' as Role }

export function Users() {
  useDocumentTitle('Users')
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['users'] })

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [toggling, setToggling] = useState<User | null>(null)

  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Pick<User, 'role' | 'is_active'>> }) =>
      api<User>(`/users/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: (u, v) => {
      toast.success(v.patch.role ? `${u.name} is now ${u.role}.` : u.is_active ? `${u.name} activated.` : `${u.name} deactivated.`)
      setToggling(null)
      refresh()
    },
    onError: (err) => {
      setToggling(null)
      toast.error(err.message)
    },
  })

  const create = useMutation({
    mutationFn: () =>
      api<User>('/users', { method: 'POST', body: { ...form, organisation: form.organisation.trim() || null } }),
    onSuccess: (u) => {
      toast.success(`User ${u.email} created.`)
      setAdding(false)
      setForm(EMPTY_FORM)
      refresh()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Create accounts, change roles and deactivate people who should no longer have access."
        icon="users"
      >
        <button
          className="btn btn-primary"
          onClick={() => {
            create.reset()
            setAdding(true)
          }}
        >
          <Icon name="user-plus" size={16} />
          Add user
        </button>
      </PageHeader>

      <ErrorBanner error={users.error} />
      <div className="card card-flush">
        {users.isLoading && <SkeletonRows rows={5} label="Loading users" />}
        {users.data && (
          <div className="table-wrap">
            <table aria-label="Users" className="table-stack">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="hide-sm">
                    Email
                  </th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id} className={u.is_active ? '' : 'row-disabled'}>
                    <td data-label="Name">
                      <span>
                      {u.name}
                      {u.id === me?.id && <span className="muted"> (you)</span>}
                      {u.organisation && u.organisation !== u.name && <small className="muted"> · {u.organisation}</small>}
                      </span>
                    </td>
                    <td className="hide-sm" data-label="Email">
                      {u.email}
                    </td>
                    <td data-label="Role">
                      <select
                        aria-label={`Role for ${u.email}`}
                        value={u.role}
                        disabled={u.id === me?.id || update.isPending}
                        onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}
                        style={{ width: 'auto' }}
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Status">{u.is_active ? 'Active' : 'Deactivated'}</td>
                    <td className="num cell-end" data-label="">
                      <button
                        className="btn btn-small"
                        disabled={u.id === me?.id || update.isPending}
                        onClick={() => (u.is_active ? setToggling(u) : update.mutate({ id: u.id, patch: { is_active: true } }))}
                      >
                        <Icon name={u.is_active ? 'user-x' : 'user-check'} size={15} />
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={toggling !== null}
        title={`Deactivate ${toggling?.name ?? 'user'}?`}
        confirmLabel="Deactivate"
        danger
        busy={update.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && update.mutate({ id: toggling.id, patch: { is_active: false } })}
      >
        <p>
          {toggling?.email} will be signed out and cannot log in until you activate them again. Their requests and history are kept.
        </p>
      </ConfirmDialog>

      <Dialog open={adding} title="Add a user" onClose={() => setAdding(false)}>
        <form className="form" onSubmit={submit} id="add-user-form" style={{ maxWidth: 'none' }}>
          <ErrorBanner error={create.error} />
          <label className="field">
            Name
            <input type="text" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            Email
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            Organisation <span className="hint">(clients)</span>
            <input type="text" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
          </label>
          <label className="field">
            Initial password <span className="hint">(at least 8 characters)</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="field">
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={create.isPending}>
              <Icon name="user-plus" size={16} />
              {create.isPending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { ErrorBanner, Loading } from '../components/ui'
import { api } from '../lib/api'
import type { Role, User } from '../lib/types'

const ROLES: Role[] = ['client', 'operator', 'admin']

export function Users() {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['users'] })

  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Pick<User, 'role' | 'is_active'>> }) =>
      api<User>(`/users/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: refresh,
  })

  const [form, setForm] = useState({ email: '', name: '', organisation: '', password: '', role: 'client' as Role })
  const create = useMutation({
    mutationFn: () =>
      api<User>('/users', {
        method: 'POST',
        body: { ...form, organisation: form.organisation.trim() || null },
      }),
    onSuccess: () => {
      setForm({ email: '', name: '', organisation: '', password: '', role: 'client' })
      refresh()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <>
      <div className="page-head">
        <h2>Users</h2>
      </div>
      <ErrorBanner error={update.error} />
      {users.isLoading && <Loading what="Loading users" />}
      <ErrorBanner error={users.error} />
      {users.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'row-disabled'}>
                  <td>
                    {u.name}
                    {u.organisation && u.organisation !== u.name && <small className="muted"> · {u.organisation}</small>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}
                    >
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-small"
                      disabled={u.id === me?.id || update.isPending}
                      onClick={() => update.mutate({ id: u.id, patch: { is_active: !u.is_active } })}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="card form" onSubmit={submit}>
        <h3>Add a user</h3>
        <ErrorBanner error={create.error} />
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Organisation <small className="muted">(clients)</small>
          <input value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
        </label>
        <label>
          Initial password <small className="muted">(min. 8 characters)</small>
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <label>
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="btn btn-primary" disabled={create.isPending}>
            Create user
          </button>
        </div>
      </form>
    </>
  )
}

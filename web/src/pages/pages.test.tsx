import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import type { RequestDetail as Detail, User } from '../lib/types'

const apiMock = vi.fn()
vi.mock('../lib/api', async (orig) => {
  const actual = await orig<typeof import('../lib/api')>()
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) }
})

let currentUser: User | null = null
const loginMock = vi.fn()
vi.mock('../auth', async (orig) => {
  const actual = await orig<typeof import('../auth')>()
  return {
    ...actual,
    useAuth: () => ({ user: currentUser, loading: false, login: loginMock, logout: vi.fn() }),
  }
})

import { ApiError } from '../lib/api'
import { Login } from './Login'
import { RequestDetail } from './RequestDetail'

const client: User = { id: 4, email: 'c@example.com', name: 'Acme', organisation: 'Acme', role: 'client', is_active: true }
const operator: User = { id: 2, email: 'o@example.com', name: 'Olu', organisation: null, role: 'operator', is_active: true }

function detail(over: Partial<Detail> = {}): Detail {
  return {
    id: 7,
    client_id: 4,
    client_name: 'Acme',
    client_organisation: 'Acme',
    task_name: 'pick cup',
    episodes_requested: 2,
    assigned_count: 0,
    deadline: '2027-01-01',
    notes: null,
    status: 'in_progress',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    available_transitions: ['delivered'],
    history: [
      { from_status: null, to_status: 'submitted', changed_by_id: 4, changed_by_name: 'Acme', changed_at: '2026-10-01T10:00:00Z', note: null },
    ],
    episodes: [],
    ...over,
  }
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/requests/7']}>
        <ToastProvider>
          <Routes>
            <Route path="/requests/:id" element={<RequestDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Fake API: episode endpoints return empty lists, everything else is decided by the test. */
function fakeApi(handler: (path: string, opts?: { method?: string }) => unknown) {
  apiMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === '/episodes') return Promise.resolve({ items: [], total: 0, limit: 20, offset: 0 })
    if (path === '/episodes/facets') return Promise.resolve({ task_names: ['pick cup'], robot_ids: [] })
    return Promise.resolve(handler(path, opts))
  })
}

beforeEach(() => {
  apiMock.mockReset()
  loginMock.mockReset()
  sessionStorage.clear()
})

describe('Login', () => {
  function renderLogin() {
    return render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
  }

  it('has labelled fields and submits the trimmed email', async () => {
    currentUser = null
    loginMock.mockResolvedValue(operator)
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), '  ops@example.com ')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(loginMock).toHaveBeenCalledWith('ops@example.com', 'secret')
  })

  it('announces a failed login and keeps the form usable', async () => {
    currentUser = null
    loginMock.mockRejectedValue(new ApiError(401, 'Incorrect email or password'))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('can reveal the password', async () => {
    currentUser = null
    renderLogin()
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
  })

  it('tells the user when their session expired', () => {
    currentUser = null
    sessionStorage.setItem('data-stream_pipeline.expired', '1')
    renderLogin()
    expect(screen.getByRole('status')).toHaveTextContent('Your session has ended')
  })
})

describe('RequestDetail (rules come from the server, the UI just reflects them)', () => {
  it('disables "Mark delivered" until enough episodes are assigned', async () => {
    currentUser = operator
    fakeApi(() => detail({ assigned_count: 1 }))
    renderDetail()
    const deliver = await screen.findByRole('button', { name: 'Mark delivered' })
    expect(deliver).toBeDisabled()
    expect(screen.getByText(/Assign 1 more episode\(s\) before delivering/)).toBeInTheDocument()
  })

  it('enables delivery once the quota is met and sends the transition', async () => {
    currentUser = operator
    fakeApi((_path, opts) =>
      opts?.method === 'POST' ? detail({ status: 'delivered', available_transitions: [] }) : detail({ assigned_count: 2 }),
    )
    renderDetail()
    const deliver = await screen.findByRole('button', { name: 'Mark delivered' })
    expect(deliver).toBeEnabled()
    await userEvent.click(deliver)
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/requests/7/transition', { method: 'POST', body: { to: 'delivered', note: null } }),
    )
    expect(await screen.findByText('Marked as delivered – the client can now review it.')).toBeInTheDocument()
  })

  it('shows only the client\'s review actions and asks for a reason before rejecting', async () => {
    currentUser = client
    fakeApi((_path, opts) =>
      opts?.method === 'POST'
        ? detail({ status: 'rejected', available_transitions: [] })
        : detail({ status: 'delivered', assigned_count: 2, available_transitions: ['accepted', 'rejected'] }),
    )
    renderDetail()
    expect(await screen.findByRole('button', { name: 'Accept delivery' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assign episodes')).not.toBeInTheDocument() // pickers are for staff only

    await userEvent.click(screen.getByRole('button', { name: 'Reject delivery' }))
    expect(await screen.findByRole('dialog', { name: 'Reject this delivery?' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Reason/), 'blurry')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/requests/7/transition', { method: 'POST', body: { to: 'rejected', note: 'blurry' } }),
    )
  })

  it("explains a 404 instead of leaking whether someone else's request exists", async () => {
    currentUser = client
    apiMock.mockRejectedValue(new ApiError(404, 'Request not found'))
    renderDetail()
    expect(await screen.findByRole('heading', { name: 'Request not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to requests' })).toBeInTheDocument()
  })
})

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './Dialog'
import { StatusStepper } from './StatusStepper'
import { ToastProvider, useToast } from './Toast'
import { Pagination, Progress } from './ui'

describe('StatusStepper', () => {
  it('marks earlier steps done and the current one active', () => {
    render(<StatusStepper status="delivered" />)
    const steps = screen.getAllByRole('listitem')
    expect(steps.map((s) => s.className)).toEqual(['step step-done', 'step step-done', 'step step-current', 'step step-todo'])
    expect(screen.getByText('Delivered').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('shows a rejected delivery in red at the delivered step', () => {
    render(<StatusStepper status="rejected" />)
    expect(screen.getByText('Rejected').closest('li')).toHaveClass('step-bad')
  })

  it('shows everything complete once accepted', () => {
    render(<StatusStepper status="accepted" />)
    expect(screen.getAllByRole('listitem').every((s) => s.className.includes('step-done'))).toBe(true)
  })
})

describe('ConfirmDialog', () => {
  it('renders nothing while closed and the title + actions when open', () => {
    const { rerender } = render(
      <ConfirmDialog open={false} title="Remove it?" confirmLabel="Remove" onConfirm={() => {}} onCancel={() => {}}>
        body
      </ConfirmDialog>,
    )
    expect(screen.queryByText('Remove it?')).not.toBeInTheDocument()
    rerender(
      <ConfirmDialog open title="Remove it?" confirmLabel="Remove" onConfirm={() => {}} onCancel={() => {}}>
        body
      </ConfirmDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Remove it?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
  })

  it('calls onConfirm / onCancel and disables the buttons while busy', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog open title="Sure?" confirmLabel="Do it" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(<ConfirmDialog open title="Sure?" confirmLabel="Do it" busy onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('Pagination', () => {
  it('is hidden when everything fits on one page', () => {
    const { container } = render(<Pagination offset={0} pageSize={25} total={10} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('pages forward and back and disables the ends', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Pagination offset={0} pageSize={25} total={60} onChange={onChange} />)
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onChange).toHaveBeenCalledWith(25)

    rerender(<Pagination offset={50} pageSize={25} total={60} onChange={onChange} />)
    expect(screen.getByText('51–60 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onChange).toHaveBeenLastCalledWith(25)
  })
})

describe('Progress', () => {
  it('exposes progress to assistive tech', () => {
    render(<Progress done={1} total={3} />)
    const bar = screen.getByRole('progressbar', { name: '1 of 3 episodes assigned' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
  })
})

describe('Toasts', () => {
  function Trigger() {
    const toast = useToast()
    return (
      <>
        <button onClick={() => toast.success('Saved!')}>ok</button>
        <button onClick={() => toast.error('Boom')}>fail</button>
      </>
    )
  }

  it('announces success politely, errors as alerts, and can be dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'ok' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved!')
    await userEvent.click(screen.getByRole('button', { name: 'fail' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    await act(async () => {
      await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]!)
    })
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument()
  })
})

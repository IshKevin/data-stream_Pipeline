import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/**
 * Modal built on the native <dialog>: focus is trapped, Escape closes it, the page behind is inert,
 * and focus returns to the trigger on close. Content is only mounted while open, so forms reset.
 */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // click on the backdrop
      }}
    >
      {open && (
        <>
          <div className="dialog-body">
            <div className="dialog-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="btn btn-ghost btn-small btn-icon" onClick={onClose} aria-label="Close dialog">
                <Icon name="close" size={18} />
              </button>
            </div>
            {children}
          </div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

interface ConfirmProps {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? (
              'Working…'
            ) : (
              <>
                <Icon name={danger ? 'trash' : 'check'} size={16} />
                {confirmLabel}
              </>
            )}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

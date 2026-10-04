import { STATUS_LABEL } from '../lib/format'
import { Icon } from './Icon'
import { STATUS_ICON } from './ui'
import type { Status } from '../lib/types'

const FLOW: Status[] = ['submitted', 'in_progress', 'delivered', 'accepted']

/** Visual progress of a request through the workflow. A rejected delivery shows in red at the "delivered" step. */
export function StatusStepper({ status }: { status: Status }) {
  const effective: Status = status === 'rejected' ? 'delivered' : status
  const currentIndex = FLOW.indexOf(effective)
  return (
    <ol className="stepper" aria-label="Request progress">
      {FLOW.map((step, i) => {
        const rejected = status === 'rejected' && step === 'delivered'
        const state = rejected ? 'bad' : i < currentIndex || (i === currentIndex && status === 'accepted') ? 'done' : i === currentIndex ? 'current' : 'todo'
        return (
          <li
            key={step}
            className={`step step-${state}`}
            aria-current={i === currentIndex ? 'step' : undefined}
          >
            <Icon name={rejected ? STATUS_ICON.rejected : STATUS_ICON[step]} size={16} />
            <span>{rejected ? STATUS_LABEL.rejected : STATUS_LABEL[step]}</span>
          </li>
        )
      })}
    </ol>
  )
}

export type Role = 'client' | 'operator' | 'admin'
export type Quality = 'good' | 'usable' | 'bad'
export type Status = 'submitted' | 'in_progress' | 'delivered' | 'accepted' | 'rejected'

export interface User {
  id: number
  email: string
  name: string
  organisation: string | null
  role: Role
  is_active: boolean
}

export interface Episode {
  id: number
  episode_id: string
  robot_id: string
  task_name: string
  recorded_at: string
  duration_seconds: number
  operator_name: string | null
  quality: Quality
  assigned_request_id: number | null
}

export interface RequestSummary {
  id: number
  client_id: number
  client_name: string
  client_organisation: string | null
  task_name: string
  episodes_requested: number
  assigned_count: number
  deadline: string
  notes: string | null
  status: Status
  created_at: string
  updated_at: string
  available_transitions: Status[]
}

export interface HistoryEntry {
  from_status: Status | null
  to_status: Status
  changed_by_id: number
  changed_by_name: string
  changed_at: string
  note: string | null
}

export interface RequestDetail extends RequestSummary {
  history: HistoryEntry[]
  episodes: Episode[]
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ImportReport {
  filename: string
  rows_total: number
  imported: number
  skipped: number
  skipped_by_reason: Record<string, number>
  reason_descriptions: Record<string, string>
  normalizations: Record<string, number>
  skipped_rows: { line: number; episode_id: string | null; reason: string; detail: string }[]
  skipped_rows_truncated: boolean
}

export interface Analytics {
  date_from: string
  date_to: string
  episodes_per_day_per_robot: { day: string; robot_id: string; episodes: number }[]
  request_fulfilment: {
    by_status: Record<string, number>
    delivered_requests: number
    median_seconds_to_deliver: number | null
  }
  top_tasks_by_good_episodes: { task_name: string; good_episodes: number }[]
}

export interface ServerEvent {
  type: 'request.created' | 'request.status_changed'
  request_id: number
  status: Status
}

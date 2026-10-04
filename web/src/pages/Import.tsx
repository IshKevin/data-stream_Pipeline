import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useToast } from '../components/Toast'
import { Icon } from '../components/Icon'
import { ErrorBanner, PageHeader, Stat } from '../components/ui'
import { api } from '../lib/api'
import { useDocumentTitle } from '../lib/hooks'
import type { ImportReport } from '../lib/types'

const FIX_TEXT: Record<string, string> = {
  episode_id_normalized: 'episode id upper-cased',
  robot_id_normalized: 'robot id trimmed / lower-cased',
  task_name_normalized: 'task name trimmed / lower-cased',
  quality_normalized: 'quality trimmed / lower-cased',
  date_format_converted: 'date converted to UTC from a non-standard format',
  duration_rounded: 'fractional duration rounded to whole seconds',
  operator_missing: 'imported without an operator name',
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function Import() {
  useDocumentTitle('Import episodes')
  const queryClient = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData()
      form.append('file', f)
      return api<ImportReport>('/episodes/import', { method: 'POST', form })
    },
    onSuccess: (report) => {
      toast.success(`Import finished: ${report.imported} imported, ${report.skipped} skipped.`)
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
      void queryClient.invalidateQueries({ queryKey: ['episode-facets'] })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (file) upload.mutate(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const report = upload.data
  return (
    <>
      <PageHeader
        title="Import episodes"
        subtitle="Upload a CSV export from the recording system. Importing the same file again is safe – existing episodes are never changed."
        icon="upload"
      />
      <form className="card form" style={{ maxWidth: 'none' }} onSubmit={submit}>
        <ErrorBanner error={upload.error} />
        <div
          className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              input.current?.click()
            }
          }}
          aria-label="Choose a CSV file or drop it here"
        >
          <input ref={input} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <>
              <Icon name="file" size={32} className="icon-upload" />
              <div>
                <strong className="file-chip">{file.name}</strong>
              </div>
              <p className="muted">{formatSize(file.size)} · click to choose a different file</p>
            </>
          ) : (
            <>
              <Icon name="upload" size={32} className="icon-upload" />
              <div>
                <strong>Drop a CSV file here</strong>
              </div>
              <p className="muted">or click to browse</p>
            </>
          )}
        </div>
        <div className="actions">
          <button className="btn btn-primary" disabled={!file || upload.isPending}>
            <Icon name="upload" size={16} />
            {upload.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>

      {report && (
        <section className="card" aria-labelledby="report-title">
          <h2 id="report-title">Result for {report.filename}</h2>
          <div className="stats">
            <Stat value={report.rows_total} label="rows read" icon="file" />
            <Stat value={report.imported} label="imported" tone="ok" icon="check-circle" />
            <Stat value={report.skipped} label="skipped" tone={report.skipped ? 'warn' : undefined} icon="alert" />
          </div>

          {Object.keys(report.skipped_by_reason).length > 0 && (
            <>
              <h3>Why rows were skipped</h3>
              <div className="table-wrap">
                <table aria-label="Skip reasons" className="table-stack">
                  <thead>
                    <tr>
                      <th scope="col" className="num">
                        Rows
                      </th>
                      <th scope="col">Reason</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.skipped_by_reason).map(([reason, n]) => (
                      <tr key={reason}>
                        <td className="num" data-label="Rows">
                          {n}
                        </td>
                        <td data-label="Reason">
                          <code>{reason}</code>
                        </td>
                        <td className="muted" data-label="Meaning">
                          {report.reason_descriptions[reason]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {Object.keys(report.normalizations).length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-4)' }}>Cleaned up on the way in</h3>
              <ul>
                {Object.entries(report.normalizations).map(([k, n]) => (
                  <li key={k}>
                    {n} × {FIX_TEXT[k] ?? k}
                  </li>
                ))}
              </ul>
            </>
          )}

          {report.skipped_rows.length > 0 && (
            <details style={{ marginTop: 'var(--space-4)' }}>
              <summary>Skipped rows ({report.skipped_rows.length}{report.skipped_rows_truncated ? '+' : ''})</summary>
              <div className="table-wrap">
                <table aria-label="Skipped rows" className="table-stack">
                  <thead>
                    <tr>
                      <th scope="col" className="num">
                        Line
                      </th>
                      <th scope="col">Episode</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.skipped_rows.map((r, i) => (
                      <tr key={i}>
                        <td className="num" data-label="Line">
                          {r.line}
                        </td>
                        <td data-label="Episode">{r.episode_id ?? '—'}</td>
                        <td data-label="Reason">
                          <code>{r.reason}</code>
                        </td>
                        <td className="muted" data-label="Detail">
                          {r.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.skipped_rows_truncated && <p className="muted">Only the first rows are listed.</p>}
            </details>
          )}
        </section>
      )}
    </>
  )
}

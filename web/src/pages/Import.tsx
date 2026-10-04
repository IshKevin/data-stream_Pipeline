import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { ErrorBanner } from '../components/ui'
import { api } from '../lib/api'
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

export function Import() {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData()
      form.append('file', f)
      return api<ImportReport>('/episodes/import', { method: 'POST', form })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
      void queryClient.invalidateQueries({ queryKey: ['episode-facets'] })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (file) upload.mutate(file)
  }

  const report = upload.data
  return (
    <>
      <div className="page-head">
        <h2>Import episodes</h2>
      </div>
      <form className="card form" onSubmit={submit}>
        <p className="muted">
          Upload a CSV export from the recording system. Importing the same file again is safe: episodes that already
          exist are left untouched.
        </p>
        <ErrorBanner error={upload.error} />
        <label>
          CSV file
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="actions">
          <button className="btn btn-primary" disabled={!file || upload.isPending}>
            {upload.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>

      {report && (
        <section className="card">
          <h3>Result for {report.filename}</h3>
          <div className="stats">
            <div>
              <strong>{report.rows_total}</strong>
              <span>rows read</span>
            </div>
            <div className="ok">
              <strong>{report.imported}</strong>
              <span>imported</span>
            </div>
            <div className={report.skipped ? 'warn' : ''}>
              <strong>{report.skipped}</strong>
              <span>skipped</span>
            </div>
          </div>

          {Object.keys(report.skipped_by_reason).length > 0 && (
            <>
              <h4>Why rows were skipped</h4>
              <table>
                <tbody>
                  {Object.entries(report.skipped_by_reason).map(([reason, n]) => (
                    <tr key={reason}>
                      <td className="num">{n}</td>
                      <td>
                        <code>{reason}</code>
                      </td>
                      <td className="muted">{report.reason_descriptions[reason]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {Object.keys(report.normalizations).length > 0 && (
            <>
              <h4>Cleaned up on the way in</h4>
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
            <>
              <h4>Skipped rows</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">Line</th>
                      <th>Episode</th>
                      <th>Reason</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.skipped_rows.map((r, i) => (
                      <tr key={i}>
                        <td className="num">{r.line}</td>
                        <td>{r.episode_id ?? '—'}</td>
                        <td>
                          <code>{r.reason}</code>
                        </td>
                        <td className="muted">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.skipped_rows_truncated && <p className="muted">Only the first rows are listed.</p>}
            </>
          )}
        </section>
      )}
    </>
  )
}

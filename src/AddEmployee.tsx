import { useRef, useState } from 'react'
import { z } from 'zod'
import type { Session } from './api'

const createdSchema = z.object({
  data: z.object({ person: z.object({ id: z.uuid() }), job: z.object({ id: z.uuid(), status: z.string() }) }),
})

export default function AddEmployee({ session }: { session: Session }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<z.infer<typeof createdSchema>>()
  return <>
    <button onClick={() => dialog.current?.showModal()}>Add employee</button>
    <dialog className="coverage-dialog onboarding-dialog" ref={dialog} aria-labelledby="onboarding-title" onCancel={event => { if (busy) event.preventDefault() }}>
      <div className="section-heading"><h2 id="onboarding-title">Add tracked employee</h2><button className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      {created ? <div role="status">
        <p>Employee added. Initial collection has been queued; contributions may take time to appear.</p>
        <a className="button" href={`/persons/${created.data.person.id}`}>View employee</a>
        <p><a href="/">Refresh employee directory</a></p>
      </div> : <form onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        const fields = new FormData(event.currentTarget)
        setBusy(true)
        setError('')
        try {
          const response = await fetch('/api/persons', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
            body: JSON.stringify({ forge: fields.get('forge'), login: fields.get('login'), display_name: fields.get('display_name') }),
          })
          if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
          if (!response.ok) {
            const body: unknown = await response.json()
            const problem = z.object({ error: z.object({ message: z.string() }) }).safeParse(body)
            throw new Error(problem.success ? problem.data.error.message : 'Onboarding could not be confirmed. Check the directory before trying again.')
          }
          setCreated(createdSchema.parse(await response.json()))
        } catch (error) {
          setError(error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Onboarding could not be confirmed. Check the directory before trying again.')
        } finally { setBusy(false) }
      }}>
        <p className="muted">Track a public forge account and queue initial collection. This does not grant dashboard sign-in access.</p>
        <fieldset disabled={busy}>
          <label>Display name<input name="display_name" required maxLength={200} autoComplete="off" /></label>
          <label>Forge hostname<input name="forge" required defaultValue="github.com" maxLength={253} pattern="[a-zA-Z0-9.\\-]+" autoComplete="off" /></label>
          <label>Account login<input name="login" required maxLength={100} pattern="[a-zA-Z0-9_.\\-]+" autoComplete="off" /></label>
          <p className="muted">The forge must already be configured in the backend. Use the account login, not a profile URL.</p>
          <button type="submit">{busy ? 'Adding employee...' : 'Add tracked employee'}</button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>}
    </dialog>
  </>
}

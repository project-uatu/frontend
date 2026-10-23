import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { get, peopleSchema, personSchema, projectsSchema } from './api'
import { allPages } from './projectDirectory'
import { readableLabel } from './labels'
import { initials } from './identity'
import type { Resource } from './useResource'

type Person = z.infer<typeof peopleSchema>['data'][number]
type Insight = { sources: z.infer<typeof personSchema>['data']['sources']; projects: number }

export default function EmployeeTable({ people }: { people: Person[] }) {
  const [insights, setInsights] = useState<Record<string, Resource<Insight>>>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      for (let start = 0; start < people.length && !controller.signal.aborted; start += 4) {
        await Promise.all(people.slice(start, start + 4).map(async person => {
          try {
            const [profile, projects] = await Promise.all([
              get(`/api/persons/${person.id}`, personSchema, controller.signal),
              allPages(`/api/persons/${person.id}/projects`, projectsSchema, controller.signal),
            ])
            if (!controller.signal.aborted) setInsights(current => ({ ...current, [person.id]: {
              status: 'ready', data: { sources: profile.data.sources, projects: new Set(projects.map(project => project.project)).size },
            } }))
          } catch (error) {
            if (!controller.signal.aborted) setInsights(current => ({ ...current, [person.id]: {
              status: 'error', message: error instanceof Error ? error.message : 'Employee details unavailable',
            } }))
          }
        }))
      }
    }
    void load()
    return () => controller.abort()
  }, [people, attempt])
  return <div className="table-scroll"><table className="employee-table">
    <caption className="sr-only">Tracked employees; project counts reflect all recorded history, not complete account history</caption>
    <thead><tr><th>Employee</th><th>Sources</th><th className="numeric">Recorded projects</th><th>Tracked since</th></tr></thead>
    <tbody>{people.map(person => {
      const insight = insights[person.id]
      return <tr key={person.id}>
        <td><a className="person-link" href={`/persons/${person.id}`}><span className="avatar" aria-hidden="true">{initials(person.display_name || '?')}</span><span>{person.display_name || person.id}<small>View contributions</small></span></a></td>
        {insight?.status === 'ready' ? <>
          <td><div className="directory-sources">{insight.data.sources.length ? insight.data.sources.map(source => <span className="directory-source" key={source.source} title={`${readableLabel(source.source)}: ${readableLabel(source.status)}; ${source.gap_count} gaps`}><i className={`source-dot ${source.status}`} aria-hidden="true" />{readableLabel(source.source)}<span className="sr-only">: {readableLabel(source.status)}</span></span>) : <span className="muted">No coverage reported</span>}</div></td>
          <td className="numeric">{insight.data.projects.toLocaleString()}</td>
        </> : <td colSpan={2}>{insight?.status === 'error' ? <div className="inline-error"><span>{insight.message}</span><button className="secondary" onClick={() => { setInsights({}); setAttempt(value => value + 1) }}>Retry details</button></div> : <span role="status" className="row-skeleton"><span className="sr-only">Loading employee details</span></span>}</td>}
        <td className="muted"><time dateTime={person.created_at}>{new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(person.created_at))}</time></td>
      </tr>
    })}</tbody>
  </table></div>
}

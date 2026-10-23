import { useEffect, useRef, useState } from 'react'
import { loadProjectDirectory } from './projectDirectory'
import type { OrganizationProject } from './projectDirectory'
import type { Resource } from './useResource'
import { initials } from './identity'
import { EmptyState, Skeleton } from './Feedback'

export default function ProjectsDirectory() {
  const [result, setResult] = useState<Resource<OrganizationProject[]>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<'project' | 'contributors' | 'events'>('contributors')
  const [ascending, setAscending] = useState(false)
  const [selected, setSelected] = useState<OrganizationProject>()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (selected) dialog.current?.showModal()
  }, [selected])
  function changeSort(column: typeof sort) {
    setAscending(column === sort ? !ascending : column === 'project')
    setSort(column)
    setPage(0)
  }
  function sortHeader(column: typeof sort, label: string) {
    return <th className={column === 'events' ? 'numeric' : undefined} aria-sort={sort === column ? ascending ? 'ascending' : 'descending' : 'none'}>
      <button className="sort-button" onClick={() => changeSort(column)}>{label}<span aria-hidden="true">{sort === column ? ascending ? ' ↑' : ' ↓' : ' ↕'}</span></button>
    </th>
  }
  useEffect(() => {
    const controller = new AbortController()
    loadProjectDirectory(controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ status: 'ready', data }) },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load projects' })
          controller.abort()
        }
      },
    )
    return () => controller.abort()
  }, [attempt])
  const projects = result.status === 'ready' ? result.data.filter(project => {
    const search = query.trim().toLocaleLowerCase()
    return project.project.toLocaleLowerCase().includes(search) ||
      project.contributors.some(person => (person.display_name || person.id).toLocaleLowerCase().includes(search))
  }).sort((a, b) => {
    const comparison = sort === 'project' ? a.project.localeCompare(b.project)
      : sort === 'contributors' ? a.contributors.length - b.contributors.length : a.count - b.count
    return (ascending ? comparison : -comparison) || (sort === 'contributors' ? b.count - a.count : 0) || a.project.localeCompare(b.project)
  }) : []
  const visible = projects.slice(page * 25, (page + 1) * 25)
  return <section className="panel">
    <p className="eyebrow">Your organization's footprint</p>
    <h1>Projects</h1>
    <p className="muted">The projects your people support, across all recorded history. Collection gaps may mean missing projects or contributors.</p>
    {result.status === 'loading' && <Skeleton label="Loading projects across the employee roster..." />}
    {result.status === 'error' && <div role="alert"><p>{result.message}</p><button onClick={() => { setResult({ status: 'loading' }); setAttempt(value => value + 1) }}>Retry</button></div>}
    {result.status === 'ready' && <>
      <div className="toolbar">
        <label>Find a project or contributor<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
        <span className="muted">{projects.length} {projects.length === 1 ? 'project' : 'projects'}{query.trim() ? ' matching your search' : ' recorded'}</span>
      </div>
      <p className="section-hint">Select a project to explore its contributors. Sort using the column headings. Event counts sum employee records and may overlap; they are not unique events or commit totals.</p>
      {visible.length === 0 ? <EmptyState title={query.trim() ? 'No projects match this search.' : 'No contributed projects recorded yet.'}>{query.trim() ? 'Try another project or contributor name.' : 'Projects will appear as employee contributions are collected.'}</EmptyState> : <div className="table-scroll">
        <table className="projects-directory"><caption className="sr-only">Organization projects and employee contributors</caption>
          <thead><tr>{sortHeader('project', 'Project')}{sortHeader('contributors', 'Employee contributors')}{sortHeader('events', 'Recorded events')}</tr></thead>
          <tbody>{visible.map(project => <tr key={project.project}>
            <td className="project-name"><button className="project-open" onClick={() => setSelected(project)}>{project.project}</button></td>
            <td><span className="contributor-count">{project.contributors.length} {project.contributors.length === 1 ? 'employee' : 'employees'}</span><ul className="project-contributors">{project.contributors.map(person => <li key={person.id}><a href={`/persons/${person.id}`}><span className="avatar" aria-hidden="true">{initials(person.display_name || '?')}</span>{person.display_name || person.id}</a></li>)}</ul></td>
            <td className="numeric">{project.count.toLocaleString()}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {projects.length > 25 && <nav className="pager" aria-label="Project pagination">
        <button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page + 1} of {Math.ceil(projects.length / 25)}</span>
        <button disabled={(page + 1) * 25 >= projects.length} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>}
    </>}
    <dialog className="coverage-dialog project-dialog" ref={dialog} aria-labelledby="project-dialog-title" onClose={() => setSelected(undefined)}>
      <div className="section-heading"><h2 id="project-dialog-title">{selected?.project}</h2><button className="secondary" onClick={() => dialog.current?.close()}>Close</button></div>
      {selected && <>
        <p className="section-hint">{selected.contributors.length} employee {selected.contributors.length === 1 ? 'contributor' : 'contributors'} across all recorded history. Collection gaps may mean additional contributors are not recorded.</p>
        <ul className="project-people">{selected.contributors.map(person => <li key={person.id}><a className="person-link" href={`/persons/${person.id}`}><span className="avatar" aria-hidden="true">{initials(person.display_name || '?')}</span><span>{person.display_name || person.id}<small>View contributions</small></span></a></li>)}</ul>
      </>}
    </dialog>
  </section>
}

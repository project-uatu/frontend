import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { z } from 'zod'
import {
  activitySchema, countsSchema, coverageSchema, peopleSchema, personSchema,
  projectsSchema, safeLink, sessionSchema,
} from './api'
import type { Session } from './api'
import { dateRange, defaultDates } from './history'
import { useResource } from './useResource'
import type { Resource } from './useResource'
import ChartBoundary from './ChartBoundary'
import { forgeLabels, readableLabel } from './labels'
import { AppearanceControl } from './Theme'
import ProjectsDirectory from './ProjectsDirectory'
import { DateFilter } from './DateFilter'
import AddEmployee from './AddEmployee'
import EmployeeTable from './EmployeeTable'
import { initials } from './identity'
import { EmptyState, Skeleton } from './Feedback'
import './App.css'

const HistoryChart = lazy(() => import('./HistoryChart'))
const ProjectChart = lazy(() => import('./ProjectChart'))

function readableDate(value: string, time = false) {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  }).format(new Date(value))
}

function Result<T>({ result, retry, children, loading }: {
  result: Resource<T>; retry: () => void; children: (data: T) => ReactNode; loading?: ReactNode
}) {
  if (result.status === 'loading') return loading ?? <Skeleton />
  if (result.status === 'error') return <div role="alert"><p>{result.message}</p><button onClick={retry}>Retry</button></div>
  return children(result.data)
}

function Pager({ page, cursors, setCursors }: {
  page: { has_more: boolean; next_cursor?: string }
  cursors: string[]
  setCursors: (cursors: string[]) => void
}) {
  return <nav className="pager" aria-label="Pagination">
    <button disabled={cursors.length === 0} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</button>
    <span>Page {cursors.length + 1}</span>
    <button disabled={!page.has_more} onClick={() => {
      if (page.next_cursor) setCursors([...cursors, page.next_cursor])
    }}>Next</button>
  </nav>
}

function DirectoryPage({ query }: { query: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const params = new URLSearchParams({ limit: '25' })
  if (query) params.set('q', query)
  if (cursors.length) params.set('cursor', cursors[cursors.length - 1])
  const resource = useResource(`/api/persons?${params}`, peopleSchema)
  return <Result {...resource}>{data => (
    <>
      {data.data.length === 0 ? <EmptyState title={`No tracked employees found${query ? ' for this search' : ''}.`}>{query ? 'Try a different name or clear your search.' : 'Add a tracked employee to start collecting contributions.'}</EmptyState> : <EmployeeTable people={data.data} />}
      <Pager page={data.page} cursors={cursors} setCursors={setCursors} />
    </>
  )}</Result>
}

function Directory({ session }: { session: Session }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">Your organization</p><h1>Employees</h1></div>{session.user.canManageEmployees && <AddEmployee session={session} />}</div>
    <p className="muted">Your people, their sources, and the projects they support. Project counts cover all recorded history; collection gaps may apply.</p>
    <form className="toolbar" onSubmit={event => { event.preventDefault(); setQuery(input.trim()) }}>
      <label>Find an employee<input type="search" maxLength={100} value={input} onChange={event => setInput(event.target.value)} /></label>
      <button type="submit">Search</button>
    </form>
    <DirectoryPage key={query} query={query} />
  </section>
}

function Activity({ base }: { base: string }) {
  const [kind, setKind] = useState('')
  const [range, setRange] = useState<{ from: string; to: string }>()
  const params = new URLSearchParams(range)
  if (kind) params.set('kind', kind)
  const url = `${base}/activity?${params}`
  return <section className="panel" id="recorded-activity">
    <h2>Recorded activity</h2>
    <div className="section-controls"><DateFilter label="Activity history" onChange={setRange} />
    <div className="filter-field"><label htmlFor="activity-type">Activity type</label><select id="activity-type" value={kind} onChange={event => setKind(event.target.value)}>
      <option value="commit_authored">Recorded authored commits</option>
      <option value="">All recorded activity</option>
    </select></div></div>
    <p className="section-hint">Recorded public events, not complete account history. Browse pages to see earlier activity.</p>
    <p className="muted">{range ? `Showing ${readableDate(range.from)} through ${readableDate(new Date(Date.parse(range.to) - 86400000).toISOString())} (UTC).` : 'Showing all recorded history.'}</p>
    <ActivityPage key={url} url={url} />
  </section>
}

function ActivityPage({ url }: { url: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const resource = useResource(`${url}&limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ''}`, activitySchema)
  return <Result {...resource}>{data => <>
    {data.data.length === 0 ? <EmptyState title="No matching activity recorded for this selection.">Try another date range or activity type. Missing collection is not zero activity.</EmptyState> : (
      <ul className="activity">{data.data.map(item => {
        const href = safeLink(item.url)
        return <li key={item.event_id}>
          <div className="activity-meta"><span className="badge">{readableLabel(item.kind)}</span><time dateTime={item.occurred_at}>{readableDate(item.occurred_at, true)} UTC</time></div>
          <div className="activity-title">{href ? <a href={href} target="_blank" rel="noreferrer">{item.title || item.kind}</a> : item.title || item.kind}</div>
          <small>{item.project} <span aria-hidden="true">·</span> {item.role}</small>
        </li>
      })}</ul>
    )}
    <Pager page={data.page} cursors={cursors} setCursors={setCursors} />
  </>}</Result>
}

function ProjectPage({ url, allHistory }: { url: string; allHistory: boolean }) {
  const [cursors, setCursors] = useState<string[]>([])
  const resource = useResource(`${url}${url.includes('?') ? '&' : '?'}limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ''}`, projectsSchema)
  return <Result {...resource}>{data => <>
    {data.data.length === 0 ? <EmptyState title={allHistory ? 'No contributed projects recorded yet.' : 'No contributed projects recorded in this range.'}>Projects appear as collection progresses. Check coverage before interpreting missing data.</EmptyState> : (
      <>
      <ChartBoundary>
        <Suspense fallback={<Skeleton variant="chart" label="Loading project chart..." />}>
          <ProjectChart projects={data.data} paginated={cursors.length > 0 || data.page.has_more} allHistory={allHistory} />
        </Suspense>
      </ChartBoundary>
      <table><thead><tr><th>Project</th><th className="numeric">Recorded events</th></tr></thead>
        <tbody>{data.data.map(project => <tr key={project.project}><td className="project-name">{project.project}</td><td className="numeric">{project.count.toLocaleString()}</td></tr>)}</tbody>
      </table>
      </>
    )}
    <Pager page={data.page} cursors={cursors} setCursors={setCursors} />
  </>}</Result>
}

function Projects({ base }: { base: string }) {
  const [range, setRange] = useState<{ from: string; to: string }>()
  const url = `${base}/projects${range ? `?${new URLSearchParams(range)}` : ''}`
  return <section className="panel" id="contributed-projects">
    <h2>Contributed projects</h2>
    <div className="section-controls"><DateFilter label="Project history" onChange={setRange} /></div>
    <p className="section-hint">{!range
      ? 'All recorded projects. Browse pages to see more.'
      : `Projects with recorded contributions from ${readableDate(range.from)} through ${readableDate(new Date(Date.parse(range.to) - 86400000).toISOString())} (UTC).`} Collection gaps may mean additional projects are not yet recorded.</p>
    <ProjectPage key={url} url={url} allHistory={!range} />
  </section>
}

function ProfileData({ id }: { id: string }) {
  const [dates, setDates] = useState(defaultDates)
  const [metric, setMetric] = useState('commits')
  const { from, to } = dateRange(dates.from, dates.through)!
  const base = `/api/persons/${id}`
  const range = new URLSearchParams({ from, to }).toString()
  const counts = useResource(`${base}/counts?${range}`, countsSchema)
  const coverage = useResource(`${base}/coverage?${range}`, coverageSchema)
  const coverageDialog = useRef<HTMLDialogElement>(null)
  const coverageStatus = coverage.result.status === 'ready'
    ? coverage.result.data.data.length === 0 ? 'No coverage recorded'
      : coverage.result.data.data.some(item => item.status !== 'complete') ? 'Incomplete collection' : 'Reported scope complete'
    : coverage.result.status === 'error' ? 'Coverage unavailable' : 'Loading coverage'
  return <>
    <dialog className="coverage-dialog" ref={coverageDialog} aria-labelledby="coverage-title">
      <div className="section-heading"><h2 id="coverage-title">Collection coverage</h2><button className="secondary" onClick={() => coverageDialog.current?.close()}>Close</button></div>
      <p className="muted">{coverageStatus} · {readableDate(from)} through {readableDate(`${dates.through}T00:00:00Z`)} (UTC)</p>
      <div className="coverage-content">
      <Result {...coverage}>{data => <>
        <p className="coverage-summary">{data.data.length === 0
          ? 'No coverage recorded for this range.'
          : `${data.data.length} recorded coverage ${data.data.length === 1 ? 'interval' : 'intervals'} in this range; ${data.data.filter(item => item.status !== 'complete').length} not marked complete.`
        } Missing or incomplete collection is not zero activity.</p>
        {data.data.filter(item => item.gap_reason).map((item, index) => (
          <p className="coverage-gap" key={index}>Gap: {item.gap_reason}</p>
        ))}
        {data.data.length > 0 && <>
          <ul className="coverage-list">{data.data.map((item, index) => <li key={`${item.forge_instance_id}-${item.source}-${index}`}>
            <div className="source-summary"><span className={`badge ${item.status}`}>{readableLabel(item.status)}</span><strong>{readableLabel(item.source)}</strong><span>{readableLabel(item.scope)}</span></div>
            <dl><dt>Collected interval (UTC)</dt><dd>{readableDate(item.from, true)} to {readableDate(item.to, true)} (exclusive)</dd>
              <dt>Last recorded (UTC)</dt><dd>{readableDate(item.recorded_at, true)}</dd>
              <dt>Forge instance</dt><dd>{item.forge_instance_id}</dd>
            </dl>
          </li>)}</ul>
          <p className="muted">Coverage describes collection scope, not guaranteed complete account history.</p>
        </>}
      </>}</Result>
      </div>
    </dialog>
    <section className="panel" id="contribution-history"><div className="section-heading"><div><p className="eyebrow">When they contribute</p><h2>Contribution history</h2></div><button className="secondary coverage-trigger" aria-haspopup="dialog" onClick={() => coverageDialog.current?.showModal()}>Collection coverage<small>{coverageStatus}</small></button></div>
      <div className="section-controls history-controls"><DateFilter label="History period" history onChange={range => {
        if (range) setDates({ from: range.from.slice(0, 10), through: new Date(Date.parse(range.to) - 86400000).toISOString().slice(0, 10) })
      }} />
      <div className="filter-field"><label htmlFor="history-metric">Contribution metric</label><select id="history-metric" value={metric} onChange={event => setMetric(event.target.value)}>
        {[...new Set(['commits', 'daily_total', 'issues', 'pull_requests', 'reviews', ...(counts.result.status === 'ready' ? counts.result.data.data.map(count => count.metric) : []), metric])].map(value => <option key={value} value={value}>{readableLabel(value)}</option>)}
      </select></div></div>
      <p className="section-hint">{readableDate(from)} through {readableDate(`${dates.through}T00:00:00Z`)} (UTC). Source-reported observations; unknown days are not zero.</p>
      <Result {...counts} loading={<Skeleton variant="chart" label="Loading contribution history..." />}>{data => (
        <ChartBoundary>
          <Suspense fallback={<Skeleton variant="chart" label="Loading chart..." />}>
            <HistoryChart counts={data.data} from={from} to={to} metric={metric} sourceLabels={forgeLabels(coverage.result.status === 'ready' ? coverage.result.data.data : [])} />
          </Suspense>
        </ChartBoundary>
      )}</Result>
    </section>
    <Projects base={base} />
    <Activity base={base} />
  </>
}

function Person({ id }: { id: string }) {
  const profile = useResource(`/api/persons/${id}`, personSchema)
  return <>
    <section className="panel profile-header">
      <div className="profile-back"><a className="back-link" href="/"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 5-7 7 7 7M5 12h14" /></svg>Back to employees</a></div>
      <Result {...profile} loading={<Skeleton variant="profile" label="Loading contributor profile..." />}>{data => <>
        <div className="profile-identity">
          <span className="avatar profile-avatar" aria-hidden="true">{initials(data.data.display_name || '?')}</span>
          <div><p className="eyebrow">Contributor profile</p>
            <h1>{data.data.display_name || data.data.id}</h1>
            <p className="muted">Public open-source contributions <span aria-hidden="true">·</span> Tracked since {readableDate(data.data.created_at)}</p>
            {data.data.sources.length > 0 && <div className="profile-sources">{data.data.sources.map(source => (
              <div className="source-chip" key={source.source} title={`${source.gap_count} gaps. Updated ${readableDate(source.recorded_at)}.`}>
                <span>{readableLabel(source.source)}</span><span className={`source-status ${source.status}`}>{readableLabel(source.status)}</span>
              </div>
            ))}</div>}
          </div>
        </div>
        <nav className="profile-nav" aria-label="Profile sections">
          <a href="#contribution-history">History</a><a href="#contributed-projects">Projects</a><a href="#recorded-activity">Activity</a>
        </nav>
      </>}</Result>
    </section>
    {profile.result.status === 'ready' && <ProfileData id={id} />}
  </>
}

function Authenticated({ session, signOut }: { session: Session; signOut: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const accountMenuId = useId()
  async function logout() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrf } })
      if (!response.ok && response.status !== 401) throw new Error('Sign out failed. Please retry.')
      signOut()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign out failed')
    } finally {
      setBusy(false)
    }
  }
  const match = /^\/persons\/([0-9a-f-]{36})$/i.exec(window.location.pathname)
  return <>
    <header className="app-header"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">u</span>uatu</a>
      <div className="account">
        <button className="account-trigger" popoverTarget={accountMenuId} aria-label="Account menu" title={session.user.name}><span className="avatar" role="img" aria-label={`Signed in as ${session.user.name}`}>{initials(session.user.name)}</span></button>
        <div id={accountMenuId} popover="auto" className="account-menu" aria-label="Account settings">
          <a className="account-profile-link" href="/profile">Profile</a>
          <AppearanceControl />
          <button className="secondary" disabled={busy} onClick={() => void logout()}>Sign out</button>
        </div>
      </div>
    </header>
    <aside className="sidebar" aria-label="Main navigation">
      <nav><a className="nav-link" href="/" aria-current={window.location.pathname === '/' ? 'page' : undefined}><svg aria-hidden="true" className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" /></svg>Employees</a>
        <a className="nav-link" href="/projects" aria-current={window.location.pathname === '/projects' ? 'page' : undefined}><svg aria-hidden="true" className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7h7l2-3h9v16H3z" /></svg>Projects</a></nav>
    </aside>
    <main className="dashboard">
      {error && <p role="alert">{error}</p>}
      {window.location.pathname === '/' ? <Directory session={session} /> : window.location.pathname === '/profile' ? <AccountProfile session={session} /> : window.location.pathname === '/projects' ? <ProjectsDirectory /> : match ? <Person id={match[1]} /> : <section className="panel"><h1>Page not found</h1><a href="/">Go to employees</a></section>}
    </main>
  </>
}

function AccountProfile({ session }: { session: Session }) {
  return <section className="panel">
    <div className="profile-identity">
      <span className="avatar profile-avatar" aria-hidden="true">{initials(session.user.name)}</span>
      <div><p className="eyebrow">Your account</p><h1>Profile</h1><p>{session.user.name}</p></div>
    </div>
    <dl className="account-details"><dt>Sign-in method</dt><dd>Organization SSO</dd></dl>
    <p className="muted">Your name is provided by your organization's identity provider. Account details are managed there.</p>
    <p className="muted">This sign-in account is not linked to a tracked contributor. Browse employees to view recorded contributions.</p>
    <a href="/">Browse employees</a>
  </section>
}

function Login() {
  const reason = new URLSearchParams(window.location.search).get('auth_error')
  return <main className="login">
    <section className="login-story" aria-labelledby="login-title">
      <div className="login-topline"><p className="brand"><span className="brand-mark" aria-hidden="true">u</span>uatu</p><AppearanceControl /></div>
      <div className="login-intro">
        <p className="eyebrow">People first. Open source in focus.</p>
        <h1 id="login-title">Small contributions.<br /><span>A bigger picture.</span></h1>
        <p className="login-description">Discover where your people contribute, the projects they support, and the open-source footprint you build together.</p>
        <div className="login-visual" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="orbit-center">u</div>
          <span className="orbit-node node-one" /><span className="orbit-node node-two" /><span className="orbit-node node-three" />
          <span className="visual-label label-people">People</span>
          <span className="visual-label label-projects">Projects</span>
          <span className="visual-label label-contributions">Contributions</span>
        </div>
      </div>
      <p className="login-footnote">An open-source contribution observer.</p>
    </section>
    <section className="login-entry" aria-labelledby="welcome-title">
      <div className="login-form">
        <p className="eyebrow">Your organization, in perspective</p>
        <h2 id="welcome-title">Welcome to Uatu</h2>
        <p>Sign in to explore your workforce's public open-source contributions.</p>
        {reason && <p role="alert">{reason === 'denied' ? 'Your account is not authorized for this organization. Contact your administrator.' : 'Sign-in failed or expired. Please try again.'}</p>}
        <a className="button" href="/auth/login">Sign in with your organization<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></a>
        <p className="login-handoff">You'll continue securely with your organization's identity provider. No separate Uatu password needed.</p>
        <div className="login-access"><span className="status-dot" aria-hidden="true" />Organization access<p>Access is managed by your organization's Uatu administrator.</p></div>
      </div>
    </section>
  </main>
}

export default function App() {
  const resource = useResource('/auth/session', sessionSchema)
  const [signedOut, setSignedOut] = useState(false)
  useEffect(() => {
    const expire = () => setSignedOut(true)
    window.addEventListener('session-expired', expire)
    return () => window.removeEventListener('session-expired', expire)
  }, [])
  if (signedOut || (resource.result.status === 'error' && resource.result.statusCode === 401)) return <Login />
  return <Result {...resource}>{(session: z.infer<typeof sessionSchema>) => <Authenticated session={session} signOut={() => setSignedOut(true)} />}</Result>
}

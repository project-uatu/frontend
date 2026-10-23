import type { z } from 'zod'
import { get, peopleSchema, projectsSchema } from './api'

type Person = z.infer<typeof peopleSchema>['data'][number]
export type OrganizationProject = {
  project: string
  count: number
  contributors: Person[]
}

export async function allPages<T>(path: string, schema: z.ZodType<{
  data: T[]
  page: { has_more: boolean; next_cursor?: string }
}>, signal: AbortSignal): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const response = await get(`${path}?${params}`, schema, signal)
    items.push(...response.data)
    if (!response.page.has_more) return items
    cursor = response.page.next_cursor
    if (!cursor || seen.has(cursor)) throw new Error('The service returned invalid project directory pagination')
    seen.add(cursor)
  } while (!signal.aborted)
  throw new DOMException('Request aborted', 'AbortError')
}

export async function loadProjectDirectory(signal: AbortSignal): Promise<OrganizationProject[]> {
  const people = await allPages('/api/persons', peopleSchema, signal)
  const uniquePeople = [...new Map(people.map(person => [person.id, person])).values()]
  const projects = new Map<string, OrganizationProject>()
  for (let start = 0; start < uniquePeople.length; start += 4) {
    const batch = uniquePeople.slice(start, start + 4)
    const contributions = await Promise.all(batch.map(async person => ({
      person,
      projects: await allPages(`/api/persons/${person.id}/projects`, projectsSchema, signal),
    })))
    for (const contribution of contributions) {
      const seen = new Set<string>()
      for (const item of contribution.projects) {
        if (seen.has(item.project)) throw new Error('The service returned duplicate projects for an employee. Please retry.')
        seen.add(item.project)
        const project = projects.get(item.project) ?? { project: item.project, count: 0, contributors: [] }
        project.count += item.count
        project.contributors.push(contribution.person)
        projects.set(item.project, project)
      }
    }
  }
  return [...projects.values()].map(project => ({
    ...project,
    contributors: project.contributors.sort((a, b) => (a.display_name || a.id).localeCompare(b.display_name || b.id)),
  })).sort((a, b) => b.contributors.length - a.contributors.length || b.count - a.count || a.project.localeCompare(b.project))
}

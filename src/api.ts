import { z } from 'zod'

const page = z.object({ has_more: z.boolean(), next_cursor: z.string().optional() })
  .refine(value => !value.has_more || Boolean(value.next_cursor), 'Missing continuation cursor')
const person = z.object({
  id: z.uuid(),
  display_name: z.string().optional(),
  created_at: z.iso.datetime({ offset: true }),
})
const source = z.object({
  source: z.string(),
  status: z.enum(['complete', 'partial']),
  gap_count: z.number().int().nonnegative(),
  recorded_at: z.iso.datetime({ offset: true }),
  from: z.string().optional(),
  to: z.string().optional(),
})
export const sessionSchema = z.object({
  user: z.object({ name: z.string(), canManageEmployees: z.boolean().default(false) }),
  csrf: z.string(),
})
export const peopleSchema = z.object({ data: z.array(person), page })
export const personSchema = z.object({ data: person.extend({ sources: z.array(source) }) })
export const countsSchema = z.object({
  data: z.array(z.object({
    forge_instance_id: z.uuid(),
    date: z.iso.datetime({ offset: true }),
    metric: z.string(),
    kind: z.string().optional(),
    value: z.number().int().nonnegative(),
    observed_at: z.iso.datetime({ offset: true }),
  })),
})
export const coverageSchema = z.object({
  data: z.array(z.object({
    forge_instance_id: z.uuid(),
    source: z.string(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    status: z.string(),
    gap_reason: z.string().optional(),
    scope: z.string(),
    recorded_at: z.iso.datetime({ offset: true }),
  })),
})
export const activitySchema = z.object({
  data: z.array(z.object({
    event_id: z.uuid(),
    kind: z.string(),
    role: z.string(),
    occurred_at: z.iso.datetime({ offset: true }),
    project: z.string(),
    title: z.string(),
    url: z.string(),
  })),
  page,
})
export const projectsSchema = z.object({
  data: z.array(z.object({ project: z.string(), count: z.number().int().nonnegative() })),
  page,
})
export type Session = z.infer<typeof sessionSchema>
export type Count = z.infer<typeof countsSchema>['data'][number]

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function get<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
    const body: unknown = await response.json()
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body)
    throw new ApiError(error.success ? error.data.error.message : 'Unable to load data', response.status)
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new Error('The service returned an unexpected data format')
  return parsed.data
}

export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

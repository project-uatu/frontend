import { describe, expect, it } from 'vitest'
import { validateQuery } from './api.ts'

const person = '/persons/00000000-0000-4000-8000-000000000001'
const range = 'from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z'
describe('read-only query boundary', () => {
  it('accepts search and pagination', () => {
    expect(validateQuery('/persons', new URLSearchParams('q=Alex&limit=25&cursor=abc'))).toBeUndefined()
  })
  it('accepts a bounded activity range', () => {
    expect(validateQuery(`${person}/activity`, new URLSearchParams(`${range}&kind=commit_authored`))).toBeUndefined()
  })
  it('accepts all-history activity with pagination and optional kind', () => {
    expect(validateQuery(`${person}/activity`, new URLSearchParams('limit=25&cursor=abc'))).toBeUndefined()
    expect(validateQuery(`${person}/activity`, new URLSearchParams('kind=commit_authored'))).toBeUndefined()
  })
  it.each(['from=2026-01-01T00:00:00Z', 'to=2026-02-01T00:00:00Z'])('rejects partial activity bounds %s', query => {
    expect(validateQuery(`${person}/activity`, new URLSearchParams(query))).toBeDefined()
  })
  it.each(['q=a&q=b', 'token=x', 'limit=501', 'cursor=' + 'a'.repeat(2049)])('rejects unsafe directory query %s', query => {
    expect(validateQuery('/persons', new URLSearchParams(query))).toBeDefined()
  })
  it.each(['', 'from=2026-01-01', 'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
    'from=2026-02-30T00:00:00Z&to=2026-03-05T00:00:00Z',
    'from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z'])('rejects invalid ranges %s', query => {
    expect(validateQuery(`${person}/counts`, new URLSearchParams(query))).toBeDefined()
  })
})

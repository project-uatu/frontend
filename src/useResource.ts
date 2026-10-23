import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { ApiError, get } from './api'

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode?: number }
  | { status: 'ready'; data: T }

export function useResource<T>(url: string, schema: z.ZodType<T>) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ url: string; attempt: number; value: Resource<T> }>({
    url, attempt: -1, value: { status: 'loading' },
  })
  useEffect(() => {
    const controller = new AbortController()
    get(url, schema, controller.signal).then(
      data => {
        if (!controller.signal.aborted) setResult({ url, attempt, value: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ url, attempt, value: {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to load data',
            statusCode: error instanceof ApiError ? error.status : undefined,
          } })
        }
      },
    )
    return () => controller.abort()
  }, [url, schema, attempt])
  return {
    result: result.url === url && result.attempt === attempt ? result.value : { status: 'loading' as const },
    retry: () => setAttempt(value => value + 1),
  }
}

import type { ReactNode } from 'react'

export function Skeleton({ label = 'Loading...', variant = 'rows' }: { label?: string; variant?: 'rows' | 'chart' | 'profile' }) {
  return <div role="status" className={`skeleton skeleton-${variant}`}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{Array.from({ length: variant === 'rows' ? 4 : 3 }, (_, index) => <span key={index} />)}</div>
  </div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">—</span><p>{title}</p>{children && <div className="muted">{children}</div>}</div>
}

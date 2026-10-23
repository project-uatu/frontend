import { useId, useState } from 'react'
import { dateRange, defaultDates, yearToDate } from './history'

export function DateFilter({ label, history = false, onChange }: {
  label: string
  history?: boolean
  onChange: (range: { from: string; to: string } | undefined) => void
}) {
  const id = useId()
  const [scope, setScope] = useState(history ? 'year' : 'all')
  const [dates, setDates] = useState(defaultDates)
  const [invalid, setInvalid] = useState(false)
  return <div className="date-filter">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={scope} onChange={event => {
      const value = event.target.value
      setScope(value)
      setInvalid(false)
      if (value !== 'range') {
        const preset = value === 'ytd' ? yearToDate() : defaultDates()
        setDates(preset)
        onChange(value === 'all' ? undefined : dateRange(preset.from, preset.through))
      }
    }}>
      {history ? <><option value="year">Past year</option><option value="ytd">Year to date</option></>
        : <option value="all">All recorded history</option>}
      <option value="range">Custom date range</option>
    </select>
    {scope === 'range' && <form className="toolbar range-form" onSubmit={event => {
      event.preventDefault()
      const range = dateRange(dates.from, dates.through)
      if (!range) { setInvalid(true); return }
      setInvalid(false)
      onChange(range)
    }}>
      <label>From (UTC)<input type="date" required value={dates.from} onChange={event => setDates({ ...dates, from: event.target.value })} /></label>
      <label>Through (UTC, inclusive)<input type="date" required value={dates.through} onChange={event => setDates({ ...dates, through: event.target.value })} /></label>
      <button type="submit">Apply dates</button>
      {invalid && <p role="alert">Choose a valid date range of 1 to 366 days.</p>}
    </form>}
  </div>
}

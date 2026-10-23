import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DateFilter } from './DateFilter'
import { dateRange, defaultDates, yearToDate } from './history'

it('defaults to all history and applies custom dates only on submission', () => {
  const change = vi.fn()
  render(<DateFilter label="Project history" onChange={change} />)
  expect(screen.getByRole('combobox')).toHaveValue('all')
  expect(screen.queryByLabelText('From (UTC)')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'range' } })
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-01-01' } })
  fireEvent.change(screen.getByLabelText('Through (UTC, inclusive)'), { target: { value: '2026-01-31' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(change).toHaveBeenLastCalledWith(dateRange('2026-01-01', '2026-01-31'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } })
  expect(change).toHaveBeenLastCalledWith(undefined)
})

it('has past-year and year-to-date history presets and validates custom dates', () => {
  const change = vi.fn()
  render(<DateFilter label="History period" history onChange={change} />)
  expect(screen.getByRole('combobox')).toHaveValue('year')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ytd' } })
  const ytd = yearToDate()
  expect(change).toHaveBeenLastCalledWith(dateRange(ytd.from, ytd.through))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'year' } })
  const year = defaultDates()
  expect(change).toHaveBeenLastCalledWith(dateRange(year.from, year.through))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'range' } })
  fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2020-01-01' } })
  change.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(screen.getByRole('alert')).toHaveTextContent('1 to 366 days')
  expect(change).not.toHaveBeenCalled()
})

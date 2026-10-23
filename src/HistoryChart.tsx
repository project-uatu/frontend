import { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Count } from './api'
import { dailySeries } from './history'
import ContributionHeatmap from './ContributionHeatmap'
import { displaySeries, readableLabel } from './labels'
import { useTheme } from './useTheme'
import { EmptyState } from './Feedback'

echarts.use([BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, CanvasRenderer])

export default function HistoryChart({ counts, from, to, sourceLabels, metric }: { counts: Count[]; from: string; to: string; sourceLabels: Record<string, string>; metric: string }) {
  const { dark } = useTheme()
  const ink = dark ? '#b1bed4' : '#65718a'
  const line = dark ? '#344158' : '#e8ecf3'
  const history = useMemo(() => {
    const history = dailySeries(counts, from, to, metric)
    return { ...history, series: displaySeries(history.series, sourceLabels) }
  }, [counts, from, to, metric, sourceLabels])
  return (
    <>
      {history.series.length === 0 ? <EmptyState title={`No ${readableLabel(metric).toLowerCase()} observations are available for this range.`}>Try another metric or date range. Missing observations are not zero activity.</EmptyState> : (
        <>
          <ContributionHeatmap days={history.days} series={history.series} metric={metric} />
          <div className="trend-heading"><h3>Daily trend</h3><span className="muted">Day-by-day detail</span></div>
          <ReactEChartsCore
            echarts={echarts}
            notMerge
            style={{ height: 210 }}
            option={{
              animation: false,
              color: dark ? ['#9aabff', '#62d3b6', '#efb764', '#c99aeb'] : ['#5267df', '#32a58a', '#cc8b38', '#a06ac4'],
              textStyle: { fontFamily: 'system-ui, sans-serif', color: ink },
              aria: { enabled: true, decal: { show: true } },
              tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: dark ? '#202c40' : '#fff', borderColor: line, textStyle: { color: ink } },
              legend: { type: 'scroll', bottom: 0, textStyle: { color: ink, fontSize: 11 }, pageTextStyle: { color: ink } },
              grid: { left: 45, right: 15, top: 12, bottom: 65 },
              xAxis: { type: 'category', data: history.days, axisTick: { show: false }, axisLine: { lineStyle: { color: line } }, axisLabel: { color: ink, fontSize: 11 } },
              yAxis: { type: 'value', minInterval: 1, axisLabel: { color: ink }, splitLine: { lineStyle: { color: line, type: 'dashed' } } },
              series: history.series.map(series => ({ name: series.name, type: 'bar', barMaxWidth: 28, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: series.values })),
            }}
          />
          <details>
            <summary>View chart data (UTC)</summary>
            <div className="table-scroll">
              <table>
                <caption>Source-reported {metric.replaceAll('_', ' ')} by date and forge instance</caption>
                <thead><tr><th>Date</th>{history.series.map(series => <th key={series.name}>{series.name}</th>)}</tr></thead>
                <tbody>{history.days.map((day, index) => (
                  <tr key={day}><th>{day}</th>{history.series.map(series => <td key={series.name}>{series.values[index] ?? 'Unknown'}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          </details>
          <details className="data-notes"><summary>How to read these numbers</summary><p className="section-hint">Source-reported daily observations, not verified commit totals. We use the latest observation per source, metric and kind. Missing days are unknown, not zero; kinds and sources are not added together.</p></details>
        </>
      )}
    </>
  )
}

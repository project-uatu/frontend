import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from './useTheme'

echarts.use([BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer])

export default function ProjectChart({ projects, paginated, allHistory }: {
  projects: { project: string; count: number }[]
  paginated: boolean
  allHistory: boolean
}) {
  const { dark } = useTheme()
  const ink = dark ? '#b1bed4' : '#65718a'
  const line = dark ? '#344158' : '#edf0f6'
  const ranked = [...projects].sort((a, b) => b.count - a.count || a.project.localeCompare(b.project)).slice(0, 10)
  return <div className="project-chart">
    <h3>{paginated ? 'Most active projects on this page' : allHistory ? 'Most active projects across recorded history' : 'Most active projects in this range'}</h3>
    <p className="muted">Up to ten projects ranked by recorded events, including issues, pull requests, reviews, and commits. Not a commit total.{paginated && ' This is not an organization-wide or full-history ranking.'}</p>
    <ReactEChartsCore
      echarts={echarts}
      notMerge
      style={{ height: Math.max(180, ranked.length * 42 + 70) }}
      option={{
        animation: false,
        aria: { enabled: true, decal: { show: true } },
        textStyle: { fontFamily: 'system-ui, sans-serif', color: ink },
        grid: { left: 12, right: 40, top: 12, bottom: 30, containLabel: true },
        tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: dark ? '#202c40' : '#fff', borderColor: line, textStyle: { color: ink } },
        xAxis: { type: 'value', minInterval: 1, axisLabel: { color: ink }, splitLine: { lineStyle: { color: line, type: 'dashed' } } },
        yAxis: {
          type: 'category',
          inverse: true,
          data: ranked.map(project => project.project),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { width: 120, overflow: 'truncate', color: ink, fontSize: 11 },
        },
        series: [{
          type: 'bar',
          data: ranked.map(project => project.count),
          barMaxWidth: 18,
          itemStyle: { color: dark ? '#9aabff' : '#5267df', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: ink },
        }],
      }}
    />
    <p className="muted">Full project names and exact values for this page are in the table below.</p>
  </div>
}

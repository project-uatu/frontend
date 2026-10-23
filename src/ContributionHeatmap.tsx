import { heatLevel } from './history'

export default function ContributionHeatmap({ days, series, metric }: {
  days: string[]
  series: { name: string; values: (number | null)[] }[]
  metric: string
}) {
  const offset = days.length ? (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  return <section className="heatmaps" aria-label="Contribution heatmap">
    <h3>Daily contribution heatmap</h3>
    <p className="muted">One square per UTC day. Intensity is relative to each source, not comparable across sources.</p>
    {series.map(source => {
      const maximum = Math.max(1, ...source.values.filter(value => value !== null))
      return <div className="heatmap-source" key={source.name}>
        <h4>{source.name}</h4>
        <div className="heatmap-scroll">
          <div className="heatmap-layout">
            <div className="heatmap-weekdays" aria-hidden="true">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={index}>{day}</span>)}
            </div>
            <div className="heatmap-grid">
              {Array.from({ length: offset }, (_, index) => <span className="heat-cell outside" aria-hidden="true" key={`padding-${index}`} />)}
              {days.map((day, index) => {
                const value = source.values[index]
                const label = `${day} (UTC): ${value === null ? 'Unknown' : `${value} ${metric.replaceAll('_', ' ')}`}`
                return <span key={day} className={`heat-cell ${heatLevel(value, maximum)}`} role="img" aria-label={label} title={label} />
              })}
            </div>
          </div>
        </div>
        <div className="heatmap-range"><span>{days[0]}</span><span>{days[days.length - 1]}</span></div>
      </div>
    })}
    <div className="heatmap-legend" aria-label="Heatmap legend">
      <span><i className="heat-cell unknown" />Unknown</span>
      <span><i className="heat-cell zero" />Observed zero</span>
      <span>Less <i className="heat-cell level-1" /><i className="heat-cell level-2" /><i className="heat-cell level-3" /><i className="heat-cell level-4" /> More</span>
    </div>
  </section>
}

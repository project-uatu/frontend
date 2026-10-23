export function readableLabel(value: string): string {
  const labels: Record<string, string> = {
    github: 'GitHub', 'github.com': 'GitHub',
    gitlab: 'GitLab', 'gitlab.com': 'GitLab',
    codeberg: 'Codeberg', 'codeberg.org': 'Codeberg',
    github_history: 'GitHub contributions', github_commits: 'GitHub commits',
    gitlab_history: 'GitLab contributions', gitlab_commits: 'GitLab commits',
    codeberg_history: 'Codeberg contributions', codeberg_commits: 'Codeberg commits',
    complete: 'Complete', partial: 'Partial coverage',
    daily_total: 'Total contributions', pull_requests: 'Pull requests',
    commit_authored: 'Authored commit', commits: 'Commits',
    issues: 'Issues', reviews: 'Reviews',
  }
  return labels[value] ?? value.replaceAll('_', ' ').replace(/^\w/, char => char.toUpperCase())
}

export function forgeLabel(source: string): string | undefined {
  if (/^github(?:[._]|$)/i.test(source)) return 'GitHub'
  if (/^gitlab(?:[._]|$)/i.test(source)) return 'GitLab'
  if (/^codeberg(?:[._]|$)/i.test(source)) return 'Codeberg'
}

export function forgeLabels(coverage: { forge_instance_id: string; source: string }[]) {
  const labels: Record<string, string> = {}
  for (const item of coverage) {
    const label = forgeLabel(item.source)
    if (label) labels[item.forge_instance_id] = label
  }
  return labels
}

export function displaySeries(
  series: { name: string; values: (number | null)[] }[],
  labels: Record<string, string>,
) {
  const ids = [...new Set(series.map(item => item.name.split(' / ')[0]))]
  return series.map(item => {
    const [id, kind] = item.name.split(' / ')
    const base = labels[id] ?? `Source ${ids.indexOf(id) + 1}`
    const matching = ids.filter(other => labels[other] === base)
    const name = matching.length > 1 ? `${base} ${matching.indexOf(id) + 1}` : base
    return { ...item, name: kind ? `${name} / ${readableLabel(kind)}` : name }
  })
}

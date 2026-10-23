import { Component } from 'react'
import type { ReactNode } from 'react'

export default class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    console.error('Contribution chart failed to render')
  }

  render() {
    if (this.state.failed) return <div role="alert">
      <p>The contribution chart could not be loaded. Other profile data is still available.</p>
      <button onClick={() => window.location.reload()}>Reload page</button>
    </div>
    return this.props.children
  }
}

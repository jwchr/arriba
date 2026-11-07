// Shared lazy map/failure boundary for waiting and riding; map errors never take the tracker down.
import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { RouteMapProps } from './RouteMap';
const RouteMap = lazy(() => import('./RouteMap'));
class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function StreetMap({ loadingText, ...props }: RouteMapProps & { loadingText: string }) {
  return <MapBoundary fallback={<p className="warn small" role="note">{props.failedText}</p>}>
    <Suspense fallback={<p className="small">{loadingText}</p>}><RouteMap {...props} /></Suspense>
  </MapBoundary>;
}

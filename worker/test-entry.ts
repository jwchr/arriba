// Local-runtime test entry only. The production entry rejects this synthetic feed version.
import bindings from 'gtfs-realtime-bindings';
import raw from './generated/corridor.json';
import { parseDataset } from '../src/domain/dataset';
import { createFeedClass, createRouter } from './service';
const ds = parseDataset(raw), now = Date.parse('2026-11-04T12:20:00Z');
if (!ds.meta.feedVersion.startsWith('SYNTHETIC')) throw new Error('Synthetic local-runtime fixture required');
// Exercise the actual G2 missing-date shape against a provably unique synthetic calendar.
const calendar = ds.calendars[ds.trips.find((t) => t.id === 'T1')!.serviceId]!;
calendar.start = calendar.end = '20261104'; calendar.added = []; calendar.removed = [];
const descriptor = { tripId: 'T1', routeId: '10' };
const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
  // Validate outbound init with workerd's actual Request API, before the synthetic response.
  const request = new Request(url, init);
  const name = new URL(request.url).pathname.split('/').pop();
  if (name === 'authenticateUser') return Response.json({ Authenticated: 'True', UserToken: 'local-test-token' });
  const entity = name === 'getVehiclePositions' ? [{ id: 'v', vehicle: { trip: descriptor, vehicle: { id: 'local-test-bus' }, timestamp: now / 1000 - 10, position: { latitude: 40.89, longitude: -74.04 } } }]
    : name === 'getTripUpdates' ? [{ id: 'u', tripUpdate: { trip: descriptor, timestamp: now / 1000 - 10, stopTimeUpdate: [{ stopId: '2', departure: { time: now / 1000 + 300 } }] } }] : undefined;
  if (!entity) throw new Error('Unexpected endpoint in local test');
  const bytes = bindings.transit_realtime.FeedMessage.encode({ header: { gtfsRealtimeVersion: '2.0', timestamp: now / 1000 - 5 }, entity }).finish();
  return new Response(new Uint8Array(bytes).buffer);
}) as typeof fetch;
export class BusFeed extends createFeedClass(ds, fake, () => now) {}
export default createRouter(ds);

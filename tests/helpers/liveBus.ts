import { readFileSync, readdirSync } from 'node:fs';
import bindings from 'gtfs-realtime-bindings';
// @ts-expect-error existing ESM schedule converter
import { buildDataset } from '../../scripts/gtfs-lib.mjs';
import type { Dataset } from '../../src/domain/types';
const dir = new URL('../fixtures/gtfs-mini/', import.meta.url);
export const miniFiles = Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]));
export const liveDataset: Dataset = buildDataset(miniFiles, { routeShortNames: ['165', '165T'], splitVariants: true, feedVersion: 'fixture-live', builtAt: '2026-11-04T10:00:00Z' });
liveDataset.meta.realtime = { provider: 'njt-bus-g2' };
export const NOW = Date.parse('2026-11-04T12:20:00Z');
export const descriptor = { tripId: 'T1', startDate: '20261104', routeId: '10', directionId: 0 };
export const vehicle = (patch: Record<string, unknown> = {}) => ({ trip: descriptor, vehicle: { id: 'bus-A' }, timestamp: NOW / 1000 - 15, position: { latitude: 40.89, longitude: -74.04 }, ...patch });
export const update = (patch: Record<string, unknown> = {}) => ({ trip: descriptor, timestamp: NOW / 1000 - 20,
  stopTimeUpdate: [{ stopSequence: 2, stopId: '2', departure: { time: NOW / 1000 + 300 } }], ...patch });
export const binaryFeed = (entity: bindings.transit_realtime.IFeedEntity[], patch: Record<string, unknown> = {}) =>
  bindings.transit_realtime.FeedMessage.encode({ header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: NOW / 1000 - 10, ...patch }, entity }).finish();

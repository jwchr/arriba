import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { liveDataset, NOW } from '../helpers/liveBus';
import { LIVE_SOURCE, type LiveBusSnapshot } from '../../src/domain/liveBus';

const API = 'https://dale-live.test.workers.dev';
const oldFavorite = { id: 'old', label: 'My printed commute', fromStopId: 'N10', toStopId: 'N20', routeIds: ['165T'] };
async function setup(page: Page, response: () => LiveBusSnapshot | null, lang = 'en') {
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ favorite, lang }) => {
    localStorage.setItem('arriba.favorites.v1', JSON.stringify([favorite]));
    localStorage.setItem('arriba.favorites.v1.g2', JSON.stringify([{ id: 'live-test', label: 'My live bus', fromStopId: '2', toStopId: '3', routeIds: ['10'] }]));
    localStorage.setItem('arriba.settings.v1', JSON.stringify({ lang, skin: 'clean', theme: 'light', count: 3 }));
  }, { favorite: oldFavorite, lang });
  await page.route(API + '/v1/schedule', (route) => route.fulfill({ json: liveDataset, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(API + '/v1/live?**', async (route) => {
    const body = response();
    if (body) await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    else await route.abort('failed');
  });
  await page.goto('/?live=1&now=2026-11-04T07:20');
  await page.getByRole('button', { name: /7:20/ }).first().click();
  await page.getByRole('button', { name: lang === 'en' ? 'Lock onto this bus' : 'Seguir este autobús', exact: true }).click();
}
function packet(now = NOW, patch: Partial<LiveBusSnapshot> = {}): LiveBusSnapshot {
  return { v: 1, source: LIVE_SOURCE, feedVersion: liveDataset.meta.feedVersion, tripInstanceId: 'T1@20261104', receivedAt: now,
    vehicles: { state: 'ok', timestamp: now - 10_000 }, updates: { state: 'ok', timestamp: now - 10_000 },
    observations: [{ tripInstanceId: 'T1@20261104', vehicleId: 'bus-A', observedAt: now - 15_000, lat: 40.89, lon: -74.04 }],
    updatedAt: now - 20_000, predictions: [{ stopIndex: 1, at: NOW + 300_000, observedAt: now - 20_000, kind: 'departure' }], skippedStops: [], ...patch };
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('arriba.lock.v1.g2') ?? 'null'));

test('live GPS/prediction → missing feed → explicitly estimated schedule → recovered same bus', async ({ page }) => {
  let body: LiveBusSnapshot | null = packet();
  await setup(page, () => body);
  await expect(page.getByTestId('live-bus-status')).toContainText('NJ TRANSIT GPS · LIVE REPORT');
  await expect(page.getByTestId('live-bus-status')).toContainText('NJ Transit predicts departure at 7:25 AM');
  expect((await saved(page)).session.lock.vehicleId).toBe('bus-A');
  body = null;
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('signal-warning')).toContainText('WARNING: NJ TRANSIT GPS FEED LOST FOR THIS BUS');
  await expect(page.getByTestId('signal-warning')).toContainText('ESTIMATED POSITION ONLY');
  await expect(page.getByTestId('schedule-projection').locator('progress')).toBeVisible();
  expect((await saved(page)).session.history).toHaveLength(1);
  expect((await saved(page)).session.lock.status).toBe('stale');
  body = packet(NOW + 61_000);
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('live-bus-status')).toContainText('NJ TRANSIT GPS · LIVE REPORT');
  await expect(page.getByTestId('signal-warning')).toHaveCount(0);
  const lock = await saved(page);
  expect(lock.session.lock.vehicleId).toBe('bus-A'); expect(lock.session.history).toHaveLength(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('arriba.favorites.v1')!))).toEqual([oldFavorite]);
});

test('ambiguous and stale snapshots never bind a bus or claim a current prediction', async ({ page }) => {
  const first = packet(), point = first.observations[0]!;
  let body = packet(NOW, { observations: [point, { ...point, vehicleId: 'bus-B' }] });
  await setup(page, () => body);
  await expect(page.getByTestId('live-bus-status')).toContainText('BUS MATCH UNCERTAIN');
  expect((await saved(page)).session.history).toHaveLength(0);
  body = packet(NOW, { vehicles: { state: 'stale', timestamp: NOW - 600_000 }, updates: { state: 'stale', timestamp: NOW - 600_000 } });
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('live-bus-status')).toContainText('LIVE GPS UNAVAILABLE');
  await expect(page.getByTestId('live-bus-status')).not.toContainText('NJ Transit predicts');
  expect((await saved(page)).session.lock.status).toBe('scheduled_only');
  expect((await saved(page)).session.lock.vehicleId).toBeUndefined();
});

test('a replacement requires confirmation; only a fresh official cancellation cancels the selected trip', async ({ page }) => {
  let body = packet();
  await setup(page, () => body);
  await expect(page.getByTestId('live-bus-status')).toContainText('LIVE REPORT');
  body = packet(NOW + 31_000, { observations: [{ ...packet(NOW + 31_000).observations[0]!, vehicleId: 'bus-B' }] });
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('live-bus-status')).toContainText('DIFFERENT BUS REPORTED');
  expect((await saved(page)).session.lock.vehicleId).toBe('bus-A'); expect((await saved(page)).session.lock.status).toBe('needs_confirmation');
  body = packet(NOW + 62_000, { cancelledAt: NOW + 60_000 });
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('live-bus-status')).toContainText('NJ TRANSIT REPORTS THIS TRIP CANCELLED');
  expect((await saved(page)).session.lock.status).toBe('cancelled');
});

test('Spanish live fallback is clear and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  let body: LiveBusSnapshot | null = packet();
  await setup(page, () => body, 'es');
  await expect(page.getByTestId('live-bus-status')).toContainText('REPORTE EN VIVO');
  body = null;
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('live-bus-status')).toContainText('GPS EN VIVO NO DISPONIBLE');
  await expect(page.getByTestId('signal-warning')).toContainText('SOLO POSICIÓN ESTIMADA');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('live schedule is available offline without turning a saved position into live GPS', async ({ page }) => {
  await setup(page, () => packet());
  await expect(page.getByTestId('live-bus-status')).toContainText('LIVE REPORT');
  await page.route(API + '/v1/schedule', (route) => route.abort('failed'));
  await page.route(API + '/v1/live?**', (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByText(/Showing the schedule saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('signal-warning')).toContainText('ESTIMATED POSITION ONLY');
  expect((await saved(page)).session.lock.vehicleId).toBe('bus-A');
});

test('polling stops while hidden and resumes when visible; feed warnings pass accessibility checks', async ({ page }) => {
  let calls = 0;
  await setup(page, () => { calls++; return packet(); });
  await expect(page.getByTestId('live-bus-status')).toContainText('LIVE REPORT');
  const before = calls;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(90_000); expect(calls).toBe(before);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => calls).toBeGreaterThan(before);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  expect(violations).toEqual([]);
});

test('known skipped stops pause automatic get-off guidance without cancelling the trip', async ({ page }) => {
  await setup(page, () => packet(NOW, { skippedStops: [2] }));
  await expect(page.getByTestId('live-bus-status')).toContainText('LIVE REPORT');
  await expect.poll(async () => (await saved(page)).session.stopChanges?.indices).toEqual([2]);
  await page.getByRole('button', { name: 'I’m waiting at this stop', exact: true }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/automatic get-off instructions are paused/)).toBeVisible();
  expect((await saved(page)).session.lock.status).not.toBe('cancelled');
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { demoDataset } from '../../src/data/demo';

test.use({ serviceWorkers: 'block' });

async function selectDemoTrip(page: Page, estimatedBoarding = false) {
  if (estimatedBoarding) {
    const ds = structuredClone(demoDataset);
    ds.trips = ds.trips.map((trip) => ({ ...trip, estimated: [1] }));
    await page.route('**/data/corridor.json', (route) => route.fulfill({ json: ds }));
  }
  await page.goto(`/?now=2026-11-04T07:50${estimatedBoarding ? '' : '&demo'}`);
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('90002');
  await page.getByRole('button', { name: /Maple Ave & Main St \(to NYC\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
}

test('waiting survives overdue time; GPS history, estimates and reports keep their distinct meaning', async ({ page }) => {
  await selectDemoTrip(page, true);
  const panel = page.locator('.bus-lock');
  await expect(panel).toContainText('Scheduled 11/4/2026, ~8:06 AM');
  await expect(panel).toContainText('NJ Transit publishes no time for this stop');
  await expect(panel).toContainText('No GPS observation received');
  await expect(panel).toContainText('ESTIMATED FROM TIMETABLE · NOT GPS');
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await expect(page.getByRole('button', { name: 'No bus yet', exact: true })).toBeDisabled();
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Simulate GPS observations' }).click();
  await expect(panel.locator('.lock-status')).toHaveText('Demo GPS: fresh simulated observation');
  await expect(panel).toContainText('GPS history for this lock (2)');
  await expect(panel.getByTestId('schedule-projection')).toHaveCount(0);

  await page.getByRole('button', { name: 'Advance 3 minutes' }).click();
  await expect(panel.locator('.lock-status')).toHaveText('Last report is old');
  await expect(panel.getByTestId('schedule-projection')).toContainText('ESTIMATED FROM TIMETABLE');
  await page.getByRole('button', { name: 'Advance 12 minutes' }).click();
  await page.getByRole('button', { name: 'Advance 3 minutes' }).click();
  await expect(panel.locator('.lock-status')).toHaveText('Bus not reporting. Not confirmed cancelled.');
  await expect(panel.getByTestId('schedule-projection')).toContainText('Overdue · location unknown');
  await page.getByRole('button', { name: 'No bus yet', exact: true }).click();
  await expect(panel).toContainText('Not seen since 7:50 AM; last checked 8:08 AM');
  await expect(panel).toContainText('They are not yet sent to other riders');
  await page.getByRole('button', { name: 'Advance 3 minutes' }).click();
  await expect(panel).toContainText('last checked 8:08 AM'); // no timer-made negative observation

  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await expect(panel.getByText('You reported: bus arrived', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I boarded', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  await expect(panel).toContainText('Boarding does not turn on phone tracking');
});

test('another departure cannot replace a lock; returning preserves the waiting session', async ({ page }) => {
  await selectDemoTrip(page);
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.dep').nth(2).click();
  await expect(page.getByText('Another trip is locked.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock onto this bus' })).toHaveCount(0);
  await page.getByRole('button', { name: /Return to Bus Lock/ }).click();
  await expect(page.locator('.bus-lock')).toContainText('Scheduled 11/4/2026, 8:06 AM');
  await expect(page.locator('.bus-lock')).toContainText('Waiting since 7:50 AM');
  await page.getByRole('button', { name: 'Passed without stopping', exact: true }).click();
  await expect(page.locator('.bus-lock')).toContainText('You reported seeing this bus pass');
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Advance 12 minutes' }).click();
  await page.getByRole('button', { name: 'Advance 12 minutes' }).click();
  await expect(page.getByRole('button', { name: 'No bus yet', exact: true })).toBeDisabled();
  await expect(page.locator('.bus-lock').getByTestId('schedule-projection')).toHaveCount(0);
  await page.getByRole('button', { name: 'I left the stop', exact: true }).click();
  await expect(page.locator('.bus-lock')).toContainText('You ended your wait');
  await expect(page.getByRole('button', { name: 'I boarded', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('vehicle replacement needs confirmation and keeps the scheduled departure', async ({ page }) => {
  await selectDemoTrip(page);
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Simulate GPS observations' }).click();
  await page.getByRole('button', { name: 'Simulate vehicle replacement' }).click();
  const panel = page.locator('.bus-lock');
  await expect(panel).toContainText('The vehicle match changed');
  await expect(panel.locator('.lock-facts')).toContainText('DEMO-BUS');
  await page.getByRole('button', { name: 'Accept this replacement vehicle' }).click();
  await expect(panel.locator('.lock-facts')).toContainText('DEMO-REPLACEMENT');
  await expect(panel).toContainText('Scheduled 11/4/2026, 8:06 AM');
});

test('printed timetable never exposes invented GPS controls or claims community sharing', async ({ page }) => {
  await page.goto('/?now=2026-11-04T17:10');
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await expect(page.locator('.bus-lock')).toContainText('live tracking is not connected yet');
  await expect(page.locator('.lock-demo')).toHaveCount(0);
  await expect(page.locator('.bus-lock')).toContainText('No phone location is collected');
});

test('printed last return includes its next-day date, earlier option, following service and actual destination', async ({ page }) => {
  await page.goto('/?now=2026-11-04T03:00');
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').filter({ has: page.locator('.route-badge', { hasText: /^165$/ }) }).first().click();
  const card = page.locator('.last-return');
  await expect(card).toContainText('Route 165 · operating day 11/4/2026');
  await expect(card.locator('.return-time')).toHaveText('1:10 AM · 11/5/2026');
  await expect(card).toContainText('12:32 AM · 11/5/2026');
  await expect(card).toContainText('5:22 AM · 11/5/2026');
  await expect(card).toContainText('Scheduled, not a live departure');
  await page.getByRole('button', { name: 'See this return trip', exact: true }).click();
  await expect(page.locator('.last-return')).toHaveCount(0);
  await expect(page.locator('.trip-ticket')).toContainText('1:10 AM');
  await expect(page.locator('.stop-list li[data-role="alight"]')).toContainText('Westwood - Broadway at Irvington St. (to Westwood)');
});

test('Spanish Bus Lock fits a narrow screen and passes accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await selectDemoTrip(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español', exact: true }).click();
  await page.getByRole('button', { name: /Volver a Bus Lock/ }).click();
  await page.getByRole('button', { name: 'Estoy esperando en esta parada' }).click();
  await expect(page.locator('.bus-lock')).toContainText('ESTIMADO SEGÚN EL HORARIO · NO ES GPS');
  await expect(page.getByRole('button', { name: 'Todavía no llega', exact: true })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  await page.screenshot({ path: 'test-results/bus-lock-es.png', fullPage: true });
});

test('ride mode counts down 3, 2, 1 stops from fresh demo GPS and says when it cannot', async ({ page }) => {
  await selectDemoTrip(page);
  const panel = page.locator('.bus-lock');
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  const ride = page.locator('.ride-mode');
  await expect(page.getByRole('dialog', { name: 'Riding to Port Authority Bus Terminal' })).toBeVisible(); // full screen on boarding
  await expect(ride.getByRole('heading', { level: 3 })).toHaveText('Riding to Port Authority Bus Terminal');
  await expect(ride.locator('.ride-message')).toHaveText(/No GPS from this bus yet, so Dale can’t count stops/);
  await expect(ride.locator('.ride-message')).not.toContainText('stops to');

  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  await expect(ride.locator('.ride-message')).toHaveText('2 stops to Port Authority Bus Terminal');
  await expect(ride).toContainText('Counted from invented demo GPS.');
  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  // Port Authority is the end of the line: no request needed there.
  await expect(ride.locator('.ride-message')).toHaveText('Next stop is yours: Port Authority Bus Terminal, the end of the line. The bus stops there.');
  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  await expect(ride.locator('.ride-message')).toHaveText('This is your stop: Port Authority Bus Terminal. Get off when the bus stops.');

  // Old GPS: no confident instruction. (Exit full screen to reach the demo controls underneath.)
  await ride.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Advance 3 minutes' }).click();
  await expect(ride.locator('.ride-message')).toHaveText(/GPS is old, so Dale can’t tell which stop it is at/);
  await ride.getByRole('button', { name: 'Smaller text' }).click();
  await expect(ride).not.toHaveAttribute('data-large', 'true');
  await expect(ride).toContainText('Your ticket stays in the NJ Transit app');
  const { violations } = await new AxeBuilder({ page }).include('.ride-mode').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click(); // back to the trip it came from, still riding
  await expect(page.locator('.ride-mode h3')).toHaveText('Vas a Port Authority Bus Terminal');
  const es = await new AxeBuilder({ page }).include('.ride-mode').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(es.violations.map((v) => v.id)).toEqual([]);
});

test('ride mode on the printed timetable gives scheduled times only, never a stop count', async ({ page }) => {
  await page.goto('/?now=2026-11-04T07:50');
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  const ride = page.locator('.ride-mode');
  await expect(ride.locator('.ride-message')).toContainText('The printed timetable lists main stops only');
  await expect(ride.locator('.ride-message')).not.toContainText('Press the signal strip');
  await expect(ride.locator('.ride-message')).not.toContainText('stops to');
  await expect(ride).toContainText('Coming up: listed stops only (scheduled times)');
  await expect(ride).toContainText('(timetable, not GPS)');
  await expect(ride.getByRole('button', { name: /Move the demo bus/ })).toHaveCount(0);
  await expect(ride.locator('li[data-role="alight"]')).toContainText('Port Authority Bus Terminal');
});

test('capacity: one local answer from a rider who saw the bus, with honest limits', async ({ page }) => {
  await selectDemoTrip(page);
  const panel = page.locator('.bus-lock');
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await expect(panel.getByRole('button', { name: 'Looked full' })).toHaveCount(0); // not seen yet
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await panel.getByRole('button', { name: 'Seats available' }).click();
  await panel.getByRole('button', { name: 'Standing room only' }).click();
  await expect(panel.getByRole('button', { name: 'Standing room only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('status').filter({ hasText: 'You reported: Standing room only' })).toBeVisible();
  await expect(panel).toContainText('Dale has no history of how full this bus usually is');
  await expect(panel.locator('.lock-history li').filter({ hasText: 'How full it was' })).toHaveCount(1);
  await expect(panel.locator('.lock-history li').filter({ hasText: 'How full it was' })).toContainText('Standing room only');
  const { violations } = await new AxeBuilder({ page }).include('.lock-capacity').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('full-screen ride: keep the screen on, Escape exits, "I got off" ends the ride', async ({ page }) => {
  await selectDemoTrip(page);
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Riding to/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3 })).toBeFocused();
  await dialog.getByRole('checkbox', { name: 'Keep the screen on during the ride' }).check();
  await expect(dialog.getByTestId('ride-wake')).not.toBeEmpty();
  const { violations } = await new AxeBuilder({ page }).include('.ride-full').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ride-mode h3')).toBeFocused(); // focus stays with the ride
  await page.locator('.ride-mode').getByRole('button', { name: 'Full screen' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'I got off' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.bus-lock .lock-phase')).toHaveText('Session ended');
  await expect(page.locator('#bus-lock-heading')).toBeFocused();
});

test('a lock survives a reload: offered back, never resumed silently, original times kept', async ({ page }) => {
  await page.goto('/?now=2026-11-04T07:50');
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await expect(page.locator('.bus-lock')).toContainText('kept on this phone until you unlock or end the ride');

  await page.reload();
  const offer = page.locator('.lock-return[role="note"]');
  await expect(offer).toContainText(/Resume watching your 7:52 AM 165 from Westwood - Broadway at Irvington St\. \(to New York\)\?/);
  await expect(page.locator('.bus-lock')).toHaveCount(0); // not resumed until asked
  await offer.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.bus-lock .lock-phase')).toHaveText('Waiting at this stop');
  await expect(page.locator('.bus-lock')).toContainText('7:50 AM'); // the wait began before the reload

  // Unlocking forgets it: no offer after the next reload.
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.reload();
  await expect(page.locator('.lock-return[role="note"]')).toHaveCount(0);

  // "Forget it" also clears a saved lock.
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await page.reload();
  await page.locator('.lock-return[role="note"]').getByRole('button', { name: 'Forget it' }).click();
  await page.reload();
  await expect(page.locator('.lock-return[role="note"]')).toHaveCount(0);
});

test('full screen keeps the DEMO banner, makes the app behind it inert, and steps aside for a vehicle decision', async ({ page }) => {
  await selectDemoTrip(page);
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Simulate GPS observations' }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Riding to/ });
  await expect(dialog.locator('.demo-banner')).toContainText('Demo data');
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  // A different vehicle reports on this trip: the decision buttons must be reachable.
  await dialog.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Simulate vehicle replacement' }).click();
  await page.locator('.ride-mode').getByRole('button', { name: 'Full screen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // stays aside while the decision is pending
  await page.getByRole('button', { name: 'Accept this replacement vehicle' }).click();
  await expect(dialog).toBeVisible(); // back once decided
});

test('full screen on the printed timetable keeps its "typed in" banner', async ({ page }) => {
  await page.goto('/?now=2026-11-04T07:50');
  await page.getByRole('button', { name: 'Find a stop' }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.data-banner')).toContainText("printed timetable issued 7/1/2026");
});

test('trip update: the rider shares or copies a plain message; Dale sends nothing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Stand-in for the phone's share sheet: records what Dale hands over, sends nothing.
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: unknown) => { (window as unknown as { shared: unknown[] }).shared.push(data); } });
  });
  await selectDemoTrip(page);
  const lock = page.locator('.bus-lock');
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  await lock.getByRole('button', { name: 'Share a trip update' }).click();
  await expect(lock.getByTestId('share-text')).toHaveText(/^\[DEMO, invented data\] Waiting at Maple Ave & Main St for the \d{1,2}:\d\d AM 165T?\.$/);
  await expect(lock.getByTestId('share-text')).toBeFocused();
  await expect(lock.locator('.share-update')).toContainText('Dale sends nothing');
  await expect(lock.locator('.share-update')).toContainText('No GPS location is included; the message names your stop.');
  expect((await new AxeBuilder({ page }).include('.share-update').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  await lock.getByRole('button', { name: 'Copy' }).click();
  await expect(lock.locator('.share-update [role="status"]')).toHaveText('Copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\[DEMO, invented data\] Waiting at Maple Ave & Main St/);
  await lock.getByRole('button', { name: 'Share…' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { text: string }[] }).shared.map((d) => d.text))).toEqual([expect.stringMatching(/Waiting at Maple Ave & Main St/)]);
  expect(page.url()).not.toContain('share'); // nothing put in the address

  await lock.getByRole('button', { name: 'Close' }).click();
  await expect(lock.getByRole('button', { name: 'Share a trip update' })).toBeFocused();

  // A share sheet that fails (not just closed) falls back to copying.
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('no', 'NotAllowedError'); } }));
  await lock.getByRole('button', { name: 'Share a trip update' }).click();
  await lock.getByRole('button', { name: 'Share…' }).click();
  await expect(lock.locator('.share-update [role="status"]')).toHaveText('Copied.');

  // On board the full-screen ride view carries its own share button.
  await page.getByRole('button', { name: 'Bus arrived', exact: true }).click();
  await page.getByRole('button', { name: 'I boarded', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Riding to/ });
  await dialog.getByRole('button', { name: 'Share a trip update' }).click();
  await expect(dialog.getByTestId('share-text')).toHaveText(/^\[DEMO, invented data\] I'm on the \d{1,2}:\d\d AM 165T? from Maple Ave & Main St\. Scheduled to reach Port Authority Bus Terminal at \d{1,2}:\d\d AM\.$/);
  await expect(dialog.getByTestId('share-text')).not.toContainText(/\d+\.\d{3}/); // no coordinates
});

test('trip update on the printed timetable has no DEMO mark, and reads in Spanish', async ({ page }) => {
  await page.goto('/?now=2026-11-04T07:50');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await page.getByRole('button', { name: /Buscar parada/i }).first().click();
  await page.getByRole('searchbox').fill('irvington');
  await page.getByRole('button', { name: /Irvington St\. \(to New York\)/ }).click();
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Guardar en mis viajes' }).click();
  await page.locator('.dep').first().click();
  await page.getByRole('button', { name: /Seguir este autobús/ }).click();
  await page.getByRole('button', { name: 'Compartir cómo va el viaje' }).click();
  await expect(page.getByTestId('share-text')).toHaveText(/^Pienso tomar el 165T? de las? \d{1,2}:\d\d a\. ?m\. desde Westwood - Broadway at Irvington St\.$/);
});

test('backup buses appear once the bus is late past the rider’s threshold, and never change the lock', async ({ page }) => {
  await selectDemoTrip(page);
  const lock = page.locator('.bus-lock');
  await page.getByRole('button', { name: 'I’m waiting at this stop' }).click();
  const backups = lock.locator('.backup-buses');
  await expect(backups.getByRole('button', { name: '10 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(backups.getByRole('heading', { name: 'Backup buses' })).toHaveCount(0);
  // Move the demo clock past the scheduled time by more than 10 minutes.
  await lock.locator('.lock-demo summary').click();
  for (let i = 0; i < 3; i++) await lock.getByRole('button', { name: 'Advance 12 minutes' }).click();
  await expect(backups.getByRole('heading', { name: 'Backup buses' })).toBeVisible();
  await expect(backups).toContainText(/Your bus is \d+ min past its scheduled time and has not been confirmed here/);
  const rows = backups.locator('.rescue-list li');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first()).toContainText(/(\d+ min left to catch it|1 min left to catch it|Due to leave now)/);
  await expect(rows.first()).toContainText('Scheduled only');
  await expect(backups).toContainText('Your Bus Lock stays on the bus you chose');
  expect((await new AxeBuilder({ page }).include('.backup-buses').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);

  // The threshold is the rider's choice, kept on this phone.
  await backups.getByRole('button', { name: '15 min', exact: true }).click();
  await expect(backups.getByRole('button', { name: '15 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('arriba.backupAfter.v1'))).toBe('15');

  // Opening a backup shows that trip; the lock stays on the original bus.
  const lockedTime = await lock.locator('.small').first().textContent();
  await rows.first().locator('button').click();
  await expect(page.getByText('Another trip is locked. Return to it and unlock before choosing a different bus.')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.bus-lock .small').first()).toHaveText(lockedTime ?? '');
});

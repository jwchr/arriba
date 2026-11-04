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
  const ride = panel.locator('.ride-mode');
  await expect(ride.getByRole('heading', { level: 3 })).toHaveText('Riding to Port Authority Bus Terminal');
  await expect(ride.locator('.ride-message')).toHaveText(/No GPS from this bus yet, so Dale can’t count stops/);
  await expect(ride.locator('.ride-message')).not.toContainText('stops to');

  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  await expect(ride.locator('.ride-message')).toHaveText('2 stops to Port Authority Bus Terminal');
  await expect(ride).toContainText('Counted from invented demo GPS.');
  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  await expect(ride.locator('.ride-message')).toHaveText('Next stop is yours: Port Authority Bus Terminal. Press the signal strip now.');
  await ride.getByRole('button', { name: 'Move the demo bus to the next stop' }).click();
  await expect(ride.locator('.ride-message')).toHaveText('This is your stop: Port Authority Bus Terminal. Get off when the bus stops.');

  // Old GPS: no confident instruction.
  await page.getByText('Try Bus Lock · invented demo only', { exact: true }).click();
  await page.getByRole('button', { name: 'Advance 3 minutes' }).click();
  await expect(ride.locator('.ride-message')).toHaveText(/GPS is old, so Dale can’t tell which stop it is at/);
  await ride.getByRole('button', { name: 'Make smaller' }).click();
  await expect(ride).not.toHaveAttribute('data-large', 'true');
  await expect(ride).toContainText('Your ticket stays in the NJ Transit app');
  const { violations } = await new AxeBuilder({ page }).include('.ride-mode').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await page.locator('.dep').first().click();
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
  await expect(ride).toContainText('Coming up: listed stops only (scheduled times)');
  await expect(ride).toContainText('(timetable, not GPS)');
  await expect(ride.getByRole('button', { name: /Move the demo bus/ })).toHaveCount(0);
  await expect(ride.locator('li[data-role="alight"]')).toContainText('Port Authority Bus Terminal');
});

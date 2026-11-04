import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Positions here are invented, next to invented demo stops; no real rider location is used.
test.use({ serviceWorkers: 'block' });

test.describe('with location allowed', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 40.8701, longitude: -74.0400, accuracy: 25 } });

  test('suggests nearby demo stops; the rider picks one and the direction guard still applies', async ({ page }) => {
    await page.goto('/?now=2026-11-04T07:50&demo');
    await page.getByRole('button', { name: /find a stop/i }).first().click();
    await expect(page.locator('.near-me')).toContainText('Dale does not save it or send it anywhere.');
    await page.getByRole('button', { name: 'Stops near me' }).click();
    const list = page.locator('.near-me .results li');
    await expect(list).toHaveCount(2);
    await expect(list.first()).toContainText('Maple Ave & Main St (to NYC)');
    await expect(page.locator('.near-me')).toContainText('good to about 25 m');
    await expect(page.locator('.near-me')).toContainText('straight lines, not walking routes');
    const { violations } = await new AxeBuilder({ page }).include('.near-me').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await list.nth(1).click(); // the stop across the street
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maple Ave & Main St (to Demo Terminal)');
    await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
    await expect(page.getByRole('alert')).toContainText('Wrong side of the street');
  });
});

test.describe('with a rough location', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 40.8701, longitude: -74.0400, accuracy: 400 } });
  test('warns that the first stop may not be the closest', async ({ page }) => {
    await page.goto('/?now=2026-11-04T07:50&demo');
    await page.getByRole('button', { name: /find a stop/i }).first().click();
    await page.getByRole('button', { name: 'Stops near me' }).click();
    await expect(page.locator('.near-me')).toContainText('Your location is rough');
  });
});

test('location turned off: says so and points to search by name', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/?now=2026-11-04T07:50&demo');
  await page.getByRole('button', { name: /find a stop/i }).first().click();
  await page.getByRole('button', { name: 'Stops near me' }).click();
  await expect(page.locator('.near-me')).toContainText('Location is turned off for this site');
});

test('a browser that never answers: gives up after a while and the button still works', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: () => undefined }, configurable: true });
  });
  await page.clock.install();
  await page.goto('/?now=2026-11-04T07:50&demo');
  await page.getByRole('button', { name: /find a stop/i }).first().click();
  await page.getByRole('button', { name: 'Stops near me' }).click();
  await expect(page.locator('.near-me')).toContainText('Asking your phone');
  await expect(page.getByRole('button', { name: 'Stops near me' })).toBeEnabled();
  await page.clock.runFor(21_000);
  await expect(page.locator('.near-me')).toContainText('could not find your location');
});

test('a browser without location: says so', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); });
  await page.goto('/?now=2026-11-04T07:50&demo');
  await page.getByRole('button', { name: /find a stop/i }).first().click();
  await page.getByRole('button', { name: 'Stops near me' }).click();
  await expect(page.locator('.near-me')).toContainText('This browser cannot share a location');
});

test('printed timetable: not offered, and says why', async ({ page }) => {
  await page.goto('/?now=2026-11-04T07:50');
  await page.getByRole('button', { name: /find a stop/i }).first().click();
  await expect(page.getByRole('button', { name: 'Stops near me' })).toHaveCount(0);
  await expect(page.getByRole('note').filter({ hasText: 'needs stop locations, which the printed timetable does not have' })).toBeVisible();
});

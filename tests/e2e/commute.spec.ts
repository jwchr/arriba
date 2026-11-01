import { expect, test, type Page } from '@playwright/test';

// Wednesday Nov 4 2026, 7:50 AM New York time, on the invented demo dataset.
const URL = '/?now=2026-11-04T07:50&demo';

async function saveCommute(page: Page, query: string, pick: RegExp, dest: RegExp) {
  await page.getByRole('button', { name: /find a stop/i }).first().click();
  await page.getByRole('searchbox').fill(query);
  await page.getByRole('button', { name: pick }).click();
  await page.getByRole('button', { name: dest }).click();
}

test('first run: wrong-side guard, save, zero-tap home on return', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('note').first()).toContainText('Demo data');
  await saveCommute(page, 'maple', /Maple Ave & Main St \(to Demo Terminal\)/, /Port Authority Bus Terminal/);

  // Buses on this side go the other way: the app points across the street.
  await expect(page.getByRole('alert')).toContainText('Wrong side of the street');
  await page.getByRole('button', { name: 'Use that stop' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maple Ave & Main St (to NYC)');
  await page.getByRole('button', { name: /Port Authority Bus Terminal/ }).click();
  await page.getByRole('button', { name: 'Save to my commutes' }).click();

  const card = page.getByRole('article');
  await expect(card.locator('.dep-time')).toHaveText(['8:06 AM', '8:06 AM', '8:26 AM']);
  await expect(card.locator('.route-badge')).toHaveText(['165', '165T', '165T']);
  await expect(card.locator('.dep-sub').first()).toHaveText('arrives 8:55 AM');
  await expect(card.getByText('Scheduled only').first()).toBeVisible();

  // Reload = a returning rider: the next buses are there with no taps.
  await page.reload();
  await expect(page.getByRole('article').locator('.dep-time').first()).toHaveText('8:06 AM');
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
});

test('reverse, gate card, exact-bus lock, all-day timetable, Spanish', async ({ page }) => {
  await page.goto(URL);
  await saveCommute(page, '90002', /Maple Ave & Main St \(to NYC\)/, /Port Authority Bus Terminal/);
  await page.getByRole('button', { name: 'Save to my commutes' }).click();

  // One tap reverses the commute; the return leg ends at the home stop's twin across the street.
  await page.getByRole('button', { name: /Reverse/ }).click();
  const card = page.getByRole('article');
  await expect(card.locator('.leg')).toHaveText('Port Authority Bus Terminal → Maple Ave & Main St (to Demo Terminal)'); // shown only when it differs from the name
  await card.locator('.dep').first().click();
  await expect(page.locator('.sign-led')).toHaveText('165 DEMO TERMINAL');
  await expect(page.locator('.gate-card')).toContainText('Usually gate 212, door 2');
  await expect(page.locator('.gate-card')).toContainText('Ticket required before boarding');
  await page.getByRole('button', { name: 'Lock onto this bus' }).click();
  await expect(page.locator('.lock-status')).toHaveText('Scheduled only: no live bus linked yet');
  await expect(page.locator('.stop-list li[data-role="alight"]')).toContainText('Maple Ave & Main St (to Demo Terminal)');
  await page.screenshot({ path: 'test-results/departure.png', fullPage: true });

  // Back on home the card is still reversed; its all-day timetable is the return leg.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /Reverse/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /All day/ }).click();
  const rows = page.locator('table.timetable tbody tr');
  // Demo weekday return: the previous night's midnight local, 36 locals 6:00 AM-11:30 PM, 10 PM-peak expresses.
  await expect(rows).toHaveCount(47);
  await expect(rows.first().locator('.link-cell')).toHaveText('12:00 AM');
  await expect(rows.nth(1).locator('.link-cell')).toHaveText('6:00 AM');
  await expect(page.locator('tr.past')).toHaveCount(5); // 12:00, 6:00, 6:30, 7:00, 7:30 AM are before 7:50 AM
  await page.screenshot({ path: 'test-results/timetable.png', fullPage: true });

  // Spanish everywhere, 12-hour clock kept.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(page.getByRole('button', { name: /Invertir/ })).toBeVisible();
  await expect(page.getByRole('article').locator('.dep-time').first()).toHaveText(/^\d{1,2}:\d{2} (a|p)\.? ?m\.?$/i);
});

test('favorites keep the rider order', async ({ page }) => {
  await page.goto(URL);
  await saveCommute(page, '90002', /Maple Ave & Main St \(to NYC\)/, /Port Authority Bus Terminal/);
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await saveCommute(page, '90003', /Oak St & River Rd \(to NYC\)/, /Port Authority Bus Terminal/);
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  const titles = page.getByRole('article').locator('h2');
  await expect(titles).toHaveText([/^Maple/, /^Oak/]);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: /Move up/ }).nth(1).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(titles).toHaveText([/^Oak/, /^Maple/]);
  await page.reload();
  await expect(titles).toHaveText([/^Oak/, /^Maple/]);
});

test('ticket guide: labeled drawings of paper and app tickets, never a usable ticket', async ({ page }) => {
  await page.goto(URL);
  await saveCommute(page, '90002', /Maple Ave & Main St \(to NYC\)/, /Port Authority Bus Terminal/);
  await page.getByRole('button', { name: 'Save to my commutes' }).click();
  await page.getByRole('button', { name: /Reverse/ }).click();
  await page.getByRole('article').locator('.dep').first().click();

  await expect(page.locator('.trip-ticket-label')).toHaveText('Trip card · not a ticket');
  const guide = page.locator('details.ticket-guide');
  await expect(guide).toHaveAttribute('open', ''); // open by default when boarding at Port Authority
  await expect(guide.getByRole('img', { name: /paper one-way bus ticket, marked sample/ })).toBeVisible();
  await expect(guide.locator('svg text', { hasText: 'SAMPLE · NOT VALID' }).first()).toBeAttached();
  await expect(guide.locator('.ticket-notes li')).toHaveCount(5);
  await expect(guide.locator('.ticket-notes li').nth(1)).toContainText('30 days');
  await page.screenshot({ path: 'test-results/ticket-paper.png', fullPage: true });

  await guide.getByRole('button', { name: 'App ticket' }).click();
  await expect(guide.getByRole('img', { name: /app bus ticket, marked sample/ })).toBeVisible();
  await expect(guide.locator('.ticket-notes li').last()).toContainText('60 minutes after activation');
  await guide.locator('.ticket-figure').screenshot({ path: 'test-results/ticket-app.png' });

  // No real scannable code is ever drawn: the code area is a labeled hatch, not a QR or barcode image.
  await expect(guide.locator('image, img')).toHaveCount(0);

  // From a New Jersey stop the guide starts closed.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Reverse/ }).click();
  await page.getByRole('article').locator('.dep').first().click();
  await expect(page.locator('details.ticket-guide')).not.toHaveAttribute('open', '');
});

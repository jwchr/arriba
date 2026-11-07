import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ESM operational script without type declarations
import { checkBusApiCredentials, runConnectionCheck } from '../../scripts/check-bus-api.mjs';

// Synthetic values only. Real credentials and NJ Transit responses never belong in fixtures.
const credentials = { username: 'synthetic-user', password: 'synthetic-password' };
const token = 'synthetic-token-never-log';
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'jwchr/dale', NJT_API_USERNAME: credentials.username, NJT_API_PASSWORD: credentials.password };
const json = (value: unknown) => new Response(JSON.stringify(value));
const good = () => json({ Authenticated: 'True', UserToken: token });
const statuses = async (fetchImpl: unknown, creds: unknown = credentials) =>
  (await checkBusApiCredentials(creds, fetchImpl)).map((r: { status: string }) => r.status);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('approved bus API connection check', () => {
  it('posts credentials only to the two fixed production authentication endpoints, once each', async () => {
    const fetchImpl = vi.fn(async () => good());
    expect(await checkBusApiCredentials(credentials, fetchImpl)).toEqual([
      { api: 'BUSDV2', status: 'authenticated' }, { api: 'GTFSG2', status: 'authenticated' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://pcsdata.njtransit.com/api/BUSDV2/authenticateUser',
      'https://pcsdata.njtransit.com/api/GTFSG2/authenticateUser',
    ]);
    for (const [, init] of calls) {
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.body).toBeInstanceOf(FormData);
      expect([...(init.body as FormData).entries()]).toEqual([['username', credentials.username], ['password', credentials.password]]);
    }
  });

  it.each([undefined, {}, { username: 'u' }, { username: ' ', password: 'p' }, { username: 'u', password: '' }])('does not contact NJ Transit with missing credentials: %j', async (creds) => {
    const fetchImpl = vi.fn();
    expect(await statuses(fetchImpl, creds ?? null)).toEqual(['configuration-missing', 'configuration-missing']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { Authenticated: 'False', UserToken: token },
    { Authenticated: false, UserToken: token },
  ])('does not mistake a denial for success, even with a token: %j', async (value) => {
    expect(await statuses(async () => json(value))).toEqual(['access-denied', 'access-denied']);
  });

  it.each([null, [], {}, { UserToken: token }, { Authenticated: 'True' }, { Authenticated: 'True', UserToken: '' }, { Authenticated: 'True', UserToken: ' ' }, { Authenticated: 'True', UserToken: 123 }, { Authenticated: 1, UserToken: token }])('requires an explicit success and nonempty string token: %j', async (value) => {
    expect(await statuses(async () => json(value))).toEqual(['unexpected-response', 'unexpected-response']);
  });

  it('accepts a boolean true without returning or retaining the token in its result', async () => {
    const result = await checkBusApiCredentials(credentials, async () => json({ Authenticated: true, UserToken: token }));
    expect(result.map((r: { status: string }) => r.status)).toEqual(['authenticated', 'authenticated']);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([[401, 'access-denied'], [403, 'access-denied'], [429, 'rate-limited'], [500, 'http-error'], [302, 'http-error']] as const)('sanitizes HTTP %i and does not parse the error body', async (code, status) => {
    const fetchImpl = vi.fn(async () => new Response(credentials.password + token, { status: code }));
    expect(await statuses(fetchImpl)).toEqual([status, status]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not stop the second API check when only the first API rejects access', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ Authenticated: 'False' })).mockResolvedValueOnce(good());
    expect(await statuses(fetchImpl)).toEqual(['access-denied', 'authenticated']);
  });

  it('rejects invalid JSON and oversized responses without echoing them', async () => {
    expect(await statuses(async () => new Response(credentials.password + token))).toEqual(['unexpected-response', 'unexpected-response']);
    expect(await statuses(async () => json({ Authenticated: 'True', UserToken: 'x'.repeat(17_000) }))).toEqual(['unexpected-response', 'unexpected-response']);
  });

  it('bounds authentication time and does not retry a timed-out API', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error(credentials.password + token)), { once: true });
    }));
    const result = statuses(fetchImpl);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(['timed-out', 'timed-out']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active while an authentication body stalls after HTTP 200', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"Authenticated":'));
        init.signal!.addEventListener('abort', () => controller.error(new Error(credentials.password + token)), { once: true });
      },
    })));
    const result = statuses(fetchImpl);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(['timed-out', 'timed-out']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes network errors that contain secrets', async () => {
    expect(await statuses(async () => { throw new Error(credentials.password + token); })).toEqual(['network-error', 'network-error']);
  });

  it('prints only fixed outcomes for success, denial and network failure', async () => {
    for (const fetchImpl of [async () => good(), async () => json({ Authenticated: 'False', UserToken: token }), async () => { throw new Error(credentials.password + token); }]) {
      const output: string[] = [];
      const code = await runConnectionCheck(env, fetchImpl, (s: string) => output.push(s));
      expect([0, 1]).toContain(code);
      expect(output).toHaveLength(3);
      expect(output[2]).toContain('app is not connected to live data');
      for (const secret of Object.values(credentials).concat(token)) expect(output.join('\n')).not.toContain(secret);
    }
  });

  it('returns failure for missing configuration and rejected authentication', async () => {
    expect(await runConnectionCheck({ ...env, NJT_API_PASSWORD: '' }, vi.fn(), vi.fn())).toBe(1);
    expect(await runConnectionCheck(env, async () => json({ Authenticated: 'False' }), vi.fn())).toBe(1);
    expect(await runConnectionCheck(env, async () => good(), vi.fn())).toBe(0);
  });

  it.each([
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'another/repo' },
  ])('refuses to send credentials outside the manual main workflow: %j', async (patch) => {
    const fetchImpl = vi.fn();
    expect(await runConnectionCheck({ ...env, ...patch }, fetchImpl, vi.fn())).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps workflow secrets out of pull-request, build, artifact and browser paths', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/bus-api-check.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).not.toMatch(/pull_request:|push:|schedule:|upload-artifact|npm (ci|run build)/);
    expect(workflow).toContain('NJT_API_PASSWORD: ${{ secrets.NJT_API_PASSWORD }}');
  });
});

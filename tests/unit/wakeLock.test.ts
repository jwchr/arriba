import { describe, expect, it, vi } from 'vitest';
import { createScreenWakeLockController, type ScreenWakeLockHandle, type ScreenWakeLockStatus } from '../../src/ui/useScreenWakeLock';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function handle() {
  const listeners = new Set<() => void>();
  const result: ScreenWakeLockHandle & { release: ReturnType<typeof vi.fn>; revoke: () => void; listeners: Set<() => void> } = {
    released: false,
    listeners,
    release: vi.fn(async () => result.revoke()),
    revoke() { Object.assign(result, { released: true }); for (const listener of listeners) listener(); },
    addEventListener: (_, listener) => { listeners.add(listener); },
    removeEventListener: (_, listener) => { listeners.delete(listener); },
  };
  return result;
}

function setup(supported = true, initiallyVisible = true) {
  let visible = initiallyVisible;
  const visibilityListeners = new Set<() => void>();
  const attempts: ReturnType<typeof deferred<ScreenWakeLockHandle>>[] = [];
  const request = vi.fn(() => {
    const attempt = deferred<ScreenWakeLockHandle>();
    attempts.push(attempt);
    return attempt.promise;
  });
  let status: ScreenWakeLockStatus = 'off';
  const updates: ScreenWakeLockStatus[] = [];
  const controller = createScreenWakeLockController({
    isVisible: () => visible,
    request: supported ? request : undefined,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => { visibilityListeners.delete(listener); };
    },
  }, (next) => { status = next; updates.push(next); });
  return {
    controller, request, attempts, updates, visibilityListeners,
    get status() { return status; },
    setVisibilitySilently(next: boolean) { visible = next; },
    visibility(next: boolean) { visible = next; for (const listener of visibilityListeners) listener(); },
  };
}

describe('screen wake lock lifecycle', () => {
  it('requests only when enabled, reports success, and releases on disable', async () => {
    const s = setup();
    expect(s.request).not.toHaveBeenCalled();
    s.controller.setEnabled(true);
    expect(s.status).toBe('requesting');
    s.controller.retry();
    expect(s.request).toHaveBeenCalledTimes(1);
    const lock = handle();
    s.attempts[0]!.resolve(lock);
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.retry();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.setEnabled(false);
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(lock.listeners.size).toBe(0);
    expect(s.status).toBe('off');
    s.controller.dispose();
  });

  it('pauses offscreen, releases, and requests a new lock when visible again', async () => {
    const s = setup(true, false);
    s.controller.setEnabled(true);
    expect(s.status).toBe('paused');
    expect(s.request).not.toHaveBeenCalled();
    s.visibility(true);
    const first = handle();
    s.attempts[0]!.resolve(first);
    await Promise.resolve();
    s.visibility(false);
    expect(s.status).toBe('paused');
    expect(first.release).toHaveBeenCalledTimes(1);
    s.controller.retry();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.visibility(true);
    expect(s.request).toHaveBeenCalledTimes(2);
    s.attempts[1]!.resolve(handle());
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.dispose();
  });

  it('does not loop after rejection or retry on redundant visibility events', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    s.attempts[0]!.reject(new Error('power saving'));
    await Promise.resolve();
    expect(s.status).toBe('unavailable');
    s.visibility(true);
    s.controller.setEnabled(true);
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.retry();
    expect(s.request).toHaveBeenCalledTimes(2);
    s.attempts[1]!.resolve(handle());
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.dispose();
  });

  it('reports unsupported browsers without requesting, then returns to off', () => {
    const s = setup(false);
    s.controller.setEnabled(true);
    expect(s.status).toBe('unavailable');
    s.controller.retry();
    s.visibility(false);
    s.visibility(true);
    expect(s.request).not.toHaveBeenCalled();
    s.controller.setEnabled(false);
    expect(s.status).toBe('off');
    s.controller.dispose();
  });

  it('requires explicit retry or a visibility transition after system revocation', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    const lock = handle();
    s.attempts[0]!.resolve(lock);
    await Promise.resolve();
    lock.revoke();
    expect(s.status).toBe('unavailable');
    expect(lock.listeners.size).toBe(0);
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.retry();
    s.attempts[1]!.resolve(handle());
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.dispose();
  });

  it.each(['disable', 'dispose'] as const)('releases a request that resolves after %s without publishing active', async (end) => {
    const s = setup();
    s.controller.setEnabled(true);
    if (end === 'disable') s.controller.setEnabled(false);
    else s.controller.dispose();
    const updatesBefore = [...s.updates];
    const late = handle();
    s.attempts[0]!.resolve(late);
    await Promise.resolve();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(s.updates).toEqual(updatesBefore);
    expect(late.listeners.size).toBe(0);
    s.controller.dispose();
    expect(s.visibilityListeners.size).toBe(0);
  });

  it('does not let an obsolete pending request overwrite a newer lock after hide/show', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    s.visibility(false);
    s.visibility(true);
    const current = handle();
    s.attempts[1]!.resolve(current);
    await Promise.resolve();
    const old = handle();
    s.attempts[0]!.resolve(old);
    await Promise.resolve();
    expect(s.status).toBe('active');
    expect(old.release).toHaveBeenCalledTimes(1);
    expect(current.release).not.toHaveBeenCalled();
    s.controller.dispose();
    expect(current.release).toHaveBeenCalledTimes(1);
  });

  it('does not let an obsolete rejection overwrite a re-enabled session', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    s.controller.setEnabled(false);
    s.controller.setEnabled(true);
    s.attempts[1]!.resolve(handle());
    await Promise.resolve();
    s.attempts[0]!.reject(new Error('old request'));
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.dispose();
  });

  it('releases a lock acquired while hidden even before the visibility event is delivered', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    s.setVisibilitySilently(false);
    const late = handle();
    s.attempts[0]!.resolve(late);
    await Promise.resolve();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(s.status).toBe('paused');
    s.visibility(true);
    expect(s.request).toHaveBeenCalledTimes(2);
    s.attempts[1]!.resolve(handle());
    await Promise.resolve();
    expect(s.status).toBe('active');
    s.controller.dispose();
  });

  it('does not report active if the returned sentinel is already released', async () => {
    const s = setup();
    s.controller.setEnabled(true);
    const released = handle();
    released.revoke();
    s.attempts[0]!.resolve(released);
    await Promise.resolve();
    expect(s.status).toBe('unavailable');
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
});

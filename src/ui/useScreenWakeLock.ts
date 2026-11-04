import { useCallback, useEffect, useRef, useState } from 'react';

export type ScreenWakeLockStatus = 'off' | 'requesting' | 'active' | 'paused' | 'unavailable';

/** The small browser surface is injected so lifecycle races can be tested without a DOM. */
export interface ScreenWakeLockHandle {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export interface ScreenWakeLockPlatform {
  isVisible(): boolean;
  request?: () => Promise<ScreenWakeLockHandle>;
  onVisibilityChange(listener: () => void): () => void;
}

export interface ScreenWakeLockController {
  setEnabled(enabled: boolean): void;
  retry(): void;
  dispose(): void;
}

export function createScreenWakeLockController(
  platform: ScreenWakeLockPlatform,
  onStatus: (status: ScreenWakeLockStatus) => void,
): ScreenWakeLockController {
  let enabled = false;
  let disposed = false;
  let status: ScreenWakeLockStatus = 'off';
  let visible = platform.isVisible();
  let generation = 0;
  let pending = false;
  let held: { handle: ScreenWakeLockHandle; onRelease: () => void } | undefined;

  const isVisible = () => { visible = platform.isVisible(); return visible; };
  const update = (next: ScreenWakeLockStatus) => {
    if (!disposed && status !== next) { status = next; onStatus(next); }
  };
  const release = (handle: ScreenWakeLockHandle) => {
    // Cleanup must also tolerate a browser releasing the lock first or rejecting release().
    try { if (!handle.released) void handle.release().catch(() => {}); } catch { /* already unavailable */ }
  };
  const invalidate = () => {
    generation += 1;
    pending = false;
    if (held) {
      const { handle, onRelease } = held;
      held = undefined;
      handle.removeEventListener('release', onRelease);
      release(handle);
    }
  };

  const request = () => {
    if (disposed || !enabled) return;
    if (!platform.request) { update('unavailable'); return; }
    if (!isVisible()) { invalidate(); update('paused'); return; }
    if (pending || held) return;

    const attempt = ++generation;
    pending = true;
    update('requesting');
    const failed = () => {
      if (disposed || attempt !== generation || !enabled) return;
      pending = false;
      update(isVisible() ? 'unavailable' : 'paused');
    };
    try {
      void platform.request().then((handle) => {
        if (disposed || attempt !== generation || !enabled) { release(handle); return; }
        pending = false;
        if (!isVisible()) { release(handle); update('paused'); return; }
        if (handle.released) { update('unavailable'); return; }
        const onRelease = () => {
          if (held?.handle !== handle) return;
          held = undefined;
          handle.removeEventListener('release', onRelease);
          // No retry loop when the browser revokes a lock (for example, low power).
          update(isVisible() ? 'unavailable' : 'paused');
        };
        held = { handle, onRelease };
        handle.addEventListener('release', onRelease);
        update('active');
      }, failed);
    } catch { failed(); }
  };

  const unsubscribe = platform.onVisibilityChange(() => {
    const nextVisible = platform.isVisible();
    if (disposed || nextVisible === visible) return;
    visible = nextVisible;
    if (!enabled) return;
    if (!visible) {
      invalidate();
      update(platform.request ? 'paused' : 'unavailable');
    } else request();
  });

  return {
    setEnabled(next) {
      if (disposed || next === enabled) return;
      enabled = next;
      if (enabled) request();
      else { invalidate(); update('off'); }
    },
    retry: request,
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      unsubscribe();
      invalidate();
    },
  };
}

function browserPlatform(): ScreenWakeLockPlatform {
  const doc = typeof document === 'undefined' ? undefined : document;
  const wakeLock = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;
  return {
    isVisible: () => doc?.visibilityState === 'visible',
    request: wakeLock ? () => wakeLock.request('screen') : undefined,
    onVisibilityChange(listener) {
      doc?.addEventListener('visibilitychange', listener);
      return () => doc?.removeEventListener('visibilitychange', listener);
    },
  };
}

/** Screen wake is best effort; it never enables background location or changes the waiting session. */
export function useScreenWakeLock(enabled: boolean): { status: ScreenWakeLockStatus; retry: () => void } {
  const [status, setStatus] = useState<ScreenWakeLockStatus>('off');
  const controller = useRef<ScreenWakeLockController | undefined>(undefined);
  useEffect(() => {
    const current = createScreenWakeLockController(browserPlatform(), setStatus);
    controller.current = current;
    return () => { controller.current = undefined; current.dispose(); };
  }, []);
  useEffect(() => controller.current?.setEnabled(enabled), [enabled]);
  const retry = useCallback(() => controller.current?.retry(), []);
  return { status: enabled ? status : 'off', retry };
}

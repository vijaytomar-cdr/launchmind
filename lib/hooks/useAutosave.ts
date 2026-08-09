/**
 * @file lib/hooks/useAutosave.ts
 * @description Debounced autosave hook for Phase 1 alignment steps.
 *   Calls saveFn after `delay` ms of inactivity. Reports save state.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface UseAutosaveOptions {
  /** Debounce delay in ms (default: 1500) */
  delay?: number;
}

/**
 * Debounced autosave hook.
 * @param saveFn - Async function that persists the current state; should be stable or memoized with useCallback.
 * @param deps   - Values to watch; when any change, the debounce timer resets.
 * @returns saveState — current save status
 */
export function useAutosave(
  saveFn: () => Promise<void>,
  deps: unknown[],
  options: UseAutosaveOptions = {},
): SaveState {
  const { delay = 1500 } = options;
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Track whether first render (don't autosave on mount)
  const isFirstRender = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable reference to saveFn so we don't close over stale state
  const saveFnRef = useRef(saveFn);
  useEffect(() => { saveFnRef.current = saveFn; });

  useEffect(() => {
    // Skip autosave on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setSaveState('saving');
      try {
        await saveFnRef.current();
        if (mountedRef.current) setSaveState('saved');
        // Reset to idle after 2s
        setTimeout(() => { if (mountedRef.current) setSaveState('idle'); }, 2000);
      } catch {
        if (mountedRef.current) setSaveState('failed');
      }
    }, delay);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return saveState;
}

// SPDX-License-Identifier: Elastic-2.0
import { useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'done'; value: T };

/** Run an async loader, re-running when `deps` change; ignores stale results. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load().then(
      (value) => {
        if (active) setState({ status: 'done', value });
      },
      (error) => {
        if (active) setState({ status: 'error', error });
      },
    );
    return () => {
      active = false;
    };
    // `load` is recreated each render; `deps` is the caller-supplied stable key.
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps is a passthrough dependency key, intentionally dynamic.
  }, deps);
  return state;
}

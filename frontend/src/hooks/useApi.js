import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Runs an async loader and tracks {data, loading, error}, with a `reload`.
 *
 * `deps` behaves like a useEffect dependency list. Results from a superseded
 * request are discarded, so fast filter changes cannot render stale data.
 */
export default function useApi(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const execute = useCallback(async (...args) => {
    requestId.current += 1;
    const id = requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current(...args);
      if (id === requestId.current) setData(result);
      return result;
    } catch (err) {
      if (id === requestId.current) setError(err);
      throw err;
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!immediate) return;
    execute().catch(() => {
      /* error is already captured in state */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: execute, setData };
}

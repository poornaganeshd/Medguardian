import { useState, useCallback } from 'react';
import { stepUpStore } from '../services/api';

/**
 * Wraps an action that may require PIN re-authentication.
 *
 * Usage:
 *   const { run, gateProps, pending } = useStepUp();
 *   run(() => medicineApi.remove(id), 'delete this medicine');
 *
 * If a valid step-up token is already held, the action runs immediately.
 * Otherwise the PIN dialog is shown and the action is replayed once the user
 * confirms. The API layer also raises STEP_UP_REQUIRED if the token expired
 * server-side, which is handled the same way.
 */
export default function useStepUp() {
  const [pending, setPending] = useState(null);

  const run = useCallback(async (action, label = 'continue') => {
    try {
      return await action();
    } catch (error) {
      if (error.code === 'STEP_UP_REQUIRED') {
        return new Promise((resolve, reject) => {
          setPending({ action, label, resolve, reject });
        });
      }
      throw error;
    }
  }, []);

  const onConfirmed = useCallback(async () => {
    if (!pending) return;
    const { action, resolve, reject } = pending;
    setPending(null);
    try {
      resolve(await action());
    } catch (error) {
      reject(error);
    }
  }, [pending]);

  const onCancel = useCallback(() => {
    if (!pending) return;
    pending.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    setPending(null);
  }, [pending]);

  return {
    run,
    pending,
    hasStepUp: Boolean(stepUpStore.get()),
    gateProps: pending ? { action: pending.label, onConfirmed, onCancel } : null
  };
}

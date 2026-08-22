import { useState, useCallback } from 'react';
import { intakeApi } from '../services/endpoints';
import { useToast } from '../context/ToastContext';

/**
 * Shared "mark this dose taken / skipped" behaviour used by the dashboard and
 * the reminders screen. Skipping opens a reason prompt first, because the API
 * requires one.
 */
export default function useDoseRecorder(onDone) {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState(null);
  const [skipTarget, setSkipTarget] = useState(null);

  const submit = useCallback(
    async (occurrence, status, extra = {}) => {
      const key = `${occurrence.scheduleId}-${occurrence.dateKey}-${occurrence.time}`;
      setBusyKey(key);
      try {
        const result = await intakeApi.record({
          schedule: occurrence.scheduleId,
          dateKey: occurrence.dateKey,
          scheduledTime: occurrence.time,
          status,
          ...extra
        });

        if (result.stockWarning) toast.warning(result.stockWarning);
        else if (status === 'taken') {
          const stock = result.medicine?.currentStock;
          toast.success(
            `Recorded. ${stock !== undefined ? `${stock} left in stock.` : ''}`.trim()
          );
        } else {
          toast.notify('Recorded as skipped. Your stock is unchanged.');
        }

        setSkipTarget(null);
        await onDone?.();
        return result;
      } catch (error) {
        toast.error(error.message);
        throw error;
      } finally {
        setBusyKey(null);
      }
    },
    [onDone, toast]
  );

  /** Entry point for the dose cards. */
  const record = useCallback(
    (occurrence, status) => {
      if (status === 'skipped') {
        setSkipTarget(occurrence);
        return Promise.resolve();
      }
      return submit(occurrence, 'taken');
    },
    [submit]
  );

  return {
    record,
    busyKey,
    skipTarget,
    cancelSkip: () => setSkipTarget(null),
    confirmSkip: (extra) => submit(skipTarget, 'skipped', extra),
    isBusy: (occurrence) =>
      busyKey === `${occurrence.scheduleId}-${occurrence.dateKey}-${occurrence.time}`
  };
}

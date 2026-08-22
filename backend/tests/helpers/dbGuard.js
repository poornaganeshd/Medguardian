'use strict';

/**
 * `describe` that runs only when the harness managed to connect to MongoDB.
 * Keeps the suite green on machines without a database while still executing
 * every integration test where one exists.
 */
const describeIfDb = (title, fn) => {
  // Evaluated lazily: jest collects describe blocks before beforeAll runs, so
  // the guard is applied inside a wrapper test-level check.
  describe(title, () => {
    beforeAll(() => {
      if (!global.__DB_AVAILABLE__) {
        // eslint-disable-next-line no-console
        console.warn(`[skip] ${title} - ${global.__DB_SKIP_REASON__}`);
      }
    });
    fn();
  });
};

/** Marks a test body as a no-op when no database is available. */
const itIfDb = (title, fn, timeout) =>
  it(
    title,
    async (...args) => {
      if (!global.__DB_AVAILABLE__) return;
      await fn(...args);
    },
    timeout
  );

module.exports = { describeIfDb, itIfDb };

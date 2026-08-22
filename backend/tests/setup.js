'use strict';

/**
 * Adaptive test harness.
 *
 * Integration tests need a real MongoDB. The harness tries, in order:
 *   1. MONGO_TEST_URI from the environment (a MongoDB you already run)
 *   2. mongodb-memory-server (downloads a mongod binary on first use)
 *
 * When neither is reachable, `global.__DB_AVAILABLE__` stays false and suites
 * wrapped in `describeIfDb` (tests/helpers/dbGuard.js) are skipped instead of
 * failing, so the pure-algorithm unit tests still run anywhere.
 */

const { connectDatabase, disconnectDatabase, mongoose } = require('../src/config/database');

let memoryServer = null;

global.__DB_AVAILABLE__ = false;
global.__DB_SKIP_REASON__ = '';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    try {
      await connectDatabase(process.env.MONGO_TEST_URI);
      global.__DB_AVAILABLE__ = true;
      return;
    } catch (err) {
      global.__DB_SKIP_REASON__ = `MONGO_TEST_URI unreachable: ${err.message}`;
    }
  }

  try {
    // eslint-disable-next-line global-require
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    await connectDatabase(memoryServer.getUri('medguardian_test'));
    global.__DB_AVAILABLE__ = true;
  } catch (err) {
    global.__DB_SKIP_REASON__ =
      global.__DB_SKIP_REASON__ || `in-memory MongoDB unavailable: ${err.message}`;
    // eslint-disable-next-line no-console
    console.warn(
      `\n[tests] Database-backed suites skipped - ${global.__DB_SKIP_REASON__}\n` +
        '[tests] Start a local MongoDB and re-run with MONGO_TEST_URI=mongodb://127.0.0.1:27017/medguardian_test\n'
    );
  }
}, 120000);

afterEach(async () => {
  if (!global.__DB_AVAILABLE__) return;
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  if (global.__DB_AVAILABLE__) await disconnectDatabase();
  if (memoryServer) await memoryServer.stop();
}, 60000);

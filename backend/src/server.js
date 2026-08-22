'use strict';

const fs = require('fs');
const { config, assertProductionSecrets } = require('./config/env');
const logger = require('./config/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const app = require('./app');

let server;

async function bootstrap() {
  assertProductionSecrets();

  // Ensure the upload tree exists before any request can touch it.
  for (const sub of ['', '/medicines', '/records', '/tmp']) {
    fs.mkdirSync(`${config.uploads.dir}${sub}`, { recursive: true });
  }

  await connectDatabase();

  server = app.listen(config.port, () => {
    logger.info(`MedGuardian API listening on port ${config.port} [${config.env}]`);
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

bootstrap().catch((err) => {
  logger.error('Failed to start MedGuardian API:', err.message);
  process.exit(1);
});

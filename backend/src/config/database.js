'use strict';

const mongoose = require('mongoose');
const { config } = require('./env');
const logger = require('./logger');

mongoose.set('strictQuery', true);

let connectionPromise = null;

/**
 * Connect to MongoDB. Safe to call more than once - the same promise is reused.
 * @param {string} [uri] override URI (used by the test harness)
 */
async function connectDatabase(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: !config.isProd
    })
    .then((conn) => {
      logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn.connection;
    })
    .catch((err) => {
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

async function disconnectDatabase() {
  connectionPromise = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

module.exports = { connectDatabase, disconnectDatabase, mongoose };

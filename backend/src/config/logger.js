'use strict';

const { config } = require('./env');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[config.logLevel] ?? LEVELS.info;

const emit = (level, args) => {
  if (LEVELS[level] > activeLevel) return;
  if (config.isTest && level !== 'error') return;
  const stamp = new Date().toISOString();
  const target = level === 'error' ? console.error : console.log;
  target(`[${stamp}] [${level.toUpperCase()}]`, ...args);
};

module.exports = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  debug: (...args) => emit('debug', args)
};

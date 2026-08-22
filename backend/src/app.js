'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const { config } = require('./config/env');
const logger = require('./config/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const routes = require('./routes');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------- security
app.use(
  helmet({
    // Uploaded images are fetched by the SPA running on a different origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: config.isProd ? undefined : false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / server-to-server calls (no Origin header).
      if (!origin) return callback(null, true);
      if (config.clientOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
  })
);

// ------------------------------------------------------------ body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());
app.use(mongoSanitize());
app.use(hpp());

if (!config.isTest) {
  app.use(
    morgan(config.isProd ? 'combined' : 'dev', {
      stream: { write: (msg) => logger.info(msg.trim()) }
    })
  );
}

// ------------------------------------------------------------------ routes
app.use('/api', apiLimiter, routes);

// Static delivery of the built SPA in production (single-service deployment).
if (config.isProd) {
  const clientDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => (err ? next() : undefined));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

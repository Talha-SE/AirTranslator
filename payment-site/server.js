import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

import paymentRoutes from './src/routes/paymentRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security middleware
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      "font-src": ["'self'", 'https://fonts.gstatic.com', 'data:'],
      "img-src": ["'self'", 'data:'],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

const corsOrigin = process.env.CORS_ORIGIN || `http://localhost:${PORT}`;
app.use(cors({
  origin: corsOrigin,
  methods: ['GET','POST'],
  credentials: false
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Logging
if (NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Static files (disable caching in development for instant refreshes)
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (/\.(css|js|html)$/i.test(req.url)) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
} else {
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
}

// API routes
app.use('/api', paymentRoutes);

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log(`Payment site running on http://localhost:${PORT}`);
});

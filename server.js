import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, initTracking, getFeatures } from './db/index.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import stripeRoutes, { stripeWebhook } from './routes/stripe.js';
import trackRoutes from './routes/track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Lazy DB init ───────────────────────────────────────────
// Runs once on first request — works in both serverless (Vercel)
// and traditional long-running server mode.
let _dbInitialized = false;
let _dbInitPromise = null;

function ensureDB() {
  if (_dbInitialized) return Promise.resolve();
  if (_dbInitPromise) return _dbInitPromise;
  _dbInitPromise = (async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('⚠  DATABASE_URL not set — database features disabled.');
      _dbInitialized = true;
      return;
    }
    await initDB();
    try {
      await initTracking();
    } catch (err) {
      console.warn('⚠  Tracking tables could not be initialized:', err.message, '— analytics disabled.');
    }
    _dbInitialized = true;
  })();
  return _dbInitPromise;
}

// ── Stripe Webhook — raw body BEFORE express.json() ───────
// Stripe requires the raw, unparsed request body to verify signatures.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// ── Middleware ────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── Ensure DB is ready before every request ───────────────
app.use((_req, _res, next) => {
  ensureDB().then(() => next()).catch(() => next());
});

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/track', trackRoutes);

// ── Public: feature visibility map (no auth required) ─────
app.get('/api/features', async (_req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json({ features: {} });
    const rows = await getFeatures();
    const features = {};
    rows.forEach(f => { features[f.key] = f.enabled; });
    res.json({ features });
  } catch {
    res.json({ features: {} }); // on error, show all features
  }
});

// ── Static Files ──────────────────────────────────────────
// Serve all .html files and assets from the project root
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: 'index.html',
}));

// Fallback: any unmatched route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Local dev: start listening ────────────────────────────
// On Vercel the module is imported as a serverless function handler;
// app.listen() is skipped and the default export is used instead.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  Funds Edge running at http://localhost:${PORT}\n`);
  });
}

// ── Vercel serverless export ──────────────────────────────
export default app;

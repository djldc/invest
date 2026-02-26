import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getFeatures } from './db/index.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import stripeRoutes, { stripeWebhook } from './routes/stripe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Stripe Webhook — raw body BEFORE express.json() ───────
// Stripe requires the raw, unparsed request body to verify signatures.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// ── Middleware ────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stripe', stripeRoutes);

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

// ── Start ─────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    await initDB();
  } else {
    console.warn('⚠  DATABASE_URL not set — database features disabled. Add it to .env to enable.');
  }

  app.listen(PORT, () => {
    console.log(`\n  Funds Edge running at http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

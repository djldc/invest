import express from 'express';
import jwt from 'jsonwebtoken';
import { getTokenFromRequest } from './auth.js';
import { logPageView, logClickEvent, getTrackingStats, getUserById } from '../db/index.js';

const router = express.Router();

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function getDevice(ua = '') {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}

function isBot(ua = '') {
  return /bot|crawler|spider|slurp|wget|curl|python|java|ruby|perl|go-http|headless|phantom/i.test(ua);
}

// ── POST /api/track/pageview ───────────────────────────────
router.post('/pageview', async (req, res) => {
  try {
    const { session_id, page, referrer } = req.body;
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) return res.json({ ok: true });

    const ip = getIP(req);
    const device = getDevice(ua);

    let user_id = null;
    const token = getTokenFromRequest(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user_id = decoded.id;
      } catch { /* no-op — anonymous visit */ }
    }

    await logPageView({ session_id, user_id, page, referrer, ip, user_agent: ua, device });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false }); // never fail the page load
  }
});

// ── POST /api/track/click ──────────────────────────────────
router.post('/click', async (req, res) => {
  try {
    const { session_id, page, element } = req.body;
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) return res.json({ ok: true });
    await logClickEvent({ session_id, page, element });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

// ── GET /api/track/stats — admin only ─────────────────────
router.get('/stats', async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let isAdmin = !!decoded.is_admin;
    if (!isAdmin) {
      const dbUser = await getUserById(decoded.id);
      isAdmin = !!dbUser?.is_admin;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Admin required' });

    const stats = await getTrackingStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

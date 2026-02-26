import express from 'express';
import jwt from 'jsonwebtoken';
import { getTokenFromRequest } from './auth.js';
import { getAllUsers, updateUser, getUserById, getFeatures, updateFeature, getSettings, setSetting } from '../db/index.js';

const router = express.Router();

// ── Admin middleware ───────────────────────────────────────
// Checks JWT claim first; falls back to DB lookup for sessions issued before
// the is_admin flag was added (so users don't have to re-login).
async function requireAdmin(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let isAdmin = !!decoded.is_admin;
    if (!isAdmin) {
      const dbUser = await getUserById(decoded.id);
      isAdmin = !!dbUser?.is_admin;
    }

    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ── GET /api/admin/users ───────────────────────────────────
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err) {
    console.error('Admin get users error:', err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ── PATCH /api/admin/users/:id ─────────────────────────────
// Body: { subscription_status: 'free'|'premium' } or { is_admin: true|false }
router.patch('/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { subscription_status, is_admin, has_book } = req.body;

    if (subscription_status !== undefined && !['free', 'premium'].includes(subscription_status)) {
      return res.status(400).json({ error: 'subscription_status must be "free" or "premium"' });
    }

    const user = await updateUser(id, { subscription_status, is_admin, has_book });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, user });
  } catch (err) {
    console.error('Admin update user error:', err.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ── GET /api/admin/features ────────────────────────────────
router.get('/features', requireAdmin, async (_req, res) => {
  try {
    const features = await getFeatures();
    res.json({ features });
  } catch (err) {
    console.error('Get features error:', err.message);
    res.status(500).json({ error: 'Failed to fetch features' });
  }
});

// ── PATCH /api/admin/features/:key ─────────────────────────
// Body: { enabled: true|false }
router.patch('/features/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const feature = await updateFeature(key, enabled);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json({ ok: true, feature });
  } catch (err) {
    console.error('Update feature error:', err.message);
    res.status(500).json({ error: 'Failed to update feature' });
  }
});

// ── POST /api/admin/settings ───────────────────────────────
// Body: { sitelock_enabled: bool, sitelock_message: string }
router.post('/settings', requireAdmin, async (req, res) => {
  try {
    const { sitelock_enabled, sitelock_message } = req.body;
    if (sitelock_enabled !== undefined)
      await setSetting('sitelock_enabled', String(!!sitelock_enabled));
    if (sitelock_message !== undefined)
      await setSetting('sitelock_message', sitelock_message);
    res.json({ ok: true });
  } catch (err) {
    console.error('Save settings error:', err.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ── GET /api/admin/settings ────────────────────────────────
router.get('/settings', requireAdmin, async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({
      sitelock_enabled: s.sitelock_enabled === 'true',
      sitelock_message: s.sitelock_message || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

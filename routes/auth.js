import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { upsertUser, getUserById, getUserByEmail, createEmailUser, setAdminByEmail } from '../db/index.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Helpers ──────────────────────────────────────────────

function signJWT(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: !!user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(res, token) {
  res.cookie('ia_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function getTokenFromRequest(req) {
  if (req.cookies?.ia_auth) return req.cookies.ia_auth;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Grant admin if email matches ADMIN_EMAIL env var
async function maybeGrantAdmin(user) {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (adminEmail && user.email.toLowerCase() === adminEmail && !user.is_admin) {
    await setAdminByEmail(user.email);
    user.is_admin = true;
  }
  return user;
}

// ── Google Sign-In ────────────────────────────────────────

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    let user = await upsertUser({
      email:       payload.email,
      name:        payload.name,
      picture:     payload.picture,
      provider:    'google',
      provider_id: payload.sub,
    });

    user = await maybeGrantAdmin(user);
    const token = signJWT(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user, token });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// ── Apple Sign-In ─────────────────────────────────────────

router.post('/apple', async (req, res) => {
  try {
    const { id_token, user: appleUser } = req.body;
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    const decoded = jwt.decode(id_token);
    if (!decoded?.sub) return res.status(401).json({ error: 'Invalid Apple token' });

    const email = decoded.email || appleUser?.email;
    if (!email) return res.status(400).json({ error: 'Email not provided by Apple' });

    const name = appleUser?.name
      ? `${appleUser.name.firstName || ''} ${appleUser.name.lastName || ''}`.trim()
      : email.split('@')[0];

    let user = await upsertUser({ email, name, picture: null, provider: 'apple', provider_id: decoded.sub });
    user = await maybeGrantAdmin(user);
    const token = signJWT(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user, token });
  } catch (err) {
    console.error('Apple auth error:', err.message);
    res.status(401).json({ error: 'Apple authentication failed' });
  }
});

// ── Current User ──────────────────────────────────────────

router.get('/me', async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUserById(decoded.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// ── Logout ────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('ia_auth');
  res.json({ ok: true });
});

// ── Email Sign-Up ─────────────────────────────────────────

router.post('/email/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    let user = await createEmailUser({ email, name: name || email.split('@')[0], password_hash });
    user = await maybeGrantAdmin(user);

    const token = signJWT(user);
    setAuthCookie(res, token);
    res.status(201).json({ ok: true, user, token });
  } catch (err) {
    console.error('Email signup error:', err.message);
    res.status(500).json({ error: 'Sign-up failed. Please try again.' });
  }
});

// ── Email Sign-In ─────────────────────────────────────────

router.post('/email/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await getUserByEmail(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const { password_hash, ...safeUser } = user;
    await maybeGrantAdmin(safeUser);

    const token = signJWT(safeUser);
    setAuthCookie(res, token);
    res.json({ ok: true, user: safeUser, token });
  } catch (err) {
    console.error('Email signin error:', err.message);
    res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

export default router;

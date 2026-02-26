import { neon } from '@neondatabase/serverless';

let sql;

export function getDB() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

export async function initDB() {
  const sql = getDB();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id                  SERIAL PRIMARY KEY,
      email               TEXT UNIQUE NOT NULL,
      name                TEXT,
      picture             TEXT,
      provider            TEXT NOT NULL,
      provider_id         TEXT NOT NULL,
      password_hash       TEXT,
      subscription_status TEXT DEFAULT 'free',
      is_admin            BOOLEAN DEFAULT FALSE,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      last_login          TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Safe column additions for existing tables
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_book BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  // Features visibility table
  await sql`
    CREATE TABLE IF NOT EXISTS features (
      key        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      icon       TEXT NOT NULL DEFAULT '◈',
      url        TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Seed default feature rows (won't overwrite existing settings)
  await sql`
    INSERT INTO features (key, label, icon, url, enabled) VALUES
      ('health-score',        'Financial Health Score', '🎯', 'premium-01-health-score.html',        TRUE),
      ('market-dashboard',    'Market Dashboard',       '📊', 'premium-02-market-dashboard.html',    TRUE),
      ('education-library',   'Education Library',      '📚', 'premium-03-education-library.html',   TRUE),
      ('scenario-comparison', 'Scenario Comparison',    '↔',  'premium-04-scenario-comparison.html', TRUE),
      ('checklists',          'Financial Checklists',   '✅', 'premium-05-checklists.html',          TRUE),
      ('calendar',            'Financial Calendar',     '📅', 'premium-06-calendar.html',            TRUE),
      ('community',           'Community Q&A',          '💬', 'premium-07-community.html',           TRUE),
      ('newsletter',          'Newsletter',             '📬', 'premium-08-newsletter.html',          TRUE),
      ('advisor-directory',   'Advisor Directory',      '🤝', 'premium-09-advisor-directory.html',   TRUE)
    ON CONFLICT (key) DO NOTHING
  `;
  // Settings table (site lockdown, etc.)
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO settings (key, value) VALUES
      ('sitelock_enabled', 'false'),
      ('sitelock_message', 'This site is temporarily unavailable. Please check back soon.')
    ON CONFLICT (key) DO NOTHING
  `;
  console.log('Database initialized — users + features + settings tables ready');
}

// ── Settings ───────────────────────────────────────────────
export async function getSettings() {
  const sql = getDB();
  const rows = await sql`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function setSetting(key, value) {
  const sql = getDB();
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `;
}

// ── Social OAuth (Google / Apple) ─────────────────────────
export async function upsertUser({ email, name, picture, provider, provider_id }) {
  const sql = getDB();
  const rows = await sql`
    INSERT INTO users (email, name, picture, provider, provider_id, last_login)
    VALUES (${email}, ${name}, ${picture}, ${provider}, ${provider_id}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name        = EXCLUDED.name,
      picture     = EXCLUDED.picture,
      last_login  = NOW()
    RETURNING id, email, name, picture, provider, subscription_status, is_admin, has_book, created_at
  `;
  return rows[0];
}

// ── Email sign-up ──────────────────────────────────────────
export async function createEmailUser({ email, name, password_hash }) {
  const sql = getDB();
  const rows = await sql`
    INSERT INTO users (email, name, provider, provider_id, password_hash)
    VALUES (${email}, ${name}, 'email', ${email}, ${password_hash})
    RETURNING id, email, name, picture, provider, subscription_status, is_admin, has_book, created_at
  `;
  return rows[0];
}

// ── Lookups ────────────────────────────────────────────────
export async function getUserByEmail(email) {
  const sql = getDB();
  const rows = await sql`
    SELECT id, email, name, picture, provider, subscription_status, is_admin, has_book, created_at, password_hash
    FROM users WHERE email = ${email}
  `;
  return rows[0] || null;
}

export async function getUserById(id) {
  const sql = getDB();
  const rows = await sql`
    SELECT id, email, name, picture, provider, subscription_status, is_admin, has_book, created_at
    FROM users WHERE id = ${id}
  `;
  return rows[0] || null;
}

// ── Admin ──────────────────────────────────────────────────
export async function getAllUsers() {
  const sql = getDB();
  return sql`
    SELECT id, email, name, picture, provider, subscription_status, is_admin,
           has_book, stripe_customer_id, created_at, last_login
    FROM users ORDER BY created_at DESC
  `;
}

export async function updateUser(id, { subscription_status, is_admin, has_book }) {
  const sql = getDB();
  // Use separate statements per field to avoid COALESCE type issues with boolean
  // false in the Neon serverless driver (false is treated as null in some contexts).
  let rows;

  if (subscription_status !== undefined) {
    rows = await sql`
      UPDATE users SET subscription_status = ${subscription_status}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, is_admin, has_book
    `;
  }

  if (is_admin !== undefined) {
    rows = await sql`
      UPDATE users SET is_admin = ${is_admin}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, is_admin, has_book
    `;
  }

  if (has_book !== undefined) {
    rows = await sql`
      UPDATE users SET has_book = ${has_book}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, is_admin, has_book
    `;
  }

  if (!rows) return null;
  return rows[0] || null;
}

// ── Stripe ─────────────────────────────────────────────────
// Called by Stripe webhook after successful payment
export async function updateUserStripe(id, updates) {
  const sql = getDB();
  const { stripe_customer_id, has_book, subscription_status } = updates;
  let rows;

  if (stripe_customer_id !== undefined) {
    rows = await sql`
      UPDATE users SET stripe_customer_id = ${stripe_customer_id}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, has_book, stripe_customer_id
    `;
  }

  if (has_book !== undefined) {
    rows = await sql`
      UPDATE users SET has_book = ${has_book}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, has_book, stripe_customer_id
    `;
  }

  if (subscription_status !== undefined) {
    rows = await sql`
      UPDATE users SET subscription_status = ${subscription_status}
      WHERE id = ${id}
      RETURNING id, email, name, subscription_status, has_book, stripe_customer_id
    `;
  }

  if (!rows) return null;
  return rows[0] || null;
}

export async function setAdminByEmail(email) {
  const sql = getDB();
  await sql`UPDATE users SET is_admin = TRUE WHERE email = ${email}`;
}

// ── Tracking ───────────────────────────────────────────────
export async function initTracking() {
  const sql = getDB();
  await sql`
    CREATE TABLE IF NOT EXISTS page_views (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT,
      user_id     INTEGER,
      page        TEXT NOT NULL,
      referrer    TEXT,
      ip          TEXT,
      user_agent  TEXT,
      device      TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS click_events (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT,
      page        TEXT,
      element     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pv_page    ON page_views(page)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pv_session ON page_views(session_id)`;
  console.log('Tracking tables ready');
}

export async function logPageView({ session_id, user_id, page, referrer, ip, user_agent, device }) {
  const sql = getDB();
  await sql`
    INSERT INTO page_views (session_id, user_id, page, referrer, ip, user_agent, device)
    VALUES (${session_id}, ${user_id || null}, ${page}, ${referrer || null}, ${ip}, ${user_agent}, ${device})
  `;
}

export async function logClickEvent({ session_id, page, element }) {
  const sql = getDB();
  await sql`
    INSERT INTO click_events (session_id, page, element)
    VALUES (${session_id}, ${page}, ${element})
  `;
}

export async function getTrackingStats() {
  const sql = getDB();
  const [totals, byPage, byDevice, recent, topClicks, topReferrers] = await Promise.all([
    sql`
      SELECT
        COUNT(*)                                                          AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month,
        COUNT(DISTINCT session_id)                                        AS unique_sessions,
        COUNT(DISTINCT ip)                                                AS unique_ips
      FROM page_views
    `,
    sql`SELECT page, COUNT(*) AS views FROM page_views GROUP BY page ORDER BY views DESC LIMIT 20`,
    sql`SELECT device, COUNT(*) AS count FROM page_views GROUP BY device ORDER BY count DESC`,
    sql`SELECT id, session_id, page, referrer, ip, user_agent, device, created_at FROM page_views ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT element, page, COUNT(*) AS count FROM click_events GROUP BY element, page ORDER BY count DESC LIMIT 20`,
    sql`SELECT referrer, COUNT(*) AS count FROM page_views WHERE referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY count DESC LIMIT 15`,
  ]);
  return { totals: totals[0], byPage, byDevice, recent, topClicks, topReferrers };
}

// ── Features ───────────────────────────────────────────────
export async function getFeatures() {
  const sql = getDB();
  return sql`SELECT key, label, icon, url, enabled FROM features ORDER BY key`;
}

export async function updateFeature(key, enabled) {
  const sql = getDB();
  const rows = await sql`
    UPDATE features SET enabled = ${enabled}, updated_at = NOW()
    WHERE key = ${key}
    RETURNING key, label, icon, url, enabled
  `;
  return rows[0] || null;
}

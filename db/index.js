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
  console.log('Database initialized — users + features tables ready');
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

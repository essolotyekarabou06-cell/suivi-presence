const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const STATUTS = ['Présent', 'Absent', 'Retard', 'Permission', 'Congé', 'Maladie'];
const ROLES = ['agent', 'gestionnaire', 'lecture', 'admin'];
const DEFAULT_LIMIT = '08:00';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- base de données (Postgres Neon) ----------
let _sql;
function q(strings, ...values) {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new HttpError(500, 'Base de données non configurée (DATABASE_URL manquante).');
    _sql = neon(url);
  }
  return _sql(strings, ...values);
}

let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await q`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        service TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'agent',
        active BOOLEAN NOT NULL DEFAULT true,
        salt TEXT NOT NULL,
        pw TEXT NOT NULL
      )`;
      await q`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))`;
      await q`CREATE TABLE IF NOT EXISTS attendance (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        arrive TEXT,
        depart TEXT,
        status TEXT,
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, day)
      )`;
      await q`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
      // Premier démarrage : crée le compte admin à partir des variables d'environnement.
      const c = await q`SELECT COUNT(*)::int AS n FROM users`;
      if (c[0].n === 0 && process.env.ADMIN_PASSWORD) {
        const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD);
        const username = (process.env.ADMIN_USER || 'admin').trim();
        await q`INSERT INTO users (username, name, role, salt, pw)
                VALUES (${username}, 'Administrateur', 'admin', ${salt}, ${hash})
                ON CONFLICT DO NOTHING`;
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// ---------- mots de passe et jetons ----------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}

function checkPassword(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 32);
  const e = Buffer.from(hash, 'hex');
  return e.length === h.length && crypto.timingSafeEqual(h, e);
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'AUTH_SECRET manquant ou trop court (16 caractères minimum).');
  return s;
}

function sign(uid) {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
  const s = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  return p + '.' + s;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const e = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
}

async function authUser(req) {
  const h = req.headers.authorization || '';
  const d = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!d) return null;
  const r = await q`SELECT id, username, name, category, service, role, active FROM users WHERE id = ${d.uid}`;
  return r[0] && r[0].active ? r[0] : null;
}

async function requireUser(req, roles) {
  const u = await authUser(req);
  if (!u) throw new HttpError(401, 'Session expirée. Reconnectez-vous.');
  if (roles && !roles.includes(u.role)) throw new HttpError(403, 'Accès refusé.');
  return u;
}

// ---------- utilitaires ----------
/** Date et heure locales (fuseau APP_TZ, par défaut Africa/Lome). */
function nowParts() {
  const tz = process.env.APP_TZ || 'Africa/Lome';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t).value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

async function getLimit() {
  const r = await q`SELECT value FROM settings WHERE key = 'limit'`;
  return (r[0] && r[0].value) || process.env.LIMIT || DEFAULT_LIMIT;
}

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      throw new HttpError(400, 'Requête invalide.');
    }
  }
  return b;
}

/** Enveloppe commune : CORS, schéma de base, gestion des erreurs. */
function route(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      await ensureSchema();
      const out = await fn(req);
      res.status(200).json(out);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = {
  STATUTS, ROLES, DEFAULT_LIMIT, HttpError,
  q, route, readBody, nowParts, getLimit,
  hashPassword, checkPassword, sign, authUser, requireUser,
};

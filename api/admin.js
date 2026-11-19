const { q, route, readBody, HttpError, hashPassword, requireUser, STATUTS, ROLES } = require('./_lib');

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const nul = (v) => (v === undefined || v === null || v === '' ? null : String(v));

module.exports = route(async (req) => {
  // ---- lecture : liste du personnel et des pointages ----
  if (req.method === 'GET') {
    await requireUser(req, ['gestionnaire', 'lecture', 'admin']);
    if (req.query.q === 'roster') {
      return q`SELECT id, username, name, category, service, role, active FROM users ORDER BY lower(name)`;
    }
    if (req.query.q === 'att') {
      return q`SELECT user_id, day, arrive, depart, status, note FROM attendance ORDER BY day DESC`;
    }
    throw new HttpError(404, 'Route inconnue.');
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');

  const b = readBody(req);

  // ---- correction d'une journée (gestionnaire / admin) ----
  if (b.action === 'set') {
    await requireUser(req, ['gestionnaire', 'admin']);
    const uid = Number(b.user_id);
    const day = String(b.day || '');
    const arrive = nul(b.arrive), depart = nul(b.depart), status = nul(b.status);
    const note = String(b.note == null ? '' : b.note);
    if (!isDay(day)) throw new HttpError(400, 'Date invalide.');
    if ((arrive && !isTime(arrive)) || (depart && !isTime(depart))) throw new HttpError(400, 'Heure invalide.');
    if (status && !STATUTS.includes(status)) throw new HttpError(400, 'Statut invalide.');
    const ex = await q`SELECT id FROM users WHERE id = ${uid}`;
    if (!ex.length) throw new HttpError(404, 'Agent introuvable.');
    await q`INSERT INTO attendance (user_id, day, arrive, depart, status, note)
            VALUES (${uid}, ${day}, ${arrive}, ${depart}, ${status}, ${note})
            ON CONFLICT (user_id, day) DO UPDATE
            SET arrive = EXCLUDED.arrive, depart = EXCLUDED.depart, status = EXCLUDED.status, note = EXCLUDED.note`;
    return { ok: true };
  }

  // ---- gestion des comptes (admin) ----
  if (b.action === 'user_add') {
    await requireUser(req, ['admin']);
    const username = String(b.username || '').trim();
    const name = String(b.name || '').trim();
    const pw = String(b.password || '');
    const role = String(b.role || 'agent');
    const category = String(b.category || '').trim();
    const service = String(b.service || '').trim();
    if (!username || !name) throw new HttpError(400, 'Identifiant et nom complet obligatoires.');
    if (pw.length < 6) throw new HttpError(400, 'Mot de passe : 6 caractères minimum.');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle invalide.');
    const dup = await q`SELECT 1 FROM users WHERE lower(username) = lower(${username})`;
    if (dup.length) throw new HttpError(400, 'Cet identifiant existe déjà.');
    const { salt, hash } = hashPassword(pw);
    await q`INSERT INTO users (username, name, category, service, role, salt, pw)
            VALUES (${username}, ${name}, ${category}, ${service}, ${role}, ${salt}, ${hash})`;
    return { ok: true };
  }

  if (b.action === 'user_update') {
    const me = await requireUser(req, ['admin']);
    const id = Number(b.id);
    const r = await q`SELECT id, role FROM users WHERE id = ${id}`;
    if (!r.length) throw new HttpError(404, 'Compte introuvable.');
    const self = id === me.id;
    if ('role' in b) {
      if (!ROLES.includes(b.role)) throw new HttpError(400, 'Rôle invalide.');
      if (self && b.role !== r[0].role) throw new HttpError(400, 'Vous ne pouvez pas modifier votre propre rôle.');
      await q`UPDATE users SET role = ${b.role} WHERE id = ${id}`;
    }
    if ('active' in b) {
      if (self && b.active !== true) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte.');
      await q`UPDATE users SET active = ${b.active === true} WHERE id = ${id}`;
    }
    if ('name' in b) {
      const n = String(b.name).trim();
      if (!n) throw new HttpError(400, 'Le nom est obligatoire.');
      await q`UPDATE users SET name = ${n} WHERE id = ${id}`;
    }
    if ('category' in b) await q`UPDATE users SET category = ${String(b.category).trim()} WHERE id = ${id}`;
    if ('service' in b) await q`UPDATE users SET service = ${String(b.service).trim()} WHERE id = ${id}`;
    if ('password' in b) {
      const pw = String(b.password);
      if (pw.length < 6) throw new HttpError(400, 'Mot de passe : 6 caractères minimum.');
      const { salt, hash } = hashPassword(pw);
      await q`UPDATE users SET salt = ${salt}, pw = ${hash} WHERE id = ${id}`;
    }
    return { ok: true };
  }

  // ---- heure limite d'arrivée (admin) ----
  if (b.action === 'set_limit') {
    await requireUser(req, ['admin']);
    const v = String(b.value || '');
    if (!isTime(v)) throw new HttpError(400, 'Heure invalide.');
    await q`INSERT INTO settings (key, value) VALUES ('limit', ${v})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    return { ok: true };
  }

  throw new HttpError(400, 'Action inconnue.');
});

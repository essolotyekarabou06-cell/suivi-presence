const { q, route, readBody, HttpError, checkPassword, sign, authUser } = require('./_lib');

module.exports = route(async (req) => {
  const a = req.query.a;

  if (a === 'login') {
    if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
    const b = readBody(req);
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const r = await q`SELECT id, salt, pw, active FROM users WHERE lower(username) = lower(${username})`;
    const u = r[0];
    if (!u || !checkPassword(password, u.salt, u.pw)) throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    if (!u.active) throw new HttpError(403, 'Compte désactivé.');
    return { token: sign(u.id) };
  }

  if (a === 'me') {
    const u = await authUser(req);
    return { user: u };
  }

  throw new HttpError(404, 'Route inconnue.');
});

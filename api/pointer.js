const { q, route, readBody, HttpError, nowParts, getLimit, requireUser } = require('./_lib');

// Pointage de l'utilisateur connecté : GET = état du jour + historique du mois,
// POST {action: 'arrive' | 'depart'} = enregistre l'arrivée ou le départ (heure du serveur).
module.exports = route(async (req) => {
  const u = await requireUser(req);
  const { day, time } = nowParts();
  const limit = await getLimit();

  if (req.method === 'POST') {
    const action = readBody(req).action;
    const r = await q`SELECT arrive, depart FROM attendance WHERE user_id = ${u.id} AND day = ${day}`;
    const row = r[0];
    if (action === 'arrive') {
      if (row && row.arrive) throw new HttpError(400, 'Arrivée déjà enregistrée.');
      const status = time > limit ? 'Retard' : 'Présent';
      await q`INSERT INTO attendance (user_id, day, arrive, status)
              VALUES (${u.id}, ${day}, ${time}, ${status})
              ON CONFLICT (user_id, day) DO UPDATE SET arrive = ${time}, status = ${status}`;
    } else if (action === 'depart') {
      if (!row || !row.arrive) throw new HttpError(400, 'Enregistrez d’abord votre arrivée.');
      if (row.depart) throw new HttpError(400, 'Départ déjà enregistré.');
      await q`UPDATE attendance SET depart = ${time} WHERE user_id = ${u.id} AND day = ${day}`;
    } else {
      throw new HttpError(400, 'Action inconnue.');
    }
  } else if (req.method !== 'GET') {
    throw new HttpError(405, 'Méthode non autorisée.');
  }

  const rows = await q`SELECT user_id, day, arrive, depart, status, note
                       FROM attendance
                       WHERE user_id = ${u.id} AND day LIKE ${day.slice(0, 7) + '%'}
                       ORDER BY day DESC`;
  return { today: day, time, limit, rows };
});

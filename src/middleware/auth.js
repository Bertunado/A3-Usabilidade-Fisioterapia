const { db } = require('../db');
const { toUser } = require('../mappers');

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
  }

  const row = db.prepare(`
    SELECT u.*, s.expires_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);

  if (!row || row.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
  }

  req.user = toUser(row);
  req.token = token;
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      const who = role === 'teacher' ? 'professores' : 'estudantes';
      return res.status(403).json({ message: `Apenas ${who} podem realizar esta ação.` });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };

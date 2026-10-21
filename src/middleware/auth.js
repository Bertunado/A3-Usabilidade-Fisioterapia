const { db } = require('../db');
const { toUser } = require('../mappers');
const { handle } = require('../http');

const requireAuth = handle(async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
  }

  const row = await db.get(`
    SELECT u.*, s.expires_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `, [token]);

  if (!row || row.expires_at < new Date().toISOString() || !row.active) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    const message = row && !row.active
      ? 'Seu acesso foi desativado. Procure a coordenação do curso.'
      : 'Sessão expirada. Faça login novamente.';
    return res.status(401).json({ message });
  }

  req.user = toUser(row);
  req.token = token;
  return next();
});

const ROLE_NAMES = { student: 'estudantes', teacher: 'professores', admin: 'administradores' };

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      const who = roles.map(r => ROLE_NAMES[r]).join(' e ');
      return res.status(403).json({ message: `Apenas ${who} podem realizar esta ação.` });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };

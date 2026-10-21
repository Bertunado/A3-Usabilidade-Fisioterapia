const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { toUser } = require('../mappers');
const { requireAuth } = require('../middleware/auth');
const { normalizeMatricula, validatePassword } = require('../../assets/js/shared');

const router = express.Router();

const SESSION_DAYS = 7;

// Bloqueio simples contra tentativas repetidas de senha (por IP + matrícula)
const MAX_ATTEMPTS = 8;
const BLOCK_MINUTES = 15;
const failedLogins = new Map();

function isBlocked(key) {
  const entry = failedLogins.get(key);
  return Boolean(entry && entry.until > Date.now());
}

function registerFailure(key) {
  const entry = failedLogins.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.count = 0;
    entry.until = Date.now() + BLOCK_MINUTES * 60 * 1000;
  }
  failedLogins.set(key, entry);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now.toISOString(), expires.toISOString());

  return token;
}

router.post('/login', (req, res) => {
  const { password, role } = req.body;
  const matricula = normalizeMatricula(req.body.matricula);

  if (!matricula || !password) {
    return res.status(400).json({ message: 'Informe a matrícula e a senha.' });
  }

  const attemptKey = `${req.ip}|${matricula}`;
  if (isBlocked(attemptKey)) {
    return res.status(429).json({ message: `Muitas tentativas de login. Aguarde ${BLOCK_MINUTES} minutos e tente novamente.` });
  }

  const user = db.prepare('SELECT * FROM users WHERE matricula = ?').get(matricula);

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    registerFailure(attemptKey);
    return res.status(401).json({ message: 'Matrícula ou senha incorretas.' });
  }

  failedLogins.delete(attemptKey);

  if (!user.active) {
    return res.status(403).json({ message: 'Seu acesso está desativado. Procure a coordenação do curso.' });
  }

  // O administrador entra por qualquer uma das abas de perfil
  if (role && user.role !== role && user.role !== 'admin') {
    const profile = user.role === 'teacher' ? 'Professor' : 'Estudante';
    return res.status(403).json({ message: `Esta matrícula pertence ao perfil ${profile}. Selecione o perfil correto acima.` });
  }

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);

  return res.json({
    message: 'Login realizado com sucesso.',
    token: createSession(user.id),
    user: toUser(user)
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    return res.status(400).json({ message: 'A senha atual está incorreta.', field: 'currentPassword' });
  }

  const result = validatePassword(req.body.newPassword);
  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: 'newPassword' });
  }

  if (result.value === String(currentPassword)) {
    return res.status(400).json({ message: 'A nova senha precisa ser diferente da atual.', field: 'newPassword' });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(bcrypt.hashSync(result.value, 10), user.id);
    // Encerra as sessões em outros dispositivos; mantém a atual
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, req.token);
  })();

  return res.json({
    message: 'Senha alterada com sucesso.',
    user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id))
  });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  return res.json({ message: 'Sessão encerrada.' });
});

// Cadastro e redefinição de senha agora são feitos pelo administrador
router.use((req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));

module.exports = router;

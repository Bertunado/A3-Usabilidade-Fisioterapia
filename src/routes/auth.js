const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { toUser } = require('../mappers');
const { requireAuth } = require('../middleware/auth');
const { normalizeMatricula, validateRegistration } = require('../../assets/js/shared');

const router = express.Router();

const SESSION_DAYS = 7;

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

  const user = db.prepare('SELECT * FROM users WHERE matricula = ?').get(matricula);

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ message: 'Matrícula ou senha incorretas.' });
  }

  if (role && user.role !== role) {
    const profile = user.role === 'teacher' ? 'Professor' : 'Estudante';
    return res.status(403).json({ message: `Esta matrícula pertence ao perfil ${profile}. Selecione o perfil correto acima.` });
  }

  return res.json({
    message: 'Login realizado com sucesso.',
    token: createSession(user.id),
    user: toUser(user)
  });
});

router.post('/register', (req, res) => {
  const result = validateRegistration(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { name, role, matricula, email, password } = result.value;

  if (db.prepare('SELECT id FROM users WHERE matricula = ?').get(matricula)) {
    return res.status(409).json({ message: 'Já existe um usuário com essa matrícula.', field: 'matricula' });
  }

  const info = db.prepare(`
    INSERT INTO users (name, email, role, matricula, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, email, role, matricula, bcrypt.hashSync(password, 10), new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  return res.status(201).json({
    message: 'Conta criada com sucesso.',
    token: createSession(user.id),
    user: toUser(user)
  });
});

router.post('/reset-password', (req, res) => {
  const matricula = normalizeMatricula(req.body.matricula);
  const email = String(req.body.email || '').trim().toLowerCase();
  const newPassword = String(req.body.newPassword || '');

  if (!matricula || !email) {
    return res.status(400).json({ message: 'Informe a matrícula e o e-mail cadastrado.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres.', field: 'password' });
  }

  const user = db.prepare('SELECT * FROM users WHERE matricula = ? AND lower(email) = ?').get(matricula, email);

  if (!user) {
    return res.status(400).json({ message: 'Matrícula e e-mail não conferem com nenhum cadastro.' });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  })();

  return res.json({ message: 'Senha redefinida. Faça login com a nova senha.' });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  return res.json({ message: 'Sessão encerrada.' });
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { toAdminUser } = require('../mappers');
const { requireRole } = require('../middleware/auth');
const { validateRegistration, validateUserUpdate, validatePassword } = require('../../assets/js/shared');

const router = express.Router();

router.use(requireRole('admin'));

const USER_SELECT = `
  SELECT u.*,
    (SELECT COUNT(*) FROM evolutions e WHERE e.student_id = u.id) AS evolution_count,
    (SELECT COUNT(*) FROM evolutions e WHERE e.reviewer_id = u.id) AS review_count
  FROM users u
`;

// O painel gerencia apenas estudantes e professores (a conta admin não aparece na lista)
function findManagedUser(id) {
  return toAdminUser(db.prepare(`${USER_SELECT} WHERE u.id = ? AND u.role != 'admin'`).get(id));
}

function matriculaTaken(matricula, exceptId = 0) {
  return Boolean(db.prepare('SELECT id FROM users WHERE matricula = ? AND id != ?').get(matricula, exceptId));
}

router.get('/users', (req, res) => {
  const rows = db.prepare(`${USER_SELECT} WHERE u.role != 'admin' ORDER BY u.name COLLATE NOCASE ASC`).all();
  return res.json(rows.map(toAdminUser));
});

router.post('/users', (req, res) => {
  const result = validateRegistration(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { name, role, matricula, email, password } = result.value;

  if (matriculaTaken(matricula)) {
    return res.status(409).json({ message: 'Já existe um usuário com essa matrícula.', field: 'matricula' });
  }

  // A senha definida pelo admin é provisória: o usuário troca no primeiro acesso
  const info = db.prepare(`
    INSERT INTO users (name, email, role, matricula, password_hash, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(name, email, role, matricula, bcrypt.hashSync(password, 10), new Date().toISOString());

  return res.status(201).json({ message: 'Usuário cadastrado.', user: findManagedUser(info.lastInsertRowid) });
});

router.put('/users/:id', (req, res) => {
  const id = Number(req.params.id);

  if (!findManagedUser(id)) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const result = validateUserUpdate(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { name, role, matricula, email } = result.value;

  if (matriculaTaken(matricula, id)) {
    return res.status(409).json({ message: 'Já existe outro usuário com essa matrícula.', field: 'matricula' });
  }

  db.prepare('UPDATE users SET name = ?, role = ?, matricula = ?, email = ? WHERE id = ?')
    .run(name, role, matricula, email, id);

  return res.json({ message: 'Cadastro atualizado.', user: findManagedUser(id) });
});

router.post('/users/:id/password', (req, res) => {
  const id = Number(req.params.id);

  if (!findManagedUser(id)) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const result = validatePassword(req.body.password);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: 'password' });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(result.value, 10), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  })();

  return res.json({ message: 'Senha provisória definida.', user: findManagedUser(id) });
});

router.patch('/users/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body.active);

  if (!findManagedUser(id)) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  })();

  return res.json({ message: active ? 'Acesso reativado.' : 'Acesso desativado.', user: findManagedUser(id) });
});

module.exports = router;

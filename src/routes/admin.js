const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { toAdminUser } = require('../mappers');
const { handle } = require('../http');
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
async function findManagedUser(id) {
  return toAdminUser(await db.get(`${USER_SELECT} WHERE u.id = ? AND u.role != 'admin'`, [id]));
}

async function matriculaTaken(matricula, exceptId = 0) {
  return Boolean(await db.get('SELECT id FROM users WHERE matricula = ? AND id != ?', [matricula, exceptId]));
}

router.get('/users', handle(async (req, res) => {
  const rows = await db.all(`${USER_SELECT} WHERE u.role != 'admin' ORDER BY u.name COLLATE NOCASE ASC`);
  return res.json(rows.map(toAdminUser));
}));

router.post('/users', handle(async (req, res) => {
  const result = validateRegistration(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { name, role, matricula, email, password } = result.value;

  if (await matriculaTaken(matricula)) {
    return res.status(409).json({ message: 'Já existe um usuário com essa matrícula.', field: 'matricula' });
  }

  // A senha definida pelo admin é provisória: o usuário troca no primeiro acesso
  const info = await db.run(`
    INSERT INTO users (name, email, role, matricula, password_hash, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `, [name, email, role, matricula, await bcrypt.hash(password, 10), new Date().toISOString()]);

  return res.status(201).json({ message: 'Usuário cadastrado.', user: await findManagedUser(info.lastInsertRowid) });
}));

router.put('/users/:id', handle(async (req, res) => {
  const id = Number(req.params.id);

  if (!(await findManagedUser(id))) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const result = validateUserUpdate(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { name, role, matricula, email } = result.value;

  if (await matriculaTaken(matricula, id)) {
    return res.status(409).json({ message: 'Já existe outro usuário com essa matrícula.', field: 'matricula' });
  }

  await db.run('UPDATE users SET name = ?, role = ?, matricula = ?, email = ? WHERE id = ?',
    [name, role, matricula, email, id]);

  return res.json({ message: 'Cadastro atualizado.', user: await findManagedUser(id) });
}));

router.post('/users/:id/password', handle(async (req, res) => {
  const id = Number(req.params.id);

  if (!(await findManagedUser(id))) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const result = validatePassword(req.body.password);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: 'password' });
  }

  await db.batch([
    ['UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [await bcrypt.hash(result.value, 10), id]],
    ['DELETE FROM sessions WHERE user_id = ?', [id]]
  ]);

  return res.json({ message: 'Senha provisória definida.', user: await findManagedUser(id) });
}));

router.patch('/users/:id/status', handle(async (req, res) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body.active);

  if (!(await findManagedUser(id))) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const statements = [['UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, id]]];
  if (!active) statements.push(['DELETE FROM sessions WHERE user_id = ?', [id]]);
  await db.batch(statements);

  return res.json({ message: active ? 'Acesso reativado.' : 'Acesso desativado.', user: await findManagedUser(id) });
}));

module.exports = router;

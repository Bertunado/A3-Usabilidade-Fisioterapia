const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const router = express.Router();

router.post('/login', (req, res) => {
  const { matricula, password, role } = req.body;

  if (!matricula || !password) {
    return res.status(400).json({ message: 'Matrícula e senha são obrigatórias.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE matricula = ? AND role = ?')
    .get(matricula, role || 'student');

  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  const passwordMatches = bcrypt.compareSync(password, user.password_hash);

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Senha incorreta.' });
  }

  return res.json({
    message: 'Login realizado com sucesso.',
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      matricula: user.matricula,
      email: user.email
    }
  });
});

router.post('/register', (req, res) => {
  const { name, role, matricula, email, password } = req.body;

  if (!name || !role || !matricula || !password) {
    return res.status(400).json({ message: 'Nome, perfil, matrícula e senha são obrigatórios.' });
  }

  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ message: 'Perfil inválido. Use student ou teacher.' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE matricula = ?').get(matricula);

  if (exists) {
    return res.status(409).json({ message: 'Usuário com essa matrícula já existe.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (name, email, role, matricula, password_hash)
    VALUES (@name, @email, @role, @matricula, @password_hash)
  `).run({
    name,
    email: email || null,
    role,
    matricula,
    password_hash: passwordHash
  });

  return res.status(201).json({
    message: 'Usuário cadastrado com sucesso.',
    user: {
      id: result.lastInsertRowid,
      name,
      role,
      matricula,
      email: email || null
    }
  });
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, matricula FROM users ORDER BY name ASC').all();
  return res.json(users);
});

module.exports = router;

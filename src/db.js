const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'physioedu.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
      matricula TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cpf TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL,
      time TEXT NOT NULL,
      specialty TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      history TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      eva INTEGER,
      subjective TEXT,
      objective TEXT,
      conduct TEXT,
      plan TEXT,
      teacher_approval TEXT DEFAULT 'Pendente de Validação',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
  `);

  const seedUsers = [
    {
      name: 'Lucas Andrade',
      email: 'lucas@physioedu.com',
      role: 'student',
      matricula: '202301982',
      password: '123456'
    },
    {
      name: 'Profª. Dra. Helena',
      email: 'helena@physioedu.com',
      role: 'teacher',
      matricula: 'DOC-88392',
      password: '123456'
    }
  ];

  const existingUsers = db.prepare('SELECT matricula FROM users').all();
  const existingMatriculas = new Set(existingUsers.map(u => u.matricula));

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, role, matricula, password_hash)
    VALUES (@name, @email, @role, @matricula, @password_hash)
  `);

  for (const user of seedUsers) {
    if (!existingMatriculas.has(user.matricula)) {
      insertUser.run({
        name: user.name,
        email: user.email,
        role: user.role,
        matricula: user.matricula,
        password_hash: bcrypt.hashSync(user.password, 10)
      });
    }
  }
}

module.exports = { db, initDatabase };

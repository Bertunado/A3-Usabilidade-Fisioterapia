const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { buildSeed, ADMIN_ACCOUNT } = require('../assets/js/shared');

const SCHEMA_VERSION = 3;

// Hash bcrypt da senha padrão do administrador (a senha em si não fica no código).
// Para usar outra senha na criação do admin, defina a variável ADMIN_PASSWORD.
const ADMIN_PASSWORD_HASH = '$2a$10$HEoO4OSsPOKvaV58Mi1s7uWunOJohaBlwNpjtLRpT3Tr4fWrA0.c2';

// Pacientes, agendamentos e contas de exemplo. Em produção use DEMO_DATA=false.
const DEMO_DATA = process.env.DEMO_DATA !== 'false';

const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dbDir, 'physioedu.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function usersTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'admin')),
      matricula TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );
  `;
}

function createSchema() {
  db.exec(`
    ${usersTableSql('users')}

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cpf TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL,
      diagnosis TEXT NOT NULL DEFAULT '',
      history TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'attending', 'completed', 'absent')),
      student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date, time);

    CREATE TABLE IF NOT EXISTS evolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER UNIQUE NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      student_name TEXT NOT NULL,
      eva INTEGER NOT NULL,
      subjective TEXT NOT NULL,
      pa TEXT NOT NULL DEFAULT '',
      fc TEXT NOT NULL DEFAULT '',
      spo2 TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '',
      procedures TEXT NOT NULL DEFAULT '[]',
      conduct TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'correction')),
      feedback TEXT NOT NULL DEFAULT '',
      reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewer_name TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evolutions_status ON evolutions(status);
  `);
}

function migrate() {
  const version = db.pragma('user_version', { simple: true });
  if (version >= SCHEMA_VERSION) return;

  if (version < 2) {
    // A versão 1 (protótipo) tinha outro formato de tabelas e nenhum dado real:
    // recriamos o banco do zero no formato novo.
    db.exec(`
      DROP TABLE IF EXISTS evolutions;
      DROP TABLE IF EXISTS appointments;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS patients;
      DROP TABLE IF EXISTS users;
    `);
    createSchema();
  } else {
    // 2 -> 3: perfil admin e controle de acesso. O SQLite não altera CHECK de uma
    // coluna, então a tabela de usuários é recriada preservando todos os dados.
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        ${usersTableSql('users_v3')}
        INSERT INTO users_v3 (id, name, email, role, matricula, password_hash, created_at)
          SELECT id, name, email, role, matricula, password_hash, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_v3 RENAME TO users;
      `);
    })();
    db.pragma('foreign_keys = ON');
    console.log('Banco de dados atualizado para a versão 3 (painel administrativo).');
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function ensureAdmin() {
  if (db.prepare("SELECT id FROM users WHERE role = 'admin'").get()) return;

  const passwordHash = process.env.ADMIN_PASSWORD
    ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
    : ADMIN_PASSWORD_HASH;

  db.prepare(`
    INSERT INTO users (name, email, role, matricula, password_hash, created_at)
    VALUES (@name, @email, @role, @matricula, @passwordHash, @createdAt)
  `).run({ ...ADMIN_ACCOUNT, passwordHash, createdAt: new Date().toISOString() });

  console.log(`Conta de administrador criada (login: ${ADMIN_ACCOUNT.matricula.toLowerCase()}).`);
}

function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0 || !DEMO_DATA) return;

  const data = buildSeed();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, role, matricula, password_hash, created_at)
    VALUES (@id, @name, @email, @role, @matricula, @password_hash, @createdAt)
  `);
  const insertPatient = db.prepare(`
    INSERT INTO patients (id, name, cpf, age, phone, specialty, diagnosis, history, created_by, created_at, updated_at)
    VALUES (@id, @name, @cpf, @age, @phone, @specialty, @diagnosis, @history, @createdBy, @createdAt, @updatedAt)
  `);
  const insertAppointment = db.prepare(`
    INSERT INTO appointments (id, patient_id, date, time, status, student_id, created_at, updated_at)
    VALUES (@id, @patientId, @date, @time, @status, @studentId, @createdAt, @updatedAt)
  `);
  const insertEvolution = db.prepare(`
    INSERT INTO evolutions (
      id, appointment_id, patient_id, student_id, student_name, eva, subjective, pa, fc, spo2,
      objective, procedures, conduct, plan, status, feedback, reviewer_id, reviewer_name,
      reviewed_at, revision, created_at, updated_at
    ) VALUES (
      @id, @appointmentId, @patientId, @studentId, @studentName, @eva, @subjective, @pa, @fc, @spo2,
      @objective, @procedures, @conduct, @plan, @status, @feedback, @reviewerId, @reviewerName,
      @reviewedAt, @revision, @createdAt, @updatedAt
    )
  `);

  db.transaction(() => {
    for (const user of data.users) {
      insertUser.run({ ...user, password_hash: bcrypt.hashSync(user.password, 10) });
    }
    data.patients.forEach(p => insertPatient.run(p));
    data.appointments.forEach(a => insertAppointment.run(a));
    data.evolutions.forEach(e => insertEvolution.run({ ...e, procedures: JSON.stringify(e.procedures) }));
  })();

  console.log('Banco de dados populado com os dados de demonstração.');
}

function initDatabase() {
  migrate();
  createSchema();
  seed();
  ensureAdmin();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

module.exports = { db, initDatabase };

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const { buildSeed, ADMIN_ACCOUNT } = require('../assets/js/shared');

const SCHEMA_VERSION = 3;

// Hash bcrypt da senha padrão do administrador (a senha em si não fica no código).
// Para usar outra senha na criação do admin, defina a variável ADMIN_PASSWORD.
const ADMIN_PASSWORD_HASH = '$2a$10$HEoO4OSsPOKvaV58Mi1s7uWunOJohaBlwNpjtLRpT3Tr4fWrA0.c2';

// Pacientes, agendamentos e contas de exemplo. Em produção use DEMO_DATA=false.
const DEMO_DATA = process.env.DEMO_DATA !== 'false';

// Produção: banco Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
// Desenvolvimento: arquivo SQLite local em database/physioedu.db (ou DB_PATH).
function databaseUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const file = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'database', 'physioedu.db'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return pathToFileURL(file).href;
}

const DATABASE_URL = databaseUrl();
const isLocalFile = DATABASE_URL.startsWith('file:');
const client = createClient({ url: DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// ---------- acesso ao banco ----------

function normalize(value) {
  return value === undefined ? null : value;
}

// Parâmetros posicionais (array) ou nomeados (objeto com @nome no SQL).
// Nos nomeados, envia apenas os que aparecem no SQL.
function bind(sql, args) {
  if (Array.isArray(args)) return args.map(normalize);
  const out = {};
  for (const [, name] of sql.matchAll(/@([A-Za-z_]\w*)/g)) out[name] = normalize(args[name]);
  return out;
}

function statement(sql, args = []) {
  return { sql, args: bind(sql, args) };
}

function runResult(result) {
  return {
    changes: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid)
  };
}

const db = {
  async get(sql, args) {
    const result = await client.execute(statement(sql, args));
    return result.rows[0] || null;
  },

  async all(sql, args) {
    return (await client.execute(statement(sql, args))).rows;
  },

  async run(sql, args) {
    return runResult(await client.execute(statement(sql, args)));
  },

  // Várias escritas atômicas (tudo ou nada) numa única ida ao banco
  async batch(statements) {
    const results = await client.batch(statements.map(([sql, args]) => statement(sql, args)), 'write');
    return results.map(runResult);
  },

  exec(sql) {
    return client.executeMultiple(sql);
  }
};

// ---------- esquema ----------

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
    )
  `;
}

function createSchema() {
  return db.exec(`
    ${usersTableSql('users')};

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

// A versão do esquema fica na tabela app_meta. Bancos criados pela versão
// anterior do servidor guardavam a versão em PRAGMA user_version.
async function schemaVersion() {
  await db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = await db.get("SELECT value FROM app_meta WHERE key = 'schema_version'");
  if (row) return Number(row.value);
  try {
    const legacy = await db.get('PRAGMA user_version');
    return Number(legacy && legacy.user_version) || 0;
  } catch (err) {
    return 0;
  }
}

async function migrate() {
  const version = await schemaVersion();
  if (version >= SCHEMA_VERSION) return;

  if (version < 2) {
    // A versão 1 (protótipo) tinha outro formato de tabelas e nenhum dado real:
    // recriamos o banco do zero no formato novo.
    await db.exec(`
      DROP TABLE IF EXISTS evolutions;
      DROP TABLE IF EXISTS appointments;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS patients;
      DROP TABLE IF EXISTS users;
    `);
    await createSchema();
  } else {
    // 2 -> 3: perfil admin e controle de acesso. O SQLite não altera CHECK de uma
    // coluna, então a tabela de usuários é recriada preservando todos os dados.
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.batch([
      [usersTableSql('users_v3')],
      [`INSERT INTO users_v3 (id, name, email, role, matricula, password_hash, created_at)
        SELECT id, name, email, role, matricula, password_hash, created_at FROM users`],
      ['DROP TABLE users'],
      ['ALTER TABLE users_v3 RENAME TO users']
    ]);
    await db.exec('PRAGMA foreign_keys = ON');
    console.log('Banco de dados atualizado para a versão 3 (painel administrativo).');
  }

  await db.run(
    "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(SCHEMA_VERSION)]
  );
}

async function ensureAdmin() {
  if (await db.get("SELECT id FROM users WHERE role = 'admin'")) return;

  const passwordHash = process.env.ADMIN_PASSWORD
    ? await bcrypt.hash(process.env.ADMIN_PASSWORD, 10)
    : ADMIN_PASSWORD_HASH;

  await db.run(`
    INSERT INTO users (name, email, role, matricula, password_hash, created_at)
    VALUES (@name, @email, @role, @matricula, @passwordHash, @createdAt)
  `, { ...ADMIN_ACCOUNT, passwordHash, createdAt: new Date().toISOString() });

  console.log(`Conta de administrador criada (login: ${ADMIN_ACCOUNT.matricula.toLowerCase()}).`);
}

async function seed() {
  const { count } = await db.get('SELECT COUNT(*) AS count FROM users');
  if (count > 0 || !DEMO_DATA) return;

  const data = buildSeed();
  const statements = [];

  for (const user of data.users) {
    statements.push([`
      INSERT INTO users (id, name, email, role, matricula, password_hash, created_at)
      VALUES (@id, @name, @email, @role, @matricula, @passwordHash, @createdAt)
    `, { ...user, passwordHash: await bcrypt.hash(user.password, 10) }]);
  }

  data.patients.forEach(p => statements.push([`
    INSERT INTO patients (id, name, cpf, age, phone, specialty, diagnosis, history, created_by, created_at, updated_at)
    VALUES (@id, @name, @cpf, @age, @phone, @specialty, @diagnosis, @history, @createdBy, @createdAt, @updatedAt)
  `, p]));

  data.appointments.forEach(a => statements.push([`
    INSERT INTO appointments (id, patient_id, date, time, status, student_id, created_at, updated_at)
    VALUES (@id, @patientId, @date, @time, @status, @studentId, @createdAt, @updatedAt)
  `, a]));

  data.evolutions.forEach(e => statements.push([`
    INSERT INTO evolutions (
      id, appointment_id, patient_id, student_id, student_name, eva, subjective, pa, fc, spo2,
      objective, procedures, conduct, plan, status, feedback, reviewer_id, reviewer_name,
      reviewed_at, revision, created_at, updated_at
    ) VALUES (
      @id, @appointmentId, @patientId, @studentId, @studentName, @eva, @subjective, @pa, @fc, @spo2,
      @objective, @procedures, @conduct, @plan, @status, @feedback, @reviewerId, @reviewerName,
      @reviewedAt, @revision, @createdAt, @updatedAt
    )
  `, { ...e, procedures: JSON.stringify(e.procedures) }]));

  await db.batch(statements);
  console.log('Banco de dados populado com os dados de demonstração.');
}

async function initDatabase() {
  console.log(`Banco de dados: ${isLocalFile ? 'arquivo local' : 'Turso (remoto)'}`);
  await migrate();
  await createSchema();
  await seed();
  await ensureAdmin();
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
}

module.exports = { db, initDatabase };

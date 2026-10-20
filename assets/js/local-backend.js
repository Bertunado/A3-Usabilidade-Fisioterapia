/*
 * "Servidor" que roda dentro do navegador quando não há backend Node disponível
 * (ex.: site publicado no GitHub Pages). Implementa as mesmas rotas da API
 * (src/routes/*.js) e grava os dados no localStorage deste navegador.
 */
(function () {
  const S = window.PhysioShared;
  const STORAGE_KEY = 'physioedu_db_v2';
  const SCHEMA_VERSION = 2;
  const SESSION_DAYS = 7;

  class HttpError extends Error {
    constructor(status, message, field) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }

  let db = null;
  let storageAvailable = true;

  // ---------- persistência ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (err) {
      storageAvailable = false;
    }
  }

  function save() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (err) {
      storageAvailable = false;
      console.warn('localStorage indisponível: os dados ficarão apenas nesta aba.', err);
    }
  }

  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    if (window.crypto && crypto.subtle) {
      const buffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
    }
    // Contextos sem crypto.subtle (http em IP de rede local): hash simples FNV-1a
    let h = 2166136261;
    for (const byte of data) {
      h ^= byte;
      h = Math.imul(h, 16777619);
    }
    return `fnv${(h >>> 0).toString(16)}`;
  }

  function randomToken(bytes = 24) {
    const arr = new Uint8Array(bytes);
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function seed() {
    const data = S.buildSeed();
    const users = [];

    for (const { password, ...user } of data.users) {
      const salt = randomToken(8);
      users.push({ ...user, salt, passwordHash: await hashPassword(password, salt) });
    }

    const maxId = list => list.reduce((max, r) => Math.max(max, r.id), 0);

    db = {
      version: SCHEMA_VERSION,
      seq: {
        users: maxId(users),
        patients: maxId(data.patients),
        appointments: maxId(data.appointments),
        evolutions: maxId(data.evolutions)
      },
      users,
      sessions: [],
      patients: data.patients,
      appointments: data.appointments,
      evolutions: data.evolutions
    };
    save();
  }

  async function ensureDb() {
    // Recarrega a cada requisição para enxergar alterações feitas em outras abas
    load();
    if (!db || db.version !== SCHEMA_VERSION) await seed();
  }

  // ---------- helpers ----------

  const nowISO = () => new Date().toISOString();
  const nextId = table => ++db.seq[table];
  const byId = (table, id) => db[table].find(r => r.id === Number(id));
  const clone = value => JSON.parse(JSON.stringify(value));
  const sortAppointments = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);

  function publicUser(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role, matricula: u.matricula };
  }

  function patientSummary(p) {
    return { id: p.id, name: p.name, cpf: p.cpf, age: p.age, specialty: p.specialty, diagnosis: p.diagnosis };
  }

  function userName(id) {
    const user = id ? byId('users', id) : null;
    return user ? user.name : '';
  }

  function check(result) {
    if (!result.ok) throw new HttpError(400, result.message, result.field);
    return result.value;
  }

  function requireRole(user, role) {
    if (user.role !== role) {
      const who = role === 'teacher' ? 'professores' : 'estudantes';
      throw new HttpError(403, `Apenas ${who} podem realizar esta ação.`);
    }
  }

  function authenticate(token) {
    const session = token ? db.sessions.find(s => s.token === token) : null;
    const user = session ? byId('users', session.userId) : null;

    if (!session || !user || session.expiresAt < nowISO()) {
      if (session) {
        db.sessions = db.sessions.filter(s => s !== session);
        save();
      }
      throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
    }

    return user;
  }

  function createSession(userId) {
    const token = randomToken();
    const now = new Date();
    db.sessions = db.sessions.filter(s => s.expiresAt >= now.toISOString());
    db.sessions.push({
      token,
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 864e5).toISOString()
    });
    return token;
  }

  // ---------- auth ----------

  async function login({ body }) {
    const matricula = S.normalizeMatricula(body.matricula);
    const password = String(body.password || '');

    if (!matricula || !password) throw new HttpError(400, 'Informe a matrícula e a senha.');

    const user = db.users.find(u => u.matricula === matricula);
    if (!user || (await hashPassword(password, user.salt)) !== user.passwordHash) {
      throw new HttpError(401, 'Matrícula ou senha incorretas.');
    }

    if (body.role && user.role !== body.role) {
      const profile = user.role === 'teacher' ? 'Professor' : 'Estudante';
      throw new HttpError(403, `Esta matrícula pertence ao perfil ${profile}. Selecione o perfil correto acima.`);
    }

    const token = createSession(user.id);
    save();
    return { message: 'Login realizado com sucesso.', token, user: publicUser(user) };
  }

  async function register({ body }) {
    const data = check(S.validateRegistration(body));

    if (db.users.some(u => u.matricula === data.matricula)) {
      throw new HttpError(409, 'Já existe um usuário com essa matrícula.', 'matricula');
    }

    const salt = randomToken(8);
    const user = {
      id: nextId('users'),
      name: data.name,
      email: data.email,
      role: data.role,
      matricula: data.matricula,
      salt,
      passwordHash: await hashPassword(data.password, salt),
      createdAt: nowISO()
    };
    db.users.push(user);
    const token = createSession(user.id);
    save();
    return { message: 'Conta criada com sucesso.', token, user: publicUser(user) };
  }

  async function resetPassword({ body }) {
    const matricula = S.normalizeMatricula(body.matricula);
    const email = String(body.email || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '');

    if (!matricula || !email) throw new HttpError(400, 'Informe a matrícula e o e-mail cadastrado.');
    if (newPassword.length < 6) throw new HttpError(400, 'A nova senha deve ter pelo menos 6 caracteres.', 'password');

    const user = db.users.find(u => u.matricula === matricula && u.email.toLowerCase() === email);
    if (!user) throw new HttpError(400, 'Matrícula e e-mail não conferem com nenhum cadastro.');

    user.salt = randomToken(8);
    user.passwordHash = await hashPassword(newPassword, user.salt);
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
    save();
    return { message: 'Senha redefinida. Faça login com a nova senha.' };
  }

  function logout({ token }) {
    db.sessions = db.sessions.filter(s => s.token !== token);
    save();
    return { message: 'Sessão encerrada.' };
  }

  // ---------- pacientes ----------

  function listPatients({ query }) {
    const q = String(query.q || '').trim().toLowerCase();
    const digits = S.onlyDigits(q);
    const from = S.isValidDateISO(query.from) ? query.from : S.toISODate();

    return db.patients
      .filter(p => !q || p.name.toLowerCase().includes(q) || (digits && S.onlyDigits(p.cpf).includes(digits)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map(p => {
        const appts = db.appointments.filter(a => a.patientId === p.id).sort(sortAppointments);
        const next = appts.find(a => a.date >= from && ['pending', 'attending'].includes(a.status));
        const last = appts.filter(a => a.status === 'completed').pop();
        return {
          ...p,
          evolutionCount: db.evolutions.filter(e => e.patientId === p.id).length,
          nextAppointment: next ? { date: next.date, time: next.time } : null,
          lastVisit: last ? last.date : null
        };
      });
  }

  function getPatient({ id }) {
    const patient = byId('patients', id);
    if (!patient) throw new HttpError(404, 'Paciente não encontrado.');

    const appointments = db.appointments
      .filter(a => a.patientId === patient.id)
      .sort((a, b) => sortAppointments(b, a));

    const evolutions = db.evolutions
      .filter(e => e.patientId === patient.id)
      .map(e => {
        const appt = byId('appointments', e.appointmentId);
        return { ...e, appointment: { date: appt.date, time: appt.time } };
      })
      .sort((a, b) => sortAppointments(b.appointment, a.appointment));

    return { patient, appointments, evolutions };
  }

  function createPatient({ body, user }) {
    const data = check(S.validatePatient(body));
    const apptData = body.appointment ? check(S.validateAppointment(body.appointment)) : null;

    if (db.patients.some(p => p.cpf === data.cpf)) {
      throw new HttpError(409, 'Já existe um paciente cadastrado com este CPF.', 'cpf');
    }

    const now = nowISO();
    const patient = { id: nextId('patients'), ...data, createdBy: user.id, createdAt: now, updatedAt: now };
    db.patients.push(patient);

    let appointment = null;
    if (apptData) {
      appointment = {
        id: nextId('appointments'), patientId: patient.id, ...apptData,
        status: 'pending', studentId: null, createdAt: now, updatedAt: now
      };
      db.appointments.push(appointment);
    }

    save();
    return { message: 'Paciente cadastrado com sucesso.', patient, appointment };
  }

  function updatePatient({ id, body }) {
    const patient = byId('patients', id);
    if (!patient) throw new HttpError(404, 'Paciente não encontrado.');

    const data = check(S.validatePatient(body));

    if (db.patients.some(p => p.cpf === data.cpf && p.id !== patient.id)) {
      throw new HttpError(409, 'Já existe outro paciente com este CPF.', 'cpf');
    }

    Object.assign(patient, data, { updatedAt: nowISO() });
    save();
    return { message: 'Cadastro atualizado.', patient };
  }

  // ---------- agendamentos ----------

  function listAppointments({ query }) {
    if (!S.isValidDateISO(query.date)) throw new HttpError(400, 'Informe a data no formato AAAA-MM-DD.');

    return db.appointments
      .filter(a => a.date === query.date)
      .map(a => {
        const patient = byId('patients', a.patientId);
        const evolution = db.evolutions.find(e => e.appointmentId === a.id);
        return {
          ...a,
          studentName: userName(a.studentId),
          patient: patientSummary(patient),
          evolution: evolution ? { id: evolution.id, status: evolution.status, studentId: evolution.studentId } : null
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time) || a.patient.name.localeCompare(b.patient.name, 'pt-BR'));
  }

  function getAppointment({ id }) {
    const appointment = byId('appointments', id);
    if (!appointment) throw new HttpError(404, 'Agendamento não encontrado.');

    return {
      appointment: { ...appointment, studentName: userName(appointment.studentId) },
      patient: byId('patients', appointment.patientId),
      evolution: db.evolutions.find(e => e.appointmentId === appointment.id) || null
    };
  }

  function createAppointment({ body }) {
    const patientId = Number(body.patientId);
    if (!byId('patients', patientId)) throw new HttpError(404, 'Paciente não encontrado.');

    const { date, time } = check(S.validateAppointment(body));

    const clash = db.appointments.some(a =>
      a.patientId === patientId && a.date === date && a.time === time && a.status !== 'absent');
    if (clash) throw new HttpError(409, 'Este paciente já tem uma sessão agendada neste dia e horário.');

    const now = nowISO();
    const appointment = {
      id: nextId('appointments'), patientId, date, time,
      status: 'pending', studentId: null, createdAt: now, updatedAt: now
    };
    db.appointments.push(appointment);
    save();
    return { message: 'Sessão agendada.', appointment };
  }

  function updateAppointmentStatus({ id, body, user }) {
    const appointment = byId('appointments', id);
    const { status } = body;

    if (!appointment) throw new HttpError(404, 'Agendamento não encontrado.');
    if (!['pending', 'attending', 'absent'].includes(status)) throw new HttpError(400, 'Status inválido.');
    if (appointment.status === 'completed') {
      throw new HttpError(409, 'Esta sessão já foi finalizada com evolução registrada.');
    }

    const busyByOther = appointment.status === 'attending' && appointment.studentId && appointment.studentId !== user.id;

    if (status === 'attending') {
      if (user.role !== 'student') throw new HttpError(403, 'Apenas estudantes podem iniciar atendimentos.');
      if (appointment.status === 'absent') {
        throw new HttpError(409, 'O paciente está marcado como falta. Desfaça a falta antes de atender.');
      }
      if (busyByOther) {
        throw new HttpError(409, `Paciente já está em atendimento por ${userName(appointment.studentId)}.`);
      }
      appointment.studentId = user.id;
    } else {
      if (busyByOther && user.role !== 'teacher') {
        throw new HttpError(409, `Paciente está em atendimento por ${userName(appointment.studentId)}.`);
      }
      appointment.studentId = null;
    }

    appointment.status = status;
    appointment.updatedAt = nowISO();
    save();
    return { message: 'Status atualizado.', appointment };
  }

  function deleteAppointment({ id }) {
    const appointment = byId('appointments', id);
    if (!appointment) throw new HttpError(404, 'Agendamento não encontrado.');
    if (!['pending', 'absent'].includes(appointment.status)) {
      throw new HttpError(409, 'Só é possível desmarcar sessões que ainda não foram iniciadas.');
    }

    db.appointments = db.appointments.filter(a => a.id !== appointment.id);
    save();
    return { message: 'Sessão desmarcada.' };
  }

  // ---------- evoluções ----------

  function listEvolutions({ query, user }) {
    const { status, mine, patientId } = query;

    if (status && status !== 'all' && !S.EVOLUTION_STATUSES.includes(status)) {
      throw new HttpError(400, 'Filtro de status inválido.');
    }

    return db.evolutions
      .filter(e => !status || status === 'all' || e.status === status)
      .filter(e => mine !== '1' || e.studentId === user.id)
      .filter(e => !patientId || e.patientId === Number(patientId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(e => {
        const appt = byId('appointments', e.appointmentId);
        return {
          ...e,
          patient: patientSummary(byId('patients', e.patientId)),
          appointment: { date: appt.date, time: appt.time }
        };
      });
  }

  function getEvolution({ id }) {
    const evolution = byId('evolutions', id);
    if (!evolution) throw new HttpError(404, 'Evolução não encontrada.');

    return {
      evolution,
      patient: byId('patients', evolution.patientId),
      appointment: byId('appointments', evolution.appointmentId)
    };
  }

  function createEvolution({ body, user }) {
    requireRole(user, 'student');

    const appointment = byId('appointments', body.appointmentId);
    if (!appointment) throw new HttpError(404, 'Agendamento não encontrado.');
    if (db.evolutions.some(e => e.appointmentId === appointment.id)) {
      throw new HttpError(409, 'Esta sessão já possui uma evolução registrada.');
    }
    if (appointment.status === 'absent') throw new HttpError(409, 'O paciente está marcado como falta nesta sessão.');
    if (appointment.status === 'attending' && appointment.studentId && appointment.studentId !== user.id) {
      throw new HttpError(409, 'Esta sessão está sendo atendida por outro estudante.');
    }

    const data = check(S.validateEvolution(body));
    const now = nowISO();

    const evolution = {
      id: nextId('evolutions'),
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      studentId: user.id,
      studentName: user.name,
      ...data,
      status: 'pending',
      feedback: '',
      reviewerId: null,
      reviewerName: '',
      reviewedAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    db.evolutions.push(evolution);

    Object.assign(appointment, { status: 'completed', studentId: user.id, updatedAt: now });
    save();
    return { message: 'Evolução registrada e enviada para validação.', evolution };
  }

  function updateEvolution({ id, body, user }) {
    requireRole(user, 'student');

    const evolution = byId('evolutions', id);
    if (!evolution) throw new HttpError(404, 'Evolução não encontrada.');
    if (evolution.studentId !== user.id) throw new HttpError(403, 'Apenas o autor da evolução pode corrigi-la.');
    if (evolution.status !== 'correction') {
      throw new HttpError(409, 'Só é possível editar evoluções com correção solicitada pelo professor.');
    }

    const data = check(S.validateEvolution(body));
    Object.assign(evolution, data, {
      status: 'pending',
      revision: evolution.revision + 1,
      updatedAt: nowISO()
    });
    save();
    return { message: 'Evolução corrigida e reenviada para validação.', evolution };
  }

  function reviewEvolution({ id, body, user }) {
    requireRole(user, 'teacher');

    const evolution = byId('evolutions', id);
    const feedback = String(body.feedback || '').trim().slice(0, 2000);

    if (!evolution) throw new HttpError(404, 'Evolução não encontrada.');
    if (evolution.status !== 'pending') throw new HttpError(409, 'Esta evolução já foi revisada.');
    if (!['approve', 'correction'].includes(body.action)) throw new HttpError(400, 'Ação inválida.');
    if (body.action === 'correction' && feedback.length < 5) {
      throw new HttpError(400, 'Descreva o que o aluno precisa corrigir.', 'feedback');
    }

    const now = nowISO();
    Object.assign(evolution, {
      status: body.action === 'approve' ? 'approved' : 'correction',
      feedback,
      reviewerId: user.id,
      reviewerName: user.name,
      reviewedAt: now,
      updatedAt: now
    });
    save();

    const message = body.action === 'approve' ? 'Evolução aprovada.' : 'Correção solicitada ao aluno.';
    return { message, evolution };
  }

  // ---------- roteamento ----------

  const routes = [
    { method: 'GET', path: '/health', public: true, handler: () => ({ status: 'ok', mode: 'local' }) },
    { method: 'POST', path: '/auth/login', public: true, handler: login },
    { method: 'POST', path: '/auth/register', public: true, handler: register },
    { method: 'POST', path: '/auth/reset-password', public: true, handler: resetPassword },
    { method: 'GET', path: '/auth/me', handler: ({ user }) => ({ user: publicUser(user) }) },
    { method: 'POST', path: '/auth/logout', handler: logout },
    { method: 'GET', path: '/patients', handler: listPatients },
    { method: 'POST', path: '/patients', handler: createPatient },
    { method: 'GET', path: '/patients/:id', handler: getPatient },
    { method: 'PUT', path: '/patients/:id', handler: updatePatient },
    { method: 'GET', path: '/appointments', handler: listAppointments },
    { method: 'POST', path: '/appointments', handler: createAppointment },
    { method: 'GET', path: '/appointments/:id', handler: getAppointment },
    { method: 'PATCH', path: '/appointments/:id/status', handler: updateAppointmentStatus },
    { method: 'DELETE', path: '/appointments/:id', handler: deleteAppointment },
    { method: 'GET', path: '/evolutions', handler: listEvolutions },
    { method: 'POST', path: '/evolutions', handler: createEvolution },
    { method: 'GET', path: '/evolutions/:id', handler: getEvolution },
    { method: 'PUT', path: '/evolutions/:id', handler: updateEvolution },
    { method: 'PATCH', path: '/evolutions/:id/review', handler: reviewEvolution }
  ].map(r => ({ ...r, regex: new RegExp(`^${r.path.replace(':id', '(\\d+)')}$`) }));

  async function dispatch(method, path, body, token) {
    await ensureDb();

    const url = new URL(path, 'http://local/');
    const route = routes.find(r => r.method === method && r.regex.test(url.pathname));
    if (!route) throw new HttpError(404, 'Rota não encontrada.');

    const [, id] = url.pathname.match(route.regex);
    const user = route.public ? null : authenticate(token);

    const result = await route.handler({
      id: id ? Number(id) : null,
      query: Object.fromEntries(url.searchParams),
      body: body || {},
      user,
      token
    });

    return clone(result);
  }

  // Requisições em fila: evita que duas operações assíncronas sobrescrevam uma à outra
  let queue = Promise.resolve();

  function handle(method, path, body, token) {
    const run = () => dispatch(method, path, body, token);
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  async function reset() {
    db = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) { /* ignore */ }
    await seed();
  }

  window.LocalBackend = { handle, reset, STORAGE_KEY, HttpError };
})();

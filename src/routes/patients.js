const express = require('express');
const { db } = require('../db');
const { toPatient, toAppointment, toEvolution } = require('../mappers');
const { handle } = require('../http');
const { onlyDigits, toISODate, isValidDateISO, validatePatient, validateAppointment } = require('../../assets/js/shared');

const router = express.Router();

async function findPatient(id) {
  return toPatient(await db.get('SELECT * FROM patients WHERE id = ?', [id]));
}

async function cpfTaken(cpf, exceptId = 0) {
  return Boolean(await db.get('SELECT id FROM patients WHERE cpf = ? AND id != ?', [cpf, exceptId]));
}

router.get('/patients', handle(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const from = isValidDateISO(req.query.from) ? req.query.from : toISODate();

  const rows = await db.all(`
    SELECT p.*,
      (SELECT COUNT(*) FROM evolutions e WHERE e.patient_id = p.id) AS evolution_count,
      (SELECT a.date || ' ' || a.time FROM appointments a
        WHERE a.patient_id = p.id AND a.date >= ? AND a.status IN ('pending', 'attending')
        ORDER BY a.date, a.time LIMIT 1) AS next_appointment,
      (SELECT a.date FROM appointments a
        WHERE a.patient_id = p.id AND a.status = 'completed'
        ORDER BY a.date DESC, a.time DESC LIMIT 1) AS last_visit
    FROM patients p
    ORDER BY p.name COLLATE NOCASE ASC
  `, [from]);

  const digits = onlyDigits(q);
  const filtered = q
    ? rows.filter(r => r.name.toLowerCase().includes(q) || (digits && onlyDigits(r.cpf).includes(digits)))
    : rows;

  return res.json(filtered.map(r => {
    const [date, time] = r.next_appointment ? r.next_appointment.split(' ') : [];
    return {
      ...toPatient(r),
      evolutionCount: r.evolution_count,
      nextAppointment: date ? { date, time } : null,
      lastVisit: r.last_visit
    };
  }));
}));

router.get('/patients/:id', handle(async (req, res) => {
  const patient = await findPatient(Number(req.params.id));

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  const appointments = (await db.all(
    'SELECT * FROM appointments WHERE patient_id = ? ORDER BY date DESC, time DESC', [patient.id]
  )).map(toAppointment);

  const evolutions = (await db.all(`
    SELECT e.*, a.date AS appt_date, a.time AS appt_time
    FROM evolutions e
    INNER JOIN appointments a ON a.id = e.appointment_id
    WHERE e.patient_id = ?
    ORDER BY a.date DESC, a.time DESC
  `, [patient.id])).map(r => ({ ...toEvolution(r), appointment: { date: r.appt_date, time: r.appt_time } }));

  return res.json({ patient, appointments, evolutions });
}));

router.post('/patients', handle(async (req, res) => {
  const result = validatePatient(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  let appointmentData = null;
  if (req.body.appointment) {
    const appt = validateAppointment(req.body.appointment);
    if (!appt.ok) {
      return res.status(400).json({ message: appt.message, field: appt.field });
    }
    appointmentData = appt.value;
  }

  const data = result.value;

  if (await cpfTaken(data.cpf)) {
    return res.status(409).json({ message: 'Já existe um paciente cadastrado com este CPF.', field: 'cpf' });
  }

  const now = new Date().toISOString();
  const statements = [[`
    INSERT INTO patients (name, cpf, age, phone, specialty, diagnosis, history, created_by, created_at, updated_at)
    VALUES (@name, @cpf, @age, @phone, @specialty, @diagnosis, @history, @createdBy, @now, @now)
  `, { ...data, createdBy: req.user.id, now }]];

  // A primeira sessão entra no mesmo lote, ligada ao paciente recém-criado
  if (appointmentData) {
    statements.push([`
      INSERT INTO appointments (patient_id, date, time, status, created_at, updated_at)
      VALUES (last_insert_rowid(), ?, ?, 'pending', ?, ?)
    `, [appointmentData.date, appointmentData.time, now, now]]);
  }

  const [patientInfo, appointmentInfo] = await db.batch(statements);
  const appointment = appointmentInfo
    ? toAppointment(await db.get('SELECT * FROM appointments WHERE id = ?', [appointmentInfo.lastInsertRowid]))
    : null;

  return res.status(201).json({
    message: 'Paciente cadastrado com sucesso.',
    patient: await findPatient(patientInfo.lastInsertRowid),
    appointment
  });
}));

router.put('/patients/:id', handle(async (req, res) => {
  const id = Number(req.params.id);

  if (!(await findPatient(id))) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  const result = validatePatient(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const data = result.value;

  if (await cpfTaken(data.cpf, id)) {
    return res.status(409).json({ message: 'Já existe outro paciente com este CPF.', field: 'cpf' });
  }

  await db.run(`
    UPDATE patients
    SET name = @name, cpf = @cpf, age = @age, phone = @phone, specialty = @specialty,
        diagnosis = @diagnosis, history = @history, updated_at = @now
    WHERE id = @id
  `, { ...data, id, now: new Date().toISOString() });

  return res.json({ message: 'Cadastro atualizado.', patient: await findPatient(id) });
}));

module.exports = router;

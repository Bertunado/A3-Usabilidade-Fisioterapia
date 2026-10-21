const express = require('express');
const { db } = require('../db');
const { toPatient, toAppointment, toEvolution } = require('../mappers');
const { handle } = require('../http');
const { isValidDateISO, validateAppointment } = require('../../assets/js/shared');

const router = express.Router();

async function findAppointment(id) {
  return toAppointment(await db.get('SELECT * FROM appointments WHERE id = ?', [id]));
}

async function studentName(id) {
  const row = id ? await db.get('SELECT name FROM users WHERE id = ?', [id]) : null;
  return row ? row.name : '';
}

router.get('/appointments', handle(async (req, res) => {
  const { date } = req.query;

  if (!isValidDateISO(date)) {
    return res.status(400).json({ message: 'Informe a data no formato AAAA-MM-DD.' });
  }

  const rows = await db.all(`
    SELECT a.*,
      p.name AS p_name, p.cpf AS p_cpf, p.age AS p_age, p.specialty AS p_specialty, p.diagnosis AS p_diagnosis,
      u.name AS student_name,
      e.id AS evo_id, e.status AS evo_status, e.student_id AS evo_student_id
    FROM appointments a
    INNER JOIN patients p ON p.id = a.patient_id
    LEFT JOIN users u ON u.id = a.student_id
    LEFT JOIN evolutions e ON e.appointment_id = a.id
    WHERE a.date = ?
    ORDER BY a.time ASC, p.name COLLATE NOCASE ASC
  `, [date]);

  return res.json(rows.map(r => ({
    ...toAppointment(r),
    studentName: r.student_name || '',
    patient: {
      id: r.patient_id,
      name: r.p_name,
      cpf: r.p_cpf,
      age: r.p_age,
      specialty: r.p_specialty,
      diagnosis: r.p_diagnosis
    },
    evolution: r.evo_id ? { id: r.evo_id, status: r.evo_status, studentId: r.evo_student_id } : null
  })));
}));

router.get('/appointments/:id', handle(async (req, res) => {
  const appointment = await findAppointment(Number(req.params.id));

  if (!appointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado.' });
  }

  const patient = toPatient(await db.get('SELECT * FROM patients WHERE id = ?', [appointment.patientId]));
  const evolution = toEvolution(await db.get('SELECT * FROM evolutions WHERE appointment_id = ?', [appointment.id]));

  return res.json({
    appointment: { ...appointment, studentName: await studentName(appointment.studentId) },
    patient,
    evolution
  });
}));

router.post('/appointments', handle(async (req, res) => {
  const patientId = Number(req.body.patientId);
  const patient = await db.get('SELECT id FROM patients WHERE id = ?', [patientId]);

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  const result = validateAppointment(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const { date, time } = result.value;

  const clash = await db.get(`
    SELECT id FROM appointments WHERE patient_id = ? AND date = ? AND time = ? AND status != 'absent'
  `, [patientId, date, time]);

  if (clash) {
    return res.status(409).json({ message: 'Este paciente já tem uma sessão agendada neste dia e horário.' });
  }

  const now = new Date().toISOString();
  const info = await db.run(`
    INSERT INTO appointments (patient_id, date, time, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `, [patientId, date, time, now, now]);

  return res.status(201).json({ message: 'Sessão agendada.', appointment: await findAppointment(info.lastInsertRowid) });
}));

router.patch('/appointments/:id/status', handle(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const appointment = await findAppointment(id);

  if (!appointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado.' });
  }

  if (!['pending', 'attending', 'absent'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido.' });
  }

  if (appointment.status === 'completed') {
    return res.status(409).json({ message: 'Esta sessão já foi finalizada com evolução registrada.' });
  }

  let studentId = appointment.studentId;
  const busyByOther = appointment.status === 'attending' && appointment.studentId && appointment.studentId !== req.user.id;

  if (status === 'attending') {
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Apenas estudantes podem iniciar atendimentos.' });
    }
    if (appointment.status === 'absent') {
      return res.status(409).json({ message: 'O paciente está marcado como falta. Desfaça a falta antes de atender.' });
    }
    if (busyByOther) {
      return res.status(409).json({ message: `Paciente já está em atendimento por ${await studentName(appointment.studentId)}.` });
    }
    studentId = req.user.id;
  } else {
    if (busyByOther && req.user.role !== 'teacher') {
      return res.status(409).json({ message: `Paciente está em atendimento por ${await studentName(appointment.studentId)}.` });
    }
    studentId = null;
  }

  await db.run('UPDATE appointments SET status = ?, student_id = ?, updated_at = ? WHERE id = ?',
    [status, studentId, new Date().toISOString(), id]);

  return res.json({ message: 'Status atualizado.', appointment: await findAppointment(id) });
}));

router.delete('/appointments/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const appointment = await findAppointment(id);

  if (!appointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado.' });
  }

  if (!['pending', 'absent'].includes(appointment.status)) {
    return res.status(409).json({ message: 'Só é possível desmarcar sessões que ainda não foram iniciadas.' });
  }

  await db.run('DELETE FROM appointments WHERE id = ?', [id]);

  return res.json({ message: 'Sessão desmarcada.' });
}));

module.exports = router;

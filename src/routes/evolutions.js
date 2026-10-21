const express = require('express');
const { db } = require('../db');
const { toPatient, toAppointment, toEvolution } = require('../mappers');
const { handle } = require('../http');
const { requireRole } = require('../middleware/auth');
const { validateEvolution, EVOLUTION_STATUSES } = require('../../assets/js/shared');

const router = express.Router();

async function findEvolution(id) {
  return toEvolution(await db.get('SELECT * FROM evolutions WHERE id = ?', [id]));
}

router.get('/evolutions', handle(async (req, res) => {
  const { status, mine, patientId } = req.query;
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    if (!EVOLUTION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Filtro de status inválido.' });
    }
    where.push('e.status = ?');
    params.push(status);
  }

  if (mine === '1') {
    where.push('e.student_id = ?');
    params.push(req.user.id);
  }

  if (patientId) {
    where.push('e.patient_id = ?');
    params.push(Number(patientId));
  }

  const rows = await db.all(`
    SELECT e.*,
      p.name AS p_name, p.cpf AS p_cpf, p.age AS p_age, p.specialty AS p_specialty, p.diagnosis AS p_diagnosis,
      a.date AS appt_date, a.time AS appt_time
    FROM evolutions e
    INNER JOIN patients p ON p.id = e.patient_id
    INNER JOIN appointments a ON a.id = e.appointment_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.updated_at DESC
  `, params);

  return res.json(rows.map(r => ({
    ...toEvolution(r),
    patient: {
      id: r.patient_id,
      name: r.p_name,
      cpf: r.p_cpf,
      age: r.p_age,
      specialty: r.p_specialty,
      diagnosis: r.p_diagnosis
    },
    appointment: { date: r.appt_date, time: r.appt_time }
  })));
}));

router.get('/evolutions/:id', handle(async (req, res) => {
  const evolution = await findEvolution(Number(req.params.id));

  if (!evolution) {
    return res.status(404).json({ message: 'Evolução não encontrada.' });
  }

  const patient = toPatient(await db.get('SELECT * FROM patients WHERE id = ?', [evolution.patientId]));
  const appointment = toAppointment(await db.get('SELECT * FROM appointments WHERE id = ?', [evolution.appointmentId]));

  return res.json({ evolution, patient, appointment });
}));

router.post('/evolutions', requireRole('student'), handle(async (req, res) => {
  const appointmentId = Number(req.body.appointmentId);
  const appointment = toAppointment(await db.get('SELECT * FROM appointments WHERE id = ?', [appointmentId]));

  if (!appointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado.' });
  }

  if (await db.get('SELECT id FROM evolutions WHERE appointment_id = ?', [appointmentId])) {
    return res.status(409).json({ message: 'Esta sessão já possui uma evolução registrada.' });
  }

  if (appointment.status === 'absent') {
    return res.status(409).json({ message: 'O paciente está marcado como falta nesta sessão.' });
  }

  if (appointment.status === 'attending' && appointment.studentId && appointment.studentId !== req.user.id) {
    return res.status(409).json({ message: 'Esta sessão está sendo atendida por outro estudante.' });
  }

  const result = validateEvolution(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  const now = new Date().toISOString();

  // Evolução + sessão finalizada gravadas juntas (tudo ou nada)
  const [info] = await db.batch([
    [`
      INSERT INTO evolutions (
        appointment_id, patient_id, student_id, student_name, eva, subjective, pa, fc, spo2,
        objective, procedures, conduct, plan, status, created_at, updated_at
      ) VALUES (
        @appointmentId, @patientId, @studentId, @studentName, @eva, @subjective, @pa, @fc, @spo2,
        @objective, @procedures, @conduct, @plan, 'pending', @now, @now
      )
    `, {
      ...result.value,
      procedures: JSON.stringify(result.value.procedures),
      appointmentId,
      patientId: appointment.patientId,
      studentId: req.user.id,
      studentName: req.user.name,
      now
    }],
    ["UPDATE appointments SET status = 'completed', student_id = ?, updated_at = ? WHERE id = ?", [req.user.id, now, appointmentId]]
  ]);

  return res.status(201).json({ message: 'Evolução registrada e enviada para validação.', evolution: await findEvolution(info.lastInsertRowid) });
}));

router.put('/evolutions/:id', requireRole('student'), handle(async (req, res) => {
  const id = Number(req.params.id);
  const evolution = await findEvolution(id);

  if (!evolution) {
    return res.status(404).json({ message: 'Evolução não encontrada.' });
  }

  if (evolution.studentId !== req.user.id) {
    return res.status(403).json({ message: 'Apenas o autor da evolução pode corrigi-la.' });
  }

  if (evolution.status !== 'correction') {
    return res.status(409).json({ message: 'Só é possível editar evoluções com correção solicitada pelo professor.' });
  }

  const result = validateEvolution(req.body);

  if (!result.ok) {
    return res.status(400).json({ message: result.message, field: result.field });
  }

  await db.run(`
    UPDATE evolutions
    SET eva = @eva, subjective = @subjective, pa = @pa, fc = @fc, spo2 = @spo2, objective = @objective,
        procedures = @procedures, conduct = @conduct, plan = @plan,
        status = 'pending', revision = revision + 1, updated_at = @now
    WHERE id = @id
  `, {
    ...result.value,
    procedures: JSON.stringify(result.value.procedures),
    id,
    now: new Date().toISOString()
  });

  return res.json({ message: 'Evolução corrigida e reenviada para validação.', evolution: await findEvolution(id) });
}));

router.patch('/evolutions/:id/review', requireRole('teacher'), handle(async (req, res) => {
  const id = Number(req.params.id);
  const { action } = req.body;
  const feedback = String(req.body.feedback || '').trim().slice(0, 2000);
  const evolution = await findEvolution(id);

  if (!evolution) {
    return res.status(404).json({ message: 'Evolução não encontrada.' });
  }

  if (evolution.status !== 'pending') {
    return res.status(409).json({ message: 'Esta evolução já foi revisada.' });
  }

  if (!['approve', 'correction'].includes(action)) {
    return res.status(400).json({ message: 'Ação inválida.' });
  }

  if (action === 'correction' && feedback.length < 5) {
    return res.status(400).json({ message: 'Descreva o que o aluno precisa corrigir.', field: 'feedback' });
  }

  const now = new Date().toISOString();

  await db.run(`
    UPDATE evolutions
    SET status = ?, feedback = ?, reviewer_id = ?, reviewer_name = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `, [action === 'approve' ? 'approved' : 'correction', feedback, req.user.id, req.user.name, now, now, id]);

  const message = action === 'approve' ? 'Evolução aprovada.' : 'Correção solicitada ao aluno.';
  return res.json({ message, evolution: await findEvolution(id) });
}));

module.exports = router;

const express = require('express');
const { db } = require('../db');

const router = express.Router();

function getPatientWithHistory(patientId) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

  if (!patient) return null;

  const evolutions = db
    .prepare('SELECT * FROM evolutions WHERE patient_id = ? ORDER BY created_at DESC')
    .all(patientId);

  return {
    ...patient,
    history: evolutions
  };
}

router.get('/patients', (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY time ASC').all();

  const result = patients.map(patient => ({
    ...patient,
    history: db
      .prepare('SELECT * FROM evolutions WHERE patient_id = ? ORDER BY created_at DESC')
      .all(patient.id)
  }));

  return res.json(result);
});

router.get('/patients/:id', (req, res) => {
  const patient = getPatientWithHistory(Number(req.params.id));

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  return res.json(patient);
});

router.post('/patients', (req, res) => {
  const { name, cpf, age, time, specialty, status = 'pending', history = '' } = req.body;

  if (!name || !cpf || !age || !time || !specialty) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, cpf, idade, horário e especialidade.' });
  }

  const existing = db.prepare('SELECT id FROM patients WHERE cpf = ?').get(cpf);

  if (existing) {
    return res.status(409).json({ message: 'Já existe um paciente com este CPF.' });
  }

  const result = db.prepare(`
    INSERT INTO patients (name, cpf, age, time, specialty, status, history)
    VALUES (@name, @cpf, @age, @time, @specialty, @status, @history)
  `).run({
    name,
    cpf,
    age: Number(age),
    time,
    specialty,
    status,
    history
  });

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);

  return res.status(201).json({ message: 'Paciente cadastrado com sucesso.', patient });
});

router.patch('/patients/:id/status', (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: 'Status obrigatório.' });
  }

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(Number(req.params.id));

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  db.prepare('UPDATE patients SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, Number(req.params.id));

  return res.json({ message: 'Status atualizado.', patient: getPatientWithHistory(Number(req.params.id)) });
});

router.post('/patients/:id/evolutions', (req, res) => {
  const patientId = Number(req.params.id);
  const { studentName, eva, subjective, objective, conduct, plan } = req.body;

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado.' });
  }

  if (!studentName || !subjective || !conduct) {
    return res.status(400).json({ message: 'Dados obrigatórios: nome do aluno, subjetivo e conduta.' });
  }

  const result = db.prepare(`
    INSERT INTO evolutions (patient_id, student_name, eva, subjective, objective, conduct, plan)
    VALUES (@patient_id, @student_name, @eva, @subjective, @objective, @conduct, @plan)
  `).run({
    patient_id: patientId,
    student_name: studentName,
    eva: eva ?? null,
    subjective,
    objective: objective ?? '',
    conduct,
    plan: plan ?? ''
  });

  db.prepare('UPDATE patients SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', patientId);

  const evolution = db.prepare('SELECT * FROM evolutions WHERE id = ?').get(result.lastInsertRowid);

  return res.status(201).json({ message: 'Evolução registrada com sucesso.', evolution });
});

router.get('/evolutions/pending', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, p.name as patient_name, p.cpf, p.specialty
    FROM evolutions e
    INNER JOIN patients p ON p.id = e.patient_id
    WHERE e.teacher_approval = 'Pendente de Validação'
    ORDER BY e.created_at DESC
  `).all();

  return res.json(rows);
});

router.patch('/evolutions/:id/approve', (req, res) => {
  const { teacherName } = req.body;
  const evolutionId = Number(req.params.id);

  const evolution = db.prepare('SELECT * FROM evolutions WHERE id = ?').get(evolutionId);

  if (!evolution) {
    return res.status(404).json({ message: 'Evolução não encontrada.' });
  }

  const approvalText = teacherName
    ? `Aprovado por ${teacherName}`
    : 'Aprovado';

  db.prepare('UPDATE evolutions SET teacher_approval = ? WHERE id = ?').run(approvalText, evolutionId);

  return res.json({ message: 'Evolução aprovada.', evolution: { ...evolution, teacher_approval: approvalText } });
});

module.exports = router;

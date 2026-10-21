// Converte linhas do SQLite (snake_case) para o formato JSON da API (camelCase).

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    matricula: row.matricula,
    mustChangePassword: Boolean(row.must_change_password)
  };
}

// Visão do painel administrativo (inclui situação do acesso e atividade)
function toAdminUser(row) {
  if (!row) return null;
  return {
    ...toUser(row),
    active: Boolean(row.active),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    evolutionCount: row.evolution_count || 0,
    reviewCount: row.review_count || 0
  };
}

function toPatient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    cpf: row.cpf,
    age: row.age,
    phone: row.phone,
    specialty: row.specialty,
    diagnosis: row.diagnosis,
    history: row.history,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAppointment(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    date: row.date,
    time: row.time,
    status: row.status,
    studentId: row.student_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toEvolution(row) {
  if (!row) return null;
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    studentId: row.student_id,
    studentName: row.student_name,
    eva: row.eva,
    subjective: row.subjective,
    pa: row.pa,
    fc: row.fc,
    spo2: row.spo2,
    objective: row.objective,
    procedures: JSON.parse(row.procedures || '[]'),
    conduct: row.conduct,
    plan: row.plan,
    status: row.status,
    feedback: row.feedback,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewedAt: row.reviewed_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { toUser, toAdminUser, toPatient, toAppointment, toEvolution };

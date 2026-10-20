/*
 * Regras de negócio compartilhadas entre o navegador (modo local) e o servidor Node.
 * No navegador fica disponível como window.PhysioShared; no Node, via require().
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  } else {
    root.PhysioShared = lib;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const SPECIALTIES = ['Ortopedia', 'Neurologia', 'Respiratória', 'Desportiva'];
  const PROCEDURES = ['TENS / Analgesia', 'Ultrassom Terapêutico', 'Cinesioterapia Ativa', 'Terapia Manual'];
  const ROLES = ['student', 'teacher'];
  const APPOINTMENT_STATUSES = ['pending', 'attending', 'completed', 'absent'];
  const EVOLUTION_STATUSES = ['pending', 'approved', 'correction'];

  const MAX_TEXT = 5000;

  // ---------- utilidades ----------

  function ok(value) {
    return { ok: true, value };
  }

  function fail(message, field) {
    return { ok: false, message, field };
  }

  function clean(value, max = MAX_TEXT) {
    return String(value ?? '').trim().slice(0, max);
  }

  function onlyDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // ---------- CPF / telefone ----------

  function cpfCheckDigits(base9) {
    const digits = onlyDigits(base9).slice(0, 9).split('').map(Number);
    const calc = arr => {
      const factor = arr.length + 1;
      const sum = arr.reduce((acc, n, i) => acc + n * (factor - i), 0);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    const d1 = calc(digits);
    const d2 = calc([...digits, d1]);
    return `${d1}${d2}`;
  }

  function isValidCPF(value) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    return cpfCheckDigits(cpf.slice(0, 9)) === cpf.slice(9);
  }

  function formatCPF(value) {
    return onlyDigits(value)
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function formatPhone(value) {
    const d = onlyDigits(value).slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  // ---------- datas ----------

  function toISODate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(iso, days) {
    const date = parseISODate(iso);
    date.setDate(date.getDate() + days);
    return toISODate(date);
  }

  function isValidDateISO(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
  }

  // ---------- validações ----------

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value));
  }

  function normalizeMatricula(value) {
    return clean(value, 30).toUpperCase();
  }

  function validateRegistration(input) {
    const name = clean(input.name, 120);
    if (name.length < 3) return fail('Informe seu nome completo.', 'name');

    const role = input.role;
    if (!ROLES.includes(role)) return fail('Selecione o perfil: Estudante ou Professor.', 'role');

    const matricula = normalizeMatricula(input.matricula);
    if (!/^[A-Z0-9-]{4,20}$/.test(matricula)) {
      return fail('Matrícula inválida. Use de 4 a 20 letras, números ou hífen.', 'matricula');
    }

    const email = clean(input.email, 120).toLowerCase();
    if (!isValidEmail(email)) return fail('Informe um e-mail válido.', 'email');

    const password = String(input.password ?? '');
    if (password.length < 6) return fail('A senha deve ter pelo menos 6 caracteres.', 'password');

    return ok({ name, role, matricula, email, password });
  }

  function validatePatient(input) {
    const name = clean(input.name, 120);
    if (name.length < 3) return fail('Informe o nome completo do paciente.', 'name');

    const cpfDigits = onlyDigits(input.cpf);
    if (!isValidCPF(cpfDigits)) return fail('CPF inválido. Confira os números digitados.', 'cpf');

    const age = Number(input.age);
    if (input.age === '' || !Number.isInteger(age) || age < 0 || age > 120) {
      return fail('Informe uma idade válida (0 a 120 anos).', 'age');
    }

    const phoneDigits = onlyDigits(input.phone);
    if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 11)) {
      return fail('Telefone inválido. Informe DDD + número.', 'phone');
    }

    const specialty = clean(input.specialty, 40);
    if (!SPECIALTIES.includes(specialty)) return fail('Selecione uma especialidade válida.', 'specialty');

    const history = clean(input.history);
    if (history.length < 5) return fail('Descreva a queixa principal (QP) e a HDA.', 'history');

    return ok({
      name,
      cpf: formatCPF(cpfDigits),
      age,
      phone: phoneDigits ? formatPhone(phoneDigits) : '',
      specialty,
      diagnosis: clean(input.diagnosis, 160),
      history
    });
  }

  function validateAppointment(input) {
    if (!isValidDateISO(input.date)) return fail('Informe uma data válida.', 'date');
    if (!isValidTime(input.time)) return fail('Informe um horário válido (HH:MM).', 'time');
    return ok({ date: input.date, time: input.time });
  }

  function validateEvolution(input) {
    const eva = Number(input.eva);
    if (!Number.isInteger(eva) || eva < 0 || eva > 10) {
      return fail('A escala de dor (EVA) deve ser um valor de 0 a 10.', 'eva');
    }

    const subjective = clean(input.subjective);
    if (subjective.length < 3) return fail('Preencha o relato subjetivo do paciente (aba S).', 'subjective');

    let pa = clean(input.pa, 30);
    if (pa) {
      const match = pa.match(/(\d{2,3})\s*[/xX]\s*(\d{2,3})/);
      if (!match) return fail('Pressão arterial inválida. Use o formato 120/80.', 'pa');
      pa = `${match[1]}/${match[2]}`;
    }

    let fc = clean(input.fc, 20);
    if (fc) {
      const value = Number((fc.match(/\d+/) || [])[0]);
      if (!value || value < 20 || value > 250) return fail('Frequência cardíaca inválida (20 a 250 bpm).', 'fc');
      fc = String(value);
    }

    let spo2 = clean(input.spo2, 20);
    if (spo2) {
      const value = Number((spo2.match(/\d+/) || [])[0]);
      if (!value || value < 50 || value > 100) return fail('Saturação inválida (50% a 100%).', 'spo2');
      spo2 = String(value);
    }

    const procedures = Array.isArray(input.procedures)
      ? PROCEDURES.filter(p => input.procedures.includes(p))
      : [];

    const conduct = clean(input.conduct);
    if (conduct.length < 3) {
      return fail('Descreva a conduta/tratamento aplicado (aba Conduta).', 'conduct');
    }

    return ok({
      eva,
      subjective,
      pa,
      fc,
      spo2,
      objective: clean(input.objective),
      procedures,
      conduct,
      plan: clean(input.plan)
    });
  }

  // ---------- dados de demonstração ----------

  function stamp(dateISO, time, plusMinutes = 0) {
    const [h, m] = time.split(':').map(Number);
    const date = parseISODate(dateISO);
    date.setHours(h, m + plusMinutes, 0, 0);
    return date.toISOString();
  }

  /**
   * Gera os dados iniciais com datas relativas ao dia de hoje,
   * para que a agenda sempre tenha atendimentos ao abrir o sistema.
   */
  function buildSeed(today = toISODate()) {
    const cpf = base => formatCPF(base + cpfCheckDigits(base));
    const day = n => addDays(today, n);
    const now = new Date().toISOString();

    const users = [
      { id: 1, name: 'Lucas Andrade', email: 'lucas@physioedu.com', role: 'student', matricula: '202301982', password: '123456' },
      { id: 2, name: 'Beatriz Lima', email: 'beatriz@physioedu.com', role: 'student', matricula: '202301455', password: '123456' },
      { id: 3, name: 'Profª. Dra. Helena', email: 'helena@physioedu.com', role: 'teacher', matricula: 'DOC-88392', password: '123456' },
      { id: 4, name: 'Prof. Marcos Vieira', email: 'marcos@physioedu.com', role: 'teacher', matricula: 'DOC-77120', password: '123456' }
    ].map(u => ({ ...u, createdAt: now }));

    const patients = [
      {
        id: 1, name: 'Maria das Graças Silva', cpf: cpf('123456789'), age: 58, phone: '(48) 99812-3344',
        specialty: 'Ortopedia', diagnosis: 'Gonartrose em joelho direito',
        history: 'Dor no joelho direito há 8 meses, com piora ao subir escadas e após longos períodos em pé. Nega trauma. Raio-X evidencia redução do espaço articular medial. Encaminhada pelo ortopedista para analgesia e fortalecimento.'
      },
      {
        id: 2, name: 'João Pedro Oliveira', cpf: cpf('987654321'), age: 34, phone: '(48) 98455-1020',
        specialty: 'Desportiva', diagnosis: 'Entorse de tornozelo esquerdo grau II',
        history: 'Entorse em inversão do tornozelo esquerdo durante corrida há 3 semanas. Refere instabilidade e dor ao apoiar. Sem fratura em exame de imagem.'
      },
      {
        id: 3, name: 'Ana Beatriz Souza', cpf: cpf('456789123'), age: 67, phone: '(48) 99633-7781',
        specialty: 'Neurologia', diagnosis: 'Hemiparesia à direita pós-AVE isquêmico',
        history: 'AVE isquêmico há 4 meses com hemiparesia à direita. Deambula com auxílio de bengala. Objetivo: melhorar equilíbrio e independência nas AVDs.'
      },
      {
        id: 4, name: 'Carlos Eduardo Mendes', cpf: cpf('321654987'), age: 45, phone: '(48) 99120-4455',
        specialty: 'Respiratória', diagnosis: 'Síndrome pós-COVID com dispneia aos esforços',
        history: 'Internação por COVID-19 há 2 meses. Refere dispneia aos médios esforços e fadiga. Sem uso de oxigênio domiciliar.'
      },
      {
        id: 5, name: 'Fernanda Rocha Lima', cpf: cpf('741852963'), age: 29, phone: '(48) 98877-6655',
        specialty: 'Ortopedia', diagnosis: 'Lombalgia mecânica',
        history: 'Dor lombar há 6 semanas, relacionada à postura de trabalho em home office. Sem irradiação para membros inferiores.'
      }
    ].map(p => ({ ...p, createdBy: 1, createdAt: now, updatedAt: now }));

    const appointments = [
      { id: 1, patientId: 1, date: day(-28), time: '08:00', status: 'completed', studentId: 1 },
      { id: 2, patientId: 1, date: day(-25), time: '08:00', status: 'completed', studentId: 1 },
      { id: 3, patientId: 2, date: day(-7), time: '09:00', status: 'completed', studentId: 2 },
      { id: 4, patientId: 4, date: day(-1), time: '14:00', status: 'completed', studentId: 1 },
      { id: 5, patientId: 1, date: today, time: '08:00', status: 'pending', studentId: null },
      { id: 6, patientId: 2, date: today, time: '09:00', status: 'pending', studentId: null },
      { id: 7, patientId: 3, date: today, time: '10:30', status: 'completed', studentId: 1 },
      { id: 8, patientId: 5, date: today, time: '14:00', status: 'pending', studentId: null },
      { id: 9, patientId: 4, date: day(2), time: '14:00', status: 'pending', studentId: null }
    ].map(a => ({ ...a, createdAt: now, updatedAt: now }));

    const evo = (id, appointmentId, studentId, data, review) => {
      const appt = appointments.find(a => a.id === appointmentId);
      const createdAt = stamp(appt.date, appt.time, 50);
      const reviewer = review.reviewerId ? users.find(u => u.id === review.reviewerId) : null;
      return {
        id,
        appointmentId,
        patientId: appt.patientId,
        studentId,
        studentName: users.find(u => u.id === studentId).name,
        ...data,
        status: review.status,
        feedback: review.feedback || '',
        reviewerId: reviewer ? reviewer.id : null,
        reviewerName: reviewer ? reviewer.name : '',
        reviewedAt: reviewer ? stamp(appt.date, appt.time, 240) : null,
        revision: 1,
        createdAt,
        updatedAt: createdAt
      };
    };

    const evolutions = [
      evo(1, 1, 1, {
        eva: 7, pa: '120/80', fc: '76', spo2: '97',
        subjective: 'Paciente refere dor intensa na região patelar ao subir escadas.',
        objective: 'Edema leve no joelho direito. ADM de flexão: 100°.',
        procedures: ['TENS / Analgesia', 'Terapia Manual'],
        conduct: 'TENS convencional por 20 min. Mobilização patelar graus II e III. Fortalecimento leve de quadríceps em cadeia cinética aberta.',
        plan: 'Orientada a aplicar gelo em casa por 20 min, 2x ao dia.'
      }, { status: 'approved', reviewerId: 3, feedback: 'Boa descrição da conduta.' }),
      evo(2, 2, 1, {
        eva: 5, pa: '118/75', fc: '72', spo2: '98',
        subjective: 'Relata melhora da dor em repouso após aplicação de gelo conforme orientado.',
        objective: 'ADM de flexão melhorou para 115°. Edema ausente.',
        procedures: ['Ultrassom Terapêutico', 'Cinesioterapia Ativa'],
        conduct: 'Ultrassom terapêutico 1 W/cm² por 5 min. Cinesioterapia ativa assistida para flexo-extensão do joelho.',
        plan: 'Aumentar a carga do fortalecimento na próxima sessão.'
      }, { status: 'approved', reviewerId: 3 }),
      evo(3, 3, 2, {
        eva: 4, pa: '122/78', fc: '68', spo2: '99',
        subjective: 'Refere instabilidade no tornozelo esquerdo ao caminhar em terreno irregular.',
        objective: 'Teste de gaveta anterior positivo leve. Sem equimose visível.',
        procedures: ['Cinesioterapia Ativa'],
        conduct: 'Treino proprioceptivo em disco de equilíbrio, 3 séries de 1 min. Bandagem funcional.',
        plan: 'Manter treino proprioceptivo com progressão de dificuldade.'
      }, { status: 'approved', reviewerId: 4 }),
      evo(4, 4, 1, {
        eva: 1, pa: '125/80', fc: '88', spo2: '95',
        subjective: 'Refere cansaço ao subir um lance de escadas.',
        objective: 'Paciente colaborativo.',
        procedures: ['Cinesioterapia Ativa'],
        conduct: 'Treino muscular inspiratório e exercícios aeróbicos em esteira.',
        plan: 'Progredir tempo de esteira.'
      }, {
        status: 'correction', reviewerId: 3,
        feedback: 'Registre a ausculta pulmonar e o padrão respiratório no campo Objetivo, e detalhe a carga do treino muscular inspiratório.'
      }),
      evo(5, 7, 1, {
        eva: 2, pa: '130/85', fc: '80', spo2: '96',
        subjective: 'Paciente relata cansaço após caminhar distâncias curtas, sem dor.',
        objective: 'Marcha com bengala, base alargada. Escala de Berg: 38/56.',
        procedures: ['Cinesioterapia Ativa'],
        conduct: 'Treino de marcha em barras paralelas, transferências sentado-de pé (3x10) e treino de equilíbrio estático.',
        plan: 'Reavaliar a escala de Berg em 4 semanas.'
      }, { status: 'pending' })
    ];

    return { users, patients, appointments, evolutions };
  }

  return {
    SPECIALTIES,
    PROCEDURES,
    ROLES,
    APPOINTMENT_STATUSES,
    EVOLUTION_STATUSES,
    onlyDigits,
    isValidCPF,
    formatCPF,
    formatPhone,
    toISODate,
    parseISODate,
    addDays,
    isValidDateISO,
    isValidTime,
    isValidEmail,
    normalizeMatricula,
    validateRegistration,
    validatePatient,
    validateAppointment,
    validateEvolution,
    buildSeed
  };
});

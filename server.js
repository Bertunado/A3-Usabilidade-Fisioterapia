const path = require('path');
const express = require('express');
const cors = require('cors');
const { initDatabase, DATABASE_KIND } = require('./src/db');
const { requireAuth, requireRole } = require('./src/middleware/auth');
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const patientRoutes = require('./src/routes/patients');
const appointmentRoutes = require('./src/routes/appointments');
const evolutionRoutes = require('./src/routes/evolutions');

const app = express();
const PORT = process.env.PORT || 3000;

// Atrás de um proxy reverso (Nginx, Caddy...), use TRUST_PROXY=1 para o IP real do usuário
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Frontend (mesmo arquivo publicado no GitHub Pages)
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api', (req, res) => {
  res.json({
    name: 'PhysioEdu API',
    status: 'online',
    endpoints: {
      auth: ['/api/auth/login', '/api/auth/me', '/api/auth/change-password', '/api/auth/logout'],
      admin: ['/api/admin/users', '/api/admin/users/:id', '/api/admin/users/:id/password', '/api/admin/users/:id/status'],
      patients: ['/api/patients', '/api/patients/:id'],
      appointments: ['/api/appointments?date=AAAA-MM-DD', '/api/appointments/:id', '/api/appointments/:id/status'],
      evolutions: ['/api/evolutions', '/api/evolutions/:id', '/api/evolutions/:id/review']
    }
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'server', database: DATABASE_KIND }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
// Área clínica: apenas estudantes e professores
app.use('/api', requireAuth, requireRole('student', 'teacher'), patientRoutes, appointmentRoutes, evolutionRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON inválido na requisição.' });
  }
  console.error(err.stack);
  return res.status(500).json({ message: 'Erro interno do servidor' });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`PhysioEdu rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Não foi possível iniciar o banco de dados:', err);
    process.exit(1);
  });

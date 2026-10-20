/*
 * PhysioEdu — lógica da interface.
 * Toda leitura e gravação de dados passa pelo objeto Api (assets/js/api.js),
 * que fala com o servidor Node ou com o LocalBackend do navegador.
 */
const S = window.PhysioShared;

const state = {
    user: null,
    screen: 'loading',
    loginRole: 'student',
    pendingHash: null,
    badges: { corrections: 0, pending: 0 },
    agendaDate: S.toISODate(),
    agendaFilter: 'all',
    agendaItems: [],
    agendaRequest: 0,
    corrections: [],
    patients: [],
    teacherFilter: 'pending',
    teacherItems: [],
    evo: null,           // atendimento aberto: { mode: 'new' | 'edit', appointment, patient, evolution, key }
    soapTab: 'tab-subjetivo',
    drawer: null,        // prontuário aberto: { patientId, fromEvolution, data }
    editingPatientId: null,
    schedulePatientId: null
};

const SCREENS = ['loading', 'login', 'agenda', 'patients', 'evolution', 'teacher'];
const SOAP_TABS = ['tab-subjetivo', 'tab-objetivo', 'tab-avaliacao', 'tab-plano'];
const REMEMBER_KEY = 'physioedu_remember';

const EMPTY_EVOLUTION = { eva: 5, subjective: '', pa: '', fc: '', spo2: '', objective: '', procedures: [], conduct: '', plan: '' };

const FIELD_TAB = {
    eva: 'tab-subjetivo', subjective: 'tab-subjetivo',
    pa: 'tab-objetivo', fc: 'tab-objetivo', spo2: 'tab-objetivo', objective: 'tab-objetivo',
    conduct: 'tab-avaliacao', plan: 'tab-plano'
};

const FIELD_INPUT = {
    eva: 'soap-eva', subjective: 'soap-subjetivo-text', pa: 'soap-pa', fc: 'soap-fc', spo2: 'soap-spo2',
    objective: 'soap-objetivo-text', conduct: 'soap-conduta-text', plan: 'soap-plano-text'
};

const APPT_STATUS = {
    pending: { label: 'Aguardando', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-regular fa-clock' },
    attending: { label: 'Em Atendimento', cls: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse', icon: 'fa-solid fa-spinner fa-spin' },
    completed: { label: 'Atendido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-solid fa-check' },
    absent: { label: 'Faltou', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-solid fa-user-xmark' }
};

const EVO_STATUS = {
    pending: { label: 'Pendente de Validação', short: 'Validação pendente', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-regular fa-hourglass-half' },
    approved: { label: 'Aprovada', short: 'Aprovada', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-solid fa-circle-check' },
    correction: { label: 'Correção Solicitada', short: 'Correção solicitada', cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: 'fa-solid fa-pen-to-square' }
};

const BTN_PRIMARY = 'flex-1 sm:flex-initial px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold shadow-sm transition flex items-center justify-center gap-1.5 active:scale-95';
const BTN_SECONDARY = 'px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition active:scale-95 whitespace-nowrap';


// ================= UTILIDADES =================

const $ = id => document.getElementById(id);

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayISO() {
    return S.toISODate();
}

function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function formatDateLong(iso) {
    const text = S.parseISODate(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDateTime(stamp) {
    if (!stamp) return '';
    return new Date(stamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(stamp) {
    return new Date(stamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function relativeDayLabel(iso) {
    const diff = Math.round((S.parseISODate(iso) - S.parseISODate(todayISO())) / 864e5);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
    if (diff === -1) return 'Ontem';
    return '';
}

function friendlyDate(iso) {
    return relativeDayLabel(iso) || formatDate(iso);
}

function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

function initials(name) {
    const words = name.split(/\s+/).filter(w => w.length > 2);
    const first = words[0] || name;
    const last = words.length > 1 ? words[words.length - 1] : '';
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function specialtyLabel(patient) {
    return patient.diagnosis ? `${patient.specialty} (${patient.diagnosis})` : patient.specialty;
}

function vitalsText(e) {
    return [e.pa && `PA ${e.pa} mmHg`, e.fc && `FC ${e.fc} bpm`, e.spo2 && `SpO2 ${e.spo2}%`].filter(Boolean).join(' • ');
}

function conductText(e) {
    const procedures = (e.procedures || []).join(', ');
    return procedures ? `${procedures}. ${e.conduct}` : e.conduct;
}

function badge(meta, text) {
    return `<span class="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold border whitespace-nowrap ${meta.cls}"><i class="${meta.icon} mr-1"></i>${esc(text || meta.label)}</span>`;
}

function readJSON(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        return null;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* armazenamento indisponível */ }
}

function removeKey(key) {
    try {
        localStorage.removeItem(key);
    } catch (err) { /* armazenamento indisponível */ }
}

function loadingBlock(text = 'Carregando...') {
    return `<div class="p-8 text-center text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-2 text-brand-600"></i>${esc(text)}</div>`;
}

function errorBlock(message, retry) {
    return `
        <div class="p-8 text-center space-y-2">
            <p class="text-xs text-rose-600"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${esc(message)}</p>
            ${retry ? `<button onclick="${retry}" class="text-xs font-semibold text-brand-700 hover:underline">Tentar novamente</button>` : ''}
        </div>`;
}

function emptyBlock(icon, title, text, actions = '') {
    return `
        <div class="p-8 sm:p-10 text-center space-y-2">
            <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl"><i class="${icon}"></i></div>
            <p class="text-sm font-semibold text-slate-600">${esc(title)}</p>
            ${text ? `<p class="text-xs text-slate-400">${esc(text)}</p>` : ''}
            ${actions ? `<div class="pt-2 flex flex-col sm:flex-row gap-2 justify-center">${actions}</div>` : ''}
        </div>`;
}

function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
        button.dataset.label = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Aguarde...</span>';
    } else if (button.dataset.label) {
        button.innerHTML = button.dataset.label;
        delete button.dataset.label;
    }
}


// ================= AVISOS, MODAIS E CONFIRMAÇÕES =================

function showToast(message, type = 'info', options = {}) {
    const container = $('toast-container');
    const toast = document.createElement('div');

    const styles = { success: 'bg-emerald-600', info: 'bg-brand-700', error: 'bg-rose-600', warning: 'bg-amber-600' };
    const icons = { success: 'fa-circle-check', info: 'fa-circle-info', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation' };

    toast.className = `p-3 rounded-xl shadow-xl text-xs font-semibold flex items-center justify-between gap-3 text-white ${styles[type] || 'bg-slate-800'} toast-animate pointer-events-auto`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `
        <span class="flex items-start gap-2"><i class="fa-solid ${icons[type] || icons.info} mt-0.5"></i><span>${esc(message)}</span></span>
        <span class="flex items-center gap-3 shrink-0">
            ${options.actionLabel ? `<button type="button" class="toast-action underline underline-offset-2 hover:no-underline">${esc(options.actionLabel)}</button>` : ''}
            <button type="button" class="toast-close opacity-70 hover:opacity-100" aria-label="Fechar aviso"><i class="fa-solid fa-xmark"></i></button>
        </span>
    `;

    const remove = () => toast.remove();
    toast.querySelector('.toast-close').onclick = remove;
    if (options.actionLabel) {
        toast.querySelector('.toast-action').onclick = () => {
            remove();
            options.onAction();
        };
    }

    container.appendChild(toast);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(remove, options.duration || (options.actionLabel ? 6500 : 3500));
}

const modalStack = [];
let confirmResolver = null;

function openModal(id) {
    const modal = $(id);
    modal.classList.remove('hidden');
    if (!modalStack.includes(id)) modalStack.push(id);

    // No celular não foca automaticamente para não abrir o teclado por cima do formulário
    if (window.matchMedia('(min-width: 640px)').matches) {
        const target = modal.querySelector('[data-autofocus]') || modal.querySelector('input:not(.sr-only):not([type=hidden]), textarea, select');
        if (target) setTimeout(() => target.focus(), 30);
    }
}

function closeModal(id) {
    $(id).classList.add('hidden');
    const index = modalStack.indexOf(id);
    if (index >= 0) modalStack.splice(index, 1);

    if (id === 'modal-confirm' && confirmResolver) {
        const resolve = confirmResolver;
        confirmResolver = null;
        resolve(false);
    }
}

function closeAllOverlays() {
    [...modalStack].forEach(closeModal);
    toggleDrawer(false);
}

const CONFIRM_TONES = {
    brand: { button: 'bg-brand-600 hover:bg-brand-700', icon: 'bg-brand-50 text-brand-600' },
    danger: { button: 'bg-rose-600 hover:bg-rose-700', icon: 'bg-rose-50 text-rose-600' },
    warning: { button: 'bg-amber-500 hover:bg-amber-600', icon: 'bg-amber-50 text-amber-600' }
};

function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', tone = 'brand', icon = 'fa-circle-question' }) {
    const colors = CONFIRM_TONES[tone] || CONFIRM_TONES.brand;
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-icon').className = `w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colors.icon}`;
    $('confirm-icon').innerHTML = `<i class="fa-solid ${icon} text-lg"></i>`;
    $('confirm-ok').textContent = confirmText;
    $('confirm-ok').className = `w-full sm:w-auto px-5 py-2.5 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-md transition ${colors.button}`;
    $('confirm-cancel').textContent = cancelText;

    if (confirmResolver) closeModal('modal-confirm');

    return new Promise(resolve => {
        confirmResolver = resolve;
        $('confirm-ok').onclick = () => {
            confirmResolver = null;
            closeModal('modal-confirm');
            resolve(true);
        };
        $('confirm-cancel').onclick = () => closeModal('modal-confirm');
        openModal('modal-confirm');
        setTimeout(() => $('confirm-ok').focus(), 30);
    });
}

function clearFormErrors(form) {
    form.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
    const box = form.querySelector('.form-error');
    if (box) {
        box.classList.add('hidden');
        box.innerHTML = '';
    }
}

function showFormError(form, message, field) {
    const box = form.querySelector('.form-error');
    if (box) {
        box.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> ${esc(message)}`;
        box.classList.remove('hidden');
    }
    const input = field ? form.querySelector(`[data-field="${field}"]`) : null;
    if (input) {
        input.classList.add('field-invalid');
        if (typeof input.focus === 'function') input.focus();
    } else if (box) {
        box.scrollIntoView({ block: 'nearest' });
    }
}

function togglePassword(inputId, button) {
    const input = $(inputId);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
}


// ================= TELAS, NAVEGAÇÃO E ROTAS =================

function showScreen(name) {
    const changed = state.screen !== name;
    state.screen = name;

    SCREENS.forEach(s => $(`screen-${s}`).classList.toggle('hidden', s !== name));

    const inside = Boolean(state.user) && !['login', 'loading'].includes(name);
    $('main-header').classList.toggle('hidden', !inside);
    $('mobile-bottom-nav').classList.toggle('hidden', !inside);
    document.body.classList.toggle('has-bottom-nav', inside);

    const fab = $('fab-history-btn');
    fab.classList.toggle('hidden', name !== 'evolution');
    fab.classList.toggle('flex', name === 'evolution');

    renderNav();
    if (changed) window.scrollTo(0, 0);
}

function navItems() {
    if (!state.user) return [];

    if (state.user.role === 'teacher') {
        return [
            { key: 'teacher', label: 'Validações', icon: 'fa-clipboard-check', action: "go('#/validacoes')", count: state.badges.pending },
            { key: 'patients', label: 'Pacientes', icon: 'fa-users', action: "go('#/pacientes')" }
        ];
    }

    return [
        { key: 'agenda', label: 'Agenda', icon: 'fa-calendar-day', action: "go('#/agenda')", count: state.badges.corrections },
        { key: 'patients', label: 'Pacientes', icon: 'fa-users', action: "go('#/pacientes')" },
        { key: 'evolution', label: 'Evolução', icon: 'fa-notes-medical', action: 'quickNavEvolution()', mobileOnly: true },
        { key: 'history', label: 'Histórico', icon: 'fa-clock-rotate-left', action: 'toggleDrawer(true)', mobileOnly: true }
    ];
}

function renderNav() {
    const items = navItems();

    $('desktop-nav').innerHTML = items.filter(i => !i.mobileOnly).map(i => {
        const active = state.screen === i.key;
        return `
            <button onclick="${i.action}" class="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}" ${active ? 'aria-current="page"' : ''}>
                <i class="fa-solid ${i.icon}"></i> ${i.label}
                ${i.count ? `<span class="min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">${i.count}</span>` : ''}
            </button>`;
    }).join('');

    $('mobile-bottom-nav').innerHTML = items.map(i => {
        const active = state.screen === i.key;
        return `
            <button onclick="${i.action}" class="relative flex flex-col items-center justify-center w-full h-full transition ${active ? 'text-brand-600' : 'text-slate-500 hover:text-brand-600'}" ${active ? 'aria-current="page"' : ''}>
                <i class="fa-solid ${i.icon} text-lg"></i>
                <span class="text-[10px] font-medium mt-1">${i.label}</span>
                ${i.count ? `<span class="absolute top-2 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">${i.count}</span>` : ''}
            </button>`;
    }).join('');
}

function parseHash() {
    const [name = '', param = ''] = location.hash.replace(/^#\/?/, '').split('/');
    return { name, param };
}

function homeHash() {
    return state.user && state.user.role === 'teacher' ? '#/validacoes' : '#/agenda';
}

function go(hash) {
    if (location.hash === hash) {
        handleRoute();
    } else {
        location.hash = hash;
    }
}

function replaceRoute(hash) {
    history.replaceState(null, '', hash);
    handleRoute();
}

function navigateHome() {
    if (state.user) go(homeHash());
}

function handleRoute() {
    const { name, param } = parseHash();

    if (!state.user) {
        if (name && name !== 'login') state.pendingHash = location.hash;
        showScreen('login');
        return;
    }

    // Saindo da tela de evolução: o rascunho fica salvo
    if (state.evo && !['atendimento', 'correcao'].includes(name)) {
        flushDraft();
        state.evo = null;
    }
    if (state.drawer && state.drawer.fromEvolution) toggleDrawer(false);

    if (state.user.role === 'student') {
        if (name === 'agenda') return showAgenda(param);
        if (name === 'pacientes') return showPatients();
        if (name === 'atendimento') return openAttendance(Number(param));
        if (name === 'correcao') return openCorrection(Number(param));
    } else {
        if (name === 'validacoes') return showTeacherDashboard();
        if (name === 'pacientes') return showPatients();
    }

    replaceRoute(homeHash());
}

function refreshView() {
    if (!state.user) return;
    if (state.screen === 'agenda') loadAgenda({ silent: true });
    if (state.screen === 'patients') loadPatients({ silent: true });
    if (state.screen === 'teacher') loadTeacherDashboard({ silent: true });
    if (state.drawer && state.drawer.data) refreshDrawer();
    refreshBadges();
}

async function refreshBadges() {
    if (!state.user) return;
    try {
        if (state.user.role === 'student') {
            state.corrections = await Api.get('/evolutions?status=correction&mine=1');
            state.badges.corrections = state.corrections.length;
            renderCorrections();
        } else {
            const pending = await Api.get('/evolutions?status=pending');
            state.badges.pending = pending.length;
        }
        renderNav();
    } catch (err) { /* contadores são opcionais */ }
}


// ================= LOGIN / SESSÃO =================

const ROLE_BTN_ACTIVE = 'flex-1 py-2 px-3 text-sm font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all flex items-center justify-center gap-2';
const ROLE_BTN_IDLE = 'flex-1 py-2 px-3 text-sm font-semibold rounded-lg text-slate-600 hover:text-slate-800 transition-all flex items-center justify-center gap-2';

function selectRole(role) {
    state.loginRole = role;
    const isStudent = role === 'student';

    $('role-student-btn').className = isStudent ? ROLE_BTN_ACTIVE : ROLE_BTN_IDLE;
    $('role-teacher-btn').className = isStudent ? ROLE_BTN_IDLE : ROLE_BTN_ACTIVE;
    $('role-student-btn').setAttribute('aria-selected', String(isStudent));
    $('role-teacher-btn').setAttribute('aria-selected', String(!isStudent));
    $('login-id-label').innerText = isStudent ? 'Matrícula do Aluno' : 'Registro Funcional (Docente)';
    $('login-id').placeholder = isStudent ? 'Ex: 202301982' : 'Ex: DOC-88392';
    hideLoginError();
}

function fillDemo(role) {
    selectRole(role);
    $('login-id').value = role === 'student' ? '202301982' : 'DOC-88392';
    $('login-password').value = '123456';
    $('login-submit').focus();
}

function showLoginError(message) {
    const box = $('login-error');
    box.innerHTML = `<i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>${esc(message)}</span>`;
    box.classList.remove('hidden');
}

function hideLoginError() {
    $('login-error').classList.add('hidden');
}

function applyRememberedLogin() {
    const saved = readJSON(REMEMBER_KEY);
    if (saved && saved.matricula) {
        selectRole(saved.role === 'teacher' ? 'teacher' : 'student');
        $('login-id').value = saved.matricula;
        $('login-remember').checked = true;
    } else {
        selectRole(state.loginRole);
    }
    $('login-password').value = '';
}

async function handleLogin(e) {
    e.preventDefault();
    hideLoginError();

    const matricula = $('login-id').value.trim();
    const password = $('login-password').value;

    if (!matricula || !password) {
        showLoginError('Informe a matrícula e a senha.');
        (matricula ? $('login-password') : $('login-id')).focus();
        return;
    }

    const button = $('login-submit');
    setBusy(button, true);

    try {
        const { token, user } = await Api.post('/auth/login', { matricula, password, role: state.loginRole });
        const remember = $('login-remember').checked;
        Api.setToken(token, remember);
        if (remember) writeJSON(REMEMBER_KEY, { matricula: user.matricula, role: user.role });
        else removeKey(REMEMBER_KEY);
        $('login-password').value = '';
        startSession(user);
        showToast(user.role === 'student' ? 'Login efetuado com sucesso!' : 'Painel do Docente Acessado', user.role === 'student' ? 'success' : 'info');
    } catch (err) {
        showLoginError(err.message);
        $('login-password').select();
    } finally {
        setBusy(button, false);
    }
}

function startSession(user) {
    state.user = user;
    state.agendaDate = todayISO();
    state.agendaFilter = 'all';
    state.teacherFilter = 'pending';

    $('user-display-name').innerText = user.name;
    $('user-display-role').innerText = user.role === 'student' ? 'Estudante' : 'Professor';

    const target = state.pendingHash || homeHash();
    state.pendingHash = null;
    go(target);
    refreshBadges();
}

function endSession(message, type = 'info') {
    Api.clearToken();
    state.user = null;
    state.evo = null;
    state.agendaItems = [];
    state.patients = [];
    state.teacherItems = [];
    state.badges = { corrections: 0, pending: 0 };
    closeAllOverlays();
    history.replaceState(null, '', '#/login');
    applyRememberedLogin();
    showScreen('login');
    if (message) showToast(message, type);
}

async function handleLogout() {
    flushDraft();
    state.user = null; // evita o aviso de "sessão expirada" caso o token já tenha vencido
    try {
        await Api.post('/auth/logout');
    } catch (err) { /* sessão já encerrada */ }
    endSession('Você saiu do sistema.');
}

function openRegisterModal() {
    const form = $('register-form');
    form.reset();
    clearFormErrors(form);
    form.querySelector(`input[name="reg-role"][value="${state.loginRole}"]`).checked = true;
    updateRegisterLabels();
    openModal('modal-register');
}

function updateRegisterLabels() {
    const role = document.querySelector('input[name="reg-role"]:checked').value;
    $('reg-matricula-label').innerText = role === 'student' ? 'Matrícula' : 'Registro Funcional';
    $('reg-matricula').placeholder = role === 'student' ? 'Ex: 202401234' : 'Ex: DOC-12345';
}

async function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    clearFormErrors(form);

    const data = {
        role: form.querySelector('input[name="reg-role"]:checked').value,
        name: $('reg-name').value,
        matricula: $('reg-matricula').value,
        email: $('reg-email').value,
        password: $('reg-password').value
    };

    const result = S.validateRegistration(data);
    if (!result.ok) return showFormError(form, result.message, result.field);
    if (data.password !== $('reg-password2').value) return showFormError(form, 'As senhas não conferem.', 'password2');

    const button = $('reg-submit');
    setBusy(button, true);

    try {
        const { token, user } = await Api.post('/auth/register', data);
        Api.setToken(token, true);
        writeJSON(REMEMBER_KEY, { matricula: user.matricula, role: user.role });
        closeModal('modal-register');
        startSession(user);
        showToast(`Conta criada! Bem-vindo(a), ${user.name}.`, 'success');
    } catch (err) {
        showFormError(form, err.message, err.field);
    } finally {
        setBusy(button, false);
    }
}

function openResetModal() {
    const form = $('reset-form');
    form.reset();
    clearFormErrors(form);
    $('reset-matricula').value = $('login-id').value.trim();
    openModal('modal-reset');
}

async function handleResetPassword(e) {
    e.preventDefault();
    const form = e.target;
    clearFormErrors(form);

    const matricula = $('reset-matricula').value.trim();
    const email = $('reset-email').value.trim();
    const newPassword = $('reset-password').value;

    if (!matricula) return showFormError(form, 'Informe sua matrícula.', 'matricula');
    if (!S.isValidEmail(email)) return showFormError(form, 'Informe o e-mail cadastrado.', 'email');
    if (newPassword.length < 6) return showFormError(form, 'A nova senha deve ter pelo menos 6 caracteres.', 'password');
    if (newPassword !== $('reset-password2').value) return showFormError(form, 'As senhas não conferem.', 'password2');

    const button = $('reset-submit');
    setBusy(button, true);

    try {
        const { message } = await Api.post('/auth/reset-password', { matricula, email, newPassword });
        closeModal('modal-reset');
        $('login-id').value = S.normalizeMatricula(matricula);
        $('login-password').value = '';
        $('login-password').focus();
        showToast(message, 'success');
    } catch (err) {
        showFormError(form, err.message, err.field);
    } finally {
        setBusy(button, false);
    }
}


// ================= AGENDA DO ALUNO =================

function showAgenda(dateParam) {
    if (dateParam && S.isValidDateISO(dateParam)) state.agendaDate = dateParam;
    showScreen('agenda');
    renderAgendaHeader();
    renderCorrections();
    loadAgenda();
    refreshBadges();
}

function renderAgendaHeader() {
    const date = state.agendaDate;
    const relative = relativeDayLabel(date);

    $('agenda-date').value = date;
    $('current-date-display').innerText = formatDateLong(date);
    $('agenda-relative-badge').innerText = relative;
    $('agenda-relative-badge').classList.toggle('hidden', !relative);
    $('agenda-list-title').innerText = date === todayISO() ? 'Lista de Pacientes do Dia' : `Pacientes de ${formatDate(date)}`;
}

function setAgendaDate(iso) {
    if (!S.isValidDateISO(iso)) return;
    state.agendaDate = iso;
    go(`#/agenda/${iso}`);
}

function changeAgendaDate(delta) {
    setAgendaDate(S.addDays(state.agendaDate, delta));
}

async function loadAgenda({ silent = false } = {}) {
    const container = $('patient-list-container');
    const requestId = ++state.agendaRequest;
    const date = state.agendaDate;

    if (!silent) container.innerHTML = loadingBlock('Carregando agenda...');

    try {
        const items = await Api.get(`/appointments?date=${date}`);
        if (requestId !== state.agendaRequest) return;
        state.agendaItems = items;
        renderAgenda();
    } catch (err) {
        if (requestId !== state.agendaRequest) return;
        container.innerHTML = errorBlock(err.message, 'loadAgenda()');
    }
}

function matchAgendaFilter(item) {
    if (state.agendaFilter === 'pending') return item.status === 'pending' || item.status === 'attending';
    if (state.agendaFilter === 'all') return true;
    return item.status === state.agendaFilter;
}

function setAgendaFilter(filter) {
    state.agendaFilter = state.agendaFilter === filter ? 'all' : filter;
    renderAgenda();
}

function clearAgendaFilters() {
    state.agendaFilter = 'all';
    $('search-patient').value = '';
    renderAgenda();
}

function renderAgenda() {
    const container = $('patient-list-container');
    const items = state.agendaItems;

    $('stat-total').innerText = items.length;
    $('stat-pending').innerText = items.filter(i => i.status === 'pending' || i.status === 'attending').length;
    $('stat-completed').innerText = items.filter(i => i.status === 'completed').length;
    $('stat-absent').innerText = items.filter(i => i.status === 'absent').length;

    document.querySelectorAll('.agenda-stat').forEach(btn => {
        const active = btn.dataset.filter === state.agendaFilter && state.agendaFilter !== 'all';
        btn.classList.toggle('ring-2', active);
        btn.classList.toggle('ring-brand-500', active);
        btn.setAttribute('aria-pressed', String(active));
    });

    const term = $('search-patient').value.trim().toLowerCase();
    const digits = S.onlyDigits(term);
    const filtered = items
        .filter(matchAgendaFilter)
        .filter(i => !term || i.patient.name.toLowerCase().includes(term) || (digits && S.onlyDigits(i.patient.cpf).includes(digits)));

    if (!items.length) {
        container.innerHTML = emptyBlock(
            'fa-regular fa-calendar',
            `Nenhuma sessão agendada para ${relativeDayLabel(state.agendaDate).toLowerCase() || formatDate(state.agendaDate)}.`,
            'Cadastre um novo paciente ou agende uma sessão a partir da lista de pacientes.',
            `<button onclick="openAnamneseModal()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold"><i class="fa-solid fa-user-plus mr-1"></i> Novo paciente</button>
             <button onclick="go('#/pacientes')" class="${BTN_SECONDARY}"><i class="fa-solid fa-users mr-1"></i> Ver pacientes</button>`
        );
        return;
    }

    if (!filtered.length) {
        container.innerHTML = emptyBlock(
            'fa-solid fa-filter-circle-xmark',
            'Nenhum paciente encontrado com esse filtro.',
            '',
            `<button onclick="clearAgendaFilters()" class="${BTN_SECONDARY}">Limpar filtros</button>`
        );
        return;
    }

    container.innerHTML = filtered.map(agendaRow).join('');
}

function agendaRow(item) {
    const me = state.user.id;
    const patient = item.patient;
    const evo = item.evolution;
    const hasDraft = item.status !== 'completed' && Boolean(readJSON(draftKey('appt', item.id)));

    let chips = badge(APPT_STATUS[item.status]);
    if (item.status === 'attending' && item.studentName) {
        chips += `<span class="text-[10px] text-blue-600 font-medium">por ${esc(item.studentId === me ? 'você' : item.studentName)}</span>`;
    }
    if (evo) chips += badge(EVO_STATUS[evo.status], EVO_STATUS[evo.status].short);
    if (hasDraft) {
        chips += '<span class="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold border bg-slate-100 text-slate-600 border-slate-200"><i class="fa-regular fa-floppy-disk mr-1"></i>Rascunho</span>';
    }

    let actions = '';
    if (item.status === 'pending') {
        actions = `
            <button onclick="cancelAppointment(${item.id})" class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Desmarcar sessão" aria-label="Desmarcar sessão">
                <i class="fa-regular fa-trash-can"></i>
            </button>
            <button onclick="markAbsent(${item.id})" class="px-3 py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 rounded-xl text-xs font-semibold transition active:scale-95" title="Registrar Falta">
                <i class="fa-solid fa-user-xmark mr-1"></i> Falta
            </button>
            <button onclick="startEvolution(${item.id})" class="${BTN_PRIMARY}">
                <i class="fa-solid fa-stethoscope"></i>
                <span>${hasDraft ? 'Continuar Evolução' : 'Atender / Evoluir'}</span>
            </button>`;
    } else if (item.status === 'attending') {
        actions = item.studentId === me
            ? `<button onclick="startEvolution(${item.id})" class="${BTN_PRIMARY.replace('bg-brand-600 hover:bg-brand-700', 'bg-blue-600 hover:bg-blue-700')}">
                   <i class="fa-solid fa-stethoscope"></i><span>Continuar Atendimento</span>
               </button>`
            : `<span class="text-xs text-slate-400"><i class="fa-solid fa-lock mr-1"></i>Em atendimento por ${esc(item.studentName)}</span>`;
    } else if (item.status === 'completed') {
        const canFix = evo && evo.status === 'correction' && evo.studentId === me;
        actions = `
            <button onclick="openScheduleModal(${patient.id}, '${item.time}')" class="${BTN_SECONDARY}" title="Agendar retorno">
                <i class="fa-regular fa-calendar-plus mr-1"></i> Retorno
            </button>
            ${canFix ? `<button onclick="go('#/correcao/${evo.id}')" class="${BTN_PRIMARY.replace('bg-brand-600 hover:bg-brand-700', 'bg-orange-500 hover:bg-orange-600')}"><i class="fa-solid fa-pen-to-square"></i><span>Corrigir</span></button>` : ''}
            ${evo ? `<button onclick="openEvolutionView(${evo.id})" class="${canFix ? BTN_SECONDARY : BTN_PRIMARY}"><i class="fa-regular fa-file-lines${canFix ? ' mr-1' : ''}"></i><span>Revisar</span></button>` : ''}`;
    } else if (item.status === 'absent') {
        actions = `
            <button onclick="undoAbsent(${item.id})" class="${BTN_SECONDARY}">
                <i class="fa-solid fa-rotate-left mr-1"></i> Desfazer falta
            </button>
            <button onclick="openScheduleModal(${patient.id}, '${item.time}')" class="${BTN_PRIMARY}">
                <i class="fa-regular fa-calendar-plus"></i><span>Reagendar</span>
            </button>`;
    }

    return `
        <div class="p-3.5 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50 transition">
            <div class="flex items-center gap-3 w-full sm:w-auto min-w-0">
                <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-600 text-xs sm:text-sm border border-slate-200 shrink-0">
                    ${esc(item.time)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button onclick="openPatientRecord(${patient.id})" class="font-bold text-slate-800 text-sm sm:text-base truncate hover:text-brand-700 hover:underline text-left" title="Abrir prontuário">${esc(patient.name)}</button>
                        ${chips}
                    </div>
                    <p class="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate">${esc(specialtyLabel(patient))} • ${patient.age} anos</p>
                </div>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-2.5 sm:pt-0 border-slate-100 shrink-0">
                ${actions}
            </div>
        </div>`;
}

function renderCorrections() {
    const panel = $('corrections-panel');
    const items = state.corrections;

    if (!items.length) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    panel.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div class="flex-1 min-w-0">
                <h3 class="font-bold text-amber-900 text-sm">${items.length === 1 ? '1 evolução precisa de correção' : `${items.length} evoluções precisam de correção`}</h3>
                <p class="text-xs text-amber-800/80 mt-0.5">O professor orientador revisou e pediu ajustes. Corrija e reenvie para validação.</p>
                <div class="mt-3 space-y-2">
                    ${items.map(e => `
                        <div class="bg-white/80 border border-amber-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-xs font-bold text-slate-800">${esc(e.patient.name)} <span class="font-normal text-slate-500">• sessão de ${formatDate(e.appointment.date)}</span></p>
                                <p class="text-xs text-slate-600 mt-0.5"><i class="fa-regular fa-comment mr-1 text-amber-500"></i><strong>${esc(e.reviewerName)}:</strong> “${esc(e.feedback)}”</p>
                            </div>
                            <button onclick="go('#/correcao/${e.id}')" class="shrink-0 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95">
                                <i class="fa-solid fa-pen-to-square mr-1"></i> Corrigir
                            </button>
                        </div>`).join('')}
                </div>
            </div>
        </div>`;
    panel.classList.remove('hidden');
}

function findAgendaItem(id) {
    return state.agendaItems.find(i => i.id === id);
}

async function markAbsent(id) {
    const item = findAgendaItem(id);
    try {
        await Api.patch(`/appointments/${id}/status`, { status: 'absent' });
        showToast(`Falta registrada para ${item ? item.patient.name : 'o paciente'}`, 'info', {
            actionLabel: 'Desfazer',
            onAction: () => undoAbsent(id)
        });
    } catch (err) {
        showToast(err.message, 'error');
    }
    loadAgenda({ silent: true });
}

async function undoAbsent(id) {
    try {
        await Api.patch(`/appointments/${id}/status`, { status: 'pending' });
        showToast('Falta desfeita. O paciente voltou para "Aguardando".', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
    loadAgenda({ silent: true });
}

async function cancelAppointment(id) {
    const item = findAgendaItem(id);
    if (!item) return;

    const ok = await confirmDialog({
        title: 'Desmarcar sessão?',
        message: `A sessão de ${item.patient.name} em ${formatDate(item.date)} às ${item.time} será removida da agenda.`,
        confirmText: 'Desmarcar',
        cancelText: 'Manter sessão',
        tone: 'danger',
        icon: 'fa-calendar-xmark'
    });
    if (!ok) return;

    try {
        await Api.del(`/appointments/${id}`);
        removeKey(draftKey('appt', id));
        showToast('Sessão desmarcada.', 'info');
    } catch (err) {
        showToast(err.message, 'error');
    }
    loadAgenda({ silent: true });
}

function startEvolution(appointmentId) {
    go(`#/atendimento/${appointmentId}`);
}


// ================= PACIENTES =================

function showPatients() {
    showScreen('patients');
    $('patients-new-btn').classList.toggle('hidden', state.user.role !== 'student');
    loadPatients();
}

async function loadPatients({ silent = false } = {}) {
    const container = $('patients-container');
    if (!silent) container.innerHTML = loadingBlock('Carregando pacientes...');

    try {
        state.patients = await Api.get(`/patients?from=${todayISO()}`);
        renderPatients();
    } catch (err) {
        container.innerHTML = errorBlock(err.message, 'loadPatients()');
    }
}

function renderPatients() {
    const container = $('patients-container');
    const isStudent = state.user.role === 'student';
    const term = $('search-patients').value.trim().toLowerCase();
    const digits = S.onlyDigits(term);

    const filtered = state.patients.filter(p =>
        !term || p.name.toLowerCase().includes(term) || (digits && S.onlyDigits(p.cpf).includes(digits)));

    $('patients-count').innerText = term
        ? `${plural(filtered.length, 'paciente encontrado', 'pacientes encontrados')}`
        : `${plural(state.patients.length, 'paciente cadastrado', 'pacientes cadastrados')}`;

    if (!state.patients.length) {
        container.innerHTML = emptyBlock('fa-solid fa-users', 'Nenhum paciente cadastrado ainda.', '',
            isStudent ? '<button onclick="openAnamneseModal()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold"><i class="fa-solid fa-user-plus mr-1"></i> Cadastrar paciente</button>' : '');
        return;
    }

    if (!filtered.length) {
        container.innerHTML = emptyBlock('fa-solid fa-magnifying-glass', `Nenhum paciente encontrado para “${term}”.`, 'Confira o nome ou CPF digitado.');
        return;
    }

    container.innerHTML = filtered.map(p => `
        <div class="p-3.5 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50 transition">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-brand-50 text-brand-700 font-bold text-xs sm:text-sm flex items-center justify-center border border-brand-100 shrink-0">${esc(initials(p.name))}</div>
                <div class="min-w-0">
                    <button onclick="openPatientRecord(${p.id})" class="font-bold text-slate-800 text-sm sm:text-base hover:text-brand-700 hover:underline text-left">${esc(p.name)}</button>
                    <p class="text-[11px] sm:text-xs text-slate-500 mt-0.5">CPF ${esc(p.cpf)} • ${p.age} anos${p.phone ? ` • ${esc(p.phone)}` : ''}</p>
                    <p class="text-[11px] sm:text-xs text-slate-500 truncate">${esc(specialtyLabel(p))}</p>
                </div>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 md:gap-4 w-full md:w-auto border-t md:border-t-0 pt-2.5 md:pt-0 border-slate-100 shrink-0">
                <div class="text-[11px] text-slate-500 sm:text-right flex-1">
                    ${p.nextAppointment
                        ? `<span class="text-brand-700 font-semibold"><i class="fa-regular fa-calendar mr-1"></i>Próxima: ${friendlyDate(p.nextAppointment.date)} às ${esc(p.nextAppointment.time)}</span>`
                        : '<span class="text-slate-400">Sem sessões agendadas</span>'}
                    <span class="block">${plural(p.evolutionCount, 'evolução', 'evoluções')}${p.lastVisit ? ` • última sessão em ${formatDate(p.lastVisit)}` : ''}</span>
                </div>
                <div class="flex items-center gap-2 justify-end">
                    <button onclick="openPatientRecord(${p.id})" class="${BTN_SECONDARY}"><i class="fa-solid fa-folder-open mr-1"></i> Prontuário</button>
                    ${isStudent ? `<button onclick="openScheduleModal(${p.id})" class="${BTN_PRIMARY}"><i class="fa-regular fa-calendar-plus"></i><span>Agendar</span></button>` : ''}
                </div>
            </div>
        </div>`).join('');
}

async function openAnamneseModal(patientId = null) {
    const form = $('anamnese-form');
    form.reset();
    clearFormErrors(form);
    state.editingPatientId = patientId;

    const editing = Boolean(patientId);
    $('anamnese-title').querySelector('span').innerText = editing ? 'Editar Cadastro do Paciente' : 'Cadastro de Anamnese Inicial';
    $('ana-schedule-fields').classList.toggle('hidden', editing);
    $('ana-submit').innerText = editing ? 'Salvar Alterações' : 'Salvar & Incluir na Agenda';

    if (editing) {
        try {
            const { patient } = await Api.get(`/patients/${patientId}`);
            $('ana-name').value = patient.name;
            $('ana-cpf').value = patient.cpf;
            $('ana-age').value = patient.age;
            $('ana-phone').value = patient.phone;
            $('ana-type').value = patient.specialty;
            $('ana-diagnosis').value = patient.diagnosis;
            $('ana-history').value = patient.history;
        } catch (err) {
            showToast(err.message, 'error');
            return;
        }
    } else {
        const today = todayISO();
        $('ana-date').min = today;
        $('ana-date').value = state.agendaDate >= today ? state.agendaDate : today;
        $('ana-time').value = '14:00';
    }

    openModal('modal-anamnese');
}

async function handleSaveAnamnese(e) {
    e.preventDefault();
    const form = e.target;
    clearFormErrors(form);

    const editing = Boolean(state.editingPatientId);
    const data = {
        name: $('ana-name').value,
        cpf: $('ana-cpf').value,
        age: $('ana-age').value,
        phone: $('ana-phone').value,
        specialty: $('ana-type').value,
        diagnosis: $('ana-diagnosis').value,
        history: $('ana-history').value
    };

    const result = S.validatePatient(data);
    if (!result.ok) return showFormError(form, result.message, result.field);

    let appointment = null;
    if (!editing) {
        appointment = { date: $('ana-date').value, time: $('ana-time').value };
        const appt = S.validateAppointment(appointment);
        if (!appt.ok) return showFormError(form, appt.message, appt.field);
        if (appointment.date < todayISO()) return showFormError(form, 'A primeira sessão não pode ser agendada em uma data passada.', 'date');
    }

    const button = $('ana-submit');
    setBusy(button, true);

    try {
        if (editing) {
            await Api.put(`/patients/${state.editingPatientId}`, data);
            closeModal('modal-anamnese');
            showToast('Cadastro do paciente atualizado.', 'success');
        } else {
            await Api.post('/patients', { ...data, appointment });
            closeModal('modal-anamnese');
            const onOtherDay = state.screen !== 'agenda' || appointment.date !== state.agendaDate;
            showToast(`Novo paciente cadastrado na agenda de ${friendlyDate(appointment.date).toLowerCase()} às ${appointment.time}!`, 'success',
                onOtherDay ? { actionLabel: 'Ver agenda', onAction: () => setAgendaDate(appointment.date) } : {});
        }
        refreshView();
    } catch (err) {
        showFormError(form, err.message, err.field);
    } finally {
        setBusy(button, false);
    }
}

function knownPatient(patientId) {
    const fromList = state.patients.find(p => p.id === patientId);
    if (fromList) return fromList;
    const fromAgenda = state.agendaItems.find(i => i.patient.id === patientId);
    if (fromAgenda) return fromAgenda.patient;
    if (state.drawer && state.drawer.data && state.drawer.data.patient.id === patientId) return state.drawer.data.patient;
    return null;
}

function openScheduleModal(patientId, time = '08:00') {
    const form = $('schedule-form');
    form.reset();
    clearFormErrors(form);
    state.schedulePatientId = patientId;

    const patient = knownPatient(patientId);
    $('schedule-patient-name').innerText = patient ? `Paciente: ${patient.name}` : '';
    $('schedule-date').min = todayISO();
    $('schedule-date').value = S.addDays(todayISO(), 7);
    $('schedule-time').value = time;

    openModal('modal-schedule');
}

async function handleSchedule(e) {
    e.preventDefault();
    const form = e.target;
    clearFormErrors(form);

    const data = { date: $('schedule-date').value, time: $('schedule-time').value };
    const result = S.validateAppointment(data);
    if (!result.ok) return showFormError(form, result.message, result.field);
    if (data.date < todayISO()) return showFormError(form, 'Escolha uma data a partir de hoje.', 'date');

    const button = $('schedule-submit');
    setBusy(button, true);

    try {
        await Api.post('/appointments', { patientId: state.schedulePatientId, ...data });
        closeModal('modal-schedule');
        showToast(`Sessão agendada para ${formatDateLong(data.date).toLowerCase()} às ${data.time}.`, 'success', {
            actionLabel: 'Ver na agenda',
            onAction: () => {
                toggleDrawer(false);
                setAgendaDate(data.date);
            }
        });
        refreshView();
    } catch (err) {
        showFormError(form, err.message, err.field);
    } finally {
        setBusy(button, false);
    }
}


// ================= ATENDIMENTO / EVOLUÇÃO SOAP =================

function draftKey(kind, id) {
    return `physioedu_draft_${state.user.id}_${kind}_${id}`;
}

function activeKey() {
    return `physioedu_active_${state.user.id}`;
}

// Evita abrir uma tela depois que o usuário já navegou para outra durante o carregamento
function stillOn(hash) {
    return location.hash === hash;
}

async function openAttendance(appointmentId) {
    if (!appointmentId) return replaceRoute('#/agenda');
    if (state.evo && state.evo.mode === 'new' && state.evo.appointment.id === appointmentId) return showScreen('evolution');

    flushDraft();
    state.evo = null;
    const route = location.hash;
    showScreen('loading');

    let data;
    try {
        data = await Api.get(`/appointments/${appointmentId}`);
    } catch (err) {
        showToast(err.message, 'error');
        return replaceRoute('#/agenda');
    }
    if (!stillOn(route)) return;

    const { appointment, patient, evolution } = data;
    const backToAgenda = () => replaceRoute(`#/agenda/${appointment.date}`);

    if (appointment.status === 'completed') {
        if (readJSON(activeKey()) === appointment.id) removeKey(activeKey());
        if (evolution && evolution.status === 'correction' && evolution.studentId === state.user.id) {
            return replaceRoute(`#/correcao/${evolution.id}`);
        }
        backToAgenda();
        if (evolution) openEvolutionView(evolution.id);
        return;
    }

    if (appointment.status === 'absent') {
        showToast('Paciente marcado como falta. Desfaça a falta para iniciar o atendimento.', 'warning');
        return backToAgenda();
    }

    if (appointment.status !== 'attending' || appointment.studentId !== state.user.id) {
        try {
            const res = await Api.patch(`/appointments/${appointment.id}/status`, { status: 'attending' });
            Object.assign(appointment, res.appointment);
        } catch (err) {
            showToast(err.message, 'error');
            return backToAgenda();
        }
    }
    if (!stillOn(route)) return;

    state.evo = { mode: 'new', appointment, patient, evolution: null, key: draftKey('appt', appointment.id) };
    writeJSON(activeKey(), appointment.id);
    setupEvolutionScreen();
}

async function openCorrection(evolutionId) {
    if (!evolutionId) return replaceRoute('#/agenda');
    if (state.evo && state.evo.mode === 'edit' && state.evo.evolution.id === evolutionId) return showScreen('evolution');

    flushDraft();
    state.evo = null;
    const route = location.hash;
    showScreen('loading');

    let data;
    try {
        data = await Api.get(`/evolutions/${evolutionId}`);
    } catch (err) {
        showToast(err.message, 'error');
        return replaceRoute('#/agenda');
    }
    if (!stillOn(route)) return;

    const { evolution, patient, appointment } = data;

    if (evolution.studentId !== state.user.id) {
        showToast('Apenas o autor da evolução pode corrigi-la.', 'error');
        return replaceRoute('#/agenda');
    }

    if (evolution.status !== 'correction') {
        showToast(evolution.status === 'approved' ? 'Esta evolução já foi aprovada.' : 'Esta evolução já foi reenviada e aguarda validação.', 'info');
        replaceRoute(`#/agenda/${appointment.date}`);
        return openEvolutionView(evolution.id);
    }

    state.evo = { mode: 'edit', appointment, patient, evolution, key: draftKey('evo', evolution.id) };
    setupEvolutionScreen();
}

function setupEvolutionScreen() {
    const { mode, appointment, patient, evolution } = state.evo;
    const editing = mode === 'edit';

    $('evo-patient-name').innerText = patient.name;
    $('evo-patient-meta').innerText = `CPF: ${patient.cpf} | Idade: ${patient.age} anos | ${specialtyLabel(patient)} | Sessão: ${formatDate(appointment.date)} às ${appointment.time}`;

    const badgeEl = $('evo-patient-badge');
    badgeEl.innerText = editing ? 'Correção Solicitada' : 'Em Atendimento';
    badgeEl.className = `px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold ${editing ? 'bg-orange-100 text-orange-800' : 'bg-brand-100 text-brand-800'}`;

    $('evo-correction-banner').classList.toggle('hidden', !editing);
    if (editing) {
        $('evo-correction-title').innerText = `Correção solicitada por ${evolution.reviewerName}${evolution.reviewedAt ? ` em ${formatDateTime(evolution.reviewedAt)}` : ''}`;
        $('evo-correction-text').innerText = evolution.feedback;
    }

    $('evo-submit-label').innerText = editing ? 'Reenviar para Validação' : 'Finalizar Atendimento';
    $('evo-cancel-btn').innerText = editing ? 'Voltar' : 'Cancelar Atendimento';
    $('evo-form-error').classList.add('hidden');
    $('evolution-form').querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));

    const draft = readJSON(state.evo.key);
    if (draft && draft.data) {
        applyEvolutionForm(draft.data);
        setDraftStatus(draft.savedAt);
        showToast('Rascunho restaurado. Continue de onde parou.', 'info');
    } else {
        applyEvolutionForm(editing ? evolution : EMPTY_EVOLUTION);
        setDraftStatus(null);
    }

    switchSoapTab('tab-subjetivo');
    updateTabIndicators();
    showScreen('evolution');
}

function collectEvolutionForm() {
    return {
        eva: Number($('soap-eva').value),
        subjective: $('soap-subjetivo-text').value,
        pa: $('soap-pa').value,
        fc: $('soap-fc').value,
        spo2: $('soap-spo2').value,
        objective: $('soap-objetivo-text').value,
        procedures: Array.from(document.querySelectorAll('.soap-conduta-check:checked'), cb => cb.value),
        conduct: $('soap-conduta-text').value,
        plan: $('soap-plano-text').value
    };
}

function applyEvolutionForm(data) {
    $('soap-eva').value = data.eva ?? 5;
    updateEvaDisplay();
    $('soap-subjetivo-text').value = data.subjective || '';
    $('soap-pa').value = data.pa || '';
    $('soap-fc').value = data.fc || '';
    $('soap-spo2').value = data.spo2 || '';
    $('soap-objetivo-text').value = data.objective || '';
    $('soap-conduta-text').value = data.conduct || '';
    $('soap-plano-text').value = data.plan || '';
    document.querySelectorAll('.soap-conduta-check').forEach(cb => {
        cb.checked = (data.procedures || []).includes(cb.value);
    });
}

function updateEvaDisplay() {
    $('eva-value-display').innerText = `${$('soap-eva').value} / 10`;
}

function switchSoapTab(tabId) {
    state.soapTab = tabId;
    document.querySelectorAll('.soap-tab-content').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.soap-tab-btn').forEach(btn => {
        btn.classList.remove('border-brand-600', 'text-brand-600');
        btn.classList.add('border-transparent', 'text-slate-500');
        btn.setAttribute('aria-selected', 'false');
    });

    $(tabId).classList.remove('hidden');

    const activeBtn = $('btn-' + tabId);
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
    activeBtn.classList.add('border-brand-600', 'text-brand-600');
    activeBtn.setAttribute('aria-selected', 'true');
    activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const index = SOAP_TABS.indexOf(tabId);
    $('evo-prev-btn').classList.toggle('invisible', index === 0);
    $('evo-next-btn').classList.toggle('invisible', index === SOAP_TABS.length - 1);
}

function stepSoapTab(delta) {
    const index = SOAP_TABS.indexOf(state.soapTab) + delta;
    if (index >= 0 && index < SOAP_TABS.length) switchSoapTab(SOAP_TABS[index]);
}

function updateTabIndicators() {
    const d = collectEvolutionForm();
    const filled = {
        'tab-subjetivo': d.subjective.trim().length >= 3,
        'tab-objetivo': Boolean(d.pa.trim() || d.fc.trim() || d.spo2.trim() || d.objective.trim()),
        'tab-avaliacao': d.conduct.trim().length >= 3,
        'tab-plano': Boolean(d.plan.trim())
    };
    SOAP_TABS.forEach(tab => $(`btn-${tab}`).querySelector('.tab-check').classList.toggle('hidden', !filled[tab]));
}

let draftTimer = null;

function isEvolutionEmpty(d) {
    return !d.subjective.trim() && !d.pa.trim() && !d.fc.trim() && !d.spo2.trim() && !d.objective.trim()
        && !d.conduct.trim() && !d.plan.trim() && !d.procedures.length && d.eva === 5;
}

function saveDraft(silent = false) {
    if (!state.evo) return;
    clearTimeout(draftTimer);

    const data = collectEvolutionForm();
    if (state.evo.mode === 'new' && isEvolutionEmpty(data)) {
        removeKey(state.evo.key);
        setDraftStatus(null);
        if (!silent) showToast('Nada para salvar ainda: preencha algum campo da evolução.', 'info');
        return;
    }

    const savedAt = new Date().toISOString();
    writeJSON(state.evo.key, { data, savedAt });
    setDraftStatus(savedAt);
    if (!silent) showToast('Rascunho salvo neste dispositivo!', 'success');
}

function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(true), 700);
    updateTabIndicators();
    $('evo-form-error').classList.add('hidden');
}

function flushDraft() {
    if (state.evo) saveDraft(true);
}

function setDraftStatus(savedAt) {
    $('draft-status').innerText = savedAt ? `Rascunho salvo às ${formatTime(savedAt)}` : '';
}

function showEvolutionError(field, message) {
    const box = $('evo-form-error');
    box.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> ${esc(message)}`;
    box.classList.remove('hidden');

    if (FIELD_TAB[field]) switchSoapTab(FIELD_TAB[field]);
    const input = $(FIELD_INPUT[field]);
    if (input) {
        input.classList.add('field-invalid');
        input.focus();
    }
    showToast(message, 'error');
}

async function handleFinishEvolution(e) {
    e.preventDefault();
    if (!state.evo) return;

    const { mode, appointment, patient, evolution } = state.evo;
    const data = collectEvolutionForm();
    const result = S.validateEvolution(data);
    if (!result.ok) return showEvolutionError(result.field, result.message);

    const ok = await confirmDialog(mode === 'edit'
        ? {
            title: 'Reenviar evolução corrigida?',
            message: 'A evolução volta para a fila de validação do professor orientador.',
            confirmText: 'Reenviar',
            icon: 'fa-paper-plane'
        }
        : {
            title: 'Finalizar atendimento?',
            message: `A evolução de ${patient.name} será enviada para validação do professor orientador. Depois de enviada, ela só poderá ser editada se o professor solicitar correção.`,
            confirmText: 'Enviar para validação',
            cancelText: 'Revisar antes',
            icon: 'fa-paper-plane'
        });
    if (!ok || !state.evo) return;

    const button = $('evo-submit-btn');
    setBusy(button, true);

    try {
        if (mode === 'edit') {
            await Api.put(`/evolutions/${evolution.id}`, data);
        } else {
            await Api.post('/evolutions', { appointmentId: appointment.id, ...data });
            removeKey(activeKey());
        }
        clearTimeout(draftTimer);
        removeKey(state.evo.key);
        state.evo = null;
        showToast(mode === 'edit' ? 'Evolução corrigida e reenviada para validação!' : 'Evolução gravada com sucesso!', 'success');
        go(`#/agenda/${appointment.date}`);
    } catch (err) {
        if (err.field && FIELD_INPUT[err.field]) showEvolutionError(err.field, err.message);
        else showToast(err.message, 'error');
    } finally {
        setBusy(button, false);
    }
}

async function cancelEvolution() {
    if (!state.evo) return navigateHome();
    const { mode, appointment } = state.evo;

    if (mode === 'edit') {
        flushDraft();
        return go(`#/agenda/${appointment.date}`);
    }

    const ok = await confirmDialog({
        title: 'Cancelar atendimento?',
        message: 'O paciente volta para "Aguardando" na agenda. O que você já escreveu fica salvo como rascunho neste dispositivo.',
        confirmText: 'Cancelar atendimento',
        cancelText: 'Continuar atendendo',
        tone: 'danger',
        icon: 'fa-circle-xmark'
    });
    if (!ok || !state.evo) return;

    flushDraft();
    try {
        await Api.patch(`/appointments/${appointment.id}/status`, { status: 'pending' });
    } catch (err) {
        showToast(err.message, 'error');
    }
    removeKey(activeKey());
    state.evo = null;
    go(`#/agenda/${appointment.date}`);
}

// Botão "voltar" da tela de evolução: sai sem cancelar o atendimento
function leaveEvolution() {
    if (!state.evo) return navigateHome();
    const { mode, appointment } = state.evo;
    flushDraft();
    go(`#/agenda/${appointment.date}`);
    showToast(mode === 'edit' ? 'Correção salva como rascunho.' : 'Atendimento segue em andamento. O rascunho foi salvo.', 'info');
}

function quickNavEvolution() {
    if (state.evo) return showScreen('evolution');

    const active = readJSON(activeKey());
    if (active) return go(`#/atendimento/${active}`);

    const mine = state.agendaItems.find(i => i.status === 'attending' && i.studentId === state.user.id);
    if (mine) return go(`#/atendimento/${mine.id}`);

    showToast('Selecione um paciente na agenda primeiro', 'info');
}


// ================= PRONTUÁRIO (GAVETA DE HISTÓRICO) =================

function toggleDrawer(show) {
    const drawer = $('drawer-history');

    if (!show) {
        drawer.classList.add('hidden');
        state.drawer = null;
        return;
    }

    if (state.evo) {
        openPatientRecord(state.evo.patient.id, { fromEvolution: true });
        return;
    }

    showToast('Selecione um paciente para consultar o prontuário.', 'info');
    go('#/pacientes');
}

async function openPatientRecord(patientId, { fromEvolution = false } = {}) {
    state.drawer = { patientId, fromEvolution, data: null };

    $('drawer-patient-name').innerText = 'Carregando...';
    $('history-timeline-container').innerHTML = loadingBlock('Carregando prontuário...');
    renderDrawerFooter();
    $('drawer-history').classList.remove('hidden');

    await refreshDrawer();
}

async function refreshDrawer() {
    if (!state.drawer) return;
    const { patientId } = state.drawer;

    try {
        const data = await Api.get(`/patients/${patientId}`);
        if (!state.drawer || state.drawer.patientId !== patientId) return;
        state.drawer.data = data;
        renderPatientRecord();
    } catch (err) {
        if (state.drawer && !state.drawer.data) {
            $('history-timeline-container').innerHTML = errorBlock(err.message, `openPatientRecord(${patientId})`);
        }
    }
}

function renderDrawerFooter() {
    const footer = $('drawer-footer');
    const closeLabel = state.drawer.fromEvolution ? 'Voltar para a Evolução Atual' : 'Fechar';

    footer.innerHTML = `
        ${!state.drawer.fromEvolution && state.user.role === 'student' ? `
            <button onclick="openAnamneseModal(${state.drawer.patientId})" class="w-full py-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition active:scale-[0.98]">
                <i class="fa-regular fa-pen-to-square mr-1"></i> Editar cadastro
            </button>
            <button onclick="openScheduleModal(${state.drawer.patientId})" class="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs rounded-xl transition active:scale-[0.98]">
                <i class="fa-regular fa-calendar-plus mr-1"></i> Agendar sessão
            </button>` : ''}
        <button onclick="toggleDrawer(false)" class="w-full py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-xl transition active:scale-[0.98]">
            ${closeLabel}
        </button>`;
}

function renderPatientRecord() {
    const { patient, appointments, evolutions } = state.drawer.data;
    const container = $('history-timeline-container');
    const today = todayISO();

    $('drawer-patient-name').innerText = `${patient.name} - Prontuário #${patient.id}`;

    const upcoming = appointments
        .filter(a => a.date >= today && ['pending', 'attending'].includes(a.status))
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    const field = (label, value) => `
        <div>
            <dt class="text-[10px] font-semibold text-slate-400 uppercase">${label}</dt>
            <dd class="text-slate-700 font-medium">${esc(value || '—')}</dd>
        </div>`;

    container.innerHTML = `
        <section class="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3 text-xs">
            <h4 class="font-bold text-slate-700 flex items-center gap-2"><i class="fa-regular fa-id-card text-brand-600"></i> Dados do paciente</h4>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2">
                ${field('CPF', patient.cpf)}
                ${field('Idade', `${patient.age} anos`)}
                ${field('Telefone', patient.phone)}
                ${field('Especialidade', patient.specialty)}
            </dl>
            ${patient.diagnosis ? `<div>${field('Diagnóstico clínico', patient.diagnosis)}</div>` : ''}
            <div>
                <p class="text-[10px] font-semibold text-slate-400 uppercase">Queixa principal (QP) & HDA</p>
                <p class="text-slate-700 whitespace-pre-line mt-0.5">${esc(patient.history)}</p>
            </div>
        </section>

        ${upcoming.length ? `
            <section class="p-3.5 bg-brand-50/60 border border-brand-100 rounded-xl text-xs space-y-2">
                <h4 class="font-bold text-brand-800 flex items-center gap-2"><i class="fa-regular fa-calendar"></i> Próximas sessões</h4>
                <div class="flex flex-wrap gap-1.5">
                    ${upcoming.map(a => `<span class="px-2 py-1 bg-white border border-brand-100 rounded-lg font-semibold text-brand-700">${friendlyDate(a.date)} às ${esc(a.time)}</span>`).join('')}
                </div>
            </section>` : ''}

        <h4 class="font-bold text-slate-700 text-xs pt-1 flex items-center gap-2"><i class="fa-solid fa-clock-rotate-left text-indigo-600"></i> Evoluções (${evolutions.length})</h4>
        ${evolutions.length
            ? evolutions.map(historyCard).join('')
            : '<p class="text-xs text-slate-400 text-center py-8">Nenhum atendimento anterior registrado para este paciente.</p>'}
    `;
}

function historyCard(h) {
    const status = EVO_STATUS[h.status];
    const label = h.status === 'approved' && h.reviewerName ? `Aprovado por ${h.reviewerName}` : status.label;
    const vitals = vitalsText(h);

    return `
        <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2 font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex-wrap">
                <span class="text-brand-700"><i class="fa-regular fa-calendar-check mr-1"></i> Data: ${formatDate(h.appointment.date)}</span>
                ${badge(status, label)}
            </div>
            <p><strong>Estagiário:</strong> ${esc(h.studentName)}</p>
            <p><strong>EVA (Dor):</strong> ${h.eva} / 10${vitals ? ` • ${esc(vitals)}` : ''}</p>
            <p><strong>S (Subjetivo):</strong> ${esc(h.subjective)}</p>
            <p><strong>O (Objetivo):</strong> ${esc(h.objective || '—')}</p>
            <p><strong>A (Conduta):</strong> ${esc(conductText(h))}</p>
            <p><strong>P (Plano):</strong> ${esc(h.plan || '—')}</p>
            ${h.feedback ? `<p class="p-2 rounded-lg bg-white border border-slate-200 text-slate-600"><i class="fa-regular fa-comment mr-1 text-indigo-500"></i><strong>${esc(h.reviewerName)}:</strong> ${esc(h.feedback)}</p>` : ''}
            <button onclick="openEvolutionView(${h.id})" class="text-indigo-600 font-semibold hover:underline">Ver evolução completa</button>
        </div>`;
}


// ================= DETALHES DA EVOLUÇÃO / REVISÃO DO PROFESSOR =================

async function openEvolutionView(evolutionId, { focusFeedback = false } = {}) {
    $('evoview-title').querySelector('span').innerText = 'Evolução';
    $('evoview-subtitle').innerText = '';
    $('evoview-body').innerHTML = loadingBlock('Carregando evolução...');
    $('evoview-footer').innerHTML = `<button onclick="closeModal('modal-evolution-view')" class="${BTN_SECONDARY}">Fechar</button>`;
    openModal('modal-evolution-view');

    try {
        const data = await Api.get(`/evolutions/${evolutionId}`);
        renderEvolutionView(data, focusFeedback);
    } catch (err) {
        $('evoview-body').innerHTML = errorBlock(err.message);
    }
}

function renderEvolutionView({ evolution: e, patient, appointment }, focusFeedback) {
    const status = EVO_STATUS[e.status];
    const isTeacher = state.user.role === 'teacher';
    const canReview = isTeacher && e.status === 'pending';
    const canFix = !isTeacher && e.status === 'correction' && e.studentId === state.user.id;

    $('evoview-title').querySelector('span').innerText = `Evolução — ${patient.name}`;
    $('evoview-subtitle').innerText = `Sessão de ${formatDate(appointment.date)} às ${appointment.time} • Estagiário: ${e.studentName}`;

    const vital = (label, value, unit) => `
        <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center">
            <p class="text-[10px] font-semibold text-slate-400 uppercase">${label}</p>
            <p class="font-bold text-slate-800 mt-0.5">${value ? `${esc(value)}${unit ? ` <span class="text-[10px] font-medium text-slate-400">${unit}</span>` : ''}` : '—'}</p>
        </div>`;

    const section = (letter, title, content) => `
        <div>
            <h4 class="font-bold text-slate-700 flex items-center gap-2 mb-1">
                <span class="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] flex items-center justify-center font-bold">${letter}</span> ${title}
            </h4>
            <div class="text-slate-600 whitespace-pre-line pl-7">${content}</div>
        </div>`;

    const feedbackBox = e.feedback ? `
        <div class="p-3 rounded-xl border ${e.status === 'approved' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-orange-50 border-orange-200 text-orange-900'}">
            <p class="font-bold text-xs"><i class="fa-regular fa-comment mr-1"></i>${e.status === 'pending' ? 'Observação anterior do professor' : 'Observação do professor'} — ${esc(e.reviewerName)}${e.reviewedAt ? ` em ${formatDateTime(e.reviewedAt)}` : ''}</p>
            <p class="mt-1 whitespace-pre-line">${esc(e.feedback)}</p>
        </div>` : '';

    $('evoview-body').innerHTML = `
        <div class="flex items-center gap-2 flex-wrap text-xs text-slate-500">
            ${badge(status, e.status === 'approved' && e.reviewerName ? `Aprovado por ${e.reviewerName}` : null)}
            <span>Enviada em ${formatDateTime(e.updatedAt)}</span>
            ${e.revision > 1 ? `<span class="text-indigo-600 font-semibold">• Versão ${e.revision} (corrigida)</span>` : ''}
        </div>
        <p class="text-xs text-slate-500"><strong class="text-slate-600">Paciente:</strong> ${esc(patient.name)} • ${patient.age} anos • ${esc(specialtyLabel(patient))}</p>
        ${feedbackBox}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            ${vital('EVA (Dor)', `${e.eva} / 10`)}
            ${vital('PA', e.pa, 'mmHg')}
            ${vital('FC', e.fc, 'bpm')}
            ${vital('SpO2', e.spo2, '%')}
        </div>
        ${section('S', 'Subjetivo', esc(e.subjective))}
        ${section('O', 'Objetivo', esc(e.objective || '—'))}
        ${section('A', 'Conduta', `${e.procedures.length ? `<div class="flex flex-wrap gap-1.5 mb-1.5">${e.procedures.map(p => `<span class="px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 border border-brand-100 text-[11px] font-semibold">${esc(p)}</span>`).join('')}</div>` : ''}${esc(e.conduct)}`)}
        ${section('P', 'Plano', esc(e.plan || '—'))}
        ${canReview ? `
            <div class="pt-3 border-t border-slate-200">
                <label for="review-feedback" class="block text-xs font-semibold text-slate-700 uppercase mb-1">Comentário para o aluno</label>
                <textarea id="review-feedback" rows="3" placeholder="Obrigatório ao solicitar correção; opcional na aprovação." class="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none"></textarea>
                <p id="review-error" class="hidden text-xs text-rose-600 mt-1"></p>
            </div>` : ''}
    `;

    $('evoview-footer').innerHTML = `
        <button onclick="closeModal('modal-evolution-view'); openPatientRecord(${patient.id})" class="${BTN_SECONDARY} sm:mr-auto"><i class="fa-solid fa-folder-open mr-1"></i> Ver prontuário</button>
        ${canReview ? `
            <button id="review-correction-btn" onclick="submitReview(${e.id}, 'correction')" class="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold shadow-sm transition active:scale-95">
                <i class="fa-solid fa-pen-to-square mr-1"></i> Solicitar Correção
            </button>
            <button id="review-approve-btn" onclick="submitReview(${e.id}, 'approve')" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition active:scale-95">
                <i class="fa-solid fa-check mr-1"></i> Aprovar
            </button>` : ''}
        ${canFix ? `
            <button onclick="closeModal('modal-evolution-view'); go('#/correcao/${e.id}')" class="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold shadow-sm transition active:scale-95">
                <i class="fa-solid fa-pen-to-square mr-1"></i> Corrigir evolução
            </button>` : ''}
        <button onclick="closeModal('modal-evolution-view')" class="${BTN_SECONDARY}">Fechar</button>
    `;

    if (canReview && focusFeedback) setTimeout(() => $('review-feedback').focus(), 50);
}

async function submitReview(evolutionId, action) {
    const input = $('review-feedback');
    const feedback = input ? input.value.trim() : '';

    if (action === 'correction' && feedback.length < 5) {
        const error = $('review-error');
        error.innerText = 'Descreva o que o aluno precisa corrigir (mínimo de 5 caracteres).';
        error.classList.remove('hidden');
        input.classList.add('field-invalid');
        input.focus();
        return;
    }

    const button = $(action === 'approve' ? 'review-approve-btn' : 'review-correction-btn');
    setBusy(button, true);

    try {
        await reviewEvolution(evolutionId, action, feedback);
        closeModal('modal-evolution-view');
    } catch (err) {
        setBusy(button, false);
    }
}

async function reviewEvolution(evolutionId, action, feedback = '') {
    const item = state.teacherItems.find(i => i.id === evolutionId);
    try {
        await Api.patch(`/evolutions/${evolutionId}/review`, { action, feedback });
        const name = item ? item.patient.name : 'paciente';
        showToast(action === 'approve' ? `Evolução de ${name} aprovada!` : `Correção solicitada ao aluno (${name}).`, action === 'approve' ? 'success' : 'info');
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    } finally {
        refreshView();
    }
}

function quickApprove(evolutionId) {
    reviewEvolution(evolutionId, 'approve').catch(() => {});
}

function requestCorrection(evolutionId) {
    openEvolutionView(evolutionId, { focusFeedback: true });
}


// ================= PAINEL DO PROFESSOR =================

function showTeacherDashboard() {
    showScreen('teacher');
    renderTeacherDashboard();
    loadTeacherDashboard();
}

async function loadTeacherDashboard({ silent = false } = {}) {
    const container = $('teacher-reviews-container');
    if (!silent && !state.teacherItems.length) container.innerHTML = loadingBlock('Carregando evoluções...');

    try {
        state.teacherItems = await Api.get('/evolutions?status=all');
        state.badges.pending = state.teacherItems.filter(e => e.status === 'pending').length;
        renderTeacherDashboard();
        renderNav();
    } catch (err) {
        container.innerHTML = errorBlock(err.message, 'loadTeacherDashboard()');
    }
}

function setTeacherFilter(filter) {
    state.teacherFilter = filter;
    renderTeacherDashboard();
}

function renderTeacherDashboard() {
    const container = $('teacher-reviews-container');
    const items = state.teacherItems;
    const count = status => items.filter(e => e.status === status).length;
    const pending = count('pending');

    $('pending-count-badge').innerText = `${pending} Pendente${pending === 1 ? '' : 's'}`;
    $('tstat-pending').innerText = pending;
    $('tstat-correction').innerText = count('correction');
    $('tstat-approved').innerText = count('approved');

    document.querySelectorAll('.teacher-tab').forEach(btn => {
        const active = btn.dataset.filter === state.teacherFilter;
        btn.className = `teacher-tab flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;
        btn.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.teacher-stat').forEach(btn => {
        const active = btn.dataset.filter === state.teacherFilter;
        btn.classList.toggle('ring-2', active);
        btn.classList.toggle('ring-brand-500', active);
    });

    const term = $('search-teacher').value.trim().toLowerCase();
    const filtered = items
        .filter(e => state.teacherFilter === 'all' || e.status === state.teacherFilter)
        .filter(e => !term || e.patient.name.toLowerCase().includes(term) || e.studentName.toLowerCase().includes(term))
        .sort((a, b) => state.teacherFilter === 'pending'
            ? a.updatedAt.localeCompare(b.updatedAt)  // fila: mais antigas primeiro
            : b.updatedAt.localeCompare(a.updatedAt));

    if (!filtered.length) {
        const messages = {
            pending: 'Todas as evoluções foram revisadas e validadas!',
            correction: 'Nenhuma evolução aguardando correção dos alunos.',
            approved: 'Nenhuma evolução aprovada ainda.',
            all: 'Nenhuma evolução registrada ainda.'
        };
        container.innerHTML = term
            ? `<p class="p-8 text-center text-xs text-slate-400">Nenhuma evolução encontrada para “${esc(term)}”.</p>`
            : `<p class="p-8 text-center text-xs text-slate-400">${messages[state.teacherFilter]}</p>`;
        return;
    }

    container.innerHTML = filtered.map(e => `
        <div class="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div class="space-y-1 w-full md:w-auto min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <h4 class="font-bold text-slate-800 text-xs sm:text-sm">${esc(e.patient.name)}</h4>
                    ${badge(EVO_STATUS[e.status], EVO_STATUS[e.status].short)}
                    ${e.revision > 1 && e.status === 'pending' ? '<span class="text-[10px] text-indigo-600 font-semibold"><i class="fa-solid fa-rotate mr-1"></i>Reenviada após correção</span>' : ''}
                </div>
                <p class="text-[10px] text-slate-400">Aluno: ${esc(e.studentName)} • Sessão de ${formatDate(e.appointment.date)} às ${esc(e.appointment.time)} • ${esc(e.patient.specialty)} • EVA ${e.eva}/10</p>
                <p class="text-xs text-slate-600 line-clamp-2"><strong>Conduta:</strong> ${esc(conductText(e))}</p>
                <p class="text-xs text-slate-500 line-clamp-2"><strong>Subjetivo:</strong> ${esc(e.subjective)}</p>
                ${e.status !== 'pending' && e.reviewerName ? `<p class="text-[11px] text-slate-400">Revisado por ${esc(e.reviewerName)} em ${formatDateTime(e.reviewedAt)}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 w-full md:w-auto justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 shrink-0">
                <button onclick="openEvolutionView(${e.id})" class="flex-1 md:flex-initial px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition active:scale-95">
                    <i class="fa-regular fa-eye mr-1"></i> Ver completa
                </button>
                ${e.status === 'pending' ? `
                    <button onclick="quickApprove(${e.id})" class="flex-1 md:flex-initial px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95">
                        <i class="fa-solid fa-check mr-1"></i> Aprovar
                    </button>
                    <button onclick="requestCorrection(${e.id})" class="flex-1 md:flex-initial px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95">
                        Solicitar Correção
                    </button>` : ''}
            </div>
        </div>`).join('');
}


// ================= MODO DE DADOS (SERVIDOR x LOCAL) =================

function renderModeIndicator(mode) {
    const el = $('mode-indicator');
    if (mode === 'server') {
        el.innerHTML = '<i class="fa-solid fa-server mr-1"></i> Conectado ao servidor PhysioEdu (banco SQLite).';
    } else {
        el.innerHTML = `<i class="fa-solid fa-laptop mr-1"></i> Modo demonstração: os dados ficam salvos neste navegador.
            <button onclick="resetDemoData()" class="underline hover:text-slate-600">Restaurar dados iniciais</button>`;
    }
}

async function resetDemoData() {
    const ok = await confirmDialog({
        title: 'Restaurar dados iniciais?',
        message: 'Todos os pacientes, agendamentos, evoluções e contas criadas neste navegador serão apagados e substituídos pelos dados de demonstração.',
        confirmText: 'Restaurar dados',
        tone: 'danger',
        icon: 'fa-rotate-left'
    });
    if (!ok) return;

    await LocalBackend.reset();
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith('physioedu_draft_') || k.startsWith('physioedu_active_'))
            .forEach(k => localStorage.removeItem(k));
    } catch (err) { /* armazenamento indisponível */ }

    state.user = null;
    endSession('Dados de demonstração restaurados. Faça login novamente.', 'success');
}


// ================= INICIALIZAÇÃO =================

function bindGlobalEvents() {
    window.addEventListener('hashchange', handleRoute);

    document.addEventListener('input', e => {
        const target = e.target;
        if (target.classList.contains('field-invalid')) target.classList.remove('field-invalid');
        if (target.dataset.mask === 'cpf') target.value = S.formatCPF(target.value);
        if (target.dataset.mask === 'phone') target.value = S.formatPhone(target.value);
    });

    $('evolution-form').addEventListener('input', scheduleDraftSave);
    $('evolution-form').addEventListener('change', scheduleDraftSave);
    document.querySelectorAll('input[name="reg-role"]').forEach(r => r.addEventListener('change', updateRegisterLabels));

    // Clique fora fecha apenas modais de leitura (formulários não perdem dados por engano)
    ['modal-evolution-view', 'modal-confirm'].forEach(id => {
        $(id).addEventListener('mousedown', e => {
            if (e.target.id === id) closeModal(id);
        });
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (modalStack.length) closeModal(modalStack[modalStack.length - 1]);
        else if (state.drawer) toggleDrawer(false);
    });

    // Atualização automática: outra aba (modo local) ou outro usuário (modo servidor)
    window.addEventListener('storage', e => {
        if (Api.mode === 'local' && e.key === LocalBackend.STORAGE_KEY) refreshView();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshView();
    });
    setInterval(() => {
        if (Api.mode === 'server' && !document.hidden) refreshView();
    }, 30000);

    window.addEventListener('beforeunload', flushDraft);
}

async function init() {
    removeKey('physioedu_patients'); // dados do protótipo antigo
    bindGlobalEvents();

    Api.onUnauthorized = () => {
        if (state.user) endSession('Sua sessão expirou. Entre novamente.', 'warning');
    };

    const mode = await Api.detectMode();
    renderModeIndicator(mode);
    applyRememberedLogin();

    // Ao recarregar a página, volta para a mesma tela após validar a sessão
    const { name } = parseHash();
    if (name && name !== 'login') state.pendingHash = location.hash;

    if (Api.getToken()) {
        try {
            const { user } = await Api.get('/auth/me');
            startSession(user);
            return;
        } catch (err) {
            Api.clearToken();
        }
    }

    history.replaceState(null, '', '#/login');
    showScreen('login');
}

init();

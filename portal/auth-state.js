// Проверка общей сессии экосистемы. Cookie session_id (Domain=.bot-atelier.ru)
// HttpOnly — прочитана не может быть, поэтому спрашиваем testing (/api/me)
// с credentials. CORS разрешён для апекса на стороне testing (PORTAL_URLS).
const TESTING_ORIGIN = 'https://testing.bot-atelier.ru';
const LOGIN_URL = 'https://bot-atelier.ru/login?next=https%3A%2F%2Fbot-atelier.ru%2F';

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('is-hidden');
}

function show(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('is-hidden');
}

function renderAuthenticated(user) {
  document.documentElement.classList.add('is-authenticated');
  hide('portal-footer-login');
  hide('portal-login');

  const cta = document.getElementById('portal-cta');
  if (cta) {
    cta.textContent = 'Продолжить работу →';
    cta.setAttribute('href', `${TESTING_ORIGIN}/`);
  }

  const container = document.querySelector('.app-user');
  if (!container) return;

  const login = document.getElementById('portal-login');
  if (login) login.remove();

  const actions = document.createElement('span');
  actions.className = 'user-actions';

  const chip = document.createElement('span');
  chip.className = 'user-chip';
  chip.title = user.email || '';
  chip.textContent = user.name || user.email || '';

  const logout = document.createElement('button');
  logout.id = 'portal-logout';
  logout.type = 'button';
  logout.className = 'btn btn-secondary btn-sm';
  logout.textContent = 'Выйти';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Выходим…';
    try {
      await fetch(`${TESTING_ORIGIN}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      // сеть недоступна — всё равно обновляем состояние
    }
    window.location.reload();
  });

  actions.appendChild(chip);
  actions.appendChild(logout);
  container.appendChild(actions);
}

function renderLoggedOut() {
  document.documentElement.classList.remove('is-authenticated');
  const container = document.querySelector('.app-user');
  const actions = container && container.querySelector('.user-actions');
  if (actions) actions.remove();
  if (container && !document.getElementById('portal-login')) {
    const link = document.createElement('a');
    link.id = 'portal-login';
    link.className = 'btn btn-secondary btn-sm';
    link.href = LOGIN_URL;
    link.textContent = 'Войти';
    container.appendChild(link);
  }
  show('portal-footer-login');
  const cta = document.getElementById('portal-cta');
  if (cta) {
    cta.textContent = 'Войти в экосистему';
    cta.setAttribute('href', LOGIN_URL);
  }
}

async function checkSession() {
  try {
    const res = await fetch(`${TESTING_ORIGIN}/api/me`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.user ? data.user : null;
  } catch (e) {
    return null;
  }
}

async function applyState() {
  const user = await checkSession();
  if (user) {
    renderAuthenticated(user);
  } else {
    renderLoggedOut();
  }
}

document.addEventListener('DOMContentLoaded', applyState);
window.addEventListener('pageshow', event => {
  if (event.persisted) applyState();
});

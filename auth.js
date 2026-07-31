// Autenticación y sincronización de Efectiva con Supabase.
// La clave publishable es segura de incluir en una aplicación web pública.
(() => {
  const SUPABASE_URL = 'https://uwxopjatesgptsrwyeqr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_DvGtq7FNsg82Ufny1P1_OA_t-AMIpZU';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const PENDING_SYNC_PREFIX = 'efectiva_pending_sync_';
  let currentUser = null;
  let syncTimer = null;
  let syncInProgress = false;

  function pendingSyncKey() {
    return currentUser ? PENDING_SYNC_PREFIX + currentUser.id : null;
  }
  function readPendingSync() {
    const key = pendingSyncKey();
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }
  function writePendingSync(payload) {
    const key = pendingSyncKey();
    if (key) localStorage.setItem(key, JSON.stringify(payload));
  }
  function clearPendingSync() {
    const key = pendingSyncKey();
    if (key) localStorage.removeItem(key);
  }
  function queueSync(payload) {
    if (!currentUser) return;
    const previous = readPendingSync() || {};
    // Mantiene la última versión completa de cada área, nunca bloquea la UI.
    writePendingSync({ ...previous, ...payload, _queuedAt: Date.now() });
    if (navigator.onLine) flushPendingSync();
  }
  async function flushPendingSync() {
    if (!currentUser || !navigator.onLine || syncInProgress) return;
    const pending = readPendingSync();
    if (!pending) return;
    syncInProgress = true;
    try {
      const { _queuedAt, ...payload } = pending;
      // Fusiona áreas (tareas/historial) para no sobrescribir una con otra.
      const current = await loadData() || {};
      await saveData({ ...current, ...payload });
      clearPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:sync-complete'));
    } catch (error) {
      // El cambio permanece en cola; se reintentará en el próximo "online".
      console.warn('Efectiva quedó pendiente de sincronizar:', error.message);
    } finally {
      syncInProgress = false;
    }
  }

  function el(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    return wrapper.firstElementChild;
  }

  function showAuth(message = '') {
    let modal = document.getElementById('authModal');
    if (!modal) {
      modal = el(`
        <div id="authModal" class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
          <div class="auth-card">
            <div class="auth-logo">✓</div>
            <h2 id="authTitle">Bienvenido a Efectiva</h2>
            <p class="auth-subtitle">Creá tu cuenta para guardar y sincronizar tus tareas desde cualquier dispositivo.</p>
            <form id="authForm">
              <label for="authEmail">Correo electrónico</label>
              <input id="authEmail" type="email" autocomplete="email" placeholder="tu@email.com" required>
              <label for="authPassword">Contraseña</label>
              <input id="authPassword" type="password" autocomplete="current-password" minlength="6" placeholder="Mínimo 6 caracteres" required>
              <button id="authSubmit" type="submit">Iniciar sesión</button>
            </form>
            <p id="authMessage" class="auth-message">${message}</p>
            <button id="authSwitch" class="auth-link" type="button">No tengo cuenta — Registrarme</button>
          </div>
        </div>`);
      document.body.appendChild(modal);
      let registerMode = false;
      const title = modal.querySelector('#authTitle');
      const submit = modal.querySelector('#authSubmit');
      const switcher = modal.querySelector('#authSwitch');
      const messageEl = modal.querySelector('#authMessage');
      switcher.addEventListener('click', () => {
        registerMode = !registerMode;
        title.textContent = registerMode ? 'Crear cuenta' : 'Bienvenido a Efectiva';
        submit.textContent = registerMode ? 'Crear mi cuenta' : 'Iniciar sesión';
        switcher.textContent = registerMode ? 'Ya tengo cuenta — Iniciar sesión' : 'No tengo cuenta — Registrarme';
        messageEl.textContent = '';
      });
      modal.querySelector('#authForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = modal.querySelector('#authEmail').value.trim();
        const password = modal.querySelector('#authPassword').value;
        submit.disabled = true;
        messageEl.textContent = 'Procesando...';
        const result = registerMode
          ? await client.auth.signUp({ email, password })
          : await client.auth.signInWithPassword({ email, password });
        submit.disabled = false;
        if (result.error) {
          messageEl.textContent = result.error.message;
          return;
        }
        if (registerMode && !result.data.session) {
          messageEl.textContent = 'Cuenta creada. Revisá tu correo y confirmá tu cuenta antes de entrar.';
        }
      });
    }
    modal.style.display = 'flex';
  }

  function hideAuth() {
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'none';
  }

  async function loadData() {
    if (!currentUser || !navigator.onLine) return null;
    const { data, error } = await client.from('user_data').select('data').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }

  async function saveData(payload) {
    if (!currentUser) return;
    const { error } = await client.from('user_data').upsert({
      user_id: currentUser.id,
      data: payload,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
  }

  function scheduleSave(payload) {
    // La UI ya guardó localmente. Encolamos y retornamos sin esperar a internet.
    queueSync(payload);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushPendingSync, 700);
  }

  // El historial se guarda dentro del mismo registro privado del usuario.
  // Así no existe una tabla pública adicional ni se mezclan datos entre cuentas.
  async function loadAIChats() {
    const data = await loadData();
    return data && Array.isArray(data.aiChats)
      ? { chats: data.aiChats, currentChatId: data.aiCurrentChatId || null }
      : null;
  }

  async function saveAIChats(chats, currentChatId) {
    if (!currentUser) return;
    // Se encola igual que las tareas: el chat no espera una respuesta de red.
    queueSync({ aiChats: chats, aiCurrentChatId: currentChatId || null });
  }

  window.EfectivaCloud = {
    get user() { return currentUser; },
    loadData,
    scheduleSave,
    loadAIChats,
    saveAIChats,
    async signOut() { await client.auth.signOut(); }
  };

  window.addEventListener('online', () => flushPendingSync());

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      hideAuth();
      flushPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
    } else {
      showAuth();
    }
  });

  client.auth.getSession().then(({ data }) => {
    currentUser = data.session?.user || null;
    if (currentUser) {
      hideAuth();
      flushPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
    } else {
      showAuth();
    }
  });
})();

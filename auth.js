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
            <button id="authGoogleBtn" class="auth-google-btn" type="button">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-3l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.2 0-5.9-2.1-6.9-5H1.1v3.1C3.1 21.3 7.2 24 12 24z"/><path fill="#FBBC05" d="M5.1 14.2c-.2-.7-.4-1.5-.4-2.2s.1-1.5.4-2.2V6.7H1.1C.4 8.3 0 10.1 0 12s.4 3.7 1.1 5.3l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.2 0 3.1 2.7 1.1 6.7l4 3.1c1-2.9 3.7-5 6.9-5z"/></svg>
              <span>Continuar con Google</span>
            </button>
            <div class="auth-divider"><span>o con tu correo</span></div>
            <form id="authForm">
              <label for="authEmail">Correo electrónico</label>
              <input id="authEmail" type="email" autocomplete="email" placeholder="tu@email.com" required>
              <label for="authPassword">Contraseña</label>
              <input id="authPassword" type="password" autocomplete="current-password" minlength="6" placeholder="Mínimo 6 caracteres" required>
              <button id="authSubmit" type="submit">Iniciar sesión</button>
            </form>
            <p id="authMessage" class="auth-message">${message}</p>
            <div class="auth-links-row">
              <button id="authSwitch" class="auth-link" type="button">No tengo cuenta — Registrarme</button>
              <button id="authResetBtn" class="auth-link" type="button">Olvidé / Crear contraseña</button>
            </div>
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

      const googleBtn = modal.querySelector('#authGoogleBtn');
      if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
          const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
          const redirectTo = isNative
            ? 'com.russellralt.efectiva://auth-callback'
            : (window.location.origin + window.location.pathname);

          messageEl.textContent = 'Abriendo Google...';
          googleBtn.disabled = true;
          try {
            const { data, error } = await client.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo,
                skipBrowserRedirect: isNative
              }
            });
            if (error) {
              messageEl.textContent = error.message;
              googleBtn.disabled = false;
              return;
            }
            if (isNative && data && data.url) {
              const Browser = window.Capacitor?.Plugins?.Browser;
              if (Browser && Browser.open) {
                await Browser.open({ url: data.url });
              } else {
                window.open(data.url, '_system');
              }
            }
          } catch (e) {
            messageEl.textContent = 'Error con Google: ' + (e && e.message ? e.message : String(e));
          } finally {
            googleBtn.disabled = false;
          }
        });
      }

      const resetBtn = modal.querySelector('#authResetBtn');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          const email = modal.querySelector('#authEmail').value.trim();
          if (!email) {
            messageEl.textContent = 'Escribí primero tu correo arriba para enviarte el enlace.';
            return;
          }
          messageEl.textContent = 'Enviando enlace...';
          const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://russellralt.github.io/efectiva-app/'
          });
          messageEl.textContent = error
            ? error.message
            : 'Revisá tu correo: te enviamos un enlace para crear o cambiar tu contraseña.';
        });
      }
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

  function showSetNewPasswordPrompt() {
    const newPass = window.prompt('Recuperación de cuenta: escribí tu nueva contraseña (mínimo 6 caracteres):');
    if (!newPass || newPass.trim().length < 6) return;
    client.auth.updateUser({ password: newPass.trim() }).then(({ error }) => {
      if (error) {
        alert('No se pudo actualizar la contraseña: ' + error.message);
      } else {
        alert('Contraseña actualizada con éxito. Ya podés usarla en la APK y en la web.');
      }
    });
  }

  client.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') {
      hideAuth();
      flushPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
      setTimeout(showSetNewPasswordPrompt, 400);
      return;
    }
    if (currentUser) {
      hideAuth();
      flushPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
    } else {
      showAuth();
    }
  });

  // Capturar retorno de Google OAuth en APK Capacitor
  try {
    const CapApp = window.Capacitor?.Plugins?.App;
    const CapBrowser = window.Capacitor?.Plugins?.Browser;
    if (CapApp && CapApp.addListener) {
      CapApp.addListener('appUrlOpen', async ({ url }) => {
        if (!url || !url.includes('auth-callback')) return;
        try { if (CapBrowser && CapBrowser.close) await CapBrowser.close(); } catch (_) {}
        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          if (code && client.auth.exchangeCodeForSession) {
            await client.auth.exchangeCodeForSession(code);
            return;
          }
          const hash = parsed.hash ? new URLSearchParams(parsed.hash.replace(/^#/, '')) : null;
          const access_token = hash && hash.get('access_token');
          const refresh_token = hash && hash.get('refresh_token');
          if (access_token && refresh_token) {
            await client.auth.setSession({ access_token, refresh_token });
          }
        } catch (err) {
          console.error('Error procesando retorno OAuth:', err);
        }
      });
    }
  } catch (_) {}

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

// Autenticación y sincronización de Efectiva con Supabase.
// La clave publishable es segura de incluir en una aplicación web pública.
(() => {
  const SUPABASE_URL = 'https://uwxopjatesgptsrwyeqr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_DvGtq7FNsg82Ufny1P1_OA_t-AMIpZU';
  const PUBLIC_APP_URL = 'https://russellralt.github.io/efectiva-app/';
  const NATIVE_CALLBACK_URL = 'com.russellralt.efectiva://auth-callback';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true
    }
  });
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
          ? await client.auth.signUp({ email, password, options: { emailRedirectTo: PUBLIC_APP_URL } })
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
          const redirectTo = isNative ? NATIVE_CALLBACK_URL : PUBLIC_APP_URL;

          messageEl.textContent = 'Abriendo Google...';
          googleBtn.disabled = true;
          try {
            const { data, error } = await client.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo,
                skipBrowserRedirect: isNative,
                queryParams: { prompt: 'select_account' }
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
            redirectTo: PUBLIC_APP_URL
          });
          messageEl.textContent = error
            ? error.message
            : 'Revisá tu correo (y la carpeta de Spam): te enviamos el enlace seguro para crear o cambiar tu contraseña.';
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

  async function getAccessToken() {
    try {
      const { data } = await client.auth.getSession();
      return data?.session?.access_token || null;
    } catch (_) {
      return null;
    }
  }

  async function flushNow() {
    clearTimeout(syncTimer);
    await flushPendingSync();
  }

  async function getCloudJob() {
    const data = await loadData();
    return (data && data.aiCloudJob && typeof data.aiCloudJob === 'object') ? data.aiCloudJob : null;
  }

  async function clearCloudJob(jobId) {
    if (!currentUser || !navigator.onLine) return;
    try {
      const current = await loadData();
      if (!current || !current.aiCloudJob) return;
      if (jobId && current.aiCloudJob.jobId !== jobId) return;
      const next = { ...current };
      next.aiCloudJob = { ...current.aiCloudJob, consumed: true, state: null };
      await saveData(next);
    } catch (_) {}
  }

  let realtimeJobChannel = null;
  function subscribeCloudJob(onUpdate) {
    if (!currentUser || !client || typeof client.channel !== 'function') return null;
    try {
      if (realtimeJobChannel) {
        client.removeChannel(realtimeJobChannel);
        realtimeJobChannel = null;
      }
      realtimeJobChannel = client
        .channel('efectiva-cloud-job-' + currentUser.id)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'user_data',
            filter: 'user_id=eq.' + currentUser.id
          },
          (payload) => {
            const job = payload?.new?.data?.aiCloudJob;
            if (job && (job.status === 'done' || job.status === 'error')) {
              if (typeof onUpdate === 'function') onUpdate(job);
              window.dispatchEvent(new CustomEvent('efectiva:cloud-job-update', { detail: job }));
            }
          }
        )
        .subscribe();
      return realtimeJobChannel;
    } catch (_) {
      return null;
    }
  }

  window.EfectivaCloud = {
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    get user() { return currentUser; },
    getAccessToken,
    flushNow,
    getCloudJob,
    clearCloudJob,
    subscribeCloudJob,
    loadData,
    scheduleSave,
    loadAIChats,
    saveAIChats,
    async signOut() { await client.auth.signOut(); }
  };

  window.addEventListener('online', () => flushPendingSync());

  function showSetNewPasswordModal() {
    hideAuth();
    const prev = document.getElementById('passwordRecoveryModal');
    if (prev) prev.remove();

    const modal = el(`
      <div id="passwordRecoveryModal" class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="recoveryTitle">
        <div class="auth-card">
          <div class="auth-logo">🔐</div>
          <h2 id="recoveryTitle">Crear / Cambiar contraseña</h2>
          <p class="auth-subtitle">Ingresá tu nueva contraseña para acceder desde la web y la APK.</p>
          <form id="recoveryForm">
            <label for="recoveryPass1">Nueva contraseña</label>
            <input id="recoveryPass1" type="password" autocomplete="new-password" minlength="6" placeholder="Mínimo 6 caracteres" required>
            <label for="recoveryPass2">Repetí la contraseña</label>
            <input id="recoveryPass2" type="password" autocomplete="new-password" minlength="6" placeholder="Repetí tu contraseña" required>
            <button id="recoverySubmitBtn" type="submit">Guardar nueva contraseña</button>
          </form>
          <p id="recoveryMsg" class="auth-message"></p>
          <div class="auth-links-row">
            <button id="recoveryCancelBtn" class="auth-link" type="button">Cancelar</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(modal);
    modal.style.display = 'flex';

    const form = modal.querySelector('#recoveryForm');
    const p1El = modal.querySelector('#recoveryPass1');
    const p2El = modal.querySelector('#recoveryPass2');
    const submitBtn = modal.querySelector('#recoverySubmitBtn');
    const msgEl = modal.querySelector('#recoveryMsg');
    const cancelBtn = modal.querySelector('#recoveryCancelBtn');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        modal.remove();
      });
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pass1 = p1El.value.trim();
      const pass2 = p2El.value.trim();
      if (pass1.length < 6) {
        msgEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        return;
      }
      if (pass1 !== pass2) {
        msgEl.textContent = 'Las contraseñas no coinciden.';
        return;
      }
      submitBtn.disabled = true;
      msgEl.textContent = 'Guardando nueva contraseña...';
      try {
        const { error } = await client.auth.updateUser({ password: pass1 });
        if (error) {
          msgEl.textContent = 'No se pudo actualizar: ' + error.message;
          submitBtn.disabled = false;
          return;
        }
        msgEl.textContent = '✅ Contraseña actualizada con éxito. Ya podés usarla en la APK y en la web.';
        try { history.replaceState({}, '', window.location.pathname); } catch (_) {}
        setTimeout(() => {
          modal.remove();
          window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
        }, 1100);
      } catch (err) {
        msgEl.textContent = 'Error inesperado: ' + (err && err.message ? err.message : String(err));
        submitBtn.disabled = false;
      }
    });
  }

  client.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') {
      hideAuth();
      flushPendingSync();
      window.dispatchEvent(new CustomEvent('efectiva:authenticated'));
      setTimeout(showSetNewPasswordModal, 250);
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

  // Capturar retorno de Google OAuth / Recuperación en APK Capacitor
  try {
    const CapApp = window.Capacitor?.Plugins?.App;
    const CapBrowser = window.Capacitor?.Plugins?.Browser;
    if (CapApp && CapApp.addListener) {
      CapApp.addListener('appUrlOpen', async ({ url }) => {
        if (!url || !url.includes('auth-callback')) return;
        try { if (CapBrowser && CapBrowser.close) await CapBrowser.close(); } catch (_) {}
        const isRecovery = url.includes('type=recovery');
        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          if (code && client.auth.exchangeCodeForSession) {
            await client.auth.exchangeCodeForSession(code);
            if (isRecovery) setTimeout(showSetNewPasswordModal, 350);
            return;
          }
          const hash = parsed.hash ? new URLSearchParams(parsed.hash.replace(/^#/, '')) : null;
          const access_token = hash && hash.get('access_token');
          const refresh_token = hash && hash.get('refresh_token');
          if (access_token && refresh_token) {
            await client.auth.setSession({ access_token, refresh_token });
            if (isRecovery || (hash && hash.get('type') === 'recovery')) {
              setTimeout(showSetNewPasswordModal, 350);
            }
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

/* ============================================================================
 *  EFECTIVA v39 — ALARMA PERENNE ANTI-OCIOSIDAD (MODO ENFOQUE ESTRICTO)
 *  Suena y recuerda TODOS los pendientes mientras el usuario NO tenga una
 *  tarea en Play (Modo Presentación, ya sea pantalla completa o PiP).
 *  Apenas inicia Play en cualquier tarea, se silencia y cancela notificaciones.
 * ============================================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'efectivaIdleAlarmV1';
  const NATIVE_IDLE_IDS = [9101, 9102, 9103, 9104, 9105, 9106, 9107, 9108, 9109, 9110, 9111, 9112];

  let config = {
    enabled: true,
    loudMode: true,         // alarma escandalosa por defecto
    soundEverySec: 12,      // cada cuántos segundos suena el tono en primer plano
    bgIntervalMin: 5,       // cada cuántos minutos dispara alarma con app cerrada / 2do plano
    speakPending: false,    // leer pendientes en voz alta (opcional)
    snoozeUntil: 0          // timestamp para pausa temporal (ej. descanso/sueño)
  };

  let tickTimer = null;
  let lastChimeAt = 0;
  let lastNotifScheduledSig = '';
  let lastBannerSig = '';
  let lastPlayStoppedAt = 0;
  let wasPlaying = false;
  let audioUnlocked = false;
  let panelOpen = false;

  const ICON_PLAY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>';
  const ICON_BELL_OFF_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          config = Object.assign(config, parsed);
        }
      }
    } catch (_) {}
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (_) {}
  }

  function isTaskPlaying() {
    try {
      return !!(typeof presentationOpen !== 'undefined' && presentationOpen && typeof currentPresentationTask !== 'undefined' && currentPresentationTask);
    } catch (_) {
      return false;
    }
  }

  function getAllPendingTasks() {
    try {
      const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
      const list = [];
      allFolders.forEach(f => {
        if (!f || f.isDefaultRewards) return;
        (f.tasks || []).forEach(t => {
          list.push({
            folderId: f.id,
            folderName: f.name || 'Carpeta',
            task: t,
            id: t.id,
            name: t.name || 'Sin nombre',
            priority: t.priority || null,
            stepsCount: Array.isArray(t.steps) ? t.steps.length : 0,
            totalMin: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : null,
            dueDate: t.dueDate || null
          });
        });
      });
      const prioRank = { urgente: 0, alta: 1, media: 2, baja: 3 };
      list.sort((a, b) => {
        const pa = prioRank[String(a.priority || '').toLowerCase()] ?? 4;
        const pb = prioRank[String(b.priority || '').toLowerCase()] ?? 4;
        return pa - pb;
      });
      return list;
    } catch (_) {
      return [];
    }
  }

  function isSnoozed() {
    return !!(config.snoozeUntil && Date.now() < config.snoozeUntil);
  }

  function shouldAlarmNow() {
    if (!config.enabled) return false;
    if (isSnoozed()) return false;
    if (isTaskPlaying()) return false;
    const pending = getAllPendingTasks();
    return pending.length > 0;
  }

  // Tono escandaloso (sirena real de alerta) o tono suave según config.loudMode
  function playIdleAlarmTone() {
    try {
      if (typeof unlockStepAlarmAudio === 'function') unlockStepAlarmAudio();
      const ctx = (typeof stepAlarmAudioCtx !== 'undefined' && stepAlarmAudioCtx)
        ? stepAlarmAudioCtx
        : (global.__efIdleAudioCtx || (global.__efIdleAudioCtx = new (window.AudioContext || window.webkitAudioContext)()));
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;

      if (config.loudMode !== false) {
        // Alarma escandalosa: 4 ráfagas bitonales de alta presencia (980Hz -> 1480Hz)
        [0, 0.24, 0.48, 0.72].forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          const t0 = now + offset;
          osc.frequency.setValueAtTime(idx % 2 === 0 ? 987.77 : 1479.98, t0);
          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.21);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.22);
        });
        if (navigator.vibrate) {
          try { navigator.vibrate([450, 150, 450, 150, 600]); } catch (_) {}
        }
      } else {
        const freqs = [659.25, 880, 1174.66];
        freqs.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t0 = now + i * 0.16;
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.exponentialRampToValueAtTime(0.24, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.15);
        });
        if (navigator.vibrate) {
          try { navigator.vibrate([180, 90, 180]); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function buildPendingSummaryText(pending) {
    if (!pending || !pending.length) return '';
    const lines = pending.slice(0, 6).map((p, i) => `${i + 1}. ${p.name} (${p.folderName})`);
    const more = pending.length > 6 ? `\n+${pending.length - 6} pendientes más...` : '';
    return lines.join('\n') + more;
  }

  let lastNativeSyncSig = '';
  function syncNativeLoudAlarmBridge(pending) {
    const bridge = global.EfectivaIdleAlarmBridge;
    if (!bridge || typeof bridge.syncState !== 'function') return false;
    const playing = isTaskPlaying();
    const intervalMin = Math.max(1, Number(config.bgIntervalMin) || 5);
    const summary = buildPendingSummaryText(pending);
    const snoozeUntil = Number(config.snoozeUntil) || 0;
    const sig = `${config.enabled}|${playing}|${intervalMin}|${pending.length}|${snoozeUntil}|${summary.slice(0, 100)}`;
    if (sig === lastNativeSyncSig) return true;
    lastNativeSyncSig = sig;
    try {
      bridge.syncState(!!config.enabled, !!playing, intervalMin, pending.length, summary, snoozeUntil);
    } catch (_) {}
    return true;
  }

  function getNativePerms() {
    const bridge = global.EfectivaIdleAlarmBridge;
    if (!bridge || typeof bridge.getPermissionsStatus !== 'function') return null;
    try {
      return JSON.parse(bridge.getPermissionsStatus());
    } catch (_) {
      return null;
    }
  }

  function speakPendingSummary(pending) {
    if (!config.speakPending || !pending.length) return;
    try {
      const names = pending.slice(0, 5).map(p => p.name).join(', ');
      const extra = pending.length > 5 ? ` y ${pending.length - 5} pendientes más.` : '.';
      const msg = `No estás ejecutando ninguna tarea. Tenés ${pending.length} pendientes: ${names}${extra}`;
      if (global.EfectivaTTS && typeof global.EfectivaTTS.speakChunks === 'function' && typeof splitTextForSpeech === 'function') {
        const chunks = splitTextForSpeech(msg, 160);
        if (chunks.length > 0) {
          global.EfectivaTTS.speakChunks(chunks, { rate: 1.0, lang: 'es-AR', guard: () => !isTaskPlaying() });
        }
      } else if (typeof speakPresentationStep === 'function' && isTaskPlaying()) {
        speakPresentationStep(msg, true);
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(msg);
        u.lang = 'es-MX';
        window.speechSynthesis.speak(u);
      }
    } catch (_) {}
  }

  async function scheduleNativeIdleNotifications(pending) {
    try {
      const LocalNotif = window.Capacitor?.Plugins?.LocalNotifications;
      if (!LocalNotif || !pending.length) return;

      const intervalMin = Math.max(1, Number(config.bgIntervalMin) || 5);
      const summaryLines = pending.slice(0, 6).map((p, i) => `${i + 1}. ${p.name} (${p.folderName})`);
      const more = pending.length > 6 ? `\n+${pending.length - 6} pendientes más...` : '';
      const bodyText = summaryLines.join('\n') + more;
      const sig = `${intervalMin}|${pending.length}|${bodyText.slice(0, 120)}`;
      if (sig === lastNotifScheduledSig) return;
      lastNotifScheduledSig = sig;

      await LocalNotif.requestPermissions().catch(() => {});
      await LocalNotif.cancel({ notifications: NATIVE_IDLE_IDS.map(id => ({ id })) }).catch(() => {});

      const now = Date.now();
      const batch = NATIVE_IDLE_IDS.map((id, idx) => ({
        id,
        title: `🚨 Efectiva: ${pending.length} pendiente(s) sin Play`,
        body: bodyText,
        schedule: {
          at: new Date(now + (idx + 1) * intervalMin * 60 * 1000),
          allowWhileIdle: true
        },
        sound: 'default'
      }));
      await LocalNotif.schedule({ notifications: batch });
    } catch (_) {}
  }

  async function cancelNativeIdleNotifications() {
    lastNotifScheduledSig = '';
    try {
      const LocalNotif = window.Capacitor?.Plugins?.LocalNotifications;
      if (!LocalNotif) return;
      await LocalNotif.cancel({ notifications: NATIVE_IDLE_IDS.map(id => ({ id })) });
    } catch (_) {}
  }

  function fireWebNotificationIfBackground(pending) {
    if (!document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const preview = pending.slice(0, 4).map(p => '• ' + p.name).join('\n');
      new Notification(`🚨 ${pending.length} pendiente(s) esperando Play`, {
        body: preview + (pending.length > 4 ? `\n+${pending.length - 4} más` : ''),
        tag: 'efectiva-idle-alarm',
        renotify: true
      });
    } catch (_) {}
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function startTaskFromIdleAlarm(item) {
    if (!item || !item.task) return;
    closeIdleAlarmPanel();
    try { global.EfectivaIdleAlarmBridge?.stopRingingNow(); } catch (_) {}

    const hasSteps = Array.isArray(item.task.steps) && item.task.steps.length > 0;
    try {
      if (typeof openFolder === 'function' && item.folderId) {
        openFolder(item.folderId, true);
      }

      if (hasSteps) {
        // Armar cola secuencial igual que el botón ▶ nativo en script.js
        try {
          if (item.folderId && typeof folders !== 'undefined' && Array.isArray(folders)) {
            const folder = folders.find(f => f.id === item.folderId);
            if (folder) {
              const tasksWithSteps = (folder.tasks || []).filter(t => t.steps && t.steps.length > 0);
              if (tasksWithSteps.length > 1 && typeof folderPlayQueue !== 'undefined') {
                const taskIndex = tasksWithSteps.findIndex(t => t.id === item.task.id);
                if (taskIndex >= 0) {
                  folderPlayQueue = tasksWithSteps;
                  folderPlayIndex = taskIndex;
                  folderPlayFolderId = item.folderId;
                  folderPlayOriginalLength = tasksWithSteps.length;
                }
              }
            }
          }
        } catch (_) {}

        if (typeof startPresentation === 'function') {
          startPresentation(item.task);
        }
      } else {
        item.task.isExpanded = true;
        if (typeof renderTasks === 'function') renderTasks();
        setTimeout(() => {
          try {
            const card = document.querySelector(`[data-task-id="${item.task.id}"]`);
            if (card) {
              if (typeof card.scrollIntoView === 'function') {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
              const stepInput = card.querySelector('.new-step-input');
              if (stepInput) stepInput.focus();
            }
            if (typeof showVoiceNotice === 'function') {
              showVoiceNotice('Agregá al menos 1 paso a esta tarea para iniciarla en Play');
            }
          } catch (_) {}
        }, 80);
      }
    } catch (_) {}
    evaluateIdleAlarm(false);
  }

  function updateHeaderButton() {
    const btn = document.getElementById('idleAlarmBtn');
    if (!btn) return;
    const playing = isTaskPlaying();
    const activeAlert = shouldAlarmNow();
    btn.classList.toggle('idle-alarm-alert', activeAlert);
    btn.classList.toggle('idle-alarm-ok', config.enabled && playing);
    btn.classList.toggle('idle-alarm-off', !config.enabled || isSnoozed());
    if (!config.enabled) {
      btn.textContent = '🔕';
      btn.title = 'Alarma perenne desactivada (clic para configurar)';
    } else if (isSnoozed()) {
      const minsLeft = Math.max(1, Math.ceil((config.snoozeUntil - Date.now()) / 60000));
      btn.textContent = '⏸️';
      btn.title = `Alarma perenne pausada (${minsLeft} min restantes)`;
    } else if (playing) {
      btn.textContent = '🛡️';
      btn.title = 'Alarma perenne activa · En pausa porque estás en Play';
    } else {
      btn.textContent = '🚨';
      btn.title = '¡Alarma perenne sonando! Tocá para ver pendientes y dar Play';
    }
  }

  function renderPersistentBanner() {
    let banner = document.getElementById('idleAlarmBanner');
    const active = shouldAlarmNow();
    if (!active) {
      lastBannerSig = '';
      if (banner) banner.style.display = 'none';
      return;
    }

    const pending = getAllPendingTasks();
    if (!pending.length) {
      lastBannerSig = '';
      if (banner) banner.style.display = 'none';
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'idleAlarmBanner';
      banner.className = 'idle-alarm-banner';
      document.body.appendChild(banner);
    }

    const topTask = pending.find(p => p.stepsCount > 0) || pending[0];
    const sig = `${topTask.id}|${topTask.name}|${topTask.folderName}|${topTask.stepsCount}|${topTask.totalMin || ''}|${pending.length}`;
    if (sig === lastBannerSig && banner.style.display !== 'none') {
      return;
    }
    lastBannerSig = sig;

    const countLabel = `${pending.length} pendiente${pending.length === 1 ? '' : 's'}`;
    const stepsLabel = topTask.stepsCount > 0
      ? `${topTask.stepsCount} paso${topTask.stepsCount === 1 ? '' : 's'}`
      : 'Sin pasos aún';
    const metaText = `${escHtml(topTask.folderName)} · ${stepsLabel}${topTask.totalMin ? ` · ${topTask.totalMin} min` : ''}`;
    const primaryCta = topTask.stepsCount > 0
      ? `${ICON_PLAY_SVG}<span>Empezar</span>`
      : '<span>+ Agregar pasos</span>';

    banner.style.display = 'flex';
    banner.innerHTML = `
      <div class="idle-dock-top">
        <div class="idle-dock-status">
          <span class="idle-live-dot" aria-hidden="true"></span>
          <span class="idle-dock-kicker">Enfoque en pausa</span>
          <span class="idle-count-pill">${countLabel}</span>
        </div>
        <button type="button" class="idle-dock-dismiss" id="idleBannerDisableBtn" title="Desactivar alarma perenne" aria-label="Desactivar alarma perenne">${ICON_BELL_OFF_SVG}</button>
      </div>
      <div class="idle-dock-task">
        <div class="idle-dock-title">${escHtml(topTask.name)}</div>
        <div class="idle-dock-meta">${metaText}</div>
      </div>
      <div class="idle-dock-actions">
        <button type="button" class="idle-btn-play" id="idleBannerPlayTopBtn">${primaryCta}</button>
        <button type="button" class="idle-btn-list" id="idleBannerOpenPanelBtn">Ver pendientes</button>
      </div>
    `;

    banner.querySelector('#idleBannerPlayTopBtn').onclick = (e) => {
      e.stopPropagation();
      startTaskFromIdleAlarm(topTask);
    };
    banner.querySelector('#idleBannerOpenPanelBtn').onclick = (e) => {
      e.stopPropagation();
      openIdleAlarmPanel();
    };
    banner.querySelector('#idleBannerDisableBtn').onclick = (e) => {
      e.stopPropagation();
      config.enabled = false;
      saveConfig();
      try { global.EfectivaIdleAlarmBridge?.stopRingingNow(); } catch (_) {}
      cancelNativeIdleNotifications();
      lastBannerSig = '';
      lastNativeSyncSig = '';
      evaluateIdleAlarm(true);
    };
  }

  function closeIdleAlarmPanel() {
    panelOpen = false;
    const modal = document.getElementById('idleAlarmModal');
    if (modal) modal.remove();
  }

  function openIdleAlarmPanel() {
    closeIdleAlarmPanel();
    panelOpen = true;
    const pending = getAllPendingTasks();
    const playing = isTaskPlaying();
    const snoozed = isSnoozed();
    const snoozeMinLeft = snoozed ? Math.max(1, Math.ceil((config.snoozeUntil - Date.now()) / 60000)) : 0;

    const modal = document.createElement('div');
    modal.id = 'idleAlarmModal';
    modal.className = 'sheet-modal';
    modal.innerHTML = `
      <div class="sheet-modal-card idle-alarm-modal-card">
        <div class="sheet-modal-header">
          <div class="idle-modal-head-title">
            <span class="cc-kicker">Efectiva Focus</span>
            <h3 class="idle-modal-title">Alarma de Enfoque</h3>
          </div>
          <button type="button" class="cc-close-btn" id="closeIdleAlarmModalBtn" aria-label="Cerrar">✕</button>
        </div>

        <div class="idle-status-box ${playing ? 'ok' : (config.enabled && !snoozed ? 'alert' : 'muted')}">
          ${playing
            ? '<strong>En Play:</strong> Estás trabajando en una tarea. La alarma está silenciada automáticamente.'
            : (!config.enabled
              ? '<strong>Desactivada:</strong> Activala para exigir una tarea en Play continuamente.'
              : (snoozed
                ? `<strong>Pausada temporalmente:</strong> Quedan ${snoozeMinLeft} min de descanso.`
                : `<strong>Alarma activa (${pending.length} pendientes):</strong> Iniciá una tarea con pasos para silenciarla.`))}
        </div>

        <div class="idle-controls-grid">
          <div class="idle-switch-row">
            <span>Alarma perenne activa</span>
            <label class="ef-switch">
              <input type="checkbox" id="idleEnabledChk" ${config.enabled ? 'checked' : ''} />
              <span class="ef-slider"></span>
            </label>
          </div>
          <div class="idle-switch-row">
            <span>Modo escandaloso</span>
            <label class="ef-switch">
              <input type="checkbox" id="idleLoudChk" ${config.loudMode !== false ? 'checked' : ''} />
              <span class="ef-slider"></span>
            </label>
          </div>
          <div class="idle-switch-row">
            <span>Leer pendientes en voz alta</span>
            <label class="ef-switch">
              <input type="checkbox" id="idleSpeakChk" ${config.speakPending ? 'checked' : ''} />
              <span class="ef-slider"></span>
            </label>
          </div>
          <label class="idle-select-row">
            <span>Sonido en app cada:</span>
            <select id="idleSoundSecSel">
              ${[10, 12, 15, 30, 60].map(s => `<option value="${s}" ${config.soundEverySec === s ? 'selected' : ''}>${s} seg</option>`).join('')}
            </select>
          </label>
          <label class="idle-select-row">
            <span>Con app cerrada cada:</span>
            <select id="idleBgMinSel">
              ${[1, 2, 5, 10, 15].map(m => `<option value="${m}" ${config.bgIntervalMin === m ? 'selected' : ''}>${m} min</option>`).join('')}
            </select>
          </label>
        </div>

        ${(() => {
          const perms = getNativePerms();
          if (perms) {
            return `
              <div class="idle-perms-box">
                <div class="idle-perms-title">Permisos Android (para sonar con app cerrada)</div>
                <div class="idle-perms-list">
                  <button type="button" class="fin-btn sm" id="permNotifBtn">${perms.notifications ? '✅' : '⚠️'} Notificaciones</button>
                  <button type="button" class="fin-btn sm" id="permExactBtn">${perms.exactAlarm ? '✅' : '⚠️'} Alarmas exactas</button>
                  <button type="button" class="fin-btn sm" id="permBatteryBtn">${perms.batteryOptimization ? '✅' : '⚠️'} Sin restricción batería</button>
                  <button type="button" class="fin-btn sm" id="permFullBtn">${perms.fullScreenIntent ? '✅' : '⚠️'} Pantalla bloqueada</button>
                </div>
                <div class="idle-snooze-row" style="margin-top:6px;">
                  <button type="button" class="fin-btn sm primary" id="idleTestLoudBtn">🔊 Probar alarma</button>
                  <button type="button" class="fin-btn sm danger" id="idleStopLoudBtn">🔇 Silenciar ahora</button>
                </div>
              </div>
            `;
          }
          return `
            <div class="idle-perms-box">
              <div class="idle-perms-title">Modo Alarma con app cerrada</div>
              <small style="opacity:0.85;">En APK v40+ se habilita el servicio nativo <code>USAGE_ALARM</code> + <code>AlarmManager</code> + <code>BOOT_COMPLETED</code> para sonar incluso con la app cerrada y en silencio.</small>
              <div class="idle-snooze-row" style="margin-top:6px;">
                <button type="button" class="fin-btn sm primary" id="idleTestWebLoudBtn">🔊 Probar sonido ahora</button>
              </div>
            </div>
          `;
        })()}

        <div class="idle-snooze-row">
          <button type="button" class="fin-btn sm" data-snooze="15">⏸ 15m</button>
          <button type="button" class="fin-btn sm" data-snooze="30">⏸ 30m</button>
          <button type="button" class="fin-btn sm" data-snooze="60">⏸ 1h</button>
          ${snoozed ? '<button type="button" class="fin-btn sm primary" id="idleResumeNowBtn">▶ Reanudar ya</button>' : ''}
          <button type="button" class="fin-btn sm danger" id="idleQuickToggleBtn">${config.enabled ? 'Desactivar alarma' : 'Activar alarma'}</button>
        </div>

        <div class="idle-pending-header">
          <strong>Todos tus pendientes (${pending.length})</strong>
          <small>Tocá Empezar para entrar en enfoque</small>
        </div>
        <div class="idle-pending-list" id="idlePendingList">
          ${pending.length === 0
            ? '<div class="excel-empty">¡No tenés tareas pendientes!</div>'
            : pending.map((p, idx) => `
              <div class="idle-pending-item">
                <div class="idle-pending-meta">
                  <strong>${escHtml(p.name)}</strong>
                  <small>${escHtml(p.folderName)}${p.stepsCount ? ` · ${p.stepsCount} paso(s)` : ' · Sin pasos'}${p.totalMin ? ` · ${p.totalMin} min` : ''}${p.priority ? ` · ${escHtml(p.priority)}` : ''}</small>
                </div>
                ${p.stepsCount > 0
                  ? `<button type="button" class="idle-btn-play idle-btn-play-compact" data-play-idx="${idx}">${ICON_PLAY_SVG}<span>Empezar</span></button>`
                  : `<button type="button" class="idle-btn-open" data-play-idx="${idx}">Abrir</button>`}
              </div>
            `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.onclick = (e) => { if (e.target === modal) closeIdleAlarmPanel(); };
    modal.querySelector('#closeIdleAlarmModalBtn').onclick = closeIdleAlarmPanel;

    modal.querySelector('#idleEnabledChk').onchange = (e) => {
      config.enabled = !!e.target.checked;
      if (config.enabled) config.snoozeUntil = 0;
      lastNativeSyncSig = '';
      lastBannerSig = '';
      saveConfig();
      if (!config.enabled) {
        try { global.EfectivaIdleAlarmBridge?.stopRingingNow(); } catch (_) {}
        cancelNativeIdleNotifications();
      }
      evaluateIdleAlarm(true);
      openIdleAlarmPanel();
    };
    const loudChk = modal.querySelector('#idleLoudChk');
    if (loudChk) {
      loudChk.onchange = (e) => {
        config.loudMode = !!e.target.checked;
        saveConfig();
      };
    }
    const quickToggle = modal.querySelector('#idleQuickToggleBtn');
    if (quickToggle) {
      quickToggle.onclick = () => {
        config.enabled = !config.enabled;
        if (config.enabled) config.snoozeUntil = 0;
        lastNativeSyncSig = '';
        lastBannerSig = '';
        saveConfig();
        if (!config.enabled) {
          try { global.EfectivaIdleAlarmBridge?.stopRingingNow(); } catch (_) {}
          cancelNativeIdleNotifications();
        }
        evaluateIdleAlarm(true);
        openIdleAlarmPanel();
      };
    }
    const permNotifBtn = modal.querySelector('#permNotifBtn');
    if (permNotifBtn) permNotifBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.requestNotificationPermission(); } catch (_) {} };
    const permExactBtn = modal.querySelector('#permExactBtn');
    if (permExactBtn) permExactBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.requestExactAlarmPermission(); } catch (_) {} };
    const permBatteryBtn = modal.querySelector('#permBatteryBtn');
    if (permBatteryBtn) permBatteryBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.requestIgnoreBatteryOptimizations(); } catch (_) {} };
    const permFullBtn = modal.querySelector('#permFullBtn');
    if (permFullBtn) permFullBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.requestFullScreenIntentPermission(); } catch (_) {} };
    const testLoudBtn = modal.querySelector('#idleTestLoudBtn');
    if (testLoudBtn) testLoudBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.triggerTestAlarm(buildPendingSummaryText(pending)); } catch (_) {} };
    const stopLoudBtn = modal.querySelector('#idleStopLoudBtn');
    if (stopLoudBtn) stopLoudBtn.onclick = () => { try { global.EfectivaIdleAlarmBridge?.stopRingingNow(); } catch (_) {} };
    const testWebLoudBtn = modal.querySelector('#idleTestWebLoudBtn');
    if (testWebLoudBtn) testWebLoudBtn.onclick = () => { playIdleAlarmTone(); };
    modal.querySelector('#idleSpeakChk').onchange = (e) => {
      config.speakPending = !!e.target.checked;
      saveConfig();
    };
    modal.querySelector('#idleSoundSecSel').onchange = (e) => {
      config.soundEverySec = Number(e.target.value) || 15;
      saveConfig();
    };
    modal.querySelector('#idleBgMinSel').onchange = (e) => {
      config.bgIntervalMin = Number(e.target.value) || 5;
      lastNotifScheduledSig = '';
      saveConfig();
      evaluateIdleAlarm(true);
    };
    modal.querySelectorAll('[data-snooze]').forEach(btn => {
      btn.onclick = () => {
        const mins = Number(btn.dataset.snooze) || 15;
        config.snoozeUntil = Date.now() + mins * 60 * 1000;
        saveConfig();
        cancelNativeIdleNotifications();
        evaluateIdleAlarm();
        openIdleAlarmPanel();
      };
    });
    const resumeBtn = modal.querySelector('#idleResumeNowBtn');
    if (resumeBtn) {
      resumeBtn.onclick = () => {
        config.snoozeUntil = 0;
        saveConfig();
        evaluateIdleAlarm(true);
        openIdleAlarmPanel();
      };
    }
    modal.querySelectorAll('[data-play-idx]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.playIdx);
        if (pending[idx]) startTaskFromIdleAlarm(pending[idx]);
      };
    });
  }

  function evaluateIdleAlarm(forceImmediate = false) {
    const playing = isTaskPlaying();
    if (wasPlaying && !playing) {
      // Acaba de salir de Play: 8s de gracia para elegir otra tarea sin sonar al milisegundo
      lastPlayStoppedAt = Date.now();
    }
    wasPlaying = playing;

    updateHeaderButton();
    renderPersistentBanner();

    const pending = getAllPendingTasks();
    const hasNativeLoud = syncNativeLoudAlarmBridge(pending);

    if (!shouldAlarmNow()) {
      cancelNativeIdleNotifications();
      return;
    }

    if (!hasNativeLoud) {
      scheduleNativeIdleNotifications(pending);
    }

    const now = Date.now();
    const gracePassed = forceImmediate || (now - lastPlayStoppedAt >= 8000);
    const intervalMs = Math.max(5, Number(config.soundEverySec) || 15) * 1000;

    if (gracePassed && (forceImmediate || (now - lastChimeAt >= intervalMs))) {
      lastChimeAt = now;
      if (!document.hidden) {
        playIdleAlarmTone();
        speakPendingSummary(pending);
      } else {
        fireWebNotificationIfBackground(pending);
      }
    }
  }

  function bindIdleAlarmUI() {
    const btn = document.getElementById('idleAlarmBtn');
    if (btn && !btn._idleBound) {
      btn._idleBound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openIdleAlarmPanel();
      });
    }
  }

  function initIdleAlarm() {
    loadConfig();
    bindIdleAlarmUI();

    // Desbloquear Web Audio & pedir permiso de Web Notification en primer gesto del usuario
    const unlockOnce = () => {
      audioUnlocked = true;
      try { if (typeof unlockStepAlarmAudio === 'function') unlockStepAlarmAudio(); } catch (_) {}
      if ('Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission().catch(() => {}); } catch (_) {}
      }
      evaluateIdleAlarm();
    };
    document.addEventListener('pointerdown', unlockOnce, { once: true, capture: true });
    document.addEventListener('keydown', unlockOnce, { once: true, capture: true });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) evaluateIdleAlarm();
    });

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => evaluateIdleAlarm(false), 3000);
    setTimeout(() => evaluateIdleAlarm(false), 1800);
  }

  global.EfectivaIdleAlarm = {
    openPanel: openIdleAlarmPanel,
    closePanel: closeIdleAlarmPanel,
    evaluate: evaluateIdleAlarm,
    renderBanner: renderPersistentBanner,
    startTask: startTaskFromIdleAlarm,
    getConfig: () => ({ ...config }),
    setEnabled(val) {
      config.enabled = !!val;
      if (config.enabled) config.snoozeUntil = 0;
      lastNativeSyncSig = '';
      lastBannerSig = '';
      saveConfig();
      if (!config.enabled) cancelNativeIdleNotifications();
      evaluateIdleAlarm(true);
    },
    getAllPendingTasks
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIdleAlarm);
  } else {
    setTimeout(initIdleAlarm, 80);
  }
})(typeof window !== 'undefined' ? window : globalThis);

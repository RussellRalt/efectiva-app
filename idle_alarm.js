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
    soundEverySec: 15,      // cada cuántos segundos suena el tono en primer plano
    bgIntervalMin: 5,       // cada cuántos minutos dispara notificación en 2do plano
    speakPending: false,    // leer pendientes en voz alta (opcional)
    snoozeUntil: 0          // timestamp para pausa temporal (ej. descanso/sueño)
  };

  let tickTimer = null;
  let lastChimeAt = 0;
  let lastNotifScheduledSig = '';
  let lastPlayStoppedAt = 0;
  let wasPlaying = false;
  let audioUnlocked = false;
  let panelOpen = false;

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

  // Tono distintivo de alarma perenne (3 pulsos ascendentes claros, diferente al de fin de paso)
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
      const freqs = [659.25, 880, 1174.66]; // E5 - A5 - D6
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
    } catch (_) {}
  }

  function speakPendingSummary(pending) {
    if (!config.speakPending || !pending.length) return;
    try {
      const names = pending.slice(0, 5).map(p => p.name).join(', ');
      const extra = pending.length > 5 ? ` y ${pending.length - 5} pendientes más.` : '.';
      const msg = `No estás ejecutando ninguna tarea. Tenés ${pending.length} pendientes: ${names}${extra}`;
      if (typeof speakStepText === 'function') {
        speakStepText(msg);
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
    try {
      if (typeof openFolder === 'function' && item.folderId) {
        openFolder(item.folderId, true);
      }
      if (typeof openPresentation === 'function') {
        openPresentation(item.task);
      }
    } catch (_) {}
    evaluateIdleAlarm();
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
      if (banner) banner.style.display = 'none';
      return;
    }

    const pending = getAllPendingTasks();
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'idleAlarmBanner';
      banner.className = 'idle-alarm-banner';
      document.body.appendChild(banner);
    }

    const topTask = pending[0];
    banner.style.display = 'flex';
    banner.innerHTML = `
      <div class="idle-alarm-banner-info">
        <span class="idle-alarm-pulse">🚨</span>
        <div class="idle-alarm-banner-text">
          <strong>Sin tarea en Play · ${pending.length} pendiente(s)</strong>
          <small>Siguiente: ${escHtml(topTask.name)} (${escHtml(topTask.folderName)})</small>
        </div>
      </div>
      <div class="idle-alarm-banner-actions">
        <button type="button" class="idle-btn-play" id="idleBannerPlayTopBtn">▶ Play</button>
        <button type="button" class="idle-btn-list" id="idleBannerOpenPanelBtn">📋 Ver todos</button>
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
          <h3 style="margin:0;font-size:1.05rem;">🚨 Alarma Perenne de Enfoque</h3>
          <button type="button" class="fin-btn sm" id="closeIdleAlarmModalBtn">✕</button>
        </div>

        <div class="idle-status-box ${playing ? 'ok' : (config.enabled && !snoozed ? 'alert' : 'muted')}">
          ${playing
            ? '🛡️ <strong>En Play:</strong> Estás trabajando en una tarea. La alarma está silenciada automáticamente.'
            : (!config.enabled
              ? '🔕 <strong>Desactivada:</strong> Activala para exigir una tarea en Play continuamente.'
              : (snoozed
                ? `⏸️ <strong>Pausada temporalmente:</strong> Quedan ${snoozeMinLeft} min de descanso.`
                : `🚨 <strong>ACTIVA (${pending.length} pendientes):</strong> Dale ▶ Play a una tarea para silenciarla.`))}
        </div>

        <div class="idle-controls-grid">
          <label class="idle-switch-row">
            <span>Alarma perenne activa</span>
            <input type="checkbox" id="idleEnabledChk" ${config.enabled ? 'checked' : ''} />
          </label>
          <label class="idle-switch-row">
            <span>🗣️ Leer pendientes en voz alta</span>
            <input type="checkbox" id="idleSpeakChk" ${config.speakPending ? 'checked' : ''} />
          </label>
          <label class="idle-select-row">
            <span>Sonido en app cada:</span>
            <select id="idleSoundSecSel">
              ${[10, 15, 30, 60].map(s => `<option value="${s}" ${config.soundEverySec === s ? 'selected' : ''}>${s} seg</option>`).join('')}
            </select>
          </label>
          <label class="idle-select-row">
            <span>Recordatorio 2do plano:</span>
            <select id="idleBgMinSel">
              ${[1, 2, 5, 10, 15].map(m => `<option value="${m}" ${config.bgIntervalMin === m ? 'selected' : ''}>${m} min</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="idle-snooze-row">
          <button type="button" class="fin-btn sm" data-snooze="15">⏸ 15m</button>
          <button type="button" class="fin-btn sm" data-snooze="30">⏸ 30m</button>
          <button type="button" class="fin-btn sm" data-snooze="60">⏸ 1h</button>
          ${snoozed ? '<button type="button" class="fin-btn sm primary" id="idleResumeNowBtn">▶ Reanudar ya</button>' : ''}
        </div>

        <div class="idle-pending-header">
          <strong>Todos tus pendientes (${pending.length})</strong>
          <small>Tocá ▶ Play para empezar y silenciar la alarma</small>
        </div>
        <div class="idle-pending-list" id="idlePendingList">
          ${pending.length === 0
            ? '<div class="excel-empty">🎉 ¡No tenés tareas pendientes!</div>'
            : pending.map((p, idx) => `
              <div class="idle-pending-item">
                <div class="idle-pending-meta">
                  <strong>${escHtml(p.name)}</strong>
                  <small>📁 ${escHtml(p.folderName)}${p.stepsCount ? ` · ${p.stepsCount} paso(s)` : ''}${p.totalMin ? ` · ${p.totalMin} min` : ''}${p.priority ? ` · ⚡ ${escHtml(p.priority)}` : ''}</small>
                </div>
                <button type="button" class="idle-btn-play" data-play-idx="${idx}">▶ Play</button>
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
      saveConfig();
      if (!config.enabled) cancelNativeIdleNotifications();
      evaluateIdleAlarm(true);
      openIdleAlarmPanel();
    };
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

    if (!shouldAlarmNow()) {
      cancelNativeIdleNotifications();
      return;
    }

    const pending = getAllPendingTasks();
    scheduleNativeIdleNotifications(pending);

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
    getConfig: () => ({ ...config }),
    setEnabled(val) {
      config.enabled = !!val;
      if (config.enabled) config.snoozeUntil = 0;
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

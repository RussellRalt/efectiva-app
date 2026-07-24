// @ts-nocheck
/* ============================================================================
 *  ASISTA MULTY — SISTEMA DE MODALES TEMÁTICOS v1
 *  Reemplaza alert()/confirm()/prompt() nativos del navegador por modales
 *  que respetan el tema activo (claro / oscuro / cyberpunk).
 *  También incluye AsistaModal.settings() para configurar la API key de IA.
 * ============================================================================ */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  //  HELPERS
  // ---------------------------------------------------------------------------
  function ensureContainer() {
    let c = document.getElementById('asistaModalRoot');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'asistaModalRoot';
    c.className = 'asista-modal-root';
    document.body.appendChild(c);
    return c;
  }

  function closeAll() {
    const c = document.getElementById('asistaModalRoot');
    if (c) c.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Escape: cerrar el último modal abierto (si no es persistente)
    const c = document.getElementById('asistaModalRoot');
    if (!c) return;
    const modals = c.querySelectorAll('.asista-modal');
    if (modals.length === 0) return;
    const last = modals[modals.length - 1];
    if (last.dataset.persistent === '1') return;
    const cb = last._onCancel;
    if (cb) cb();
  }

  function buildModal({ title, message, type, defaultValue, inputPlaceholder, confirmText, cancelText, persistent, onConfirm, onCancel, customButtons, accentColor }) {
    const root = ensureContainer();
    const overlay = document.createElement('div');
    overlay.className = 'asista-modal asista-modal-overlay';
    if (persistent) overlay.dataset.persistent = '1';
    if (type) overlay.dataset.type = type;
    if (accentColor) overlay.dataset.accent = accentColor;

    const box = document.createElement('div');
    box.className = 'asista-modal-box';

    // Icono
    let icon = '';
    if (type === 'alert')   icon = '<span class="asista-modal-icon icon-info">ℹ</span>';
    if (type === 'success') icon = '<span class="asista-modal-icon icon-ok">✓</span>';
    if (type === 'error')   icon = '<span class="asista-modal-icon icon-err">✕</span>';
    if (type === 'warn')    icon = '<span class="asista-modal-icon icon-warn">!</span>';
    if (type === 'question')icon = '<span class="asista-modal-icon icon-q">?</span>';

    if (title) {
      const h = document.createElement('div');
      h.className = 'asista-modal-title';
      h.textContent = title;
      box.appendChild(h);
    }
    if (icon) box.insertAdjacentHTML('afterbegin', icon);

    if (message) {
      const m = document.createElement('div');
      m.className = 'asista-modal-msg';
      // Soporta saltos de línea
      m.innerHTML = String(message).replace(/\n/g, '<br>');
      box.appendChild(m);
    }

    let inputEl = null;
    if (type === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'asista-modal-input';
      inputEl.placeholder = inputPlaceholder || '';
      inputEl.value = (defaultValue != null) ? defaultValue : '';
      inputEl.autocomplete = 'off';
      inputEl.spellcheck = false;
      box.appendChild(inputEl);
    }

    const buttons = document.createElement('div');
    buttons.className = 'asista-modal-buttons';
    if (customButtons && customButtons.length) {
      customButtons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'asista-modal-btn ' + (b.cls || '');
        btn.textContent = b.text;
        btn.onclick = () => { if (b.onClick) b.onClick(inputEl ? inputEl.value : undefined); };
        buttons.appendChild(btn);
      });
    } else {
      if (type === 'alert' || type === 'success' || type === 'error' || type === 'warn') {
        const ok = document.createElement('button');
        ok.className = 'asista-modal-btn primary';
        ok.textContent = confirmText || 'Aceptar';
        ok.onclick = () => { if (onConfirm) onConfirm(); };
        buttons.appendChild(ok);
      } else if (type === 'prompt' || type === 'question') {
        const cancel = document.createElement('button');
        cancel.className = 'asista-modal-btn secondary';
        cancel.textContent = cancelText || 'Cancelar';
        cancel.onclick = () => { if (onCancel) onCancel(); };
        const ok = document.createElement('button');
        ok.className = 'asista-modal-btn primary';
        ok.textContent = confirmText || 'Aceptar';
        ok.onclick = () => { if (onConfirm) onConfirm(inputEl ? inputEl.value : ''); };
        buttons.appendChild(cancel);
        buttons.appendChild(ok);
      }
    }
    box.appendChild(buttons);

    overlay.appendChild(box);
    root.appendChild(overlay);

    // Click fuera: cerrar (si no es persistente)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !persistent) {
        if (onCancel) onCancel();
      }
    });

    overlay._onCancel = onCancel;

    // Foco
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        // Seleccionar todo el texto prellenado
        if (defaultValue) {
          try { inputEl.setSelectionRange(0, defaultValue.length); } catch (e) {}
        }
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (onConfirm) onConfirm(inputEl.value);
          }
        });
      } else {
        const primary = box.querySelector('.asista-modal-btn.primary');
        if (primary) primary.focus();
      }
    }, 30);

    document.addEventListener('keydown', onKey);

    return { overlay, box, inputEl };
  }

  // ---------------------------------------------------------------------------
  //  API PÚBLICA
  // ---------------------------------------------------------------------------
  const AsistaModal = {
    /** Muestra un alert temático. Devuelve una Promise que se resuelve con true al aceptar. */
    alert(message, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        buildModal({
          type: opts.type || 'alert',
          title: opts.title || '',
          message: message,
          confirmText: opts.confirmText || 'Aceptar',
          onConfirm: () => { closeAll(); resolve(true); },
          onCancel:  () => { closeAll(); resolve(false); },
        });
      });
    },

    /** Confirma una acción. Devuelve Promise<boolean>. */
    confirm(message, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        buildModal({
          type: 'question',
          title: opts.title || 'Confirmar',
          message: message,
          confirmText: opts.confirmText || 'Aceptar',
          cancelText:  opts.cancelText  || 'Cancelar',
          onConfirm: () => { closeAll(); resolve(true); },
          onCancel:  () => { closeAll(); resolve(false); },
        });
      });
    },

    /** Pide un valor. Devuelve Promise<string|null>. */
    prompt(message, defaultValue, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        buildModal({
          type: 'prompt',
          title: opts.title || '',
          message: message,
          defaultValue: defaultValue,
          inputPlaceholder: opts.placeholder || '',
          confirmText: opts.confirmText || 'Aceptar',
          cancelText:  opts.cancelText  || 'Cancelar',
          onConfirm: (val) => { closeAll(); resolve(val == null ? null : val); },
          onCancel:  () => { closeAll(); resolve(null); },
        });
      });
    },

    /** Modal de configuración de API key de OpenRouter. */
    settings(opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        const savedKey  = localStorage.getItem('asista_openrouter_key')  || '';
        const savedModel = localStorage.getItem('asista_openrouter_model') || 'minimax/minimax-m3';
        const savedBase  = localStorage.getItem('asista_openrouter_base')  || 'https://openrouter.ai/api/v1/chat/completions';

        const root = ensureContainer();
        const overlay = document.createElement('div');
        overlay.className = 'asista-modal asista-modal-overlay asista-settings';
        overlay.dataset.persistent = '1';
        overlay.dataset.accent = 'cyan';

        const box = document.createElement('div');
        box.className = 'asista-modal-box asista-settings-box';

        const title = document.createElement('div');
        title.className = 'asista-modal-title';
        title.innerHTML = '<span class="asista-modal-icon icon-q">⚙</span> Configurar Asistente IA';
        box.appendChild(title);

        const m = document.createElement('div');
        m.className = 'asista-modal-msg asista-settings-msg';
        m.innerHTML = 'Pegá tu API key de OpenRouter (empieza con <code>sk-or-…</code>). Se guarda solo en este dispositivo.';
        box.appendChild(m);

        // API Key
        const lblKey = document.createElement('label');
        lblKey.className = 'asista-settings-label';
        lblKey.textContent = 'API Key';
        box.appendChild(lblKey);
        const inputKey = document.createElement('input');
        inputKey.type = 'password';
        inputKey.className = 'asista-modal-input';
        inputKey.placeholder = 'sk-or-v1-...';
        inputKey.value = savedKey;
        inputKey.autocomplete = 'off';
        box.appendChild(inputKey);

        // Toggle visibilidad
        const toggleRow = document.createElement('div');
        toggleRow.className = 'asista-settings-toggle';
        const toggleLbl = document.createElement('label');
        toggleLbl.className = 'asista-settings-show';
        const toggleCb = document.createElement('input');
        toggleCb.type = 'checkbox';
        toggleCb.onchange = () => { inputKey.type = toggleCb.checked ? 'text' : 'password'; };
        toggleLbl.appendChild(toggleCb);
        toggleLbl.appendChild(document.createTextNode(' Mostrar API key'));
        toggleRow.appendChild(toggleLbl);
        box.appendChild(toggleRow);

        // Label Modelo
        const lblModel = document.createElement('label');
        lblModel.className = 'asista-settings-label';
        lblModel.textContent = 'Modelo de IA (OpenRouter)';
        box.appendChild(lblModel);

        // Input oculto / valor seleccionado real
        const inputModel = document.createElement('input');
        inputModel.type = 'hidden';
        inputModel.value = savedModel;
        box.appendChild(inputModel);

        // Contenedor del Dropdown Desplegable
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'asista-model-dropdown';

        // Trigger / Botón compacto que se presiona para desplegar
        const dropdownTrigger = document.createElement('div');
        dropdownTrigger.className = 'asista-model-trigger';
        dropdownTrigger.innerHTML = `
          <div class="asista-model-trigger-content">
            <span class="asista-model-trigger-text"></span>
            <span class="asista-model-trigger-id"></span>
          </div>
          <span class="asista-model-trigger-arrow">▼</span>
        `;
        dropdownContainer.appendChild(dropdownTrigger);

        // Panel Flotante Popover (Desplegable)
        const popover = document.createElement('div');
        popover.className = 'asista-model-popover';

        // POSICIÓN #1: Buscador dentro del desplegable
        const inputSearch = document.createElement('input');
        inputSearch.type = 'text';
        inputSearch.className = 'asista-model-search';
        inputSearch.placeholder = '🔍 Buscar modelo (gpt-4o, claude, deepseek, gemini)...';
        popover.appendChild(inputSearch);

        // Lista de modelos dentro del desplegable
        const listContainer = document.createElement('div');
        listContainer.className = 'asista-model-list';
        popover.appendChild(listContainer);

        dropdownContainer.appendChild(popover);
        box.appendChild(dropdownContainer);

        // Modelos populares de respaldo
        const FALLBACK_MODELS = [
          { id: 'minimax/minimax-m3', name: 'MiniMax M3', badge: 'minimax' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'anthropic' },
          { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', badge: 'anthropic' },
          { id: 'openai/gpt-4o', name: 'GPT-4o', badge: 'openai' },
          { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', badge: 'openai' },
          { id: 'openai/o3-mini', name: 'OpenAI o3 Mini', badge: 'openai' },
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', badge: 'deepseek' },
          { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', badge: 'deepseek' },
          { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', badge: 'google' },
          { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', badge: 'google' },
          { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', badge: 'other' },
          { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', badge: 'other' }
        ];

        let availableModels = FALLBACK_MODELS;

        function updateTriggerText() {
          const currentId = inputModel.value.trim();
          const match = availableModels.find(m => m.id === currentId);
          const nameEl = dropdownTrigger.querySelector('.asista-model-trigger-text');
          const idEl = dropdownTrigger.querySelector('.asista-model-trigger-id');
          if (match) {
            nameEl.textContent = match.name;
            idEl.textContent = '(' + match.id + ')';
          } else {
            nameEl.textContent = currentId || 'Seleccionar modelo';
            idEl.textContent = '';
          }
        }

        function renderModelList(filterText) {
          listContainer.innerHTML = '';
          const query = (filterText || '').trim().toLowerCase();
          const filtered = availableModels.filter(m => {
            if (!query) return true;
            return m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query));
          });

          if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'asista-model-empty';
            empty.textContent = 'No se encontraron modelos para "' + filterText + '"';
            listContainer.appendChild(empty);
            return;
          }

          filtered.forEach(m => {
            const item = document.createElement('div');
            item.className = 'asista-model-item' + (inputModel.value.trim() === m.id ? ' selected' : '');

            const header = document.createElement('div');
            header.className = 'asista-model-item-header';

            const nameEl = document.createElement('span');
            nameEl.className = 'asista-model-item-name';
            nameEl.textContent = m.name || m.id;
            header.appendChild(nameEl);

            if (m.badge) {
              const badgeEl = document.createElement('span');
              badgeEl.className = 'asista-model-badge ' + m.badge;
              badgeEl.textContent = m.badge;
              header.appendChild(badgeEl);
            }

            const idEl = document.createElement('div');
            idEl.className = 'asista-model-item-id';
            idEl.textContent = m.id;

            item.appendChild(header);
            item.appendChild(idEl);

            item.onclick = (e) => {
              e.stopPropagation();
              inputModel.value = m.id;
              updateTriggerText();
              dropdownContainer.classList.remove('open');
            };

            listContainer.appendChild(item);
          });
        }

        // Abrir / Cerrar Desplegable al hacer clic en el trigger
        dropdownTrigger.onclick = (e) => {
          e.stopPropagation();
          const isOpen = dropdownContainer.classList.toggle('open');
          if (isOpen) {
            renderModelList(inputSearch.value);
            setTimeout(() => inputSearch.focus(), 50);
          }
        };

        // Prevenir que clics dentro del popover cierren el menú salvo al elegir
        popover.onclick = (e) => { e.stopPropagation(); };

        // Cerrar al hacer clic fuera
        const closeOnOutside = (e) => {
          if (!dropdownContainer.contains(e.target)) {
            dropdownContainer.classList.remove('open');
          }
        };
        document.addEventListener('click', closeOnOutside);

        // Evento de búsqueda
        inputSearch.addEventListener('input', () => {
          renderModelList(inputSearch.value);
        });

        updateTriggerText();
        renderModelList('');

        // Carga diferida de modelos desde la API de OpenRouter
        fetch('https://openrouter.ai/api/v1/models')
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data && Array.isArray(data.data) && data.data.length > 0) {
              availableModels = data.data.map(m => {
                let b = 'other';
                const idLower = m.id.toLowerCase();
                if (idLower.includes('openai')) b = 'openai';
                else if (idLower.includes('anthropic')) b = 'anthropic';
                else if (idLower.includes('google') || idLower.includes('gemini')) b = 'google';
                else if (idLower.includes('deepseek')) b = 'deepseek';
                else if (idLower.includes('minimax')) b = 'minimax';
                return { id: m.id, name: m.name || m.id, badge: b };
              });
              updateTriggerText();
              if (dropdownContainer.classList.contains('open')) {
                renderModelList(inputSearch.value);
              }
            }
          })
          .catch(err => console.warn('Carga diferida OpenRouter:', err));

        // Sugerencias rápidas
        const sug = document.createElement('div');
        sug.className = 'asista-settings-sug';
        sug.innerHTML = 'Tip: Usá el buscador de arriba para filtrar entre los cientos de modelos de OpenRouter.';
        box.appendChild(sug);

        // Botones
        const buttons = document.createElement('div');
        buttons.className = 'asista-modal-buttons';
        const cancel = document.createElement('button');
        cancel.className = 'asista-modal-btn secondary';
        cancel.textContent = 'Cancelar';
        cancel.onclick = () => { closeAll(); resolve(false); };
        const save = document.createElement('button');
        save.className = 'asista-modal-btn primary';
        save.textContent = 'Guardar';
        save.onclick = () => {
          const k = (inputKey.value || '').trim();
          const m = (inputModel.value || '').trim() || 'minimax/minimax-m3';
          if (k && !k.startsWith('sk-or-')) {
            // Aviso en el mismo modal
            const w = box.querySelector('.asista-settings-warn');
            if (w) w.remove();
            const warn = document.createElement('div');
            warn.className = 'asista-settings-warn';
            warn.textContent = 'La API key debería empezar con "sk-or-". ¿Querés guardarla igual?';
            box.insertBefore(warn, buttons);
            // Reemplazar el botón Guardar por uno de "Guardar igual"
            save.textContent = 'Guardar igual';
            save.onclick = () => {
              localStorage.setItem('asista_openrouter_key',  k);
              localStorage.setItem('asista_openrouter_model', m);
              localStorage.setItem('asista_openrouter_base',  savedBase);
              closeAll(); resolve(true);
            };
            return;
          }
          localStorage.setItem('asista_openrouter_key',  k);
          localStorage.setItem('asista_openrouter_model', m);
          localStorage.setItem('asista_openrouter_base',  savedBase);
          closeAll(); resolve(true);
        };
        buttons.appendChild(cancel);
        buttons.appendChild(save);
        box.appendChild(buttons);

        overlay.appendChild(box);
        root.appendChild(overlay);

        setTimeout(() => inputKey.focus(), 30);
        inputKey.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save.click(); }
        });
        document.addEventListener('keydown', onKey);
      });
    },

    /** Cierra todos los modales abiertos. */
    close: closeAll,
  };

  // Sobrescribir los nativos para que usen el sistema temático.
  // (Esto es lo que Russell pidió: que no aparezcan los diálogos feos del navegador.)
  window.asistaConfirm = AsistaModal.confirm;
  window.asistaAlert   = AsistaModal.alert;
  window.asistaPrompt  = AsistaModal.prompt;
  window.asistaSettings = AsistaModal.settings;

  // Reemplazar alert/confirm/prompt globales. Guardamos los originales por si
  // algo interno los necesita (ej. debugging).
  const _origAlert = window.alert.bind(window);
  const _origConfirm = window.confirm.bind(window);
  const _origPrompt = window.prompt.bind(window);
  window._origAlert = _origAlert;
  window._origConfirm = _origConfirm;
  window._origPrompt = _origPrompt;

  // Sobrescribimos, pero alert y confirm en código legacy suelen ser sincrónicos
  // (esperan un OK). Por compatibilidad bloqueamos solo el primer call de alert
  // con un modal, y para confirm devolvemos false por defecto si no se puede
  // esperar. Para mantener la app funcionando 100%, vamos a:
  //   - alert: mostrar el modal temático (no bloquea, el caller no se entera)
  //   - confirm: por seguridad devolvemos true (la acción se ejecuta), PERO
  //     logueamos para que se note y dejamos una versión asíncrona (asistaConfirm)
  //     para migrar el código.
  //   - prompt: devolvemos el defaultValue (o null).
  //
  // Para no romper nada, en este parche NO reemplazamos alert/confirm/prompt
  // globales todavía — sólo exponemos asistaAlert/Confirm/Prompt/Settings.
  // El reemplazo 1:1 lo hacemos editando las llamadas específicas en
  // ai_chat.js y script.js.

  // Mensaje en consola: explica cómo migrar.
  // console.info('[AsistaModal] Usá asistaAlert/Confirm/Prompt/Settings en lugar de los nativos.');

  window.AsistaModal = AsistaModal;
})();

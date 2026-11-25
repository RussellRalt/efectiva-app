/* ============================================================================
 *  EFECTIVA v44 — NOTAS MODULARES & RECORDATORIOS ESTRUCTURADOS
 *  Retrocompatible 100% con notas planas existentes (title + content).
 *  Sin Play, sin temporizador obligatorio, sin métricas de culpa:
 *  se fijan (pin), se editan con cuerpo dual (texto + items) y se archivan.
 * ============================================================================ */
(function (global) {
  'use strict';

  const viewFilterState = {
    tab: 'all',           // 'all' | 'tasks' | 'notes' | 'tables'
    noteSub: 'active',    // 'active' | 'pinned' | 'reminders' | 'archived'
    search: ''
  };

  function genId(prefix) {
    return (prefix || '_') + Math.random().toString(36).slice(2, 10);
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normalizeNote(n) {
    if (!n || typeof n !== 'object') return n;
    if (!n.kind) n.kind = (Array.isArray(n.items) && n.items.length > 0) ? 'lista' : (n.reminderAt ? 'recordatorio' : 'nota');
    if (typeof n.pinned !== 'boolean') n.pinned = false;
    if (typeof n.archived !== 'boolean') n.archived = false;
    if (!Array.isArray(n.items)) n.items = [];
    if (!Array.isArray(n.tags)) n.tags = [];
    return n;
  }

  function getNotesRef() {
    if (typeof notes !== 'undefined' && Array.isArray(notes)) return notes;
    if (!Array.isArray(global.notes)) global.notes = [];
    return global.notes;
  }

  function persistNotesAndRefresh() {
    if (typeof saveNotes === 'function') saveNotes();
    if (typeof renderTasks === 'function') renderTasks();
  }

  function formatReminderBadge(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const isTomorrow = d.toDateString() === tomorrow.toDateString();
      const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (sameDay) return `Hoy ${hhmm}`;
      if (isTomorrow) return `Mañana ${hhmm}`;
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + hhmm;
    } catch (_) {
      return '';
    }
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) {
      return '';
    }
  }

  function renderSimpleMarkdown(text) {
    const safe = escHtml(text || '');
    return safe
      .replace(/^### (.+)$/gm, '<strong style="font-size:0.95em;">$1</strong>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:1.02em;">$1</strong>')
      .replace(/^# (.+)$/gm, '<strong style="font-size:1.08em;">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function getKindMeta(kind) {
    if (kind === 'recordatorio') return { icon: '⏰', label: 'Recordatorio', cls: 'note-kind-reminder' };
    if (kind === 'lista') return { icon: '☑️', label: 'Lista', cls: 'note-kind-list' };
    return { icon: '📝', label: 'Nota', cls: 'note-kind-note' };
  }

  function getFilteredNotesForFolder(folderId) {
    const all = getNotesRef().map(normalizeNote).filter(n => n.folderId === folderId || !n.folderId);
    const q = (viewFilterState.search || '').trim().toLowerCase();

    let filtered = all.filter(n => {
      if (viewFilterState.noteSub === 'archived') {
        if (!n.archived) return false;
      } else {
        if (n.archived) return false;
        if (viewFilterState.noteSub === 'pinned' && !n.pinned) return false;
        if (viewFilterState.noteSub === 'reminders' && !n.reminderAt && n.kind !== 'recordatorio') return false;
      }
      if (q) {
        const hay = [
          n.title || '',
          n.content || '',
          (n.tags || []).join(' '),
          (n.items || []).map(i => i.text).join(' ')
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Fijadas primero, luego más recientes
    filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    return filtered;
  }

  function buildFolderFilterBar(counts) {
    const wrap = document.createElement('div');
    wrap.className = 'folder-view-filters';

    const tabsRow = document.createElement('div');
    tabsRow.className = 'folder-view-tabs';
    const tabs = [
      { key: 'all', label: `Todos (${counts.tasks + counts.notes + counts.tables})` },
      { key: 'tasks', label: `☑ Tareas (${counts.tasks})` },
      { key: 'notes', label: `📝 Notas (${counts.notes})` },
      ...(counts.tables > 0 ? [{ key: 'tables', label: `📊 Tablas (${counts.tables})` }] : [])
    ];
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fview-tab' + (viewFilterState.tab === t.key ? ' active' : '');
      btn.textContent = t.label;
      btn.onclick = () => {
        viewFilterState.tab = t.key;
        if (typeof renderTasks === 'function') renderTasks();
      };
      tabsRow.appendChild(btn);
    });
    wrap.appendChild(tabsRow);

    // Sub-filtros de Notas (visibles cuando estamos en Notas o cuando hay notas archivadas/fijadas)
    if (viewFilterState.tab === 'notes' || (viewFilterState.tab === 'all' && (counts.notes > 0 || counts.archivedNotes > 0))) {
      const subRow = document.createElement('div');
      subRow.className = 'notes-subfilters';

      const subs = [
        { key: 'active', label: 'Activas' },
        { key: 'pinned', label: `📌 Fijadas${counts.pinnedNotes ? ` (${counts.pinnedNotes})` : ''}` },
        { key: 'reminders', label: `⏰ Recordatorios${counts.reminderNotes ? ` (${counts.reminderNotes})` : ''}` },
        { key: 'archived', label: `📦 Archivadas${counts.archivedNotes ? ` (${counts.archivedNotes})` : ''}` }
      ];
      subs.forEach(s => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'note-subchip' + (viewFilterState.noteSub === s.key ? ' active' : '');
        chip.textContent = s.label;
        chip.onclick = () => {
          viewFilterState.noteSub = s.key;
          if (viewFilterState.tab === 'tasks') viewFilterState.tab = 'notes';
          if (typeof renderTasks === 'function') renderTasks();
        };
        subRow.appendChild(chip);
      });

      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'note-search-input';
      searchInput.placeholder = 'Buscar en notas o #etiquetas...';
      searchInput.value = viewFilterState.search;
      searchInput.oninput = (e) => {
        viewFilterState.search = e.target.value;
        if (typeof renderTasks === 'function') renderTasks();
        const ref = document.querySelector('.note-search-input');
        if (ref) {
          ref.focus();
          ref.setSelectionRange(ref.value.length, ref.value.length);
        }
      };
      subRow.appendChild(searchInput);
      wrap.appendChild(subRow);
    }

    return wrap;
  }

  function convertNoteToTask(noteId, archiveSource = false) {
    const list = getNotesRef();
    const note = list.find(n => n.id === noteId);
    if (!note) return null;
    normalizeNote(note);

    const targetFolderId = note.folderId || (typeof currentFolderId !== 'undefined' ? currentFolderId : null);
    const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
    const folder = allFolders.find(f => f.id === targetFolderId) || allFolders.find(f => !f.isDefaultRewards);
    if (!folder) return null;

    let steps = [];
    if (note.items && note.items.length > 0) {
      steps = note.items.filter(i => !i.checked).map(i => String(i.text || '').trim()).filter(Boolean);
      if (steps.length === 0) {
        steps = note.items.map(i => String(i.text || '').trim()).filter(Boolean);
      }
    } else if (note.content && note.content.trim()) {
      steps = note.content.split(/\r?\n/).map(l => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 30);
    }
    if (steps.length === 0) steps = [note.title || 'Ejecutar nota'];

    const newTask = {
      id: genId('_'),
      name: note.title || 'Tarea desde nota',
      steps,
      isExpanded: false,
      scheduledTimestamp: note.reminderAt ? new Date(note.reminderAt).getTime() : null,
      totalTime: null,
      tags: Array.isArray(note.tags) ? [...note.tags] : [],
      ...(note.color ? { color: note.color } : {}),
      currentStepIndex: 0
    };
    folder.tasks.unshift(newTask);
    if (archiveSource) {
      note.archived = true;
      note.updatedAt = Date.now();
    }
    if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
    if (typeof saveNotes === 'function') saveNotes();
    if (typeof renderTasks === 'function') renderTasks();
    if (typeof showVoiceNotice === 'function') {
      showVoiceNotice(`✅ Tarea "${newTask.name}" creada con ${steps.length} paso(s)`);
    }
    return newTask;
  }

  function promoteItemToTask(noteId, itemId) {
    const list = getNotesRef();
    const note = list.find(n => n.id === noteId);
    if (!note) return null;
    normalizeNote(note);
    const item = note.items.find(i => i.id === itemId);
    if (!item || !item.text) return null;

    const targetFolderId = note.folderId || (typeof currentFolderId !== 'undefined' ? currentFolderId : null);
    const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
    const folder = allFolders.find(f => f.id === targetFolderId) || allFolders.find(f => !f.isDefaultRewards);
    if (!folder) return null;

    const newTask = {
      id: genId('_'),
      name: item.text.trim(),
      steps: [item.text.trim()],
      isExpanded: false,
      scheduledTimestamp: null,
      totalTime: null,
      tags: Array.isArray(note.tags) ? [...note.tags] : [],
      ...(note.color ? { color: note.color } : {}),
      currentStepIndex: 0
    };
    folder.tasks.unshift(newTask);
    item.checked = true;
    note.updatedAt = Date.now();
    if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
    if (typeof saveNotes === 'function') saveNotes();
    if (typeof renderTasks === 'function') renderTasks();
    if (typeof showVoiceNotice === 'function') {
      showVoiceNotice(`⚡ Ítem promovido a tarea: "${newTask.name}"`);
    }
    return newTask;
  }

  function convertTaskToNote(folder, task, removeSource = false) {
    if (!task) return null;
    const list = getNotesRef();
    const rawSteps = Array.isArray(task.steps) ? task.steps : [];
    const items = rawSteps.map((s, idx) => ({
      id: genId('_ni_'),
      text: typeof extractStepText === 'function' ? extractStepText(s) : String(s || ''),
      checked: false,
      order: idx
    })).filter(i => i.text);

    const note = normalizeNote({
      id: genId('_'),
      title: task.name || 'Nota sin título',
      content: '',
      folderId: folder ? folder.id : (typeof currentFolderId !== 'undefined' ? currentFolderId : null),
      taskId: null,
      tags: Array.isArray(task.tags) ? [...task.tags] : [],
      color: task.color || null,
      kind: items.length > 0 ? 'lista' : 'nota',
      pinned: false,
      archived: false,
      reminderAt: task.scheduledTimestamp ? new Date(task.scheduledTimestamp).toISOString() : null,
      items,
      displayMode: 'compact',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    list.unshift(note);

    if (removeSource && folder && typeof moveTaskToTrash === 'function') {
      moveTaskToTrash(folder, task.id, false);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
    }
    if (typeof saveNotes === 'function') saveNotes();
    if (typeof renderTasks === 'function') renderTasks();
    if (typeof showVoiceNotice === 'function') {
      showVoiceNotice(`📝 Convertida a Nota Modular (${items.length} ítem(s))`);
    }
    return note;
  }

  function buildNoteCard(note) {
    normalizeNote(note);
    const kindMeta = getKindMeta(note.kind);
    const noteDiv = document.createElement('div');
    noteDiv.className = 'task note-item note-modular-card' + (note.pinned ? ' note-pinned' : '') + (note.archived ? ' note-archived' : '');
    noteDiv.dataset.noteId = note.id;

    if (note.color && typeof applyCardColorTheme === 'function') {
      applyCardColorTheme(noteDiv, note.color);
    }

    const noteHeader = document.createElement('div');
    noteHeader.className = 'task-header note-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'note-title-wrap';
    titleWrap.onclick = () => openNoteEditor(note.id);

    const safeTitle = escHtml(note.title || 'Sin título');
    const totalItems = note.items.length;
    const doneItems = note.items.filter(i => i.checked).length;
    const remBadge = formatReminderBadge(note.reminderAt);

    titleWrap.innerHTML = `
      <div class="note-title-line">
        ${note.pinned ? '<span class="note-pin-flag" title="Fijada">📌</span>' : ''}
        <span class="note-kind-pill ${kindMeta.cls}">${kindMeta.icon} ${kindMeta.label}</span>
        <span class="task-name-text note-name-text">${safeTitle}</span>
      </div>
      <div class="note-meta-badges">
        ${totalItems > 0 ? `<span class="note-progress-pill">☑ ${doneItems}/${totalItems}</span>` : ''}
        ${remBadge ? `<span class="note-reminder-pill">⏰ ${escHtml(remBadge)}</span>` : ''}
        ${(note.tags || []).map(t => `<span class="note-tag-pill">#${escHtml(String(t).replace(/^#/, ''))}</span>`).join('')}
      </div>
    `;

    const noteButtons = document.createElement('div');
    noteButtons.className = 'task-buttons note-buttons';

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.textContent = '📌';
    pinBtn.title = note.pinned ? 'Desfijar nota' : 'Fijar arriba';
    if (note.pinned) pinBtn.classList.add('note-pin-active');
    pinBtn.onclick = (e) => {
      e.stopPropagation();
      note.pinned = !note.pinned;
      note.updatedAt = Date.now();
      persistNotesAndRefresh();
    };

    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.textContent = '🎨';
    colorBtn.title = 'Cambiar color de la nota';
    colorBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof openColorPicker === 'function') {
        openColorPicker(colorBtn, note.color || null, (newColor) => {
          if (newColor === null) delete note.color;
          else note.color = newColor;
          note.updatedAt = Date.now();
          persistNotesAndRefresh();
        });
      }
    };

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✏️';
    editBtn.title = 'Abrir editor híbrido';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      openNoteEditor(note.id);
    };

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = note.isExpanded ? '▼' : '◀';
    toggleBtn.title = 'Ver/Ocultar contenido';
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      note.isExpanded = !note.isExpanded;
      note.displayMode = note.isExpanded ? 'expanded' : 'compact';
      persistNotesAndRefresh();
    };

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.textContent = '⋮';
    menuBtn.title = 'Más acciones';

    const noteMenu = document.createElement('div');
    noteMenu.className = 'task-menu';
    noteMenu.style.display = 'none';

    const mkMenuItem = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = (e) => {
        e.stopPropagation();
        noteMenu.style.display = 'none';
        noteDiv.classList.remove('menu-open');
        fn();
      };
      return b;
    };

    noteMenu.append(
      mkMenuItem('▶ Convertir a Tarea', () => {
        if (typeof asistaConfirm === 'function') {
          asistaConfirm(`¿Convertir "${note.title}" en una Tarea ejecutable? (La nota quedará archivada)`, { title: 'Convertir a Tarea', confirmText: 'Convertir' })
            .then(ok => { if (ok) convertNoteToTask(note.id, true); });
        } else {
          convertNoteToTask(note.id, true);
        }
      }),
      mkMenuItem(note.archived ? '📤 Desarchivar nota' : '📦 Archivar nota', () => {
        note.archived = !note.archived;
        note.updatedAt = Date.now();
        persistNotesAndRefresh();
      }),
      mkMenuItem('📸 Capturar PNG', () => {
        if (typeof capturarElementoComoImagen === 'function') {
          capturarElementoComoImagen(noteDiv, `Nota_${(note.title || 'Nota').replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        }
      }),
      mkMenuItem('🗑 Eliminar', async () => {
        const ok = typeof asistaConfirm === 'function'
          ? await asistaConfirm(`¿Eliminar la nota "${note.title}"?`, { title: 'Eliminar Nota', danger: true })
          : confirm(`¿Eliminar la nota "${note.title}"?`);
        if (!ok) return;
        const list = getNotesRef();
        const idx = list.findIndex(n => n.id === note.id);
        if (idx !== -1) list.splice(idx, 1);
        persistNotesAndRefresh();
      })
    );

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const open = noteMenu.style.display === 'block';
      document.querySelectorAll('.task-menu').forEach(m => { m.style.display = 'none'; });
      document.querySelectorAll('.task.menu-open').forEach(el => el.classList.remove('menu-open'));
      if (!open) {
        noteMenu.style.display = 'block';
        noteDiv.classList.add('menu-open');
      }
    };

    noteButtons.append(pinBtn, colorBtn, editBtn, toggleBtn, menuBtn, noteMenu);
    noteHeader.append(titleWrap, noteButtons);
    noteDiv.appendChild(noteHeader);

    // Cuerpo desplegable con checklist interactivo inline + lectura Markdown limpia
    const noteBodyDiv = document.createElement('div');
    noteBodyDiv.className = 'note-expanded-body';
    noteBodyDiv.style.display = note.isExpanded ? 'block' : 'none';

    if (note.content && note.content.trim()) {
      const reader = document.createElement('div');
      reader.className = 'note-reader-content';
      reader.innerHTML = renderSimpleMarkdown(note.content);
      noteBodyDiv.appendChild(reader);
    }

    if (note.items.length > 0) {
      const pct = Math.round((doneItems / totalItems) * 100);
      const prog = document.createElement('div');
      prog.className = 'note-items-progress';
      prog.innerHTML = `<div class="note-items-progress-track"><div class="note-items-progress-fill" style="width:${pct}%"></div></div><span>${doneItems}/${totalItems}</span>`;
      noteBodyDiv.appendChild(prog);

      const itemsUl = document.createElement('div');
      itemsUl.className = 'note-inline-items';
      note.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'note-inline-item' + (item.checked ? ' checked' : '');
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!item.checked;
        chk.onchange = (e) => {
          e.stopPropagation();
          item.checked = !!chk.checked;
          note.updatedAt = Date.now();
          persistNotesAndRefresh();
        };
        const span = document.createElement('span');
        span.textContent = item.text;
        const promoteBtn = document.createElement('button');
        promoteBtn.type = 'button';
        promoteBtn.className = 'note-item-promote-btn';
        promoteBtn.title = 'Promover este ítem a una Tarea ejecutable';
        promoteBtn.textContent = '⚡ Tarea';
        promoteBtn.onclick = (e) => {
          e.stopPropagation();
          promoteItemToTask(note.id, item.id);
        };
        row.append(chk, span, promoteBtn);
        itemsUl.appendChild(row);
      });
      noteBodyDiv.appendChild(itemsUl);
    }

    // Input rápido inline para agregar un ítem sin abrir el modal
    const quickAddRow = document.createElement('div');
    quickAddRow.className = 'note-quick-item-row';
    const quickInput = document.createElement('input');
    quickInput.type = 'text';
    quickInput.className = 'note-quick-item-input';
    quickInput.placeholder = '+ Agregar ítem rápido (Enter)...';
    quickInput.onkeydown = (e) => {
      if (e.key === 'Enter' && quickInput.value.trim()) {
        e.preventDefault();
        note.items.push({ id: genId('_ni_'), text: quickInput.value.trim(), checked: false, order: note.items.length });
        if (note.kind === 'nota') note.kind = 'lista';
        note.updatedAt = Date.now();
        quickInput.value = '';
        persistNotesAndRefresh();
      }
    };
    quickAddRow.appendChild(quickInput);
    noteBodyDiv.appendChild(quickAddRow);

    const footer = document.createElement('div');
    footer.className = 'note-reader-footer';
    const dateStr = (note.updatedAt || note.createdAt) ? new Date(note.updatedAt || note.createdAt).toLocaleDateString() : '';
    footer.innerHTML = `<span>📅 ${dateStr}</span><button type="button" class="note-btn edit-note-inline-btn" style="margin-left:auto;">✏️ Editor completo</button>`;
    footer.querySelector('.edit-note-inline-btn').onclick = (e) => {
      e.stopPropagation();
      openNoteEditor(note.id);
    };
    noteBodyDiv.appendChild(footer);

    noteDiv.appendChild(noteBodyDiv);
    return noteDiv;
  }

  function closeNoteEditor() {
    const modal = document.getElementById('noteEditorModal');
    if (modal) modal.remove();
  }

  function openNoteEditor(noteId) {
    closeNoteEditor();
    const list = getNotesRef();
    const note = list.find(n => n.id === noteId);
    if (!note) return;
    normalizeNote(note);

    // Copia de trabajo para editar cómodamente y guardar al instante o al pulsar Guardar
    let draft = {
      title: note.title || '',
      content: note.content || '',
      kind: note.kind || 'nota',
      folderId: note.folderId || null,
      tagsStr: (note.tags || []).join(', '),
      color: note.color || null,
      pinned: !!note.pinned,
      archived: !!note.archived,
      reminderAt: note.reminderAt || null,
      items: (note.items || []).map((i, idx) => ({ id: i.id || genId('_ni_'), text: i.text || '', checked: !!i.checked, order: idx }))
    };

    const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders.filter(f => !f.isDefaultRewards) : [];
    const modal = document.createElement('div');
    modal.id = 'noteEditorModal';
    modal.className = 'sheet-modal';

    const renderModal = () => {
      modal.innerHTML = `
        <div class="sheet-modal-card note-editor-card">
          <div class="sheet-modal-header">
            <div class="idle-modal-head-title">
              <span class="cc-kicker">Nota Modular</span>
              <input type="text" id="neTitleInput" class="sheet-title-input" value="${escHtml(draft.title)}" placeholder="Título de la nota..." />
            </div>
            <button type="button" class="cc-close-btn" id="neCloseBtn" aria-label="Cerrar">✕</button>
          </div>

          <div class="ne-meta-row">
            <div class="ne-kind-pills">
              ${['nota', 'recordatorio', 'lista'].map(k => {
                const m = getKindMeta(k);
                return `<button type="button" class="fin-btn sm ${draft.kind === k ? 'primary' : ''}" data-ne-kind="${k}">${m.icon} ${m.label}</button>`;
              }).join('')}
            </div>
            <div class="ne-quick-toggles">
              <button type="button" class="fin-btn sm ${draft.pinned ? 'primary' : ''}" id="nePinBtn">📌 ${draft.pinned ? 'Fijada' : 'Fijar'}</button>
              <button type="button" class="fin-btn sm" id="neColorBtn">🎨 Color</button>
            </div>
          </div>

          <div class="ne-fields-grid">
            <label>Carpeta
              <select id="neFolderSel">
                <option value="">General (sin carpeta)</option>
                ${allFolders.map(f => `<option value="${escHtml(f.id)}" ${draft.folderId === f.id ? 'selected' : ''}>${escHtml(f.name)}</option>`).join('')}
              </select>
            </label>
            <label>Etiquetas (coma)
              <input type="text" id="neTagsInput" value="${escHtml(draft.tagsStr)}" placeholder="ej: ineb, ideas, urgente" />
            </label>
          </div>

          <div class="ne-reminder-box">
            <label>⏰ Recordatorio opcional
              <input type="datetime-local" id="neReminderInput" value="${toDatetimeLocalValue(draft.reminderAt)}" />
            </label>
            <div class="ne-reminder-presets">
              <button type="button" class="fin-btn sm" data-rem-preset="today">Hoy 18:00</button>
              <button type="button" class="fin-btn sm" data-rem-preset="tomorrow">Mañana 9:00</button>
              <button type="button" class="fin-btn sm" data-rem-preset="week">+1 semana</button>
              ${draft.reminderAt ? '<button type="button" class="fin-btn sm danger" data-rem-preset="clear">Quitar</button>' : ''}
            </div>
          </div>

          <div class="ne-dual-body">
            <label class="ne-section-label">Texto / Markdown
              <textarea id="neContentInput" rows="4" placeholder="Escribí apuntes, ideas o referencias...">${escHtml(draft.content)}</textarea>
            </label>

            <div class="ne-items-section">
              <div class="ne-section-header">
                <strong>Ítems / Checklist rápido (${draft.items.filter(i => i.checked).length}/${draft.items.length})</strong>
              </div>
              <div class="ne-items-add-row">
                <input type="text" id="neNewItemInput" placeholder="Agrega un ítem y presioná Enter..." />
                <button type="button" class="fin-btn sm primary" id="neAddItemBtn">+ Agregar</button>
              </div>
              <div class="ne-items-list">
                ${draft.items.length === 0
                  ? '<small style="opacity:0.65;">Todavía no hay ítems. Agregá puntos rápidos arriba.</small>'
                  : draft.items.map((item, idx) => `
                    <div class="ne-item-row ${item.checked ? 'checked' : ''}">
                      <input type="checkbox" data-item-chk="${idx}" ${item.checked ? 'checked' : ''} />
                      <input type="text" class="ne-item-text-input" data-item-txt="${idx}" value="${escHtml(item.text)}" />
                      <button type="button" class="fin-btn sm" data-item-up="${idx}" title="Subir" ${idx === 0 ? 'disabled' : ''}>↑</button>
                      <button type="button" class="fin-btn sm" data-item-down="${idx}" title="Bajar" ${idx === draft.items.length - 1 ? 'disabled' : ''}>↓</button>
                      <button type="button" class="fin-btn sm" data-item-promote="${idx}" title="Promover a Tarea">⚡</button>
                      <button type="button" class="fin-btn sm danger" data-item-del="${idx}" title="Quitar">✕</button>
                    </div>
                  `).join('')}
              </div>
            </div>
          </div>

          <div class="ne-footer-actions">
            <button type="button" class="fin-btn sm" id="neConvertTaskBtn">▶ Convertir a Tarea</button>
            <button type="button" class="fin-btn sm" id="neArchiveBtn">${draft.archived ? '📤 Desarchivar' : '📦 Archivar'}</button>
            <button type="button" class="fin-btn primary" id="neSaveBtn" style="margin-left:auto;">💾 Guardar</button>
          </div>
        </div>
      `;

      const syncDraftFromInputs = () => {
        const tEl = modal.querySelector('#neTitleInput');
        const cEl = modal.querySelector('#neContentInput');
        const fEl = modal.querySelector('#neFolderSel');
        const tgEl = modal.querySelector('#neTagsInput');
        const rEl = modal.querySelector('#neReminderInput');
        if (tEl) draft.title = tEl.value;
        if (cEl) draft.content = cEl.value;
        if (fEl) draft.folderId = fEl.value || null;
        if (tgEl) draft.tagsStr = tgEl.value;
        if (rEl) draft.reminderAt = rEl.value ? new Date(rEl.value).toISOString() : null;
      };

      const saveToNote = () => {
        syncDraftFromInputs();
        note.title = (draft.title || '').trim() || 'Sin título';
        note.content = draft.content || '';
        note.kind = draft.kind;
        note.folderId = draft.folderId;
        note.tags = draft.tagsStr.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
        if (draft.color) note.color = draft.color;
        else delete note.color;
        note.pinned = draft.pinned;
        note.archived = draft.archived;
        note.reminderAt = draft.reminderAt;
        note.items = draft.items.filter(i => i.text.trim()).map((i, idx) => ({ ...i, text: i.text.trim(), order: idx }));
        note.updatedAt = Date.now();
        persistNotesAndRefresh();
      };

      modal.querySelector('#neCloseBtn').onclick = closeNoteEditor;
      modal.querySelectorAll('[data-ne-kind]').forEach(btn => {
        btn.onclick = () => { syncDraftFromInputs(); draft.kind = btn.dataset.neKind; renderModal(); };
      });
      modal.querySelector('#nePinBtn').onclick = () => { syncDraftFromInputs(); draft.pinned = !draft.pinned; renderModal(); };
      modal.querySelector('#neColorBtn').onclick = (e) => {
        e.stopPropagation();
        if (typeof openColorPicker === 'function') {
          openColorPicker(e.currentTarget, draft.color, (newColor) => {
            syncDraftFromInputs();
            draft.color = newColor;
            renderModal();
          });
        }
      };
      modal.querySelectorAll('[data-rem-preset]').forEach(btn => {
        btn.onclick = () => {
          syncDraftFromInputs();
          const p = btn.dataset.remPreset;
          const d = new Date();
          if (p === 'clear') {
            draft.reminderAt = null;
          } else {
            if (p === 'today') { d.setHours(18, 0, 0, 0); if (d.getTime() < Date.now()) d.setHours(d.getHours() + 2); }
            else if (p === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
            else if (p === 'week') { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }
            draft.reminderAt = d.toISOString();
            if (draft.kind === 'nota') draft.kind = 'recordatorio';
          }
          renderModal();
        };
      });

      const addItem = () => {
        syncDraftFromInputs();
        const inp = modal.querySelector('#neNewItemInput');
        if (!inp || !inp.value.trim()) return;
        draft.items.push({ id: genId('_ni_'), text: inp.value.trim(), checked: false, order: draft.items.length });
        if (draft.kind === 'nota') draft.kind = 'lista';
        renderModal();
        const nextInp = modal.querySelector('#neNewItemInput');
        if (nextInp) nextInp.focus();
      };
      modal.querySelector('#neAddItemBtn').onclick = addItem;
      modal.querySelector('#neNewItemInput').onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addItem(); }
      };

      modal.querySelectorAll('[data-item-chk]').forEach(chk => {
        chk.onchange = () => {
          syncDraftFromInputs();
          const idx = Number(chk.dataset.itemChk);
          if (draft.items[idx]) draft.items[idx].checked = !!chk.checked;
          renderModal();
        };
      });
      modal.querySelectorAll('[data-item-txt]').forEach(inp => {
        inp.oninput = () => {
          const idx = Number(inp.dataset.itemTxt);
          if (draft.items[idx]) draft.items[idx].text = inp.value;
        };
      });
      modal.querySelectorAll('[data-item-up]').forEach(btn => {
        btn.onclick = () => {
          syncDraftFromInputs();
          const i = Number(btn.dataset.itemUp);
          if (i > 0) { const tmp = draft.items[i - 1]; draft.items[i - 1] = draft.items[i]; draft.items[i] = tmp; renderModal(); }
        };
      });
      modal.querySelectorAll('[data-item-down]').forEach(btn => {
        btn.onclick = () => {
          syncDraftFromInputs();
          const i = Number(btn.dataset.itemDown);
          if (i < draft.items.length - 1) { const tmp = draft.items[i + 1]; draft.items[i + 1] = draft.items[i]; draft.items[i] = tmp; renderModal(); }
        };
      });
      modal.querySelectorAll('[data-item-del]').forEach(btn => {
        btn.onclick = () => {
          syncDraftFromInputs();
          draft.items.splice(Number(btn.dataset.itemDel), 1);
          renderModal();
        };
      });
      modal.querySelectorAll('[data-item-promote]').forEach(btn => {
        btn.onclick = () => {
          saveToNote();
          const item = draft.items[Number(btn.dataset.itemPromote)];
          if (item) {
            promoteItemToTask(note.id, item.id);
            item.checked = true;
            renderModal();
          }
        };
      });

      modal.querySelector('#neArchiveBtn').onclick = () => {
        draft.archived = !draft.archived;
        saveToNote();
        closeNoteEditor();
      };
      modal.querySelector('#neConvertTaskBtn').onclick = () => {
        saveToNote();
        closeNoteEditor();
        convertNoteToTask(note.id, true);
      };
      modal.querySelector('#neSaveBtn').onclick = () => {
        saveToNote();
        closeNoteEditor();
      };
    };

    modal.onclick = (e) => { if (e.target === modal) closeNoteEditor(); };
    document.body.appendChild(modal);
    renderModal();
  }

  global.EfectivaNotes = {
    normalizeNote,
    getViewState: () => ({ ...viewFilterState }),
    setViewTab(t) { viewFilterState.tab = t; },
    getFilteredNotesForFolder,
    buildFolderFilterBar,
    buildNoteCard,
    openNoteEditor,
    closeNoteEditor,
    convertNoteToTask,
    convertTaskToNote,
    promoteItemToTask
  };
})(typeof window !== 'undefined' ? window : globalThis);

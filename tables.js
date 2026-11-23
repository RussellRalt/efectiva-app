/* ============================================================================
 *  EFECTIVA — MÓDULO DE TABLAS GENÉRICAS (ESTILO EXCEL / NOTION LIGERO)
 *  Persistencia offline-first: localStorage ('efectivaTablesV1') + Supabase user_data.
 *  Lazy Loading para IA: listar_tablas (solo metadata), leer_tabla (paginado),
 *  gestionar_tabla (estructura sin reescribir filas), parchear_filas_tabla.
 * ============================================================================ */
(function (global) {
  'use strict';

  const TABLES_STORAGE_KEY = 'efectivaTablesV1';
  const VALID_COL_TYPES = ['text', 'number', 'currency', 'date', 'select', 'checkbox'];

  function genId(prefix) {
    return (prefix || '_tbl_') + Math.random().toString(36).slice(2, 10);
  }

  function normalizeColumns(cols) {
    if (!Array.isArray(cols) || cols.length === 0) {
      return [
        { id: genId('_col_'), name: 'Nombre', type: 'text' },
        { id: genId('_col_'), name: 'Valor', type: 'number' },
        { id: genId('_col_'), name: 'Notas', type: 'text' }
      ];
    }
    return cols.map((c, idx) => {
      if (typeof c === 'string') {
        return { id: genId('_col_'), name: c.trim() || `Columna ${idx + 1}`, type: 'text' };
      }
      const type = VALID_COL_TYPES.includes(c.type) ? c.type : 'text';
      const out = {
        id: c.id ? String(c.id) : genId('_col_'),
        name: String(c.name || `Columna ${idx + 1}`).trim(),
        type
      };
      if (type === 'select' && Array.isArray(c.options)) {
        out.options = c.options.map(x => String(x));
      }
      return out;
    });
  }

  function createTablesEngine(initialList, onSave) {
    let tables = Array.isArray(initialList) ? initialList : [];

    function persist() {
      if (typeof onSave === 'function') onSave(tables);
    }

    function listarTablas(args = {}) {
      const folderId = args.carpeta_id || null;
      const incluirFilas = !!args.incluir_filas;
      const filtered = tables.filter(t => (!folderId || t.folderId === folderId));
      return {
        ok: true,
        total: filtered.length,
        tablas: filtered.map(t => {
          const meta = {
            id: t.id,
            title: t.title,
            folderId: t.folderId || null,
            taskId: t.taskId || null,
            tags: Array.isArray(t.tags) ? t.tags : [],
            columns: t.columns || [],
            rowCount: Array.isArray(t.rows) ? t.rows.length : 0,
            updatedAt: t.updatedAt || null
          };
          if (incluirFilas) meta.rows = t.rows || [];
          return meta;
        })
      };
    }

    function leerTabla(args = {}) {
      const tbl = tables.find(t => t.id === args.tabla_id);
      if (!tbl) return { ok: false, error: 'Tabla no encontrada.' };
      const offset = Math.max(0, Number(args.offset) || 0);
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
      const filtro = args.filtro ? String(args.filtro).toLowerCase().trim() : '';

      let rows = Array.isArray(tbl.rows) ? tbl.rows : [];
      if (filtro) {
        rows = rows.filter(r => {
          const vals = Object.values(r.cells || {}).map(v => String(v ?? '').toLowerCase()).join(' ');
          return vals.includes(filtro);
        });
      }
      const slice = rows.slice(offset, offset + limit);

      // Totales automáticos para columnas number / currency
      const totales = {};
      (tbl.columns || []).forEach(c => {
        if (c.type === 'number' || c.type === 'currency') {
          let sum = 0;
          rows.forEach(r => {
            const n = Number(r.cells?.[c.id]);
            if (Number.isFinite(n)) sum += Math.round(n * 100);
          });
          totales[c.id] = Math.round(sum) / 100;
        }
      });

      return {
        ok: true,
        id: tbl.id,
        title: tbl.title,
        folderId: tbl.folderId || null,
        columns: tbl.columns || [],
        total_filas: rows.length,
        offset,
        limit,
        rows: slice,
        totales
      };
    }

    function gestionarTabla(args = {}) {
      const accion = String(args.accion || 'crear').toLowerCase();
      if (accion === 'crear') {
        const title = String(args.title || args.titulo || '').trim();
        if (!title) return { ok: false, error: 'Falta título de la tabla.' };
        const columns = normalizeColumns(args.columns || args.columnas);
        const initialRows = Array.isArray(args.rows || args.filas)
          ? (args.rows || args.filas).map(r => {
              const cells = {};
              const src = (r && r.cells) ? r.cells : (r || {});
              columns.forEach(col => {
                if (src[col.id] !== undefined) cells[col.id] = src[col.id];
                else if (src[col.name] !== undefined) cells[col.id] = src[col.name];
              });
              return { id: (r && r.id) ? String(r.id) : genId('_row_'), cells };
            })
          : [];
        const tbl = {
          id: genId('_tbl_'),
          title,
          folderId: args.folderId || args.carpeta_id || null,
          taskId: args.taskId || args.tarea_id || null,
          tags: Array.isArray(args.tags || args.etiquetas) ? (args.tags || args.etiquetas).map(String) : [],
          columns,
          rows: initialRows,
          updatedAt: Date.now()
        };
        tables.unshift(tbl);
        persist();
        return { ok: true, tabla: { id: tbl.id, title: tbl.title, folderId: tbl.folderId, columns: tbl.columns, rowCount: tbl.rows.length } };
      }

      const idx = tables.findIndex(t => t.id === (args.tabla_id || args.id));
      if (idx === -1) return { ok: false, error: 'Tabla no encontrada.' };
      const tbl = tables[idx];

      if (accion === 'eliminar') {
        tables.splice(idx, 1);
        persist();
        return { ok: true, eliminada: args.tabla_id || args.id };
      }

      if (accion === 'actualizar_estructura') {
        if (args.title || args.titulo) tbl.title = String(args.title || args.titulo).trim() || tbl.title;
        if (args.folderId !== undefined || args.carpeta_id !== undefined) tbl.folderId = args.folderId ?? args.carpeta_id ?? null;
        if (Array.isArray(args.tags || args.etiquetas)) tbl.tags = (args.tags || args.etiquetas).map(String);
        if (Array.isArray(args.columns || args.columnas)) {
          tbl.columns = normalizeColumns(args.columns || args.columnas);
        }
        if (args.agregar_columna) {
          const c = normalizeColumns([args.agregar_columna])[0];
          tbl.columns.push(c);
        }
        if (args.eliminar_columna_id) {
          tbl.columns = tbl.columns.filter(c => c.id !== args.eliminar_columna_id);
        }
        tbl.updatedAt = Date.now();
        persist();
        return { ok: true, tabla: { id: tbl.id, title: tbl.title, columns: tbl.columns, rowCount: tbl.rows.length } };
      }

      return { ok: false, error: 'Acción inválida (crear | actualizar_estructura | eliminar).' };
    }

    function parchearFilasTabla(args = {}) {
      const tbl = tables.find(t => t.id === args.tabla_id);
      if (!tbl) return { ok: false, error: 'Tabla no encontrada.' };
      const ops = Array.isArray(args.operaciones) ? args.operaciones : [];
      if (ops.length === 0) return { ok: false, error: 'operaciones vacío.' };

      const colByName = {};
      (tbl.columns || []).forEach(c => { colByName[c.name.toLowerCase()] = c.id; });

      const mapDatosToCells = (datos) => {
        const mapped = {};
        if (!datos || typeof datos !== 'object') return mapped;
        for (const [k, v] of Object.entries(datos)) {
          const colId = tbl.columns.some(c => c.id === k) ? k : (colByName[String(k).toLowerCase()] || k);
          mapped[colId] = v;
        }
        return mapped;
      };

      let agregadas = 0;
      let actualizadas = 0;
      let eliminadas = 0;
      const idsCreados = [];

      for (const op of ops) {
        const act = String(op.accion || '').toLowerCase();
        if (act === 'agregar') {
          const row = { id: genId('_row_'), cells: mapDatosToCells(op.datos || op.cells) };
          tbl.rows.push(row);
          agregadas++;
          idsCreados.push(row.id);
        } else if (act === 'actualizar') {
          const row = tbl.rows.find(r => r.id === op.fila_id);
          if (row) {
            row.cells = Object.assign({}, row.cells || {}, mapDatosToCells(op.datos || op.cells));
            actualizadas++;
          }
        } else if (act === 'eliminar') {
          const before = tbl.rows.length;
          tbl.rows = tbl.rows.filter(r => r.id !== op.fila_id);
          if (tbl.rows.length < before) eliminadas++;
        }
      }

      tbl.updatedAt = Date.now();
      persist();
      return { ok: true, tabla_id: tbl.id, agregadas, actualizadas, eliminadas, ids_creados: idsCreados, total_filas: tbl.rows.length };
    }

    function exportarCSV(tablaId) {
      const tbl = tables.find(t => t.id === tablaId);
      if (!tbl) return null;
      const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const cols = tbl.columns || [];
      const lines = [cols.map(c => esc(c.name)).join(',')];
      (tbl.rows || []).forEach(r => {
        lines.push(cols.map(c => esc(r.cells?.[c.id])).join(','));
      });
      return { filename: (tbl.title || 'tabla').replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv', csv: '\uFEFF' + lines.join('\r\n') };
    }

    return {
      getAll: () => tables,
      setAll: (next) => { tables = Array.isArray(next) ? next : []; },
      getById: (id) => tables.find(t => t.id === id) || null,
      listarTablas,
      leerTabla,
      gestionarTabla,
      parchearFilasTabla,
      exportarCSV
    };
  }

  function downloadCsvFile(filename, csvWithBom) {
    try {
      const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) {}
  }

  // Instancia cliente + UI Editor Inline tipo Excel
  if (typeof localStorage !== 'undefined') {
    let initial = [];
    try {
      const raw = localStorage.getItem(TABLES_STORAGE_KEY);
      if (raw) initial = JSON.parse(raw);
    } catch (_) {}

    const engine = createTablesEngine(initial, (nextList) => {
      try { localStorage.setItem(TABLES_STORAGE_KEY, JSON.stringify(nextList)); } catch (_) {}
      try {
        if (global.EfectivaCloud && typeof global.EfectivaCloud.scheduleSave === 'function') {
          global.EfectivaCloud.scheduleSave({ tables: nextList });
        }
      } catch (_) {}
      try {
        if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          global.dispatchEvent(new CustomEvent('efectiva:tables-updated'));
        }
      } catch (_) {}
    });

    let activeTableId = null;
    let sortColId = null;
    let sortAsc = true;
    let filterQuery = '';

    function ensureTableEditorModal() {
      let modal = document.getElementById('tableEditorModal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'tableEditorModal';
      modal.className = 'sheet-modal';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="sheet-modal-card">
          <div class="sheet-modal-header">
            <div class="sheet-title-wrap">
              <span class="sheet-kicker">Tabla</span>
              <h2 id="tableEditorTitle" class="sheet-title">Tabla</h2>
            </div>
            <div class="sheet-header-actions">
              <button id="tableAddColBtn" type="button" class="sheet-btn">+ Columna</button>
              <button id="tableAddRowBtn" type="button" class="sheet-btn sheet-btn-primary">+ Fila</button>
              <button id="tableExportCsvBtn" type="button" class="sheet-btn">📥 .CSV</button>
              <button id="tableCloseBtn" type="button" class="sheet-close-btn" aria-label="Cerrar">✕</button>
            </div>
          </div>
          <div class="sheet-filter-bar">
            <input id="tableFilterInput" type="search" placeholder="Filtrar filas..." />
            <span id="tableRowCountBadge" class="sheet-count-badge">0 filas</span>
          </div>
          <div class="sheet-scroll-wrap">
            <table class="excel-table" id="genericTableGrid"></table>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#tableCloseBtn').onclick = () => {
        modal.style.display = 'none';
        activeTableId = null;
      };
      modal.querySelector('#tableFilterInput').oninput = (e) => {
        filterQuery = e.target.value || '';
        renderTableEditor();
      };
      modal.querySelector('#tableAddRowBtn').onclick = () => {
        if (!activeTableId) return;
        engine.parchearFilasTabla({ tabla_id: activeTableId, operaciones: [{ accion: 'agregar', datos: {} }] });
        renderTableEditor();
      };
      modal.querySelector('#tableAddColBtn').onclick = () => {
        if (!activeTableId) return;
        const name = window.prompt('Nombre de la nueva columna:');
        if (!name || !name.trim()) return;
        const typeRaw = window.prompt('Tipo (text, number, currency, date, checkbox, select):', 'text');
        const type = VALID_COL_TYPES.includes(String(typeRaw || '').trim().toLowerCase())
          ? String(typeRaw).trim().toLowerCase()
          : 'text';
        let options;
        if (type === 'select') {
          const optsRaw = window.prompt('Opciones separadas por coma (ej: Pendiente, En curso, Listo):', 'Pendiente, En curso, Listo');
          options = String(optsRaw || '').split(',').map(x => x.trim()).filter(Boolean);
        }
        engine.gestionarTabla({ accion: 'actualizar_estructura', tabla_id: activeTableId, agregar_columna: { name: name.trim(), type, options } });
        renderTableEditor();
      };
      modal.querySelector('#tableExportCsvBtn').onclick = () => {
        if (!activeTableId) return;
        const exp = engine.exportarCSV(activeTableId);
        if (exp) downloadCsvFile(exp.filename, exp.csv);
      };
      return modal;
    }

    function renderTableEditor() {
      if (!activeTableId) return;
      const tbl = engine.getById(activeTableId);
      const modal = ensureTableEditorModal();
      if (!tbl) { modal.style.display = 'none'; activeTableId = null; return; }

      modal.querySelector('#tableEditorTitle').textContent = tbl.title;
      const grid = modal.querySelector('#genericTableGrid');
      const cols = tbl.columns || [];
      let rows = Array.isArray(tbl.rows) ? tbl.rows.slice() : [];

      if (filterQuery.trim()) {
        const q = filterQuery.trim().toLowerCase();
        rows = rows.filter(r => Object.values(r.cells || {}).some(v => String(v ?? '').toLowerCase().includes(q)));
      }
      if (sortColId) {
        rows.sort((a, b) => {
          const va = a.cells?.[sortColId] ?? '';
          const vb = b.cells?.[sortColId] ?? '';
          const na = Number(va), nb = Number(vb);
          if (va !== '' && vb !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
            return sortAsc ? na - nb : nb - na;
          }
          return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
      }

      modal.querySelector('#tableRowCountBadge').textContent = `${rows.length} filas`;
      grid.innerHTML = '';

      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      cols.forEach(c => {
        const th = document.createElement('th');
        th.className = 'excel-th-sortable';
        th.textContent = c.name + (sortColId === c.id ? (sortAsc ? ' ▲' : ' ▼') : '');
        th.title = 'Clic para ordenar · Doble clic para renombrar';
        th.onclick = () => {
          if (sortColId === c.id) sortAsc = !sortAsc;
          else { sortColId = c.id; sortAsc = true; }
          renderTableEditor();
        };
        th.ondblclick = (e) => {
          e.stopPropagation();
          const nn = window.prompt('Renombrar columna:', c.name);
          if (nn && nn.trim()) {
            c.name = nn.trim();
            engine.gestionarTabla({ accion: 'actualizar_estructura', tabla_id: tbl.id, columns: cols });
            renderTableEditor();
          }
        };
        htr.appendChild(th);
      });
      const thAct = document.createElement('th');
      thAct.textContent = '';
      htr.appendChild(thAct);
      thead.appendChild(htr);
      grid.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.forEach(r => {
        const tr = document.createElement('tr');
        cols.forEach(c => {
          const td = document.createElement('td');
          const val = r.cells?.[c.id];
          if (c.type === 'checkbox') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!val;
            cb.onchange = () => {
              engine.parchearFilasTabla({ tabla_id: tbl.id, operaciones: [{ accion: 'actualizar', fila_id: r.id, datos: { [c.id]: cb.checked } }] });
            };
            td.style.textAlign = 'center';
            td.appendChild(cb);
          } else if (c.type === 'select' && Array.isArray(c.options) && c.options.length > 0) {
            const sel = document.createElement('select');
            sel.className = 'excel-cell-input';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = ''; emptyOpt.textContent = '—';
            sel.appendChild(emptyOpt);
            c.options.forEach(o => {
              const opt = document.createElement('option');
              opt.value = o; opt.textContent = o;
              if (String(val || '') === o) opt.selected = true;
              sel.appendChild(opt);
            });
            sel.onchange = () => {
              engine.parchearFilasTabla({ tabla_id: tbl.id, operaciones: [{ accion: 'actualizar', fila_id: r.id, datos: { [c.id]: sel.value } }] });
            };
            td.appendChild(sel);
          } else {
            const inp = document.createElement('input');
            inp.className = 'excel-cell-input';
            inp.type = c.type === 'date' ? 'date' : ((c.type === 'number' || c.type === 'currency') ? 'number' : 'text');
            if (c.type === 'number' || c.type === 'currency') inp.step = 'any';
            inp.value = val !== undefined && val !== null ? String(val) : '';
            inp.onchange = () => {
              const parsed = (c.type === 'number' || c.type === 'currency')
                ? (inp.value === '' ? '' : Number(inp.value))
                : inp.value;
              engine.parchearFilasTabla({ tabla_id: tbl.id, operaciones: [{ accion: 'actualizar', fila_id: r.id, datos: { [c.id]: parsed } }] });
              if (c.type === 'number' || c.type === 'currency') renderTableEditor();
            };
            td.appendChild(inp);
          }
          tr.appendChild(td);
        });
        const tdDel = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'excel-row-del';
        delBtn.textContent = '🗑';
        delBtn.onclick = () => {
          engine.parchearFilasTabla({ tabla_id: tbl.id, operaciones: [{ accion: 'eliminar', fila_id: r.id }] });
          renderTableEditor();
        };
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
      });
      grid.appendChild(tbody);

      // Fila fija de TOTALES para columnas number / currency
      const hasNumeric = cols.some(c => c.type === 'number' || c.type === 'currency');
      if (hasNumeric) {
        const tfoot = document.createElement('tfoot');
        const ftr = document.createElement('tr');
        cols.forEach((c, idx) => {
          const td = document.createElement('td');
          if (c.type === 'number' || c.type === 'currency') {
            let sumCents = 0;
            rows.forEach(r => {
              const n = Number(r.cells?.[c.id]);
              if (Number.isFinite(n)) sumCents += Math.round(n * 100);
            });
            const total = (Math.round(sumCents) / 100).toFixed(2);
            td.textContent = c.type === 'currency' ? `Σ ${total}` : `Σ ${Number(total)}`;
            td.className = 'excel-total-cell';
          } else if (idx === 0) {
            td.textContent = 'TOTAL';
            td.className = 'excel-total-label';
          }
          ftr.appendChild(td);
        });
        ftr.appendChild(document.createElement('td'));
        tfoot.appendChild(ftr);
        grid.appendChild(tfoot);
      }
    }

    function openTableEditor(tableId) {
      activeTableId = tableId;
      sortColId = null;
      sortAsc = true;
      filterQuery = '';
      const modal = ensureTableEditorModal();
      modal.querySelector('#tableFilterInput').value = '';
      modal.style.display = 'flex';
      renderTableEditor();
    }

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('efectiva:tables-updated', () => {
        if (activeTableId) renderTableEditor();
      });
    }

    function downloadTableCsv(tablaId) {
      const exp = engine.exportarCSV(tablaId);
      if (exp && exp.csv) downloadCsvFile(exp.filename, exp.csv);
      return exp;
    }

    global.EfectivaTables = {
      ...engine,
      openTableEditor,
      downloadCsvFile,
      downloadTableCsv,
      exportState: () => engine.getAll(),
      hydrateFromCloud(cloudTables) {
        if (!Array.isArray(cloudTables)) return;
        const cur = engine.getAll();
        if (cur.length === 0 || cloudTables.length > 0) {
          engine.setAll(cloudTables);
          try { localStorage.setItem(TABLES_STORAGE_KEY, JSON.stringify(cloudTables)); } catch (_) {}
          if (typeof global.dispatchEvent === 'function') {
            global.dispatchEvent(new CustomEvent('efectiva:tables-updated'));
          }
        }
      }
    };
  }

  global.createEfectivaTablesEngine = createTablesEngine;
})(typeof window !== 'undefined' ? window : globalThis);

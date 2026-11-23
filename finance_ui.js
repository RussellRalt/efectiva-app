/* ============================================================================
 *  EFECTIVA — VISTA VISUAL TIPO EXCEL PARA EL MOTOR FINANCIERO (fin_*)
 *  Única fuente de verdad: window.EfectivaFinance (sin lógica contable duplicada).
 *  Se actualiza en tiempo real ante cualquier cambio hecho en UI o por el Copiloto IA.
 * ============================================================================ */
(function (global) {
  'use strict';

  let activeTab = 'movimientos'; // movimientos | cuentas | compromisos | inversiones
  let sortState = { col: 'fecha', asc: false };
  const filters = {
    desde: '',
    hasta: '',
    cuenta: '',
    tipo: '',
    categoria: '',
    q: ''
  };

  function fmtNum(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtMoney(n, moneda) {
    const sym = moneda === 'USD' ? '$' : 'Q';
    return `${sym}${fmtNum(n)}`;
  }
  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escCsv(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCsv(filename, rowsMatrix) {
    const csv = '\uFEFF' + rowsMatrix.map(row => row.map(escCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getAccountName(cuentas, id) {
    if (!id) return '—';
    const c = (cuentas || []).find(x => x.id === id);
    return c ? c.nombre : id;
  }

  function renderKPIs(container) {
    if (!global.EfectivaFinance) return;
    const r = global.EfectivaFinance.obtenerResumen({ moneda_vista: 'GTQ', incluir_movimientos_recientes: 0, incluir_deudas: false, incluir_inversiones: false });
    const lqG = r.liquidez.GTQ;
    const lqU = r.liquidez.USD;
    container.innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi-label">Liquidez GTQ</span>
        <strong class="fin-kpi-val">Q${fmtNum(lqG.total)}</strong>
        <span class="fin-kpi-sub">Bco Q${fmtNum(lqG.banco)} · Ef Q${fmtNum(lqG.efectivo)} · Res Q${fmtNum(lqG.reserva)}</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi-label">Liquidez USD</span>
        <strong class="fin-kpi-val">$${fmtNum(lqU.total)}</strong>
        <span class="fin-kpi-sub">Crypto $${fmtNum(lqU.crypto)} · Ef $${fmtNum(lqU.efectivo)}</span>
      </div>
      <div class="fin-kpi fin-kpi-warn">
        <span class="fin-kpi-label">Deuda Total</span>
        <strong class="fin-kpi-val">Q${fmtNum(r.deuda_total.GTQ)}</strong>
        <span class="fin-kpi-sub">USD $${fmtNum(r.deuda_total.USD)} · Cobrar Q${fmtNum(r.por_cobrar.GTQ)}</span>
      </div>
      <div class="fin-kpi fin-kpi-accent">
        <span class="fin-kpi-label">Posición Neta</span>
        <strong class="fin-kpi-val">Q${fmtNum(r.consolidado_GTQ)}</strong>
        <span class="fin-kpi-sub">TC Q${r.tipo_cambio_usd_gtq} / USD</span>
      </div>
      <div class="fin-kpi ${r.flujo_mes.GTQ >= 0 ? 'fin-kpi-good' : 'fin-kpi-bad'}">
        <span class="fin-kpi-label">Flujo ${escHtml(r.mes)}</span>
        <strong class="fin-kpi-val">${r.flujo_mes.GTQ >= 0 ? '+' : ''}Q${fmtNum(r.flujo_mes.GTQ)}</strong>
        <span class="fin-kpi-sub">USD ${r.flujo_mes.USD >= 0 ? '+' : ''}$${fmtNum(r.flujo_mes.USD)}</span>
      </div>
    `;
  }

  function sortItems(items, getter) {
    const col = sortState.col;
    const asc = sortState.asc;
    return items.slice().sort((a, b) => {
      const va = getter(a, col);
      const vb = getter(b, col);
      if (typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va;
      return asc ? String(va ?? '').localeCompare(String(vb ?? '')) : String(vb ?? '').localeCompare(String(va ?? ''));
    });
  }

  function thHtml(col, label) {
    const arrow = sortState.col === col ? (sortState.asc ? ' ▲' : ' ▼') : '';
    return `<th class="excel-th-sortable" data-sort-col="${col}">${escHtml(label)}${arrow}</th>`;
  }

  function getFilteredMovimientos(st) {
    return (st.movimientos || []).filter(m => {
      if (filters.desde && (m.fecha_iso || '') < filters.desde) return false;
      if (filters.hasta && (m.fecha_iso || '') > filters.hasta) return false;
      if (filters.cuenta && m.cuenta_id !== filters.cuenta && m.cuenta_destino_id !== filters.cuenta) return false;
      if (filters.tipo && m.tipo !== filters.tipo) return false;
      if (filters.categoria && !String(m.categoria || '').toLowerCase().includes(filters.categoria.toLowerCase())) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const hay = `${m.fecha_iso} ${m.tipo} ${m.categoria} ${m.descripcion} ${getAccountName(st.cuentas, m.cuenta_id)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderSubTab(section) {
    if (!global.EfectivaFinance) return;
    const st = global.EfectivaFinance.getState();
    const filterHost = section.querySelector('#finFilterHost');
    const tableHost = section.querySelector('#finTableHost');
    const actionBtn = section.querySelector('#finPrimaryAddBtn');

    if (activeTab === 'movimientos') {
      actionBtn.textContent = '+ Nuevo Movimiento';
      const accountOptions = (st.cuentas || []).map(c => `<option value="${escHtml(c.id)}" ${filters.cuenta === c.id ? 'selected' : ''}>${escHtml(c.nombre)} (${c.moneda})</option>`).join('');
      filterHost.innerHTML = `
        <input id="finFDesde" type="date" value="${escHtml(filters.desde)}" title="Desde" />
        <input id="finFHasta" type="date" value="${escHtml(filters.hasta)}" title="Hasta" />
        <select id="finFCuenta"><option value="">Todas las cuentas</option>${accountOptions}</select>
        <select id="finFTipo">
          <option value="">Todos los tipos</option>
          ${['ingreso', 'egreso', 'transferencia', 'pago_deuda', 'cobro', 'aporte_inversion', 'retorno_inversion', 'ajuste_conciliacion'].map(t => `<option value="${t}" ${filters.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input id="finFCat" type="text" placeholder="Categoría..." value="${escHtml(filters.categoria)}" />
        <input id="finFQ" type="search" placeholder="Buscar descripción..." value="${escHtml(filters.q)}" />
      `;
      filterHost.querySelector('#finFDesde').onchange = (e) => { filters.desde = e.target.value; renderFinanceView(); };
      filterHost.querySelector('#finFHasta').onchange = (e) => { filters.hasta = e.target.value; renderFinanceView(); };
      filterHost.querySelector('#finFCuenta').onchange = (e) => { filters.cuenta = e.target.value; renderFinanceView(); };
      filterHost.querySelector('#finFTipo').onchange = (e) => { filters.tipo = e.target.value; renderFinanceView(); };
      filterHost.querySelector('#finFCat').oninput = (e) => { filters.categoria = e.target.value; renderSubTab(section); };
      filterHost.querySelector('#finFQ').oninput = (e) => { filters.q = e.target.value; renderSubTab(section); };

      const list = sortItems(getFilteredMovimientos(st), (m, col) => {
        if (col === 'monto') return (m.monto_centavos || 0) / 100;
        if (col === 'cuenta') return getAccountName(st.cuentas, m.cuenta_id);
        return m[col === 'fecha' ? 'fecha_iso' : col] || '';
      });

      let ingGtq = 0, egrGtq = 0, ingUsd = 0, egrUsd = 0;
      const rowsHtml = list.map(m => {
        const val = (m.monto_centavos || 0) / 100;
        const isIn = m.tipo === 'ingreso' || m.tipo === 'cobro' || m.tipo === 'retorno_inversion';
        const isOut = m.tipo === 'egreso' || m.tipo === 'pago_deuda' || m.tipo === 'aporte_inversion';
        if (m.moneda === 'USD') { if (isIn) ingUsd += m.monto_centavos; if (isOut) egrUsd += m.monto_centavos; }
        else { if (isIn) ingGtq += m.monto_centavos; if (isOut) egrGtq += m.monto_centavos; }
        const ctaLabel = m.cuenta_destino_id
          ? `${getAccountName(st.cuentas, m.cuenta_id)} → ${getAccountName(st.cuentas, m.cuenta_destino_id)}`
          : getAccountName(st.cuentas, m.cuenta_id);
        const cls = isIn ? 'fin-amt-in' : (isOut ? 'fin-amt-out' : 'fin-amt-neutral');
        return `<tr>
          <td>${escHtml(m.fecha_iso)}</td>
          <td><span class="fin-type-pill">${escHtml(m.tipo)}</span></td>
          <td>${escHtml(ctaLabel)}</td>
          <td>${escHtml(m.categoria || '—')}</td>
          <td>${escHtml(m.descripcion || '—')}</td>
          <td>${escHtml(m.moneda)}</td>
          <td class="excel-num ${cls}">${isIn ? '+' : (isOut ? '-' : '')}${fmtMoney(val, m.moneda)}</td>
          <td><span class="fin-id-tag">${escHtml(m.id.slice(-5))}</span></td>
        </tr>`;
      }).join('') || `<tr><td colspan="8" class="excel-empty">Sin movimientos en este filtro. Tocá "+ Nuevo Movimiento" o registralo con el Copiloto IA.</td></tr>`;

      const balGtq = (ingGtq - egrGtq) / 100;
      const balUsd = (ingUsd - egrUsd) / 100;
      tableHost.innerHTML = `<table class="excel-table">
        <thead><tr>
          ${thHtml('fecha', 'Fecha')}
          ${thHtml('tipo', 'Tipo')}
          ${thHtml('cuenta', 'Cuenta')}
          ${thHtml('categoria', 'Categoría')}
          ${thHtml('descripcion', 'Descripción')}
          ${thHtml('moneda', 'Moneda')}
          ${thHtml('monto', 'Monto')}
          <th>Ref</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="2" class="excel-total-label">TOTALES (${list.length})</td>
          <td colspan="2" class="excel-total-cell fin-amt-in">Ing: Q${fmtNum(ingGtq / 100)} | $${fmtNum(ingUsd / 100)}</td>
          <td colspan="2" class="excel-total-cell fin-amt-out">Egr: Q${fmtNum(egrGtq / 100)} | $${fmtNum(egrUsd / 100)}</td>
          <td colspan="2" class="excel-total-cell">Neto: Q${fmtNum(balGtq)} | $${fmtNum(balUsd)}</td>
        </tr></tfoot>
      </table>`;
    } else if (activeTab === 'cuentas') {
      actionBtn.textContent = '+ Nueva Cuenta';
      filterHost.innerHTML = `<span class="fin-hint-inline">Clic en "Arqueo" para conciliar el saldo real contra el calculado al centavo.</span>`;
      const list = sortItems(st.cuentas || [], (c, col) => col === 'saldo' ? (c.saldo_centavos || 0) : (c[col] || ''));
      let totGtq = 0, totUsd = 0;
      const rowsHtml = list.map(c => {
        if (c.moneda === 'USD') totUsd += c.saldo_centavos || 0;
        else totGtq += c.saldo_centavos || 0;
        return `<tr>
          <td><strong>${escHtml(c.nombre)}</strong></td>
          <td>${escHtml(c.tipo)}</td>
          <td>${escHtml(c.moneda)}</td>
          <td class="excel-num"><strong>${fmtMoney((c.saldo_centavos || 0) / 100, c.moneda)}</strong></td>
          <td>${escHtml(c.notas || '—')}</td>
          <td><button type="button" class="sheet-btn fin-arqueo-btn" data-cta-id="${escHtml(c.id)}">⚖️ Arqueo</button></td>
        </tr>`;
      }).join('') || `<tr><td colspan="6" class="excel-empty">Aún no hay cuentas creadas.</td></tr>`;

      tableHost.innerHTML = `<table class="excel-table">
        <thead><tr>
          ${thHtml('nombre', 'Cuenta')}
          ${thHtml('tipo', 'Tipo')}
          ${thHtml('moneda', 'Moneda')}
          ${thHtml('saldo', 'Saldo Actual')}
          <th>Notas</th>
          <th>Acción</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="3" class="excel-total-label">TOTALES (${list.length} cuentas)</td>
          <td colspan="3" class="excel-total-cell">GTQ: Q${fmtNum(totGtq / 100)} · USD: $${fmtNum(totUsd / 100)}</td>
        </tr></tfoot>
      </table>`;

      tableHost.querySelectorAll('.fin-arqueo-btn').forEach(btn => {
        btn.onclick = () => openArqueoModal(btn.dataset.ctaId);
      });
    } else if (activeTab === 'compromisos') {
      actionBtn.textContent = '+ Nuevo Compromiso';
      filterHost.innerHTML = `<span class="fin-hint-inline">Deudas (Por Pagar) y Cuentas Por Cobrar con progreso automático.</span>`;
      const list = sortItems(st.compromisos || [], (k, col) => {
        if (col === 'saldo_pendiente') return k.saldo_pendiente_centavos || 0;
        if (col === 'monto_total') return k.monto_total_centavos || 0;
        return k[col] || '';
      });
      let sumPagarGtq = 0, sumCobrarGtq = 0, sumPagarUsd = 0, sumCobrarUsd = 0;
      const rowsHtml = list.map(k => {
        const tot = (k.monto_total_centavos || 0) / 100;
        const pend = (k.saldo_pendiente_centavos || 0) / 100;
        const pct = tot > 0 ? Math.max(0, Math.min(100, Math.round(((tot - pend) / tot) * 100))) : 100;
        if (k.estado !== 'pagado' && k.estado !== 'cobrado') {
          if (k.moneda === 'USD') { if (k.tipo === 'por_cobrar') sumCobrarUsd += k.saldo_pendiente_centavos || 0; else sumPagarUsd += k.saldo_pendiente_centavos || 0; }
          else { if (k.tipo === 'por_cobrar') sumCobrarGtq += k.saldo_pendiente_centavos || 0; else sumPagarGtq += k.saldo_pendiente_centavos || 0; }
        }
        const isCob = k.tipo === 'por_cobrar';
        return `<tr>
          <td><span class="fin-badge ${isCob ? 'fin-badge-green' : 'fin-badge-red'}">${isCob ? 'Por Cobrar' : 'Por Pagar'}</span></td>
          <td><strong>${escHtml(k.contraparte)}</strong></td>
          <td>${escHtml(k.concepto)}</td>
          <td class="excel-num">${fmtMoney(tot, k.moneda)}</td>
          <td class="excel-num"><strong>${fmtMoney(pend, k.moneda)}</strong></td>
          <td class="excel-num">${k.cuota_mensual_centavos != null ? fmtMoney(k.cuota_mensual_centavos / 100, k.moneda) : '—'}</td>
          <td>${k.dia_corte != null ? 'Día ' + k.dia_corte : '—'}</td>
          <td><div class="fin-prog"><div class="fin-prog-bar" style="width:${pct}%"></div><span>${pct}%</span></div></td>
          <td>${pend > 0 ? `<button type="button" class="sheet-btn fin-abonar-btn" data-cmp-id="${escHtml(k.id)}">${isCob ? '💵 Cobrar' : '💸 Abonar'}</button>` : '<span class="fin-badge fin-badge-green">Saldado</span>'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="9" class="excel-empty">Sin deudas ni cuentas por cobrar registradas.</td></tr>`;

      tableHost.innerHTML = `<table class="excel-table">
        <thead><tr>
          ${thHtml('tipo', 'Tipo')}
          ${thHtml('contraparte', 'Contraparte')}
          ${thHtml('concepto', 'Concepto')}
          ${thHtml('monto_total', 'Monto Original')}
          ${thHtml('saldo_pendiente', 'Saldo Pendiente')}
          <th>Cuota</th>
          <th>Corte</th>
          <th>Progreso</th>
          <th>Acción</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="3" class="excel-total-label">PENDIENTE ACTIVO</td>
          <td colspan="3" class="excel-total-cell fin-amt-out">Por Pagar: Q${fmtNum(sumPagarGtq / 100)} | $${fmtNum(sumPagarUsd / 100)}</td>
          <td colspan="3" class="excel-total-cell fin-amt-in">Por Cobrar: Q${fmtNum(sumCobrarGtq / 100)} | $${fmtNum(sumCobrarUsd / 100)}</td>
        </tr></tfoot>
      </table>`;

      tableHost.querySelectorAll('.fin-abonar-btn').forEach(btn => {
        btn.onclick = () => openAbonarCompromisoModal(btn.dataset.cmpId);
      });
    } else if (activeTab === 'inversiones') {
      actionBtn.textContent = '+ Nueva Inversión';
      filterHost.innerHTML = `<span class="fin-hint-inline">Clasificación automática: Verde Provee · Amarillo Equilibrio · Rojo Drena.</span>`;
      const formatted = (st.inversiones || []).map(inv => {
        const cap = (inv.capital_invertido_centavos || 0) / 100;
        const ret = (inv.retornos_acumulados_centavos || 0) / 100;
        const cos = (inv.costos_acumulados_centavos || 0) / 100;
        const flujo = Math.round(((inv.retornos_acumulados_centavos || 0) - (inv.costos_acumulados_centavos || 0))) / 100;
        const roi = cap > 0 ? Math.round((flujo / cap) * 10000) / 100 : 0;
        const clas = flujo > 0 ? 'provee' : (flujo < 0 ? 'drena' : 'equilibrio');
        return { ...inv, cap, ret, cos, flujo, roi, clas };
      });
      const list = sortItems(formatted, (x, col) => x[col] ?? '');
      let flujoGtq = 0, flujoUsd = 0;
      const rowsHtml = list.map(i => {
        if (i.moneda === 'USD') flujoUsd += i.flujo; else flujoGtq += i.flujo;
        const badgeCls = i.clas === 'provee' ? 'fin-badge-green' : (i.clas === 'drena' ? 'fin-badge-red' : 'fin-badge-yellow');
        const badgeTxt = i.clas === 'provee' ? 'Provee' : (i.clas === 'drena' ? 'Drena' : 'Equilibrio');
        return `<tr>
          <td><strong>${escHtml(i.nombre)}</strong></td>
          <td>${escHtml(i.moneda)}</td>
          <td class="excel-num">${fmtMoney(i.cap, i.moneda)}</td>
          <td class="excel-num fin-amt-in">${fmtMoney(i.ret, i.moneda)}</td>
          <td class="excel-num fin-amt-out">${fmtMoney(i.cos, i.moneda)}</td>
          <td class="excel-num ${i.flujo >= 0 ? 'fin-amt-in' : 'fin-amt-out'}"><strong>${i.flujo >= 0 ? '+' : ''}${fmtMoney(i.flujo, i.moneda)}</strong></td>
          <td class="excel-num">${i.roi}%</td>
          <td>${escHtml(i.estado)}</td>
          <td><span class="fin-badge ${badgeCls}">${badgeTxt}</span></td>
        </tr>`;
      }).join('') || `<tr><td colspan="9" class="excel-empty">Sin inversiones o plataformas registradas.</td></tr>`;

      tableHost.innerHTML = `<table class="excel-table">
        <thead><tr>
          ${thHtml('nombre', 'Nombre')}
          ${thHtml('moneda', 'Moneda')}
          ${thHtml('cap', 'Capital')}
          ${thHtml('ret', 'Retornos')}
          ${thHtml('cos', 'Costos')}
          ${thHtml('flujo', 'Flujo Neto')}
          ${thHtml('roi', 'ROI %')}
          ${thHtml('estado', 'Estado')}
          ${thHtml('clas', 'Clasificación')}
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="5" class="excel-total-label">FLUJO NETO TOTAL (${list.length})</td>
          <td colspan="4" class="excel-total-cell">GTQ: Q${fmtNum(flujoGtq)} · USD: $${fmtNum(flujoUsd)}</td>
        </tr></tfoot>
      </table>`;
    }

    tableHost.querySelectorAll('th[data-sort-col]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sortCol;
        if (sortState.col === col) sortState.asc = !sortState.asc;
        else { sortState.col = col; sortState.asc = true; }
        renderSubTab(section);
      };
    });
  }

  function exportCurrentTabCsv() {
    if (!global.EfectivaFinance) return;
    const st = global.EfectivaFinance.getState();
    const today = new Date().toISOString().slice(0, 10);
    if (activeTab === 'movimientos') {
      const list = getFilteredMovimientos(st);
      const rows = [['Fecha', 'Tipo', 'Cuenta', 'Cuenta Destino', 'Categoria', 'Descripcion', 'Moneda', 'Monto']];
      list.forEach(m => rows.push([
        m.fecha_iso, m.tipo, getAccountName(st.cuentas, m.cuenta_id),
        m.cuenta_destino_id ? getAccountName(st.cuentas, m.cuenta_destino_id) : '',
        m.categoria || '', m.descripcion || '', m.moneda, ((m.monto_centavos || 0) / 100).toFixed(2)
      ]));
      downloadCsv(`efectiva_movimientos_${today}.csv`, rows);
    } else if (activeTab === 'cuentas') {
      const rows = [['Cuenta', 'Tipo', 'Moneda', 'Saldo Actual', 'Notas']];
      (st.cuentas || []).forEach(c => rows.push([c.nombre, c.tipo, c.moneda, ((c.saldo_centavos || 0) / 100).toFixed(2), c.notas || '']));
      downloadCsv(`efectiva_cuentas_${today}.csv`, rows);
    } else if (activeTab === 'compromisos') {
      const rows = [['Tipo', 'Contraparte', 'Concepto', 'Moneda', 'Monto Original', 'Saldo Pendiente', 'Cuota', 'Dia Corte', 'Estado']];
      (st.compromisos || []).forEach(k => rows.push([
        k.tipo, k.contraparte, k.concepto, k.moneda,
        ((k.monto_total_centavos || 0) / 100).toFixed(2),
        ((k.saldo_pendiente_centavos || 0) / 100).toFixed(2),
        k.cuota_mensual_centavos != null ? (k.cuota_mensual_centavos / 100).toFixed(2) : '',
        k.dia_corte != null ? k.dia_corte : '', k.estado
      ]));
      downloadCsv(`efectiva_compromisos_${today}.csv`, rows);
    } else if (activeTab === 'inversiones') {
      const rows = [['Nombre', 'Moneda', 'Capital', 'Retornos', 'Costos', 'Flujo Neto', 'ROI %', 'Estado', 'Clasificacion']];
      (st.inversiones || []).forEach(i => {
        const cap = (i.capital_invertido_centavos || 0) / 100;
        const ret = (i.retornos_acumulados_centavos || 0) / 100;
        const cos = (i.costos_acumulados_centavos || 0) / 100;
        const fl = ((i.retornos_acumulados_centavos || 0) - (i.costos_acumulados_centavos || 0)) / 100;
        const roi = cap > 0 ? Math.round((fl / cap) * 10000) / 100 : 0;
        rows.push([i.nombre, i.moneda, cap.toFixed(2), ret.toFixed(2), cos.toFixed(2), fl.toFixed(2), roi, i.estado, fl > 0 ? 'provee' : (fl < 0 ? 'drena' : 'equilibrio')]);
      });
      downloadCsv(`efectiva_inversiones_${today}.csv`, rows);
    }
  }

  function showQuickFormModal(title, fieldsHtml, onSubmit) {
    let modal = document.getElementById('finActionModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'finActionModal';
      modal.className = 'sheet-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="fin-form-card">
        <div class="sheet-modal-header">
          <h3 class="sheet-title">${escHtml(title)}</h3>
          <button type="button" class="sheet-close-btn" id="finFormClose">✕</button>
        </div>
        <form id="finQuickForm" class="fin-quick-form">
          ${fieldsHtml}
          <div class="fin-form-actions">
            <button type="button" class="sheet-btn" id="finFormCancel">Cancelar</button>
            <button type="submit" class="sheet-btn sheet-btn-primary">Guardar</button>
          </div>
          <p id="finFormErr" class="fin-form-err"></p>
        </form>
      </div>`;
    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; };
    modal.querySelector('#finFormClose').onclick = close;
    modal.querySelector('#finFormCancel').onclick = close;
    modal.querySelector('#finQuickForm').onsubmit = (e) => {
      e.preventDefault();
      const res = onSubmit(new FormData(e.target));
      if (res && res.ok === false) {
        modal.querySelector('#finFormErr').textContent = res.error || 'Error validando datos.';
      } else {
        close();
        renderFinanceView();
      }
    };
  }

  function openNewMovementModal() {
    const st = global.EfectivaFinance.getState();
    if (!st.cuentas || st.cuentas.length === 0) {
      alert('Creá primero al menos una cuenta en la pestaña "Cuentas y Saldos".');
      activeTab = 'cuentas';
      renderFinanceView();
      return;
    }
    const opts = st.cuentas.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.nombre)} (${c.moneda})</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    showQuickFormModal('Nuevo Movimiento', `
      <label>Tipo<select name="tipo" id="fmTipo">
        <option value="egreso">Egreso</option>
        <option value="ingreso">Ingreso</option>
        <option value="transferencia">Transferencia</option>
        <option value="pago_deuda">Pago de Deuda</option>
        <option value="cobro">Cobro</option>
        <option value="aporte_inversion">Aporte Inversión</option>
        <option value="retorno_inversion">Retorno Inversión</option>
      </select></label>
      <label>Cuenta<select name="cuenta_id">${opts}</select></label>
      <label>Cuenta Destino (solo transferencia)<select name="cuenta_destino_id"><option value="">—</option>${opts}</select></label>
      <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required placeholder="0.00" /></label>
      <label>Categoría<input name="categoria" type="text" placeholder="Ej: Comida, Salario, Transporte" /></label>
      <label>Descripción<input name="descripcion" type="text" placeholder="Detalle corto" /></label>
      <label>Fecha<input name="fecha_iso" type="date" value="${today}" /></label>
    `, (fd) => {
      const cta = st.cuentas.find(c => c.id === fd.get('cuenta_id'));
      return global.EfectivaFinance.registrarMovimiento({
        tipo: fd.get('tipo'),
        cuenta_id: fd.get('cuenta_id'),
        cuenta_destino_id: fd.get('cuenta_destino_id') || null,
        moneda: cta ? cta.moneda : 'GTQ',
        monto: Number(fd.get('monto')),
        categoria: fd.get('categoria'),
        descripcion: fd.get('descripcion'),
        fecha_iso: fd.get('fecha_iso')
      });
    });
  }

  function openNewAccountModal() {
    showQuickFormModal('Nueva Cuenta', `
      <label>Nombre<input name="nombre" type="text" required placeholder="Ej: BAC Credomatic, Billetera, Binance" /></label>
      <label>Tipo<select name="tipo">
        <option value="banco">Banco</option>
        <option value="billetera_fisica">Billetera física</option>
        <option value="crypto">Crypto</option>
        <option value="reserva">Reserva</option>
      </select></label>
      <label>Moneda<select name="moneda"><option value="GTQ">GTQ (Quetzales)</option><option value="USD">USD (Dólares)</option></select></label>
      <label>Saldo Inicial<input name="saldo_inicial" type="number" step="0.01" value="0" required /></label>
      <label>Notas<input name="notas" type="text" placeholder="Opcional" /></label>
    `, (fd) => global.EfectivaFinance.gestionarCuenta({
      accion: 'crear',
      nombre: fd.get('nombre'),
      tipo: fd.get('tipo'),
      moneda: fd.get('moneda'),
      saldo_inicial: Number(fd.get('saldo_inicial')),
      notas: fd.get('notas')
    }));
  }

  function openArqueoModal(cuentaId) {
    const st = global.EfectivaFinance.getState();
    const cta = (st.cuentas || []).find(c => c.id === cuentaId);
    if (!cta) return;
    const calc = ((cta.saldo_centavos || 0) / 100).toFixed(2);
    showQuickFormModal(`Arqueo — ${cta.nombre} (${cta.moneda})`, `
      <p class="fin-hint-inline">Saldo calculado actual: <strong>${fmtMoney(calc, cta.moneda)}</strong></p>
      <label>Saldo contado real<input name="real" type="number" step="0.01" value="${calc}" required /></label>
      <label class="fin-check-row"><input name="crear_ajuste" type="checkbox" checked /> Crear movimiento de ajuste automático si hay diferencia</label>
      <label>Nota del arqueo<input name="descripcion" type="text" placeholder="Ej: Conteo físico / estado de cuenta" /></label>
    `, (fd) => global.EfectivaFinance.conciliarArqueo({
      cuenta_id: cuentaId,
      saldo_contado_real: Number(fd.get('real')),
      crear_ajuste: fd.get('crear_ajuste') === 'on',
      descripcion: fd.get('descripcion')
    }));
  }

  function openNewCompromisoModal() {
    showQuickFormModal('Nuevo Compromiso (Deuda / Por Cobrar)', `
      <label>Tipo<select name="tipo"><option value="por_pagar">Por Pagar (Deuda)</option><option value="por_cobrar">Por Cobrar</option></select></label>
      <label>Contraparte<input name="contraparte" type="text" required placeholder="Ej: Bantrab, Cliente X" /></label>
      <label>Concepto<input name="concepto" type="text" required placeholder="Ej: Préstamo personal" /></label>
      <label>Moneda<select name="moneda"><option value="GTQ">GTQ</option><option value="USD">USD</option></select></label>
      <label>Monto Total<input name="monto_total" type="number" step="0.01" min="0.01" required /></label>
      <label>Cuota Mensual (opcional)<input name="cuota_mensual" type="number" step="0.01" /></label>
      <label>Día de Corte (1-31)<input name="dia_corte" type="number" min="1" max="31" /></label>
    `, (fd) => global.EfectivaFinance.gestionarCompromiso({
      accion: 'crear',
      tipo: fd.get('tipo'),
      contraparte: fd.get('contraparte'),
      concepto: fd.get('concepto'),
      moneda: fd.get('moneda'),
      monto_total: Number(fd.get('monto_total')),
      cuota_mensual: fd.get('cuota_mensual') ? Number(fd.get('cuota_mensual')) : null,
      dia_corte: fd.get('dia_corte') ? Number(fd.get('dia_corte')) : null
    }));
  }

  function openAbonarCompromisoModal(cmpId) {
    const st = global.EfectivaFinance.getState();
    const k = (st.compromisos || []).find(x => x.id === cmpId);
    if (!k) return;
    const compatibleAccounts = (st.cuentas || []).filter(c => c.moneda === k.moneda);
    if (compatibleAccounts.length === 0) {
      alert(`Creá primero una cuenta en ${k.moneda} para registrar el abono/cobro.`);
      return;
    }
    const opts = compatibleAccounts.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.nombre)} (${fmtMoney(c.saldo_centavos / 100, c.moneda)})</option>`).join('');
    const pend = ((k.saldo_pendiente_centavos || 0) / 100).toFixed(2);
    const isCob = k.tipo === 'por_cobrar';
    showQuickFormModal(`${isCob ? 'Cobrar' : 'Abonar'} — ${k.contraparte}`, `
      <p class="fin-hint-inline">Saldo pendiente: <strong>${fmtMoney(pend, k.moneda)}</strong></p>
      <label>Cuenta (${k.moneda})<select name="cuenta_id">${opts}</select></label>
      <label>Monto<input name="monto" type="number" step="0.01" min="0.01" value="${pend}" required /></label>
      <label>Descripción<input name="descripcion" type="text" value="${escHtml((isCob ? 'Cobro ' : 'Abono ') + k.contraparte)}" /></label>
    `, (fd) => global.EfectivaFinance.registrarMovimiento({
      tipo: isCob ? 'cobro' : 'pago_deuda',
      cuenta_id: fd.get('cuenta_id'),
      moneda: k.moneda,
      monto: Number(fd.get('monto')),
      categoria: isCob ? 'cobro' : 'deuda',
      descripcion: fd.get('descripcion'),
      referencia_entidad_id: k.id
    }));
  }

  function openNewInversionModal() {
    showQuickFormModal('Nueva Inversión / Plataforma', `
      <label>Nombre<input name="nombre" type="text" required placeholder="Ej: Tienda Online, SaaS, Cripto" /></label>
      <label>Moneda<select name="moneda"><option value="GTQ">GTQ</option><option value="USD">USD</option></select></label>
      <label>Capital Invertido<input name="capital" type="number" step="0.01" value="0" required /></label>
      <label>Retornos Acumulados<input name="retornos" type="number" step="0.01" value="0" /></label>
      <label>Costos Acumulados<input name="costos" type="number" step="0.01" value="0" /></label>
      <label>Estado<select name="estado"><option value="activa">Activa</option><option value="pausada">Pausada</option><option value="cerrada">Cerrada</option></select></label>
    `, (fd) => global.EfectivaFinance.gestionarInversion({
      accion: 'crear',
      nombre: fd.get('nombre'),
      moneda: fd.get('moneda'),
      capital_invertido: Number(fd.get('capital')),
      retornos_acumulados: Number(fd.get('retornos') || 0),
      costos_acumulados: Number(fd.get('costos') || 0),
      estado: fd.get('estado')
    }));
  }

  function ensureFinanceSection() {
    let sec = document.getElementById('financeSection');
    if (sec) return sec;
    sec = document.createElement('section');
    sec.id = 'financeSection';
    sec.className = 'finance-section';
    sec.style.display = 'none';
    sec.innerHTML = `
      <header class="section-header-with-back">
        <button id="backFromFinanceBtn" class="header-back-btn" type="button" title="Volver a carpetas" aria-label="Volver">←</button>
        <h2>💰 Finanzas</h2>
      </header>
      <div class="fin-shell">
        <div id="finKpiBar" class="fin-kpi-bar"></div>
        <div class="fin-toolbar">
          <div class="fin-tabs" role="tablist">
            <button type="button" class="fin-tab active" data-fin-tab="movimientos">📒 Libro Diario</button>
            <button type="button" class="fin-tab" data-fin-tab="cuentas">🏦 Cuentas</button>
            <button type="button" class="fin-tab" data-fin-tab="compromisos">📋 Deudas / Cobrar</button>
            <button type="button" class="fin-tab" data-fin-tab="inversiones">📈 Inversiones</button>
          </div>
          <div class="fin-toolbar-actions">
            <button id="finPrimaryAddBtn" type="button" class="sheet-btn sheet-btn-primary">+ Nuevo Movimiento</button>
            <button id="finExportCsvBtn" type="button" class="sheet-btn">📥 Excel (.csv)</button>
            <button id="finSnapshotNoteBtn" type="button" class="sheet-btn">📝 Snapshot Nota</button>
          </div>
        </div>
        <div id="finFilterHost" class="fin-filter-bar"></div>
        <div id="finTableHost" class="sheet-scroll-wrap"></div>
      </div>`;
    const foldersSec = document.getElementById('foldersSection');
    if (foldersSec && foldersSec.parentNode) foldersSec.parentNode.insertBefore(sec, foldersSec.nextSibling);
    else document.body.appendChild(sec);

    sec.querySelector('#backFromFinanceBtn').onclick = () => {
      sec.style.display = 'none';
      if (typeof global.showFolders === 'function') global.showFolders();
    };
    sec.querySelectorAll('.fin-tab').forEach(btn => {
      btn.onclick = () => {
        activeTab = btn.dataset.finTab;
        sortState = { col: activeTab === 'movimientos' ? 'fecha' : 'nombre', asc: activeTab !== 'movimientos' };
        sec.querySelectorAll('.fin-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderFinanceView();
      };
    });
    sec.querySelector('#finPrimaryAddBtn').onclick = () => {
      if (activeTab === 'movimientos') openNewMovementModal();
      else if (activeTab === 'cuentas') openNewAccountModal();
      else if (activeTab === 'compromisos') openNewCompromisoModal();
      else if (activeTab === 'inversiones') openNewInversionModal();
    };
    sec.querySelector('#finExportCsvBtn').onclick = exportCurrentTabCsv;
    sec.querySelector('#finSnapshotNoteBtn').onclick = () => {
      if (!global.EfectivaFinance) return;
      const md = global.EfectivaFinance.exportarMarkdown();
      const titulo = 'Estado Financiero ' + new Date().toISOString().slice(0, 10);
      try {
        if (typeof notes !== 'undefined' && Array.isArray(notes)) {
          notes.push({
            id: '_' + Math.random().toString(36).slice(2, 11),
            title: titulo,
            content: md,
            folderId: null,
            taskId: null,
            tags: ['finanzas', 'snapshot'],
            createdAt: Date.now()
          });
          if (typeof saveNotes === 'function') saveNotes();
          if (typeof asistaAlert === 'function') asistaAlert(`Snapshot guardado como nota "${titulo}".`, { title: 'Snapshot creado' });
          else alert(`Snapshot guardado como nota "${titulo}".`);
        }
      } catch (_) {}
    };
    return sec;
  }

  function renderFinanceView() {
    const sec = document.getElementById('financeSection');
    if (!sec || sec.style.display === 'none') return;
    renderKPIs(sec.querySelector('#finKpiBar'));
    renderSubTab(sec);
  }

  function openFinanceView(pushHistory = true) {
    const sec = ensureFinanceSection();
    ['foldersSection', 'tasksSection', 'trashSection', 'rewardSection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    sec.style.display = 'block';
    renderFinanceView();
    if (pushHistory) {
      try { history.pushState({ finance: true }, '', ''); } catch (_) {}
    }
  }

  global.addEventListener('efectiva:finance-updated', renderFinanceView);
  global.EfectivaFinanceUI = { openFinanceView, renderFinanceView };

  function bindFinanceNavButton() {
    const btn = document.getElementById('financeViewBtn');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', () => openFinanceView(true));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindFinanceNavButton);
  else setTimeout(bindFinanceNavButton, 50);
})(typeof window !== 'undefined' ? window : globalThis);

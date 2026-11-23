/* ============================================================================
 *  EFECTIVA — MOTOR FINANCIERO ESTRUCTURADO MULTI-MONEDA (GTQ / USD)
 *  Aritmética 100% exacta en centavos enteros (sin errores de punto flotante).
 *  Persistencia offline-first: localStorage ('efectivaFinanceV1') + Supabase user_data.
 * ============================================================================ */
(function (global) {
  'use strict';

  const FINANCE_STORAGE_KEY = 'efectivaFinanceV1';
  const VALID_CURRENCIES = ['GTQ', 'USD'];
  const VALID_ACCOUNT_TYPES = ['banco', 'billetera_fisica', 'crypto', 'reserva'];
  const VALID_MOV_TYPES = [
    'ingreso',
    'egreso',
    'transferencia',
    'pago_deuda',
    'cobro',
    'aporte_inversion',
    'retorno_inversion',
    'ajuste_conciliacion'
  ];

  function genId(prefix) {
    return (prefix || '_fin_') + Math.random().toString(36).slice(2, 10);
  }

  function toCents(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  function fromCents(cents) {
    const c = Number(cents);
    if (!Number.isFinite(c)) return 0;
    return Math.round(c) / 100;
  }

  function normCurrency(c) {
    const u = String(c || 'GTQ').trim().toUpperCase();
    return VALID_CURRENCIES.includes(u) ? u : null;
  }

  function todayIso() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function defaultState() {
    return {
      version: 1,
      cuentas: [],
      movimientos: [],
      compromisos: [],
      inversiones: [],
      tipo_cambio_usd_gtq: 7.75,
      updatedAt: 0
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    return {
      version: 1,
      cuentas: Array.isArray(raw.cuentas) ? raw.cuentas : [],
      movimientos: Array.isArray(raw.movimientos) ? raw.movimientos : [],
      compromisos: Array.isArray(raw.compromisos) ? raw.compromisos : [],
      inversiones: Array.isArray(raw.inversiones) ? raw.inversiones : [],
      tipo_cambio_usd_gtq: Number(raw.tipo_cambio_usd_gtq) > 0 ? Number(raw.tipo_cambio_usd_gtq) : 7.75,
      updatedAt: Number(raw.updatedAt) || 0
    };
  }

  function createFinanceEngine(externalStateRef, onSave) {
    let state = normalizeState(externalStateRef);

    function persist() {
      state.updatedAt = Date.now();
      if (typeof onSave === 'function') onSave(state);
    }

    function formatCuenta(c) {
      return {
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        moneda: c.moneda,
        saldo: fromCents(c.saldo_centavos),
        notas: c.notas || undefined
      };
    }

    function formatCompromiso(k) {
      return {
        id: k.id,
        tipo: k.tipo,
        contraparte: k.contraparte,
        concepto: k.concepto,
        moneda: k.moneda,
        monto_total: fromCents(k.monto_total_centavos),
        saldo_pendiente: fromCents(k.saldo_pendiente_centavos),
        cuota_mensual: k.cuota_mensual_centavos != null ? fromCents(k.cuota_mensual_centavos) : undefined,
        dia_corte: k.dia_corte != null ? k.dia_corte : undefined,
        fecha_limite: k.fecha_limite || undefined,
        estado: k.estado
      };
    }

    function formatInversion(inv) {
      const cap = inv.capital_invertido_centavos || 0;
      const ret = inv.retornos_acumulados_centavos || 0;
      const cos = inv.costos_acumulados_centavos || 0;
      const flujo = ret - cos;
      const roi = cap > 0 ? Math.round((flujo / cap) * 10000) / 100 : 0;
      const clasificacion = flujo > 0 ? 'provee' : (flujo < 0 ? 'drena' : 'equilibrio');
      return {
        id: inv.id,
        nombre: inv.nombre,
        moneda: inv.moneda,
        capital_invertido: fromCents(cap),
        retornos: fromCents(ret),
        costos: fromCents(cos),
        flujo_neto: fromCents(flujo),
        roi_porcentaje: roi,
        clasificacion,
        estado: inv.estado
      };
    }

    function formatMov(m) {
      return {
        id: m.id,
        fecha: m.fecha_iso,
        tipo: m.tipo,
        monto: fromCents(m.monto_centavos),
        moneda: m.moneda,
        cuenta_id: m.cuenta_id,
        cuenta_destino_id: m.cuenta_destino_id || undefined,
        categoria: m.categoria || undefined,
        descripcion: m.descripcion || undefined,
        referencia_entidad_id: m.referencia_entidad_id || undefined
      };
    }

    function gestionarCuenta(args = {}) {
      const accion = String(args.accion || 'listar').toLowerCase();
      if (accion === 'listar') {
        const list = args.moneda
          ? state.cuentas.filter(c => c.moneda === normCurrency(args.moneda))
          : state.cuentas;
        return { ok: true, total: list.length, cuentas: list.map(formatCuenta) };
      }

      if (accion === 'crear') {
        const nombre = String(args.nombre || '').trim();
        if (!nombre) return { ok: false, error: 'Falta nombre de cuenta.' };
        const moneda = normCurrency(args.moneda || 'GTQ');
        if (!moneda) return { ok: false, error: 'Moneda inválida (usa GTQ o USD).' };
        const tipo = VALID_ACCOUNT_TYPES.includes(args.tipo) ? args.tipo : 'banco';
        const saldoInit = args.saldo_inicial !== undefined ? args.saldo_inicial : (args.saldo_actual !== undefined ? args.saldo_actual : 0);
        const cents = toCents(saldoInit);
        if (cents === null) return { ok: false, error: 'Saldo inicial inválido.' };

        const cuenta = {
          id: genId('_cta_'),
          nombre,
          tipo,
          moneda,
          saldo_centavos: cents,
          notas: args.notas ? String(args.notas).trim() : '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        state.cuentas.push(cuenta);
        persist();
        return { ok: true, cuenta: formatCuenta(cuenta) };
      }

      const cuenta = state.cuentas.find(c => c.id === args.cuenta_id);
      if (!cuenta) return { ok: false, error: 'Cuenta no encontrada.' };

      if (accion === 'actualizar') {
        if (args.nombre !== undefined && String(args.nombre).trim()) cuenta.nombre = String(args.nombre).trim();
        if (args.tipo !== undefined && VALID_ACCOUNT_TYPES.includes(args.tipo)) cuenta.tipo = args.tipo;
        if (args.moneda !== undefined) {
          const m = normCurrency(args.moneda);
          if (!m) return { ok: false, error: 'Moneda inválida.' };
          cuenta.moneda = m;
        }
        if (args.notas !== undefined) cuenta.notas = String(args.notas);
        if (args.saldo_actual !== undefined) {
          const c = toCents(args.saldo_actual);
          if (c === null) return { ok: false, error: 'Saldo inválido.' };
          cuenta.saldo_centavos = c;
        }
        cuenta.updatedAt = Date.now();
        persist();
        return { ok: true, cuenta: formatCuenta(cuenta) };
      }

      if (accion === 'ajustar_saldo') {
        const target = args.saldo_actual !== undefined ? args.saldo_actual : args.saldo_inicial;
        const c = toCents(target);
        if (c === null) return { ok: false, error: 'Indica saldo_actual numérico.' };
        const diff = c - cuenta.saldo_centavos;
        cuenta.saldo_centavos = c;
        cuenta.updatedAt = Date.now();
        persist();
        return { ok: true, cuenta: formatCuenta(cuenta), diferencia: fromCents(diff) };
      }

      return { ok: false, error: 'Acción inválida (crear|actualizar|ajustar_saldo|listar).' };
    }

    function registrarMovimiento(args = {}) {
      const tipo = String(args.tipo || '').toLowerCase();
      if (!VALID_MOV_TYPES.includes(tipo)) {
        return { ok: false, error: 'Tipo de movimiento inválido.' };
      }
      const montoCents = toCents(args.monto);
      if (montoCents === null || montoCents <= 0) {
        return { ok: false, error: 'El monto debe ser mayor a 0.' };
      }
      const cuenta = state.cuentas.find(c => c.id === args.cuenta_id);
      if (!cuenta) return { ok: false, error: 'Cuenta origen no encontrada.' };

      const moneda = normCurrency(args.moneda || cuenta.moneda);
      if (!moneda) return { ok: false, error: 'Moneda inválida (GTQ o USD).' };
      if (moneda !== cuenta.moneda) {
        return { ok: false, error: `La cuenta "${cuenta.nombre}" opera en ${cuenta.moneda}, no en ${moneda}.` };
      }

      let cuentaDest = null;
      let montoDestCents = montoCents;
      if (tipo === 'transferencia') {
        cuentaDest = state.cuentas.find(c => c.id === args.cuenta_destino_id);
        if (!cuentaDest) return { ok: false, error: 'Cuenta destino no encontrada para transferencia.' };
        if (cuentaDest.id === cuenta.id) return { ok: false, error: 'Cuenta origen y destino no pueden ser la misma.' };
        if (cuentaDest.moneda !== cuenta.moneda) {
          const tc = Number(args.tipo_cambio_usd_gtq) || state.tipo_cambio_usd_gtq || 7.75;
          if (args.monto_destino !== undefined) {
            const md = toCents(args.monto_destino);
            if (md === null || md <= 0) return { ok: false, error: 'monto_destino inválido.' };
            montoDestCents = md;
          } else if (cuenta.moneda === 'USD' && cuentaDest.moneda === 'GTQ') {
            montoDestCents = Math.round(montoCents * tc);
          } else {
            montoDestCents = Math.round(montoCents / tc);
          }
        }
      }

      // Actualizar saldos en centavos exactos
      if (tipo === 'ingreso' || tipo === 'cobro' || tipo === 'retorno_inversion') {
        cuenta.saldo_centavos += montoCents;
      } else if (tipo === 'egreso' || tipo === 'pago_deuda' || tipo === 'aporte_inversion') {
        cuenta.saldo_centavos -= montoCents;
      } else if (tipo === 'transferencia') {
        cuenta.saldo_centavos -= montoCents;
        cuentaDest.saldo_centavos += montoDestCents;
        cuentaDest.updatedAt = Date.now();
      } else if (tipo === 'ajuste_conciliacion') {
        const signo = args.signo === '-' ? -1 : 1;
        cuenta.saldo_centavos += signo * montoCents;
      }
      cuenta.updatedAt = Date.now();

      // Actualizar compromiso o inversión vinculada si aplica
      let entidadActualizada = null;
      if (args.referencia_entidad_id) {
        const comp = state.compromisos.find(k => k.id === args.referencia_entidad_id);
        if (comp && (tipo === 'pago_deuda' || tipo === 'cobro')) {
          comp.saldo_pendiente_centavos = Math.max(0, (comp.saldo_pendiente_centavos || 0) - montoCents);
          if (comp.saldo_pendiente_centavos === 0) {
            comp.estado = comp.tipo === 'por_pagar' ? 'pagado' : 'cobrado';
          }
          comp.updatedAt = Date.now();
          entidadActualizada = { tipo: 'compromiso', id: comp.id, saldo_pendiente: fromCents(comp.saldo_pendiente_centavos), estado: comp.estado };
        }
        const inv = state.inversiones.find(i => i.id === args.referencia_entidad_id);
        if (inv) {
          if (tipo === 'aporte_inversion') {
            inv.capital_invertido_centavos = (inv.capital_invertido_centavos || 0) + montoCents;
            inv.costos_acumulados_centavos = (inv.costos_acumulados_centavos || 0) + montoCents;
          } else if (tipo === 'retorno_inversion') {
            inv.retornos_acumulados_centavos = (inv.retornos_acumulados_centavos || 0) + montoCents;
          } else if (tipo === 'egreso') {
            inv.costos_acumulados_centavos = (inv.costos_acumulados_centavos || 0) + montoCents;
          }
          inv.updatedAt = Date.now();
          entidadActualizada = { tipo: 'inversion', ...formatInversion(inv) };
        }
      }

      const mov = {
        id: genId('_mov_'),
        tipo,
        monto_centavos: montoCents,
        moneda,
        cuenta_id: cuenta.id,
        cuenta_destino_id: cuentaDest ? cuentaDest.id : null,
        monto_destino_centavos: cuentaDest ? montoDestCents : null,
        categoria: String(args.categoria || tipo).trim(),
        descripcion: String(args.descripcion || '').trim(),
        fecha_iso: String(args.fecha_iso || todayIso()).slice(0, 10),
        tarea_id: args.tarea_id || null,
        referencia_entidad_id: args.referencia_entidad_id || null,
        createdAt: Date.now()
      };
      state.movimientos.unshift(mov);
      persist();

      const resp = {
        ok: true,
        movimiento: formatMov(mov),
        nuevo_saldo_cuenta: { id: cuenta.id, nombre: cuenta.nombre, moneda: cuenta.moneda, saldo: fromCents(cuenta.saldo_centavos) }
      };
      if (cuentaDest) {
        resp.nuevo_saldo_destino = { id: cuentaDest.id, nombre: cuentaDest.nombre, moneda: cuentaDest.moneda, saldo: fromCents(cuentaDest.saldo_centavos) };
      }
      if (entidadActualizada) resp.entidad_actualizada = entidadActualizada;
      return resp;
    }

    function gestionarCompromiso(args = {}) {
      const accion = String(args.accion || (args.compromiso_id ? 'actualizar' : 'crear')).toLowerCase();
      if (accion === 'listar') {
        const list = state.compromisos.filter(k => {
          if (args.tipo && k.tipo !== args.tipo) return false;
          if (args.estado && k.estado !== args.estado) return false;
          return true;
        });
        return { ok: true, total: list.length, compromisos: list.map(formatCompromiso) };
      }
      if (accion === 'eliminar') {
        const before = state.compromisos.length;
        state.compromisos = state.compromisos.filter(k => k.id !== args.compromiso_id);
        if (state.compromisos.length === before) return { ok: false, error: 'Compromiso no encontrado.' };
        persist();
        return { ok: true, eliminado: args.compromiso_id };
      }
      if (accion === 'crear') {
        const tipo = args.tipo === 'por_cobrar' ? 'por_cobrar' : 'por_pagar';
        const contraparte = String(args.contraparte || '').trim();
        const concepto = String(args.concepto || '').trim();
        if (!contraparte || !concepto) return { ok: false, error: 'Falta contraparte o concepto.' };
        const moneda = normCurrency(args.moneda || 'GTQ');
        if (!moneda) return { ok: false, error: 'Moneda inválida.' };
        const totalC = toCents(args.monto_total);
        if (totalC === null || totalC < 0) return { ok: false, error: 'monto_total inválido.' };
        const pendC = args.saldo_pendiente !== undefined ? toCents(args.saldo_pendiente) : totalC;
        if (pendC === null || pendC < 0) return { ok: false, error: 'saldo_pendiente inválido.' };
        const cuotaC = args.cuota_mensual !== undefined && args.cuota_mensual !== null ? toCents(args.cuota_mensual) : null;

        const comp = {
          id: genId('_cmp_'),
          tipo,
          contraparte,
          concepto,
          moneda,
          monto_total_centavos: totalC,
          saldo_pendiente_centavos: pendC,
          cuota_mensual_centavos: cuotaC,
          dia_corte: args.dia_corte != null ? Number(args.dia_corte) : null,
          fecha_limite: args.fecha_limite || null,
          estado: args.estado || (pendC === 0 ? (tipo === 'por_pagar' ? 'pagado' : 'cobrado') : 'activo'),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        state.compromisos.push(comp);
        persist();
        return { ok: true, compromiso: formatCompromiso(comp) };
      }

      const comp = state.compromisos.find(k => k.id === args.compromiso_id);
      if (!comp) return { ok: false, error: 'Compromiso no encontrado.' };
      if (args.contraparte !== undefined) comp.contraparte = String(args.contraparte).trim();
      if (args.concepto !== undefined) comp.concepto = String(args.concepto).trim();
      if (args.monto_total !== undefined) {
        const c = toCents(args.monto_total);
        if (c !== null && c >= 0) comp.monto_total_centavos = c;
      }
      if (args.saldo_pendiente !== undefined) {
        const c = toCents(args.saldo_pendiente);
        if (c !== null && c >= 0) comp.saldo_pendiente_centavos = c;
      }
      if (args.cuota_mensual !== undefined) comp.cuota_mensual_centavos = args.cuota_mensual === null ? null : toCents(args.cuota_mensual);
      if (args.dia_corte !== undefined) comp.dia_corte = args.dia_corte === null ? null : Number(args.dia_corte);
      if (args.fecha_limite !== undefined) comp.fecha_limite = args.fecha_limite || null;
      if (args.estado !== undefined) comp.estado = String(args.estado);
      comp.updatedAt = Date.now();
      persist();
      return { ok: true, compromiso: formatCompromiso(comp) };
    }

    function gestionarInversion(args = {}) {
      const accion = String(args.accion || (args.inversion_id ? 'actualizar' : 'crear')).toLowerCase();
      if (accion === 'listar') {
        const list = args.estado ? state.inversiones.filter(i => i.estado === args.estado) : state.inversiones;
        return { ok: true, total: list.length, inversiones: list.map(formatInversion) };
      }
      if (accion === 'eliminar') {
        const before = state.inversiones.length;
        state.inversiones = state.inversiones.filter(i => i.id !== args.inversion_id);
        if (state.inversiones.length === before) return { ok: false, error: 'Inversión no encontrada.' };
        persist();
        return { ok: true, eliminada: args.inversion_id };
      }
      if (accion === 'crear') {
        const nombre = String(args.nombre || '').trim();
        if (!nombre) return { ok: false, error: 'Falta nombre de inversión.' };
        const moneda = normCurrency(args.moneda || 'GTQ');
        if (!moneda) return { ok: false, error: 'Moneda inválida.' };
        const capC = toCents(args.capital_invertido || 0);
        const retC = toCents(args.retornos_acumulados || 0);
        const cosC = toCents(args.costos_acumulados || 0);
        if (capC === null || retC === null || cosC === null) return { ok: false, error: 'Montos inválidos.' };

        const inv = {
          id: genId('_inv_'),
          nombre,
          moneda,
          capital_invertido_centavos: capC,
          retornos_acumulados_centavos: retC,
          costos_acumulados_centavos: cosC,
          estado: ['activa', 'pausada', 'cerrada'].includes(args.estado) ? args.estado : 'activa',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        state.inversiones.push(inv);
        persist();
        return { ok: true, inversion: formatInversion(inv) };
      }

      const inv = state.inversiones.find(i => i.id === args.inversion_id);
      if (!inv) return { ok: false, error: 'Inversión no encontrada.' };
      if (args.nombre !== undefined) inv.nombre = String(args.nombre).trim() || inv.nombre;
      if (args.capital_invertido !== undefined) {
        const c = toCents(args.capital_invertido);
        if (c !== null) inv.capital_invertido_centavos = c;
      }
      if (args.retornos_acumulados !== undefined) {
        const c = toCents(args.retornos_acumulados);
        if (c !== null) inv.retornos_acumulados_centavos = c;
      }
      if (args.costos_acumulados !== undefined) {
        const c = toCents(args.costos_acumulados);
        if (c !== null) inv.costos_acumulados_centavos = c;
      }
      if (args.estado !== undefined && ['activa', 'pausada', 'cerrada'].includes(args.estado)) inv.estado = args.estado;
      inv.updatedAt = Date.now();
      persist();
      return { ok: true, inversion: formatInversion(inv) };
    }

    function conciliarArqueo(args = {}) {
      const cuenta = state.cuentas.find(c => c.id === args.cuenta_id);
      if (!cuenta) return { ok: false, error: 'Cuenta no encontrada.' };
      const realCents = toCents(args.saldo_contado_real);
      if (realCents === null) return { ok: false, error: 'saldo_contado_real inválido.' };

      const calculadoCents = cuenta.saldo_centavos;
      const diffCents = realCents - calculadoCents;
      let ajusteMov = null;

      if (args.crear_ajuste && diffCents !== 0) {
        cuenta.saldo_centavos = realCents;
        cuenta.updatedAt = Date.now();
        ajusteMov = {
          id: genId('_mov_'),
          tipo: 'ajuste_conciliacion',
          monto_centavos: Math.abs(diffCents),
          signo: diffCents >= 0 ? '+' : '-',
          moneda: cuenta.moneda,
          cuenta_id: cuenta.id,
          cuenta_destino_id: null,
          categoria: 'conciliacion',
          descripcion: String(args.descripcion || `Arqueo ${cuenta.nombre} (${diffCents >= 0 ? '+' : ''}${fromCents(diffCents)})`),
          fecha_iso: todayIso(),
          createdAt: Date.now()
        };
        state.movimientos.unshift(ajusteMov);
        persist();
      }

      return {
        ok: true,
        cuenta: cuenta.nombre,
        moneda: cuenta.moneda,
        saldo_calculado: fromCents(calculadoCents),
        saldo_contado_real: fromCents(realCents),
        diferencia: fromCents(diffCents),
        cuadra: diffCents === 0,
        ajuste_creado: ajusteMov ? formatMov(ajusteMov) : null
      };
    }

    function obtenerResumen(args = {}) {
      const tc = Number(args.tipo_cambio_usd_gtq) > 0 ? Number(args.tipo_cambio_usd_gtq) : state.tipo_cambio_usd_gtq;
      if (Number(args.tipo_cambio_usd_gtq) > 0 && args.tipo_cambio_usd_gtq !== state.tipo_cambio_usd_gtq) {
        state.tipo_cambio_usd_gtq = tc;
        persist();
      }
      const nMovs = args.incluir_movimientos_recientes !== undefined ? Math.max(0, Math.min(25, Number(args.incluir_movimientos_recientes))) : 5;
      const incDeudas = args.incluir_deudas !== false;
      const incInv = args.incluir_inversiones !== false;
      const ym = todayIso().slice(0, 7); // YYYY-MM

      const liquidez = {
        GTQ: { total: 0, banco: 0, billetera_fisica: 0, crypto: 0, reserva: 0 },
        USD: { total: 0, banco: 0, billetera_fisica: 0, crypto: 0, reserva: 0 }
      };
      state.cuentas.forEach(c => {
        const m = liquidez[c.moneda];
        if (!m) return;
        m.total += c.saldo_centavos;
        if (m[c.tipo] !== undefined) m[c.tipo] += c.saldo_centavos;
      });

      const deudas = { GTQ: 0, USD: 0 };
      const porCobrar = { GTQ: 0, USD: 0 };
      state.compromisos.forEach(k => {
        if (k.estado === 'pagado' || k.estado === 'cobrado') return;
        const target = k.tipo === 'por_cobrar' ? porCobrar : deudas;
        if (target[k.moneda] !== undefined) target[k.moneda] += (k.saldo_pendiente_centavos || 0);
      });

      const flujoMes = { GTQ: 0, USD: 0 };
      state.movimientos.forEach(m => {
        if (!String(m.fecha_iso || '').startsWith(ym)) return;
        if (flujoMes[m.moneda] === undefined) return;
        if (m.tipo === 'ingreso' || m.tipo === 'cobro' || m.tipo === 'retorno_inversion') flujoMes[m.moneda] += m.monto_centavos;
        else if (m.tipo === 'egreso' || m.tipo === 'pago_deuda' || m.tipo === 'aporte_inversion') flujoMes[m.moneda] -= m.monto_centavos;
      });

      const toObj = (raw) => ({
        total: fromCents(raw.total),
        banco: fromCents(raw.banco),
        efectivo: fromCents(raw.billetera_fisica),
        crypto: fromCents(raw.crypto),
        reserva: fromCents(raw.reserva)
      });

      const res = {
        ok: true,
        mes: ym,
        tipo_cambio_usd_gtq: tc,
        liquidez: { GTQ: toObj(liquidez.GTQ), USD: toObj(liquidez.USD) },
        deuda_total: { GTQ: fromCents(deudas.GTQ), USD: fromCents(deudas.USD) },
        por_cobrar: { GTQ: fromCents(porCobrar.GTQ), USD: fromCents(porCobrar.USD) },
        posicion_neta: {
          GTQ: fromCents(liquidez.GTQ.total + porCobrar.GTQ - deudas.GTQ),
          USD: fromCents(liquidez.USD.total + porCobrar.USD - deudas.USD)
        },
        flujo_mes: { GTQ: fromCents(flujoMes.GTQ), USD: fromCents(flujoMes.USD) }
      };

      if (args.moneda_vista) {
        const mv = normCurrency(args.moneda_vista);
        if (mv === 'GTQ') {
          const netGtqC = (liquidez.GTQ.total + porCobrar.GTQ - deudas.GTQ) + Math.round((liquidez.USD.total + porCobrar.USD - deudas.USD) * tc);
          res.consolidado_GTQ = fromCents(netGtqC);
        } else if (mv === 'USD') {
          const netUsdC = (liquidez.USD.total + porCobrar.USD - deudas.USD) + Math.round((liquidez.GTQ.total + porCobrar.GTQ - deudas.GTQ) / tc);
          res.consolidado_USD = fromCents(netUsdC);
        }
      }

      if (incDeudas) {
        const activos = state.compromisos.filter(k => k.estado !== 'pagado' && k.estado !== 'cobrado');
        res.compromisos_activos = activos.map(k => ({
          id: k.id, tipo: k.tipo, contraparte: k.contraparte, moneda: k.moneda, saldo: fromCents(k.saldo_pendiente_centavos), limite: k.fecha_limite || undefined
        }));
      }

      if (incInv) {
        const formatted = state.inversiones.map(formatInversion);
        res.inversiones = {
          provee: formatted.filter(i => i.clasificacion === 'provee').map(i => ({ id: i.id, nombre: i.nombre, moneda: i.moneda, flujo: i.flujo_neto, roi: i.roi_porcentaje })),
          equilibrio: formatted.filter(i => i.clasificacion === 'equilibrio').map(i => ({ id: i.id, nombre: i.nombre, moneda: i.moneda })),
          drena: formatted.filter(i => i.clasificacion === 'drena').map(i => ({ id: i.id, nombre: i.nombre, moneda: i.moneda, flujo: i.flujo_neto, roi: i.roi_porcentaje }))
        };
      }

      if (nMovs > 0) {
        res.movimientos_recientes = state.movimientos.slice(0, nMovs).map(formatMov);
      }

      return res;
    }

    function exportarMarkdown(args = {}) {
      const r = obtenerResumen({
        incluir_movimientos_recientes: 10,
        incluir_deudas: true,
        incluir_inversiones: true,
        moneda_vista: 'GTQ',
        tipo_cambio_usd_gtq: args.tipo_cambio_usd_gtq
      });
      const lines = [
        `# Estado Financiero (${todayIso()})`,
        `Tipo de cambio: **Q${r.tipo_cambio_usd_gtq} / USD**`,
        '',
        '## Liquidez',
        `- **GTQ:** Q${r.liquidez.GTQ.total} (Bancos: Q${r.liquidez.GTQ.banco} | Efectivo: Q${r.liquidez.GTQ.efectivo} | Crypto: Q${r.liquidez.GTQ.crypto} | Reserva: Q${r.liquidez.GTQ.reserva})`,
        `- **USD:** $${r.liquidez.USD.total} (Bancos: $${r.liquidez.USD.banco} | Efectivo: $${r.liquidez.USD.efectivo} | Crypto: $${r.liquidez.USD.crypto} | Reserva: $${r.liquidez.USD.reserva})`,
        '',
        '## Posición Neta y Flujo del Mes',
        `- **Posición Neta:** Q${r.posicion_neta.GTQ} | $${r.posicion_neta.USD} (Consolidado: **Q${r.consolidado_GTQ}**)`,
        `- **Deudas:** Q${r.deuda_total.GTQ} | $${r.deuda_total.USD}`,
        `- **Por Cobrar:** Q${r.por_cobrar.GTQ} | $${r.por_cobrar.USD}`,
        `- **Flujo ${r.mes}:** Q${r.flujo_mes.GTQ} | $${r.flujo_mes.USD}`,
        '',
        '## Cuentas',
        ...(state.cuentas.length ? state.cuentas.map(c => `- ${c.nombre} (${c.tipo}, ${c.moneda}): ${fromCents(c.saldo_centavos)}`) : ['- (Sin cuentas)']),
        '',
        '## Inversiones (Provee vs Drena)',
        `- **Provee:** ${(r.inversiones.provee || []).map(i => `${i.nombre} (+${i.flujo} ${i.moneda}, ROI ${i.roi}%)`).join(', ') || 'Ninguna'}`,
        `- **Drena:** ${(r.inversiones.drena || []).map(i => `${i.nombre} (${i.flujo} ${i.moneda}, ROI ${i.roi}%)`).join(', ') || 'Ninguna'}`
      ];
      return lines.join('\n');
    }

    return {
      getState: () => state,
      setState: (next) => { state = normalizeState(next); },
      gestionarCuenta,
      registrarMovimiento,
      gestionarCompromiso,
      gestionarInversion,
      conciliarArqueo,
      obtenerResumen,
      exportarMarkdown
    };
  }

  // Instancia cliente en navegador (con localStorage + EfectivaCloud)
  if (typeof localStorage !== 'undefined') {
    let initial = null;
    try {
      const raw = localStorage.getItem(FINANCE_STORAGE_KEY);
      if (raw) initial = JSON.parse(raw);
    } catch (_) {}

    const engine = createFinanceEngine(initial, (nextState) => {
      try { localStorage.setItem(FINANCE_STORAGE_KEY, JSON.stringify(nextState)); } catch (_) {}
      try {
        if (global.EfectivaCloud && typeof global.EfectivaCloud.scheduleSave === 'function') {
          global.EfectivaCloud.scheduleSave({ finance: nextState });
        }
      } catch (_) {}
    });

    global.EfectivaFinance = {
      ...engine,
      exportState: () => engine.getState(),
      hydrateFromCloud(cloudFinance) {
        if (!cloudFinance || typeof cloudFinance !== 'object') return;
        const cur = engine.getState();
        const cloudTs = Number(cloudFinance.updatedAt) || 0;
        const localEmpty = cur.cuentas.length === 0 && cur.movimientos.length === 0 && cur.compromisos.length === 0 && cur.inversiones.length === 0;
        if (localEmpty || cloudTs >= (cur.updatedAt || 0)) {
          engine.setState(cloudFinance);
          try { localStorage.setItem(FINANCE_STORAGE_KEY, JSON.stringify(engine.getState())); } catch (_) {}
        }
      }
    };
  }

  global.createEfectivaFinanceEngine = createFinanceEngine;
})(typeof window !== 'undefined' ? window : globalThis);

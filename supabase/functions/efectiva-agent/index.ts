// Supabase Edge Function: efectiva-agent (v26)
// Ejecuta el agente IA de Efectiva en segundo plano real en la nube (EdgeRuntime.waitUntil)
// para que siga trabajando aunque el usuario cambie a WhatsApp o cierre la app.
//
// Seguridad: verifica el JWT del usuario con supabase.auth.getUser() y usa RLS de user_data.
// Despliegue CLI: npx supabase functions deploy efectiva-agent --project-ref uwxopjatesgptsrwyeqr --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function genId(prefix = '_'): string {
  return prefix + Math.random().toString(36).slice(2, 11);
}

interface AppState {
  folders: any[];
  trash: any[];
  notes: any[];
  userTemplates: any[];
  automationRules: any[];
  agentMemory: any[];
  finance?: any;
  tables?: any[];
  userStats: {
    xp_total: number;
    nivel: number;
    racha_dias_consecutivos: number;
    ultimo_dia_activo?: string | null;
  };
  currentFolderId: string | null;
  activePresentation: any | null;
  timezone: string;
  localNow: string;
}

interface ToolTraceItem {
  tool: string;
  args: Record<string, any>;
  result: any;
}

interface UiActionItem {
  tool: string;
  args: Record<string, any>;
}

function recalcStepTimes(task: any, forceEqual = false) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  if (!task.totalTime || steps.length === 0) {
    task.stepTimes = [];
    return;
  }
  if (!forceEqual && task.hasCustomStepTimes && Array.isArray(task.stepTimes) && task.stepTimes.length === steps.length) {
    return;
  }
  const perStep = Math.floor(Number(task.totalTime) / steps.length);
  task.stepTimes = steps.map(() => perStep);
  task.hasCustomStepTimes = false;
}

function createToolEngine(
  state: AppState,
  aiConfig: { apiKey: string; model: string; baseUrl: string },
  uiActions: UiActionItem[],
) {
  let mutated = false;
  const markMutated = () => { mutated = true; };

  const findFolder = (id: string | null | undefined) =>
    id ? state.folders.find((f) => f.id === id) || null : null;

  const findTask = (id: string | null | undefined) => {
    if (!id) return null;
    for (const f of state.folders) {
      const t = (f.tasks || []).find((x: any) => x.id === id);
      if (t) return { folder: f, task: t, isFinished: false };
      const t2 = (f.finished || []).find((x: any) => x.id === id);
      if (t2) return { folder: f, task: t2, isFinished: true };
    }
    return null;
  };

  const moveTaskToTrashLocal = (folder: any, taskId: string, isFinished = false) => {
    const arr = isFinished ? (folder.finished || []) : (folder.tasks || []);
    const idx = arr.findIndex((t: any) => t.id === taskId);
    if (idx === -1) return false;
    const [removed] = arr.splice(idx, 1);
    state.trash.unshift({
      id: removed.id || genId(),
      type: 'task',
      name: removed.name,
      folderId: folder.id,
      folderName: folder.name,
      wasFinished: isFinished,
      data: removed,
      deletedAt: Date.now(),
    });
    markMutated();
    return true;
  };

  const moveTaskToFinishedLocal = (folder: any, task: any) => {
    folder.tasks = (folder.tasks || []).filter((x: any) => x.id !== task.id);
    if (!Array.isArray(folder.finished)) folder.finished = [];
    task.completedAt = new Date().toISOString();
    folder.finished.unshift(task);
    markMutated();
  };

  const getStateSnapshot = () => {
    const nowObj = new Date();
    const allNotes = Array.isArray(state.notes) ? state.notes : [];
    const allRules = Array.isArray(state.automationRules) ? state.automationRules : [];
    return {
      ok: true,
      ahora_iso: nowObj.toISOString(),
      ahora_local: state.localNow || nowObj.toISOString(),
      zona_horaria: state.timezone || 'UTC',
      carpeta_actual_id: state.currentFolderId || null,
      plantillas_usuario: (state.userTemplates || []).map((t: any) => ({
        id: t.id,
        nombre: t.name,
        pasos: (t.steps || []).length,
        tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : null,
        prioridad: t.priority || null,
      })),
      notas_resumen: {
        total: allNotes.length,
        recientes: allNotes.slice(0, 12).map((n: any) => ({
          id: n.id,
          titulo: n.title,
          carpeta_id: n.folderId || null,
          tarea_id: n.taskId || null,
          etiquetas: n.tags || [],
        })),
      },
      reglas_automatizacion_resumen: {
        total: allRules.length,
        activas: allRules.filter((r: any) => r.activa !== false).length,
      },
      presentacion_activa: state.activePresentation || null,
      carpetas: (state.folders || []).map((f: any) => ({
        id: f.id,
        nombre: f.name,
        es_recompensas: !!f.isDefaultRewards,
        cantidad_tareas: (f.tasks || []).length,
        cantidad_completadas: (f.finished || []).length,
        tareas: (f.tasks || []).map((t: any) => {
          const curIdx = t.currentStepIndex || 0;
          return {
            id: t.id,
            nombre: t.name,
            es_recompensa: !!t.isReward,
            tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : (t.rewardTime || null),
            tiempo_real_min: t.actualTimeMinutes || null,
            tiempos_pasos_minutos: Array.isArray(t.stepTimes)
              ? t.stepTimes.map((s: any) => Math.round(((Number(s) || 0) / 60) * 10) / 10)
              : [],
            tiempos_personalizados: !!t.hasCustomStepTimes,
            color: t.color || null,
            prioridad: t.priority || null,
            fecha_vencimiento: t.dueDate || null,
            etiquetas: Array.isArray(t.tags) ? t.tags : [],
            pasos: t.steps || [],
            pasos_detalle: (t.steps || []).map((s: any, idx: number) => ({
              indice: idx,
              texto: typeof s === 'string' ? s : (s?.text || ''),
              completado: typeof s === 'object' && s !== null && typeof s.completed === 'boolean'
                ? s.completed
                : idx < curIdx,
              minutos: Array.isArray(t.stepTimes) && typeof t.stepTimes[idx] === 'number'
                ? Math.round((t.stepTimes[idx] / 60) * 10) / 10
                : null,
            })),
            retrasos: Array.isArray(t.delayLogs) ? t.delayLogs : [],
          };
        }),
        tareas_completadas: (f.finished || []).map((t: any) => ({
          id: t.id,
          nombre: t.name,
          tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : null,
          tiempo_real_min: t.actualTimeMinutes || null,
          fecha_completada: t.completedAt || null,
          color: t.color || null,
          prioridad: t.priority || null,
          etiquetas: Array.isArray(t.tags) ? t.tags : [],
          pasos_detalle: (t.steps || []).map((s: any, idx: number) => ({
            indice: idx,
            texto: typeof s === 'string' ? s : (s?.text || ''),
            completado: true,
            minutos: Array.isArray(t.stepTimes) && typeof t.stepTimes[idx] === 'number'
              ? Math.round((t.stepTimes[idx] / 60) * 10) / 10
              : null,
          })),
          retrasos: Array.isArray(t.delayLogs) ? t.delayLogs : [],
        })),
      })),
    };
  };

  const executors: Record<string, (args: any) => any | Promise<any>> = {
    obtener_estado() {
      return getStateSnapshot();
    },

    crear_carpeta({ nombre }: any) {
      if (!nombre || !String(nombre).trim()) return { ok: false, error: 'Nombre vacío' };
      const n = String(nombre).trim();
      const folder = { id: genId(), name: n, tasks: [], finished: [], isDefaultRewards: false };
      state.folders.push(folder);
      markMutated();
      return { ok: true, mensaje: `Carpeta "${n}" creada.`, carpeta_id: folder.id };
    },

    renombrar_carpeta({ carpeta_id, nuevo_nombre }: any) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      const antes = f.name;
      f.name = String(nuevo_nombre || '').trim() || f.name;
      markMutated();
      return { ok: true, mensaje: `Carpeta renombrada de "${antes}" a "${f.name}".` };
    },

    eliminar_carpeta({ carpeta_id }: any) {
      const idx = state.folders.findIndex((f) => f.id === carpeta_id);
      if (idx === -1) return { ok: false, error: 'Carpeta no encontrada' };
      const f = state.folders[idx];
      if (f.isDefaultRewards) return { ok: false, error: 'No se puede eliminar la carpeta de Recompensas' };
      state.folders.splice(idx, 1);
      state.trash.unshift({ id: f.id, type: 'folder', name: f.name, data: f, deletedAt: Date.now() });
      markMutated();
      return { ok: true, mensaje: `Carpeta "${f.name}" enviada a la papelera.` };
    },

    crear_tarea({ carpeta_id, nombre, tiempo_minutos }: any) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      if (f.isDefaultRewards) return { ok: false, error: 'La carpeta de recompensas no acepta tareas; usá crear_recompensa.' };
      if (!nombre || !String(nombre).trim()) return { ok: false, error: 'Nombre vacío' };
      const task = {
        id: genId(),
        name: String(nombre).trim(),
        steps: [],
        isExpanded: false,
        scheduledTimestamp: null,
        currentStepIndex: 0,
        totalTime: tiempo_minutos && Number(tiempo_minutos) > 0 ? Number(tiempo_minutos) * 60 : null,
        stepTimes: [],
      };
      if (!Array.isArray(f.tasks)) f.tasks = [];
      f.tasks.push(task);
      markMutated();
      return { ok: true, mensaje: `Tarea "${task.name}" creada${task.totalTime ? ` (${tiempo_minutos} min)` : ''}.`, tarea_id: task.id };
    },

    renombrar_tarea({ tarea_id, nuevo_nombre }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const antes = found.task.name;
      found.task.name = String(nuevo_nombre || '').trim() || found.task.name;
      markMutated();
      return { ok: true, mensaje: `Tarea renombrada de "${antes}" a "${found.task.name}".` };
    },

    guardar_tarea_completa({ carpeta_id, tarea_id, nombre, pasos, tiempo_minutos, prioridad, color, fecha_iso, etiquetas, posicion }: any) {
      const folder = findFolder(carpeta_id);
      if (!folder) return { ok: false, error: 'Carpeta no encontrada' };
      if (folder.isDefaultRewards) return { ok: false, error: 'No se pueden crear tareas normales en la carpeta de recompensas.' };
      if (!nombre || !String(nombre).trim()) return { ok: false, error: 'Nombre de tarea vacío' };

      let task: any = null;
      let isUpdate = false;
      if (tarea_id) {
        const found = findTask(tarea_id);
        if (!found) return { ok: false, error: 'Tarea a actualizar no encontrada' };
        task = found.task;
        isUpdate = true;
      } else {
        task = {
          id: genId(),
          name: String(nombre).trim(),
          steps: [],
          isExpanded: false,
          scheduledTimestamp: null,
          isReward: false,
          currentStepIndex: 0,
          totalTime: null,
          stepTimes: [],
        };
      }

      task.name = String(nombre).trim();

      if (Array.isArray(pasos)) {
        const parsedSteps: string[] = [];
        const parsedTimes: number[] = [];
        let hasAnyCustomMin = false;
        let firstUncompleted = pasos.length;

        pasos.forEach((p: any) => {
          const text = typeof p === 'string' ? p.trim() : String((p && (p.descripcion || p.texto || p.text)) || '').trim();
          if (!text) return;
          parsedSteps.push(text);
          const mins = typeof p === 'object' && p !== null && p.minutos !== undefined && p.minutos !== null ? Number(p.minutos) : null;
          if (mins !== null && !isNaN(mins) && mins >= 0) {
            parsedTimes.push(Math.round(mins * 60));
            hasAnyCustomMin = true;
          } else {
            parsedTimes.push(0);
          }
          const isDone = typeof p === 'object' && p !== null ? !!p.completado : false;
          if (!isDone && firstUncompleted === pasos.length) {
            firstUncompleted = parsedSteps.length - 1;
          }
        });

        task.steps = parsedSteps;
        if (hasAnyCustomMin) {
          task.stepTimes = parsedTimes;
          task.hasCustomStepTimes = true;
          task.totalTime = tiempo_minutos && Number(tiempo_minutos) > 0
            ? Math.round(Number(tiempo_minutos) * 60)
            : parsedTimes.reduce((a, b) => a + b, 0);
        } else if (tiempo_minutos && Number(tiempo_minutos) > 0) {
          task.totalTime = Math.round(Number(tiempo_minutos) * 60);
          recalcStepTimes(task, true);
        } else if (tiempo_minutos === null) {
          task.totalTime = null;
          task.stepTimes = [];
          task.hasCustomStepTimes = false;
        }
        if (firstUncompleted < parsedSteps.length) {
          task.currentStepIndex = firstUncompleted;
        }
      } else if (tiempo_minutos !== undefined) {
        task.totalTime = tiempo_minutos && Number(tiempo_minutos) > 0 ? Math.round(Number(tiempo_minutos) * 60) : null;
        recalcStepTimes(task, true);
      }

      if (prioridad !== undefined) {
        const p = prioridad ? String(prioridad).toLowerCase() : null;
        task.priority = p === 'ninguna' || !p ? null : p;
      }
      if (color !== undefined) {
        if (!color) {
          delete task.color;
        } else {
          const hex = String(color).trim();
          if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
            task.color = (hex.startsWith('#') ? hex : '#' + hex).toUpperCase();
          }
        }
      }
      if (fecha_iso !== undefined) task.dueDate = fecha_iso ? String(fecha_iso) : null;
      if (Array.isArray(etiquetas)) task.tags = etiquetas.map((x: any) => String(x));

      if (!Array.isArray(folder.tasks)) folder.tasks = [];
      if (!isUpdate) {
        if (posicion !== undefined && posicion !== null && !isNaN(Number(posicion))) {
          const pos = Math.max(0, Math.min(folder.tasks.length, Number(posicion)));
          folder.tasks.splice(pos, 0, task);
        } else {
          folder.tasks.push(task);
        }
      } else if (posicion !== undefined && posicion !== null && !isNaN(Number(posicion))) {
        const curIdx = folder.tasks.findIndex((x: any) => x.id === task.id);
        if (curIdx !== -1) {
          folder.tasks.splice(curIdx, 1);
          const pos = Math.max(0, Math.min(folder.tasks.length, Number(posicion)));
          folder.tasks.splice(pos, 0, task);
        }
      }

      markMutated();
      return {
        ok: true,
        mensaje: `Tarea "${task.name}" ${isUpdate ? 'actualizada' : 'creada'} atómicamente con ${task.steps.length} pasos.`,
        tarea_id: task.id,
      };
    },

    registrar_retraso_paso({ tarea_id, paso_indice, motivo, minutos_extra }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const idx = Number(paso_indice);
      if (isNaN(idx) || idx < 0 || idx >= (found.task.steps || []).length) {
        return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
      }
      if (!Array.isArray(found.task.delayLogs)) found.task.delayLogs = [];
      const entry = {
        stepIndex: idx,
        stepText: typeof found.task.steps[idx] === 'string' ? found.task.steps[idx] : (found.task.steps[idx]?.text || ''),
        motivo: String(motivo || 'Sin especificar').trim(),
        extraMinutes: Number(minutos_extra) || 0,
        overdueSeconds: 0,
        timestamp: new Date().toISOString(),
      };
      found.task.delayLogs.push(entry);
      if (entry.extraMinutes > 0 && Array.isArray(found.task.stepTimes) && typeof found.task.stepTimes[idx] === 'number') {
        found.task.stepTimes[idx] += Math.round(entry.extraMinutes * 60);
        found.task.hasCustomStepTimes = true;
      }
      markMutated();
      return { ok: true, mensaje: `Retraso registrado en paso ${idx + 1}: "${entry.motivo}".`, registro: entry };
    },

    asignar_tiempo_tarea({ tarea_id, tiempo_minutos }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.totalTime = tiempo_minutos && Number(tiempo_minutos) > 0 ? Math.round(Number(tiempo_minutos) * 60) : null;
      recalcStepTimes(found.task, true);
      markMutated();
      return {
        ok: true,
        mensaje: found.task.totalTime
          ? `Tiempo de "${found.task.name}" actualizado a ${tiempo_minutos} min.`
          : `Tiempo de "${found.task.name}" eliminado.`,
      };
    },

    asignar_tiempos_pasos({ tarea_id, tiempos_minutos, paso_indice, minutos, actualizar_total }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const task = found.task;
      if (!Array.isArray(task.steps) || task.steps.length === 0) return { ok: false, error: 'La tarea no tiene pasos.' };

      if (Array.isArray(tiempos_minutos)) {
        task.stepTimes = task.steps.map((_: any, i: number) => {
          const val = Number(tiempos_minutos[i]);
          return !isNaN(val) && val >= 0 ? Math.round(val * 60) : 0;
        });
        task.hasCustomStepTimes = true;
        if (actualizar_total || !task.totalTime) {
          task.totalTime = task.stepTimes.reduce((a: number, b: number) => a + b, 0);
        }
      } else if (paso_indice !== undefined && minutos !== undefined) {
        const idx = Number(paso_indice);
        if (isNaN(idx) || idx < 0 || idx >= task.steps.length) return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
        if (!Array.isArray(task.stepTimes) || task.stepTimes.length !== task.steps.length) {
          task.stepTimes = task.steps.map(() => 0);
        }
        task.stepTimes[idx] = Math.max(0, Math.round(Number(minutos) * 60));
        task.hasCustomStepTimes = true;
        if (actualizar_total) {
          task.totalTime = task.stepTimes.reduce((a: number, b: number) => a + (Number(b) || 0), 0);
        }
      } else {
        return { ok: false, error: 'Debes pasar tiempos_minutos (array) o paso_indice + minutos.' };
      }

      markMutated();
      const resumen = task.stepTimes.map((s: number, i: number) => `P${i + 1}: ${Math.round((s / 60) * 10) / 10}m`).join(', ');
      return { ok: true, mensaje: `Tiempos de pasos actualizados en "${task.name}" (${resumen}).` };
    },

    cambiar_color_tarea({ tarea_id, color }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (color === null || color === '') {
        delete found.task.color;
        markMutated();
        return { ok: true, mensaje: `Color de "${found.task.name}" quitado.` };
      }
      const hex = String(color).trim();
      if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return { ok: false, error: 'Color inválido. Usar formato #RRGGBB.' };
      found.task.color = (hex.startsWith('#') ? hex : '#' + hex).toUpperCase();
      markMutated();
      return { ok: true, mensaje: `Color de "${found.task.name}" cambiado a ${found.task.color}.` };
    },

    eliminar_tarea({ tarea_id }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const nombre = found.task.name;
      moveTaskToTrashLocal(found.folder, tarea_id, !!found.isFinished);
      return { ok: true, mensaje: `Tarea "${nombre}" enviada a la papelera.` };
    },

    mover_tarea({ tarea_id, carpeta_destino_id }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const dest = findFolder(carpeta_destino_id);
      if (!dest) return { ok: false, error: 'Carpeta destino no encontrada' };
      if (dest.isDefaultRewards) return { ok: false, error: 'No se puede mover una tarea normal a la carpeta de recompensas.' };
      const idx = (found.folder.tasks || []).findIndex((t: any) => t.id === tarea_id);
      if (idx === -1) return { ok: false, error: 'Tarea no encontrada en carpeta origen' };
      const [task] = found.folder.tasks.splice(idx, 1);
      if (!Array.isArray(dest.tasks)) dest.tasks = [];
      dest.tasks.push(task);
      markMutated();
      return { ok: true, mensaje: `Tarea "${task.name}" movida a "${dest.name}".` };
    },

    reordenar_tareas({ carpeta_id, nuevo_orden_ids }: any) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      if (!Array.isArray(nuevo_orden_ids)) return { ok: false, error: 'nuevo_orden_ids debe ser un array' };
      const byId: Record<string, any> = {};
      (f.tasks || []).forEach((t: any) => { byId[t.id] = t; });
      const nuevo: any[] = [];
      for (const id of nuevo_orden_ids) {
        if (byId[id]) { nuevo.push(byId[id]); delete byId[id]; }
      }
      Object.values(byId).forEach((t) => nuevo.push(t));
      f.tasks = nuevo;
      markMutated();
      return { ok: true, mensaje: `Tareas reordenadas en "${f.name}".` };
    },

    crear_paso({ tarea_id, descripcion, posicion }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) found.task.steps = [];
      const txt = String(descripcion || '').trim();
      if (!txt) return { ok: false, error: 'Descripción vacía' };
      let pos = posicion === null || posicion === undefined ? found.task.steps.length : Number(posicion);
      pos = Math.max(0, Math.min(found.task.steps.length, pos));
      found.task.steps.splice(pos, 0, txt);
      if (found.task.hasCustomStepTimes && Array.isArray(found.task.stepTimes)) {
        found.task.stepTimes.splice(pos, 0, 0);
      } else {
        recalcStepTimes(found.task, true);
      }
      markMutated();
      return { ok: true, mensaje: `Paso "${txt}" agregado en posición ${pos}.` };
    },

    editar_paso({ tarea_id, paso_indice, nueva_descripcion }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const i = Number(paso_indice);
      if (!Number.isInteger(i) || i < 0 || i >= found.task.steps.length) {
        return { ok: false, error: `Índice inválido (debe ser entre 0 y ${found.task.steps.length - 1})` };
      }
      const antes = typeof found.task.steps[i] === 'string' ? found.task.steps[i] : (found.task.steps[i]?.text || '');
      found.task.steps[i] = String(nueva_descripcion).trim();
      markMutated();
      return { ok: true, mensaje: `Paso ${i} cambiado de "${antes}" a "${found.task.steps[i]}".` };
    },

    eliminar_paso({ tarea_id, paso_indice }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const i = Number(paso_indice);
      if (!Number.isInteger(i) || i < 0 || i >= found.task.steps.length) {
        return { ok: false, error: `Índice inválido` };
      }
      const [removed] = found.task.steps.splice(i, 1);
      recalcStepTimes(found.task);
      markMutated();
      return { ok: true, mensaje: `Paso "${typeof removed === 'string' ? removed : removed?.text}" eliminado.` };
    },

    mover_paso({ tarea_id, paso_indice_actual, nueva_posicion }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const desde = Number(paso_indice_actual);
      const hasta = Number(nueva_posicion);
      if (!Number.isInteger(desde) || desde < 0 || desde >= found.task.steps.length) return { ok: false, error: 'Índice actual inválido' };
      if (!Number.isInteger(hasta) || hasta < 0 || hasta >= found.task.steps.length) return { ok: false, error: 'Nueva posición inválida' };
      const [item] = found.task.steps.splice(desde, 1);
      found.task.steps.splice(hasta, 0, item);
      markMutated();
      return { ok: true, mensaje: `Paso movido de posición ${desde} a ${hasta}.` };
    },

    crear_recompensa({ nombre, tiempo_minutos }: any) {
      if (!nombre || !String(nombre).trim()) return { ok: false, error: 'Nombre vacío' };
      const rewardsFolder = state.folders.find((x) => x.isDefaultRewards);
      if (!rewardsFolder) return { ok: false, error: 'No existe la carpeta Recompensas' };
      const r = {
        id: genId(),
        name: String(nombre).trim(),
        steps: [],
        isExpanded: false,
        scheduledTimestamp: null,
        isReward: true,
        currentStepIndex: 0,
        rewardTime: tiempo_minutos && Number(tiempo_minutos) > 0 ? Number(tiempo_minutos) : null,
      };
      if (!Array.isArray(rewardsFolder.tasks)) rewardsFolder.tasks = [];
      rewardsFolder.tasks.unshift(r);
      markMutated();
      return { ok: true, mensaje: `Recompensa "${r.name}" creada.` };
    },

    eliminar_recompensa({ recompensa_id }: any) {
      const rewardsFolder = state.folders.find((x) => x.isDefaultRewards);
      if (!rewardsFolder) return { ok: false, error: 'No existe la carpeta Recompensas' };
      const idx = (rewardsFolder.tasks || []).findIndex((t: any) => t.id === recompensa_id);
      if (idx === -1) return { ok: false, error: 'Recompensa no encontrada' };
      const nombre = rewardsFolder.tasks[idx].name;
      rewardsFolder.tasks.splice(idx, 1);
      markMutated();
      return { ok: true, mensaje: `Recompensa "${nombre}" eliminada.` };
    },

    marcar_tarea_completada({ tarea_id }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (found.isFinished) return { ok: true, mensaje: `La tarea "${found.task.name}" ya estaba completada.` };
      moveTaskToFinishedLocal(found.folder, found.task);
      return { ok: true, mensaje: `Tarea "${found.task.name}" marcada como completada ✔️.` };
    },

    desmarcar_tarea({ tarea_id }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!found.isFinished) return { ok: true, mensaje: `La tarea "${found.task.name}" no está completada.` };
      found.folder.finished = (found.folder.finished || []).filter((x: any) => x.id !== tarea_id);
      if (!Array.isArray(found.folder.tasks)) found.folder.tasks = [];
      found.folder.tasks.unshift(found.task);
      markMutated();
      return { ok: true, mensaje: `Tarea "${found.task.name}" devuelta a pendientes.` };
    },

    completar_paso({ tarea_id, paso_indice, completado }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const steps = found.task.steps || [];
      const idx = Number(paso_indice);
      if (isNaN(idx) || idx < 0 || idx >= steps.length) return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
      const isDone = completado !== undefined ? !!completado : true;
      if (typeof steps[idx] === 'object' && steps[idx] !== null) {
        steps[idx].completed = isDone;
      } else if (isDone) {
        found.task.currentStepIndex = Math.max(found.task.currentStepIndex || 0, idx + 1);
      }
      markMutated();
      return { ok: true, mensaje: `Paso ${idx + 1} ${isDone ? 'marcado como completado ✔️' : 'desmarcado'}.` };
    },

    aplicar_plantilla({ nombre_plantilla, carpeta_destino_id }: any) {
      const plantillas: Record<string, any> = {
        gimnasio: {
          nombre: '🏋️ Rutina de Gimnasio (Push / Pull / Legs)',
          tareas: [
            { nombre: 'Día 1: Pecho, Hombros y Tríceps', tiempo: 60, pasos: ['Calentamiento manguito rotador', 'Press de Banca Plano 4x10', 'Press Inclinado con Mancuernas 3x12', 'Press Militar Hombro 4x10', 'Elevaciones Laterales 4x15', 'Extensión de Tríceps Polea 4x12'] },
            { nombre: 'Día 2: Espalda y Bíceps', tiempo: 60, pasos: ['Dominadas o Jalón al Pecho 4x10', 'Remo con Barra 4x10', 'Remo Gironda 3x12', 'Curl de Bíceps con Barra 4x12', 'Curl Martillo 3x15'] },
            { nombre: 'Día 3: Pierna Completa', tiempo: 60, pasos: ['Sentadilla Libre 4x10', 'Prensa de Piernas 4x12', 'Peso Muerto Rumano 4x10', 'Extensión de Cuádriceps 3x15', 'Elevación de Gemelos 4x20'] },
          ],
        },
        estudio: {
          nombre: '📚 Plan de Estudio e Investigación',
          tareas: [
            { nombre: 'Bloque 1: Lectura y Resumen', tiempo: 45, pasos: ['Lectura rápida del capítulo', 'Anotación de conceptos clave', 'Elaboración de mapa mental'] },
            { nombre: 'Bloque 2: Resolución de Ejercicios', tiempo: 50, pasos: ['Resolver guía práctica', 'Revisar respuestas con solución', 'Anotar dudas frecuentes'] },
            { nombre: 'Bloque 3: Repaso Spaced Repetition', tiempo: 30, pasos: ['Repaso de flashcards', 'Autoevaluación en voz alta'] },
          ],
        },
        sprint: {
          nombre: '💻 Sprint de Desarrollo de Software',
          tareas: [
            { nombre: 'Planificación de Feature', tiempo: 30, pasos: ['Revisar requerimientos', 'Diseñar arquitectura / BD', 'Desglosar sub-tareas'] },
            { nombre: 'Codificación y Tests Unitarios', tiempo: 90, pasos: ['Escribir lógica principal', 'Escribir tests unitarios', 'Refactorizar código'] },
            { nombre: 'Code Review y Deployment', tiempo: 30, pasos: ['Revisar diff de Git', 'Ejecutar build local', 'Desplegar a producción'] },
          ],
        },
        matutina: {
          nombre: '☀️ Rutina Matutina de Alta Productividad',
          tareas: [
            { nombre: 'Activación Física y Mente', tiempo: 20, pasos: ['Hidratación (500ml agua)', 'Estiramientos / Calistenia 10 min', 'Meditación o respiración 5 min'] },
            { nombre: 'Planificación del Día', tiempo: 15, pasos: ['Revisar agenda y prioridades', 'Seleccionar las 3 tareas clave del día'] },
          ],
        },
      };
      const key = String(nombre_plantilla || '').toLowerCase();
      let targetP = plantillas.gimnasio;
      for (const k of Object.keys(plantillas)) {
        if (key.includes(k) || plantillas[k].nombre.toLowerCase().includes(key)) {
          targetP = plantillas[k];
          break;
        }
      }
      let folder = findFolder(carpeta_destino_id);
      if (!folder) {
        folder = { id: genId(), name: targetP.nombre, tasks: [], finished: [], isDefaultRewards: false };
        state.folders.push(folder);
      }
      targetP.tareas.forEach((tData: any) => {
        const task: any = {
          id: genId(),
          name: tData.nombre,
          steps: tData.pasos || [],
          totalTime: tData.tiempo ? tData.tiempo * 60 : null,
          stepTimes: [],
          currentStepIndex: 0,
        };
        recalcStepTimes(task, true);
        folder.tasks.push(task);
      });
      markMutated();
      return { ok: true, mensaje: `Plantilla "${targetP.nombre}" aplicada (${targetP.tareas.length} tareas).` };
    },

    duplicar_tarea({ tarea_id, carpeta_destino_id }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const targetFolder = findFolder(carpeta_destino_id) || found.folder;
      const clone = JSON.parse(JSON.stringify(found.task));
      clone.id = genId();
      clone.name = clone.name + ' (Copia)';
      targetFolder.tasks.push(clone);
      markMutated();
      return { ok: true, mensaje: `Tarea "${found.task.name}" duplicada en "${targetFolder.name}".`, nueva_tarea_id: clone.id };
    },

    duplicar_carpeta({ carpeta_id, nuevo_nombre }: any) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      const clone = JSON.parse(JSON.stringify(f));
      clone.id = genId();
      clone.name = nuevo_nombre && String(nuevo_nombre).trim() ? String(nuevo_nombre).trim() : f.name + ' (Copia)';
      (clone.tasks || []).forEach((t: any) => { t.id = genId(); });
      (clone.finished || []).forEach((t: any) => { t.id = genId(); });
      state.folders.push(clone);
      markMutated();
      return { ok: true, mensaje: `Carpeta "${f.name}" duplicada como "${clone.name}".`, nueva_carpeta_id: clone.id };
    },

    obtener_papelera() {
      return {
        ok: true,
        cantidad: state.trash.length,
        elementos: state.trash.map((t: any) => ({
          id: t.id,
          tipo: t.type || 'elemento',
          nombre: t.name || (t.data ? t.data.name : 'Elemento'),
          fecha_eliminado: t.deletedAt ? new Date(t.deletedAt).toISOString() : 'Reciente',
        })),
      };
    },

    restaurar_elemento({ id }: any) {
      const idx = state.trash.findIndex((t: any) => t.id === id);
      if (idx === -1) return { ok: false, error: 'Elemento no encontrado en papelera' };
      const [item] = state.trash.splice(idx, 1);
      if (item.type === 'folder' && item.data) {
        state.folders.push(item.data);
      } else if (item.data) {
        const dest = findFolder(item.folderId) || state.folders.find((f) => !f.isDefaultRewards);
        if (dest) {
          if (item.wasFinished) dest.finished.push(item.data);
          else dest.tasks.push(item.data);
        }
      }
      markMutated();
      return { ok: true, mensaje: 'Elemento restaurado desde la papelera.' };
    },

    vaciar_papelera() {
      state.trash = [];
      markMutated();
      return { ok: true, mensaje: 'La papelera ha sido vaciada permanentemente.' };
    },

    asignar_prioridad({ tarea_id, prioridad }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const p = String(prioridad || '').toLowerCase();
      if (!['alta', 'media', 'baja', 'ninguna'].includes(p)) return { ok: false, error: 'Prioridad no válida' };
      found.task.priority = p === 'ninguna' ? null : p;
      markMutated();
      return { ok: true, mensaje: `Prioridad "${p}" asignada a "${found.task.name}".` };
    },

    asignar_fecha_vencimiento({ tarea_id, fecha_iso }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.dueDate = fecha_iso || null;
      markMutated();
      return { ok: true, mensaje: `Fecha "${fecha_iso || 'sin fecha'}" asignada a "${found.task.name}".` };
    },

    buscar_elementos({ criterio }: any) {
      if (!criterio || !String(criterio).trim()) return { ok: false, error: 'Criterio vacío' };
      const q = String(criterio).trim().toLowerCase();
      const resultados: any[] = [];
      state.folders.forEach((f) => {
        if (String(f.name || '').toLowerCase().includes(q)) resultados.push({ tipo: 'carpeta', id: f.id, nombre: f.name });
        (f.tasks || []).forEach((t: any) => {
          if (String(t.name || '').toLowerCase().includes(q) || (t.priority && t.priority.includes(q))) {
            resultados.push({ tipo: 'tarea_pendiente', id: t.id, nombre: t.name, carpeta: f.name, prioridad: t.priority });
          }
        });
        (f.finished || []).forEach((t: any) => {
          if (String(t.name || '').toLowerCase().includes(q)) {
            resultados.push({ tipo: 'tarea_completada', id: t.id, nombre: t.name, carpeta: f.name });
          }
        });
      });
      return { ok: true, total: resultados.length, resultados };
    },

    obtener_reporte_productividad({ carpeta_id }: any) {
      let targetFolders = state.folders;
      if (carpeta_id) {
        const f = findFolder(carpeta_id);
        if (f) targetFolders = [f];
      }
      let totPendientes = 0;
      let totCompletadas = 0;
      let totTiempoMinutos = 0;
      targetFolders.forEach((f) => {
        totPendientes += (f.tasks || []).length;
        totCompletadas += (f.finished || []).length;
        (f.tasks || []).forEach((t: any) => { if (t.totalTime) totTiempoMinutos += Math.round(t.totalTime / 60); });
        (f.finished || []).forEach((t: any) => { if (t.totalTime) totTiempoMinutos += Math.round(t.totalTime / 60); });
      });
      const totalTareas = totPendientes + totCompletadas;
      const pct = totalTareas > 0 ? Math.round((totCompletadas / totalTareas) * 100) : 0;
      return {
        ok: true,
        carpetas_analizadas: targetFolders.length,
        tareas_pendientes: totPendientes,
        tareas_completadas: totCompletadas,
        porcentaje_cumplimiento: `${pct}%`,
        tiempo_estimado_total: `${totTiempoMinutos} minutos (${(totTiempoMinutos / 60).toFixed(1)} hrs)`,
      };
    },

    ejecutar_accion_en_lote({ filtro, accion, parametros_accion }: any) {
      const f = filtro || {};
      const params = parametros_accion || {};
      const afectadas: Array<{ folder: any; task: any }> = [];
      state.folders.forEach((folder) => {
        if (f.carpeta_id && folder.id !== f.carpeta_id) return;
        (folder.tasks || []).forEach((t: any) => {
          if (f.prioridad && t.priority !== f.prioridad) return;
          if (f.nombre_contiene && !String(t.name || '').toLowerCase().includes(String(f.nombre_contiene).toLowerCase())) return;
          if (f.etiqueta && (!Array.isArray(t.tags) || !t.tags.some((tag: string) => tag.toLowerCase() === String(f.etiqueta).toLowerCase()))) return;
          if (Array.isArray(f.tarea_ids) && f.tarea_ids.length > 0 && !f.tarea_ids.includes(t.id)) return;
          afectadas.push({ folder, task: t });
        });
      });
      if (afectadas.length === 0) return { ok: true, mensaje: 'No se encontraron tareas que coincidan con los filtros.', afectadas: 0 };
      afectadas.forEach((item) => {
        if (accion === 'marcar_completada') moveTaskToFinishedLocal(item.folder, item.task);
        else if (accion === 'eliminar') moveTaskToTrashLocal(item.folder, item.task.id, false);
        else if (accion === 'cambiar_prioridad') { item.task.priority = params.nueva_prioridad || 'alta'; markMutated(); }
        else if (accion === 'cambiar_color') { item.task.color = params.nuevo_color || '#4CAF50'; markMutated(); }
        else if (accion === 'asignar_fecha') { item.task.dueDate = params.fecha_iso || null; markMutated(); }
        else if (accion === 'asignar_etiquetas') { item.task.tags = Array.isArray(params.etiquetas) ? params.etiquetas : []; markMutated(); }
        else if (accion === 'mover' && params.carpeta_destino_id) {
          const destF = findFolder(params.carpeta_destino_id);
          if (destF) {
            item.folder.tasks = (item.folder.tasks || []).filter((x: any) => x.id !== item.task.id);
            destF.tasks.push(item.task);
            markMutated();
          }
        }
      });
      return { ok: true, mensaje: `Acción en lote "${accion}" ejecutada sobre ${afectadas.length} tareas.`, afectadas: afectadas.length };
    },

    registrar_tiempo_real({ tarea_id, minutos_reales, comentario }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const mins = Number(minutos_reales);
      if (isNaN(mins) || mins <= 0) return { ok: false, error: 'Minutos reales no válidos' };
      found.task.realTime = mins * 60;
      found.task.actualTimeMinutes = mins;
      found.task.timeComment = comentario || null;
      const estimMins = found.task.totalTime ? Math.round(found.task.totalTime / 60) : 0;
      const desvio = estimMins > 0 ? mins - estimMins : 0;
      markMutated();
      return {
        ok: true,
        mensaje: `Tiempo real de ${mins} min registrado en "${found.task.name}".`,
        tiempo_estimado_min: estimMins,
        tiempo_real_min: mins,
        desvio_minutos: desvio > 0 ? `+${desvio} min (exceso)` : desvio < 0 ? `${desvio} min (ahorro)` : 'Exacto',
      };
    },

    crear_regla_automatizacion({ evento, condicion, accion_automatica, parametros_accion }: any) {
      if (!evento || !accion_automatica) return { ok: false, error: 'Parámetros incompletos' };
      const rule = {
        id: genId(),
        activa: true,
        evento,
        condicion: condicion || {},
        accion_automatica,
        parametros_accion: parametros_accion || {},
      };
      state.automationRules.push(rule);
      markMutated();
      return { ok: true, mensaje: `Regla de automatización creada (ID: ${rule.id}).`, regla: rule };
    },

    listar_reglas_automatizacion() {
      return { ok: true, total: state.automationRules.length, reglas: state.automationRules };
    },

    actualizar_regla_automatizacion({ regla_id, activa, evento, condicion, accion_automatica, parametros_accion }: any) {
      const rule = state.automationRules.find((r) => r.id === regla_id);
      if (!rule) return { ok: false, error: 'Regla no encontrada' };
      if (activa !== undefined) rule.activa = !!activa;
      if (evento !== undefined) rule.evento = evento;
      if (condicion !== undefined) rule.condicion = condicion;
      if (accion_automatica !== undefined) rule.accion_automatica = accion_automatica;
      if (parametros_accion !== undefined) rule.parametros_accion = parametros_accion;
      markMutated();
      return { ok: true, mensaje: `Regla ${regla_id} actualizada.`, regla: rule };
    },

    eliminar_regla_automatizacion({ regla_id }: any) {
      const idx = state.automationRules.findIndex((r) => r.id === regla_id);
      if (idx === -1) return { ok: false, error: 'Regla no encontrada' };
      state.automationRules.splice(idx, 1);
      markMutated();
      return { ok: true, mensaje: 'Regla de automatización eliminada.' };
    },

    guardar_plantilla_usuario({ plantilla_id, tarea_id, nombre_plantilla, pasos, tiempo_minutos, tiempos_pasos_minutos, color, prioridad, formato_agradecimiento, alineacion_cuadridimensional }: any) {
      if (plantilla_id) {
        const existing = state.userTemplates.find((t) => t.id === plantilla_id);
        if (!existing) return { ok: false, error: 'Plantilla no encontrada' };
        if (nombre_plantilla !== undefined) existing.name = String(nombre_plantilla).trim() || existing.name;
        if (Array.isArray(pasos)) existing.steps = pasos.map((s: any) => String(s));
        if (Array.isArray(tiempos_pasos_minutos)) {
          existing.stepTimes = tiempos_pasos_minutos.map((m: any) => Math.max(0, Math.round(Number(m || 0) * 60)));
          existing.hasCustomStepTimes = true;
          existing.totalTime = existing.stepTimes.reduce((a: number, b: number) => a + b, 0);
        } else if (tiempo_minutos !== undefined) {
          existing.totalTime = tiempo_minutos ? Math.round(Number(tiempo_minutos) * 60) : null;
        }
        if (color !== undefined) existing.color = color;
        if (prioridad !== undefined) existing.priority = prioridad;
        if (formato_agradecimiento !== undefined) existing.gratitudeFormat = formato_agradecimiento;
        if (alineacion_cuadridimensional !== undefined) existing.dimensions = alineacion_cuadridimensional;
        markMutated();
        return { ok: true, mensaje: `Plantilla "${existing.name}" actualizada.`, plantilla: existing };
      }

      let baseTask: any = null;
      if (tarea_id) {
        const found = findTask(tarea_id);
        if (!found) return { ok: false, error: 'Tarea no encontrada' };
        baseTask = found.task;
      } else {
        if (!nombre_plantilla) return { ok: false, error: 'Indica nombre_plantilla o tarea_id' };
        const stepArr = Array.isArray(pasos) ? pasos.map((s: any) => String(s)) : [];
        const stepTimesSec = Array.isArray(tiempos_pasos_minutos)
          ? stepArr.map((_, i) => Math.max(0, Math.round(Number(tiempos_pasos_minutos[i] || 0) * 60)))
          : [];
        const totalSec = stepTimesSec.length > 0
          ? stepTimesSec.reduce((a, b) => a + b, 0)
          : (tiempo_minutos ? Math.round(Number(tiempo_minutos) * 60) : null);
        baseTask = {
          name: nombre_plantilla,
          steps: stepArr,
          totalTime: totalSec,
          stepTimes: stepTimesSec,
          hasCustomStepTimes: stepTimesSec.length > 0,
          color: color || null,
          priority: prioridad || null,
        };
      }

      const tpl = {
        id: genId('_tpl_'),
        name: nombre_plantilla && String(nombre_plantilla).trim() ? String(nombre_plantilla).trim() : (baseTask.name || 'Plantilla'),
        steps: Array.isArray(baseTask.steps) ? [...baseTask.steps] : [],
        totalTime: baseTask.totalTime || null,
        stepTimes: Array.isArray(baseTask.stepTimes) ? [...baseTask.stepTimes] : [],
        hasCustomStepTimes: !!baseTask.hasCustomStepTimes,
        color: baseTask.color || null,
        priority: baseTask.priority || null,
        gratitudeFormat: formato_agradecimiento !== undefined ? formato_agradecimiento : (baseTask.gratitudeFormat || ''),
        dimensions: alineacion_cuadridimensional || baseTask.dimensions || { cuerpo: '', mente: '', emociones: '', espiritu: '' },
        createdAt: Date.now(),
      };
      state.userTemplates.unshift(tpl);
      markMutated();
      return { ok: true, mensaje: `Plantilla "${tpl.name}" guardada (ID: ${tpl.id}).`, plantilla: tpl };
    },

    listar_plantillas_usuario() {
      return { ok: true, total: state.userTemplates.length, plantillas: state.userTemplates };
    },

    aplicar_plantilla_usuario({ plantilla_id, carpeta_destino_id, nombre_personalizado, fecha_iso, posicion }: any) {
      const tpl = state.userTemplates.find((t) => t.id === plantilla_id);
      if (!tpl) return { ok: false, error: 'Plantilla no encontrada' };
      const folder = findFolder(carpeta_destino_id || state.currentFolderId) || state.folders.find((f) => !f.isDefaultRewards);
      if (!folder) return { ok: false, error: 'Carpeta destino inválida' };
      const task: any = {
        id: genId(),
        name: nombre_personalizado ? String(nombre_personalizado).trim() : tpl.name,
        steps: Array.isArray(tpl.steps) ? [...tpl.steps] : [],
        totalTime: tpl.totalTime || null,
        stepTimes: Array.isArray(tpl.stepTimes) ? [...tpl.stepTimes] : [],
        hasCustomStepTimes: !!tpl.hasCustomStepTimes,
        color: tpl.color || undefined,
        priority: tpl.priority || null,
        dueDate: fecha_iso || null,
        currentStepIndex: 0,
        isExpanded: false,
      };
      if (posicion !== undefined && posicion !== null && !isNaN(Number(posicion))) {
        folder.tasks.splice(Math.max(0, Math.min(folder.tasks.length, Number(posicion))), 0, task);
      } else {
        folder.tasks.push(task);
      }
      markMutated();
      return { ok: true, mensaje: `Plantilla "${task.name}" aplicada con éxito.`, tarea_id: task.id };
    },

    eliminar_plantilla_usuario({ plantilla_id }: any) {
      state.userTemplates = state.userTemplates.filter((t) => t.id !== plantilla_id);
      markMutated();
      return { ok: true, mensaje: 'Plantilla eliminada.' };
    },

    editar_nota({ nota_id, titulo, contenido, etiquetas, carpeta_id, tarea_id }: any) {
      const note = state.notes.find((n) => n.id === nota_id);
      if (!note) return { ok: false, error: 'Nota no encontrada' };
      if (titulo !== undefined) note.title = String(titulo).trim() || note.title;
      if (contenido !== undefined) note.content = String(contenido);
      if (Array.isArray(etiquetas)) note.tags = etiquetas.map((x: any) => String(x));
      if (carpeta_id !== undefined) note.folderId = carpeta_id;
      if (tarea_id !== undefined) note.taskId = tarea_id;
      note.updatedAt = Date.now();
      markMutated();
      return { ok: true, mensaje: `Nota "${note.title}" actualizada.`, nota: note };
    },

    crear_nota({ titulo, contenido, carpeta_id, tarea_id, etiquetas }: any) {
      const note = {
        id: genId(),
        title: String(titulo || 'Sin título'),
        content: String(contenido || ''),
        folderId: carpeta_id || state.currentFolderId || null,
        taskId: tarea_id || null,
        tags: Array.isArray(etiquetas) ? etiquetas : [],
        createdAt: Date.now(),
      };
      state.notes.push(note);
      markMutated();
      return { ok: true, mensaje: `Nota "${note.title}" creada con éxito.`, nota_id: note.id };
    },

    listar_notas({ carpeta_id, tarea_id }: any) {
      const res = state.notes.filter((n) => {
        if (carpeta_id && n.folderId !== carpeta_id) return false;
        if (tarea_id && n.taskId !== tarea_id) return false;
        return true;
      });
      return { ok: true, total: res.length, notas: res };
    },

    eliminar_nota({ nota_id }: any) {
      const idx = state.notes.findIndex((n) => n.id === nota_id);
      if (idx === -1) return { ok: false, error: 'Nota no encontrada' };
      const title = state.notes[idx].title;
      state.notes.splice(idx, 1);
      markMutated();
      return { ok: true, mensaje: `Nota "${title}" eliminada.` };
    },

    asignar_color_nota({ nota_id, color }: any) {
      const note = state.notes.find((n) => n.id === nota_id);
      if (!note) return { ok: false, error: 'Nota no encontrada' };
      note.color = color || null;
      markMutated();
      return { ok: true, mensaje: `Color "${color}" asignado a la nota "${note.title}".` };
    },

    asignar_etiquetas_tarea({ tarea_id, etiquetas }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.tags = Array.isArray(etiquetas) ? etiquetas : [];
      markMutated();
      return { ok: true, mensaje: `Etiquetas [${(etiquetas || []).join(', ')}] asignadas a "${found.task.name}".` };
    },

    filtrar_por_etiqueta({ etiqueta }: any) {
      if (!etiqueta) return { ok: false, error: 'Etiqueta vacía' };
      const q = String(etiqueta).trim().toLowerCase();
      const resultados: any[] = [];
      state.folders.forEach((f) => {
        (f.tasks || []).forEach((t: any) => {
          if (Array.isArray(t.tags) && t.tags.some((tag: string) => tag.toLowerCase().includes(q))) {
            resultados.push({ id: t.id, nombre: t.name, carpeta: f.name, etiquetas: t.tags });
          }
        });
      });
      return { ok: true, total: resultados.length, resultados };
    },

    desglosar_tarea_inteligente({ tarea_id, max_pasos }: any) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const t = found.task;
      const num = max_pasos || 4;
      const pasosSugeridos = [
        `Paso 1: Definir requerimientos y alcance de "${t.name}" (10 min)`,
        `Paso 2: Recopilar recursos e información (15 min)`,
        `Paso 3: Ejecutar la fase principal de producción (25 min)`,
        `Paso 4: Revisar control de calidad y cerrar tarea (10 min)`,
      ].slice(0, num);
      if (!Array.isArray(t.steps)) t.steps = [];
      t.steps.push(...pasosSugeridos);
      markMutated();
      return { ok: true, mensaje: `Tarea "${t.name}" desglosada en ${pasosSugeridos.length} pasos.`, pasos: pasosSugeridos };
    },

    generar_bloques_tiempo({ hora_inicio, duracion_descanso_min, carpeta_id, aplicar_como_reglas }: any) {
      let targetFolders = state.folders;
      if (carpeta_id) {
        const f = findFolder(carpeta_id);
        if (f) targetFolders = [f];
      }
      const allTasks: any[] = [];
      targetFolders.forEach((f) => (f.tasks || []).forEach((t: any) => allTasks.push(t)));
      if (allTasks.length === 0) return { ok: false, error: 'No hay tareas pendientes para agendar.' };

      let currentMin = 9 * 60;
      if (hora_inicio && String(hora_inicio).includes(':')) {
        const [h, m] = String(hora_inicio).split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) currentMin = h * 60 + m;
      }
      const descanso = Number(duracion_descanso_min) || 5;
      const itinerario: any[] = [];
      allTasks.forEach((t) => {
        const dur = t.totalTime ? Math.round(t.totalTime / 60) : 30;
        const startStr = `${String(Math.floor(currentMin / 60)).padStart(2, '0')}:${String(currentMin % 60).padStart(2, '0')}`;
        const endMin = currentMin + dur;
        const endStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
        itinerario.push({ tarea_id: t.id, tarea: t.name, horario: `${startStr} - ${endStr}`, duracion: `${dur} min` });
        if (aplicar_como_reglas && !t.isReward && Array.isArray(t.steps) && t.steps.length > 0) {
          const existing = state.automationRules.find((r) => r.evento === 'hora_programada' && r.parametros_accion?.tarea_id === t.id);
          if (existing) {
            existing.condicion = { hora: startStr };
            existing.activa = true;
          } else {
            state.automationRules.push({
              id: genId(),
              activa: true,
              evento: 'hora_programada',
              condicion: { hora: startStr },
              accion_automatica: 'iniciar_presentacion_tarea',
              parametros_accion: { tarea_id: t.id },
            });
          }
          markMutated();
        }
        currentMin = endMin + descanso;
      });
      return { ok: true, total_tareas_agendadas: itinerario.length, itinerario, reglas_programadas: !!aplicar_como_reglas };
    },

    obtener_estadisticas_gamificacion() {
      const stats = state.userStats || { xp_total: 0, nivel: 1, racha_dias_consecutivos: 1 };
      return {
        ok: true,
        xp_total: stats.xp_total,
        nivel: stats.nivel,
        racha_dias_consecutivos: `${stats.racha_dias_consecutivos} días`,
        proximo_nivel_xp: `${(stats.nivel * 250) - stats.xp_total} XP faltantes`,
      };
    },

    guardar_memoria_usuario({ categoria, clave, valor, es_nucleo }: any) {
      const cat = String(categoria || 'preferencias').trim();
      const k = String(clave || '').trim();
      const v = String(valor || '').trim();
      const isCore = es_nucleo !== undefined ? !!es_nucleo : (cat === 'preferencias' || cat === 'energia_horarios' || cat === 'cuadridimensional');
      if (!k || !v) return { ok: false, error: 'clave y valor son obligatorios' };
      const existing = state.agentMemory.find((m) => m.categoria === cat && m.clave === k);
      if (existing) {
        existing.valor = v;
        existing.es_nucleo = isCore;
        existing.updatedAt = new Date().toISOString();
      } else {
        state.agentMemory.unshift({
          id: genId('_mem_'),
          categoria: cat,
          clave: k,
          valor: v,
          es_nucleo: isCore,
          updatedAt: new Date().toISOString(),
        });
      }
      markMutated();
      return { ok: true, mensaje: `Memoria guardada [${cat}/${k}] (${isCore ? 'Capa 1 Núcleo' : 'Capa 2 Archivo'}).`, total_memorias: state.agentMemory.length };
    },

    buscar_memoria_relevante({ consulta, top_k }: any) {
      const q = String(consulta || '').toLowerCase().trim();
      const k = Math.max(1, Math.min(15, Number(top_k) || 5));
      if (!q) return { ok: true, recuerdos: state.agentMemory.slice(0, k) };
      const terms = q.split(/\s+/).filter(Boolean);
      const scored = state.agentMemory.map((m) => {
        const hay = `${m.categoria} ${m.clave} ${m.valor}`.toLowerCase();
        let score = 0;
        terms.forEach((t) => { if (hay.includes(t)) score += m.clave.toLowerCase().includes(t) ? 3 : 1; });
        return { item: m, score };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      return { ok: true, consulta: q, total_coincidencias: scored.length, recuerdos: scored.slice(0, k).map((x) => x.item) };
    },

    consultar_memoria_usuario({ categoria }: any) {
      const filtered = categoria ? state.agentMemory.filter((m) => m.categoria === categoria) : state.agentMemory;
      return { ok: true, total: filtered.length, memorias: filtered };
    },

    eliminar_memoria_usuario({ memoria_id, clave }: any) {
      const before = state.agentMemory.length;
      state.agentMemory = state.agentMemory.filter((m) => (memoria_id ? m.id !== memoria_id : true) && (clave ? m.clave !== clave : true));
      markMutated();
      return { ok: true, mensaje: `Eliminadas ${before - state.agentMemory.length} memorias.` };
    },

    obtener_contexto_vivo() {
      const proximos = (state.automationRules || [])
        .filter((r) => r.activa !== false && r.evento === 'hora_programada' && r.condicion?.hora)
        .slice(0, 5)
        .map((r) => {
          const tid = r.parametros_accion?.tarea_id || null;
          const resolved = tid ? findTask(tid) : null;
          const nombre = r.parametros_accion?.nombre || resolved?.task?.name || tid || '';
          return tid ? { hora: r.condicion.hora, accion: r.accion_automatica, tarea_id: tid, nombre } : { hora: r.condicion.hora, accion: r.accion_automatica, nombre };
        });
      return {
        ok: true,
        ahora_local: state.localNow,
        zona_horaria: state.timezone,
        presentacion_activa: state.activePresentation || null,
        proximos_bloques: proximos,
      };
    },

    recalcular_agenda_dia({ minutos_retraso, hora_desde }: any) {
      const delta = Number(minutos_retraso);
      if (isNaN(delta) || delta === 0) return { ok: false, error: 'minutos_retraso debe ser distinto de 0' };
      let fromMin = 0;
      if (hora_desde && String(hora_desde).includes(':')) {
        const [hh, mm] = String(hora_desde).split(':').map(Number);
        if (!isNaN(hh) && !isNaN(mm)) fromMin = hh * 60 + mm;
      } else if (state.localNow) {
        const match = String(state.localNow).match(/(\d{2}):(\d{2})/);
        if (match) fromMin = Number(match[1]) * 60 + Number(match[2]);
      }
      const ajustadas: any[] = [];
      state.automationRules.forEach((rule) => {
        if (rule.activa === false || rule.evento !== 'hora_programada' || !rule.condicion?.hora) return;
        const [h, m] = String(rule.condicion.hora).split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return;
        const totalMin = h * 60 + m;
        if (totalMin >= fromMin) {
          const nuevoMin = Math.max(0, Math.min(23 * 60 + 59, totalMin + delta));
          const nuevaHora = `${String(Math.floor(nuevoMin / 60)).padStart(2, '0')}:${String(nuevoMin % 60).padStart(2, '0')}`;
          const anterior = rule.condicion.hora;
          rule.condicion.hora = nuevaHora;
          ajustadas.push({ regla_id: rule.id, antes: anterior, ahora: nuevaHora, accion: rule.accion_automatica });
        }
      });
      if (ajustadas.length > 0) markMutated();
      return {
        ok: true,
        mensaje: ajustadas.length > 0
          ? `Agenda recalculada (${delta > 0 ? '+' : ''}${delta} min) en ${ajustadas.length} reglas.`
          : 'No había reglas hora_programada pendientes desde esa hora.',
        ajustadas,
      };
    },

    analizar_patrones_rendimiento() {
      const delays: any[] = [];
      const desviaciones: any[] = [];
      const motivosCount: Record<string, number> = {};
      state.folders.forEach((f) => {
        [...(f.tasks || []), ...(f.finished || [])].forEach((t: any) => {
          if (Array.isArray(t.delayLogs)) {
            t.delayLogs.forEach((d: any) => {
              delays.push({ carpeta: f.name, tarea: t.name, ...d });
              const m = String(d.motivo || 'Sin especificar').trim().toLowerCase();
              motivosCount[m] = (motivosCount[m] || 0) + 1;
            });
          }
          if (t.totalTime && t.actualTimeMinutes) {
            const est = Math.round((t.totalTime / 60) * 10) / 10;
            desviaciones.push({
              carpeta: f.name,
              tarea: t.name,
              estimado_min: est,
              real_min: t.actualTimeMinutes,
              diferencia_min: Math.round((t.actualTimeMinutes - est) * 10) / 10,
            });
          }
        });
      });
      const topMotivos = Object.entries(motivosCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([motivo, veces]) => ({ motivo, veces }));
      return {
        ok: true,
        total_retrasos_registrados: delays.length,
        top_motivos_retraso: topMotivos,
        ultimos_retrasos: delays.slice(-10),
        desviaciones_tiempo: desviaciones.slice(-10),
      };
    },

    async buscar_web({ consulta, guardar_en_nota_titulo, carpeta_id, tarea_id }: any) {
      const q = String(consulta || '').trim();
      if (!q) return { ok: false, error: 'Consulta vacía' };
      let texto = '';
      let fuente = '';

      try {
        const res = await fetch('https://s.jina.ai/' + encodeURIComponent(q), {
          headers: { Accept: 'text/plain' },
          signal: AbortSignal.timeout(14000),
        });
        if (res.ok) {
          const body = (await res.text()).trim();
          if (body.length > 40) { texto = body.slice(0, 5000); fuente = 'jina_search'; }
        }
      } catch (_) {}

      if (!texto && aiConfig.apiKey) {
        try {
          const baseModel = aiConfig.model.replace(/:free$/i, '').replace(/:online$/i, '');
          const res = await fetch(aiConfig.baseUrl, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + aiConfig.apiKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://russellralt.github.io/efectiva-app/',
              'X-Title': 'Efectiva Cloud Agent',
            },
            body: JSON.stringify({
              model: baseModel + ':online',
              messages: [{ role: 'user', content: `Busca información actualizada y precisa en la web sobre: "${q}". Incluye datos concretos y URLs.` }],
              temperature: 0.2,
              max_tokens: 1400,
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (res.ok) {
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (content) { texto = String(content); fuente = 'openrouter:online'; }
          }
        } catch (_) {}
      }

      if (!texto) {
        for (const lang of ['es', 'en']) {
          try {
            const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=4`);
            if (r.ok) {
              const j = await r.json();
              const hits = (j?.query?.search || []).map((h: any) =>
                `- **${h.title}**: ${String(h.snippet || '').replace(/<[^>]+>/g, '')} (https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))})`,
              );
              if (hits.length > 0) { texto = hits.join('\n'); fuente = 'wikipedia_' + lang; break; }
            }
          } catch (_) {}
        }
      }

      if (!texto) return { ok: false, error: 'No se pudo obtener resultados web.' };
      let notaCreada = false;
      if (guardar_en_nota_titulo) {
        const resNota = executors.crear_nota({
          titulo: guardar_en_nota_titulo,
          contenido: texto,
          carpeta_id: carpeta_id || null,
          tarea_id: tarea_id || null,
          etiquetas: ['investigacion', 'web'],
        });
        notaCreada = !!(resNota && resNota.ok);
      }
      return { ok: true, fuente, consulta: q, resumen: texto.slice(0, 4500), nota_guardada: notaCreada };
    },

    async leer_url_web({ url, guardar_en_nota_titulo, carpeta_id, tarea_id }: any) {
      const targetUrl = String(url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, error: 'URL inválida' };
      try {
        const res = await fetch('https://r.jina.ai/' + targetUrl, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { ok: false, error: 'Jina Reader HTTP ' + res.status };
        const md = (await res.text()).slice(0, 6000);
        let notaCreada = false;
        if (guardar_en_nota_titulo) {
          const resNota = executors.crear_nota({
            titulo: guardar_en_nota_titulo,
            contenido: `Fuente: ${targetUrl}\n\n${md}`,
            carpeta_id: carpeta_id || null,
            tarea_id: tarea_id || null,
            etiquetas: ['lectura-web'],
          });
          notaCreada = !!(resNota && resNota.ok);
        }
        return { ok: true, url: targetUrl, contenido_markdown: md, nota_guardada: notaCreada };
      } catch (e: any) {
        return { ok: false, error: 'Error leyendo URL: ' + (e?.message || String(e)) };
      }
    },

    // --- LAZY LOADING & NOTAS GRANULARES (v34+) ---
    obtener_carpeta({ carpeta_id, incluir_completadas = false, incluir_pasos = false }: any = {}) {
      const f = state.folders.find((x: any) => x.id === carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada.' };
      const mapT = (t: any) => ({
        id: t.id, nombre: t.name, prioridad: t.priority || null,
        fecha_vencimiento: t.dueDate || null, etiquetas: t.tags || [],
        tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 100) / 100 : null,
        cantidad_pasos: (t.steps || []).length,
        ...(incluir_pasos ? { pasos: (t.steps || []).map((s: any, i: number) => ({ i, texto: s, min: t.stepTimes?.[i] ? Math.round((t.stepTimes[i] / 60) * 100) / 100 : null })) } : {})
      });
      return {
        ok: true, id: f.id, nombre: f.name,
        pendientes: (f.tasks || []).map(mapT),
        ...(incluir_completadas ? { finalizadas: (f.finished || []).map(mapT) } : { total_finalizadas: (f.finished || []).length })
      };
    },
    obtener_tarea({ tarea_id }: any = {}) {
      for (const f of state.folders) {
        for (const listName of ['tasks', 'finished']) {
          const t = (f[listName] || []).find((x: any) => x.id === tarea_id);
          if (t) {
            return {
              ok: true, carpeta_id: f.id, carpeta_nombre: f.name, finalizada: listName === 'finished',
              id: t.id, nombre: t.name, prioridad: t.priority || null, color: t.color || null,
              fecha_vencimiento: t.dueDate || null, etiquetas: t.tags || [],
              tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 100) / 100 : null,
              pasos: (t.steps || []).map((s: any, i: number) => ({ i, texto: s, min: t.stepTimes?.[i] ? Math.round((t.stepTimes[i] / 60) * 100) / 100 : null })),
              delayLogs: t.delayLogs || []
            };
          }
        }
      }
      return { ok: false, error: 'Tarea no encontrada.' };
    },
    leer_nota({ nota_id, titulo, max_chars = 6000 }: any = {}) {
      const n = nota_id
        ? state.notes.find((x: any) => x.id === nota_id)
        : state.notes.find((x: any) => String(x.title || '').toLowerCase().includes(String(titulo || '').toLowerCase()));
      if (!n) return { ok: false, error: 'Nota no encontrada.' };
      const c = String(n.content || '');
      return { ok: true, id: n.id, titulo: n.title, carpeta_id: n.folderId || null, etiquetas: n.tags || [], contenido: c.slice(0, max_chars), truncado: c.length > max_chars };
    },
    parchear_nota({ nota_id, operacion = 'append', texto = '', encabezado }: any = {}) {
      const n = state.notes.find((x: any) => x.id === nota_id);
      if (!n) return { ok: false, error: 'Nota no encontrada.' };
      const cur = String(n.content || '');
      if (operacion === 'prepend') n.content = String(texto) + (cur ? '\n' + cur : '');
      else if (operacion === 'reemplazar_seccion' && encabezado) {
        const re = new RegExp(`(^|\\n)(${String(encabezado).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?)(?=\\n#+\\s|$)`, 'i');
        n.content = re.test(cur) ? cur.replace(re, `$1${encabezado}\n${texto}`) : (cur + `\n\n${encabezado}\n${texto}`);
      } else {
        n.content = cur + (cur ? '\n' : '') + String(texto);
      }
      n.updatedAt = Date.now();
      mutated = true;
      return { ok: true, id: n.id, chars: n.content.length };
    },

    // --- MEMORIA POR NODOS Y GRADOS (v34+) ---
    cargar_nodo_memoria({ nodo, grado_maximo = 1 }: any = {}) {
      const k = String(nodo || '').toLowerCase();
      const items = (state.agentMemory || []).filter((m: any) => {
        const g = Number(m.grado ?? 1);
        const mn = String(m.nodo || m.categoria || 'general').toLowerCase();
        return g <= Number(grado_maximo) && (!k || mn === k || mn.includes(k));
      });
      return { ok: true, nodo: k, total: items.length, registros: items };
    },
    buscar_memoria_relevante({ query = '', limite = 12 }: any = {}) {
      const q = String(query || '').toLowerCase().trim();
      const hits = (state.agentMemory || []).filter((m: any) =>
        !q || JSON.stringify(m).toLowerCase().includes(q)
      ).slice(0, Number(limite) || 12);
      return { ok: true, total: hits.length, registros: hits };
    },

    // --- TABLAS GENÉRICAS LAZY LOADING (v36+) ---
    listar_tablas({ carpeta_id = null, incluir_filas = false }: any = {}) {
      const list = (state.tables || []).filter((t: any) => !carpeta_id || t.folderId === carpeta_id);
      return {
        ok: true, total: list.length,
        tablas: list.map((t: any) => ({
          id: t.id, title: t.title, folderId: t.folderId || null, columns: t.columns || [],
          rowCount: (t.rows || []).length, updatedAt: t.updatedAt || null,
          ...(incluir_filas ? { rows: t.rows || [] } : {})
        }))
      };
    },
    leer_tabla({ tabla_id, offset = 0, limit = 50, filtro = null }: any = {}) {
      const tbl = (state.tables || []).find((t: any) => t.id === tabla_id);
      if (!tbl) return { ok: false, error: 'Tabla no encontrada.' };
      let rows = tbl.rows || [];
      if (filtro) {
        const q = String(filtro).toLowerCase();
        rows = rows.filter((r: any) => Object.values(r.cells || {}).some((v: any) => String(v ?? '').toLowerCase().includes(q)));
      }
      const slice = rows.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 50));
      return { ok: true, id: tbl.id, title: tbl.title, columns: tbl.columns || [], total_filas: rows.length, rows: slice };
    },
    gestionar_tabla(args: any = {}) {
      if (!Array.isArray(state.tables)) state.tables = [];
      const accion = String(args.accion || 'crear').toLowerCase();
      if (accion === 'crear') {
        const cols = (Array.isArray(args.columnas || args.columns) ? (args.columnas || args.columns) : [{ name: 'Item', type: 'text' }])
          .map((c: any, i: number) => ({ id: c.id || ('col_' + (i + 1)), name: String(c.name || ('Col ' + (i + 1))), type: c.type || 'text', ...(c.options ? { options: c.options } : {}) }));
        const tbl = { id: '_tbl_' + Math.random().toString(36).slice(2, 9), title: String(args.titulo || args.title || 'Nueva Tabla'), folderId: args.carpeta_id || args.folderId || null, columns: cols, rows: [], updatedAt: Date.now() };
        state.tables.unshift(tbl);
        mutated = true;
        return { ok: true, tabla: { id: tbl.id, title: tbl.title, columns: tbl.columns, rowCount: 0 } };
      }
      const idx = state.tables.findIndex((t: any) => t.id === (args.tabla_id || args.id));
      if (idx === -1) return { ok: false, error: 'Tabla no encontrada.' };
      if (accion === 'eliminar') {
        state.tables.splice(idx, 1);
        mutated = true;
        return { ok: true, eliminada: args.tabla_id || args.id };
      }
      const tbl = state.tables[idx];
      if (args.titulo || args.title) tbl.title = String(args.titulo || args.title);
      if (Array.isArray(args.columnas || args.columns)) tbl.columns = args.columnas || args.columns;
      tbl.updatedAt = Date.now();
      mutated = true;
      return { ok: true, tabla: { id: tbl.id, title: tbl.title, columns: tbl.columns, rowCount: (tbl.rows || []).length } };
    },
    parchear_filas_tabla({ tabla_id, operaciones = [] }: any = {}) {
      const tbl = (state.tables || []).find((t: any) => t.id === tabla_id);
      if (!tbl) return { ok: false, error: 'Tabla no encontrada.' };
      if (!Array.isArray(tbl.rows)) tbl.rows = [];
      for (const op of (operaciones || [])) {
        const act = String(op.accion || 'agregar').toLowerCase();
        if (act === 'agregar') {
          const cells: Record<string, any> = {};
          for (const col of (tbl.columns || [])) {
            if (op.datos?.[col.id] !== undefined) cells[col.id] = op.datos[col.id];
            else if (op.datos?.[col.name] !== undefined) cells[col.id] = op.datos[col.name];
          }
          tbl.rows.push({ id: '_row_' + Math.random().toString(36).slice(2, 9), cells });
        } else if (act === 'actualizar') {
          const row = tbl.rows.find((r: any) => r.id === op.fila_id);
          if (row) {
            for (const col of (tbl.columns || [])) {
              if (op.datos?.[col.id] !== undefined) row.cells[col.id] = op.datos[col.id];
              else if (op.datos?.[col.name] !== undefined) row.cells[col.id] = op.datos[col.name];
            }
          }
        } else if (act === 'eliminar') {
          const ri = tbl.rows.findIndex((r: any) => r.id === op.fila_id);
          if (ri !== -1) tbl.rows.splice(ri, 1);
        }
      }
      tbl.updatedAt = Date.now();
      mutated = true;
      return { ok: true, total_filas: tbl.rows.length };
    },

    // --- MOTOR FINANCIERO ESTRUCTURADO EN LA NUBE (GTQ / USD EN CENTAVOS) ---
    fin_obtener_resumen() {
      const f = state.finance || { cuentas: [], movimientos: [], compromisos: [], inversiones: [], tipo_cambio_usd_gtq: 7.75 };
      const toVal = (c: number) => Math.round((Number(c) || 0)) / 100;
      const sumCents = (arr: any[]) => arr.reduce((a, x) => a + (Number(x.saldo_centavos) || 0), 0);
      const cuentas = f.cuentas || [];
      return {
        ok: true,
        liquidez_gtq: toVal(sumCents(cuentas.filter((c: any) => c.moneda === 'GTQ'))),
        liquidez_usd: toVal(sumCents(cuentas.filter((c: any) => c.moneda === 'USD'))),
        cuentas: cuentas.map((c: any) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, saldo: toVal(c.saldo_centavos) })),
        compromisos_activos: (f.compromisos || []).filter((d: any) => d.estado !== 'saldado').length,
        inversiones_activas: (f.inversiones || []).length,
        movimientos_totales: (f.movimientos || []).length
      };
    },
    fin_registrar_movimiento(args: any = {}) {
      if (!state.finance) state.finance = { version: 1, tipo_cambio_usd_gtq: 7.75, cuentas: [], movimientos: [], compromisos: [], inversiones: [] };
      const f = state.finance;
      const cents = Math.round((Number(args.monto) || 0) * 100);
      if (cents <= 0) return { ok: false, error: 'Monto inválido.' };
      const tipo = String(args.tipo || 'egreso').toLowerCase();
      const origen = (f.cuentas || []).find((c: any) => c.id === args.cuenta_origen_id || c.nombre === args.cuenta_origen_id);
      const destino = (f.cuentas || []).find((c: any) => c.id === args.cuenta_destino_id || c.nombre === args.cuenta_destino_id);
      if (tipo === 'ingreso' && destino) destino.saldo_centavos = (destino.saldo_centavos || 0) + cents;
      else if (tipo === 'egreso' && origen) origen.saldo_centavos = (origen.saldo_centavos || 0) - cents;
      else if (tipo === 'transferencia' && origen && destino) {
        origen.saldo_centavos = (origen.saldo_centavos || 0) - cents;
        destino.saldo_centavos = (destino.saldo_centavos || 0) + cents;
      }
      const mov = {
        id: 'mov_' + Math.random().toString(36).slice(2, 9),
        fecha: args.fecha || new Date().toISOString().slice(0, 10),
        tipo, moneda: args.moneda || (origen?.moneda || destino?.moneda || 'GTQ'),
        monto_centavos: cents, cuenta_origen_id: origen?.id || null, cuenta_destino_id: destino?.id || null,
        categoria: args.categoria || 'General', descripcion: args.descripcion || ''
      };
      f.movimientos.unshift(mov);
      mutated = true;
      return { ok: true, movimiento: mov };
    },
  };

  // Herramientas puramente de interfaz/reproducción en vivo: se encolan para ejecutar al volver a la app
  const UI_ONLY_TOOLS = [
    'iniciar_presentacion_tarea',
    'silenciar_alarma',
    'iniciar_playlist',
    'pausar_playlist',
    'siguiente_paso',
    'paso_anterior',
    'detener_playlist',
    'configurar_audio_coach',
    'exportar_captura',
  ];
  for (const toolName of UI_ONLY_TOOLS) {
    executors[toolName] = (args: any) => {
      uiActions.push({ tool: toolName, args: args || {} });
      return { ok: true, mensaje: `Acción visual "${toolName}" programada para ejecutarse automáticamente en tu pantalla.` };
    };
  }

  return {
    executors,
    isMutated: () => mutated,
  };
}

async function saveCloudJobToUserData(
  supabase: any,
  userId: string,
  aiCloudJob: Record<string, any>,
  mutatedState: AppState | null = null,
) {
  const { data: existingRow } = await supabase
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  const currentData = (existingRow && existingRow.data && typeof existingRow.data === 'object')
    ? { ...existingRow.data }
    : {};

  currentData.aiCloudJob = aiCloudJob;

  // Si hubo mutaciones reales, actualizar también los datos persistidos en la nube
  if (mutatedState) {
    currentData.folders = mutatedState.folders;
    currentData.trash = mutatedState.trash;
    currentData.notes = mutatedState.notes;
    currentData.userTemplates = mutatedState.userTemplates;
    currentData.automationRules = mutatedState.automationRules;
    currentData.agentMemory = mutatedState.agentMemory;
    if (mutatedState.finance) currentData.finance = mutatedState.finance;
    if (Array.isArray(mutatedState.tables)) currentData.tables = mutatedState.tables;
    currentData.userStats = mutatedState.userStats;
  }

  await supabase.from('user_data').upsert({
    user_id: userId,
    data: currentData,
    updated_at: new Date().toISOString(),
  });
}

async function runCloudAgentJob(params: {
  supabase: any;
  userId: string;
  jobId: string;
  chatId: string;
  userText: string;
  history: any[];
  systemPrompt: string;
  tools: any[];
  aiConfig: { apiKey: string; model: string; baseUrl: string };
  state: AppState;
  startedAt: number;
}) {
  const { supabase, userId, jobId, chatId, userText, history, systemPrompt, tools, aiConfig, state, startedAt } = params;
  const toolTrace: ToolTraceItem[] = [];
  const uiActions: UiActionItem[] = [];
  const engine = createToolEngine(state, aiConfig, uiActions);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(history) ? history : []),
    { role: 'user', content: userText },
  ];

  const MAX_ITERATIONS = 15;
  const DEADLINE_MS = startedAt + 135_000; // Margen seguro antes del límite de 150s de Supabase Free
  let iterations = 0;
  let emptyRetries = 0;
  let lastAssistantText = '';

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      if (Date.now() > DEADLINE_MS) {
        lastAssistantText = lastAssistantText || 'Alcancé el tiempo máximo de ejecución en la nube; los cambios aplicados hasta este punto ya quedaron guardados.';
        break;
      }

      const res = await fetch(aiConfig.baseUrl || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + aiConfig.apiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://russellralt.github.io/efectiva-app/',
          'X-Title': 'Efectiva Cloud Agent',
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.4,
          max_tokens: 8192,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let friendly = `OpenRouter HTTP ${res.status}: ${errText || res.statusText}`;
        if (res.status === 401) friendly = '🔑 API key inválida o sin permisos en OpenRouter.';
        else if (res.status === 429) friendly = '⏱️ Límite de uso alcanzado en OpenRouter. Esperá unos minutos o cambiá de modelo.';
        else if (res.status === 404) friendly = `🤖 El modelo "${aiConfig.model}" no está disponible en OpenRouter.`;
        throw new Error(friendly);
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      if (!choice) throw new Error('Respuesta inválida del modelo en OpenRouter.');

      const rawAssistantMsg = choice.message || {};
      let extractedContent = '';
      if (typeof rawAssistantMsg.content === 'string') {
        extractedContent = rawAssistantMsg.content;
      } else if (Array.isArray(rawAssistantMsg.content)) {
        extractedContent = rawAssistantMsg.content
          .map((part: any) => (typeof part === 'string' ? part : (part?.text || '')))
          .join('\n');
      }

      const cleanAssistantMsg: any = {
        role: 'assistant',
        content: extractedContent || null,
      };
      if (Array.isArray(rawAssistantMsg.tool_calls) && rawAssistantMsg.tool_calls.length > 0) {
        cleanAssistantMsg.tool_calls = rawAssistantMsg.tool_calls;
      }

      if (cleanAssistantMsg.tool_calls && cleanAssistantMsg.tool_calls.length > 0) {
        messages.push(cleanAssistantMsg);
        for (const call of cleanAssistantMsg.tool_calls) {
          let args: Record<string, any> = {};
          try { args = JSON.parse(call.function?.arguments || '{}'); } catch (_) { args = {}; }
          const fn = call.function?.name || '';
          const exec = engine.executors[fn];
          let result: any;
          if (!exec) result = { ok: false, error: 'Tool desconocida: ' + fn };
          else {
            try { result = await exec(args); }
            catch (e: any) { result = { ok: false, error: 'Excepción: ' + (e?.message || String(e)) }; }
          }
          toolTrace.push({ tool: fn, args, result });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 60000),
          });
        }

        // Guardar progreso incremental en la nube
        await saveCloudJobToUserData(supabase, userId, {
          jobId,
          chatId,
          status: 'running',
          iteration: iterations,
          tools: toolTrace,
          startedAt,
          updatedAt: Date.now(),
        });
        continue;
      }

      if (!extractedContent.trim() && emptyRetries < 2) {
        emptyRetries++;
        messages.push({
          role: 'user',
          content: choice.finish_reason === 'length'
            ? 'Tu respuesta anterior se cortó por longitud. Completa la acción pendiente (si falta editar algo, llama la herramienta ahora) y responde brevemente.'
            : 'Ya recibiste el resultado de las herramientas. Ejecuta el cambio pedido por el usuario (si aún no lo aplicaste) y responde en español con el resultado.',
        });
        continue;
      }

      messages.push(cleanAssistantMsg);
      lastAssistantText = extractedContent.trim();
      break;
    }

    if (!lastAssistantText && toolTrace.length > 0) {
      const done = toolTrace.map((t) => {
        const msg = t.result && (t.result.mensaje || t.result.error);
        return '• ' + t.tool + (msg ? ': ' + msg : '');
      }).join('\n');
      lastAssistantText = 'Ejecuté estas acciones:\n' + done;
    }

    const mutated = engine.isMutated();
    await saveCloudJobToUserData(
      supabase,
      userId,
      {
        jobId,
        chatId,
        status: 'done',
        text: lastAssistantText || 'Listo.',
        tools: toolTrace,
        mutated,
        state: mutated ? state : null,
        uiActions,
        startedAt,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
      },
      mutated ? state : null,
    );
  } catch (err: any) {
    const errMsg = err?.message ? String(err.message) : String(err);
    await saveCloudJobToUserData(supabase, userId, {
      jobId,
      chatId,
      status: 'error',
      error: errMsg,
      text: '❌ Error en nube: ' + errMsg,
      tools: toolTrace,
      mutated: engine.isMutated(),
      state: engine.isMutated() ? state : null,
      uiActions,
      startedAt,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    }, engine.isMutated() ? state : null);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Falta token de autenticación Supabase' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ ok: false, error: 'Variables SUPABASE_URL / SUPABASE_ANON_KEY no configuradas' }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return jsonResponse({ ok: false, error: 'Sesión inválida o expirada' }, 401);
  }
  const userId = authData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, 400);
  }

  if (body.action === 'ping') {
    return jsonResponse({ ok: true, mode: 'cloud', version: 'v26', userId });
  }

  const jobId = String(body.jobId || genId('job_'));
  const chatId = String(body.chatId || '');
  const userText = String(body.userText || '').trim();
  const apiKey = String(body.apiKey || '').trim();
  const model = String(body.model || 'minimax/minimax-m3').trim();
  const baseUrl = String(body.baseUrl || 'https://openrouter.ai/api/v1/chat/completions').trim();
  const systemPrompt = String(body.systemPrompt || '');
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const history = Array.isArray(body.history) ? body.history : [];

  if (!userText) return jsonResponse({ ok: false, error: 'userText vacío' }, 400);
  if (!apiKey) return jsonResponse({ ok: false, error: 'Falta API key de OpenRouter' }, 400);

  const rawState = body.state || {};
  const state: AppState = {
    folders: Array.isArray(rawState.folders) ? rawState.folders : [],
    trash: Array.isArray(rawState.trash) ? rawState.trash : [],
    notes: Array.isArray(rawState.notes) ? rawState.notes : [],
    userTemplates: Array.isArray(rawState.userTemplates) ? rawState.userTemplates : [],
    automationRules: Array.isArray(rawState.automationRules) ? rawState.automationRules : [],
    agentMemory: Array.isArray(rawState.agentMemory) ? rawState.agentMemory : [],
    finance: rawState.finance && typeof rawState.finance === 'object' ? rawState.finance : null,
    tables: Array.isArray(rawState.tables) ? rawState.tables : [],
    userStats: rawState.userStats || { xp_total: 0, nivel: 1, racha_dias_consecutivos: 1 },
    currentFolderId: rawState.currentFolderId || null,
    activePresentation: rawState.activePresentation || null,
    timezone: String(rawState.timezone || 'UTC'),
    localNow: String(rawState.localNow || new Date().toISOString()),
  };

  const startedAt = Date.now();

  // Registrar trabajo en ejecución antes de responder 202
  await saveCloudJobToUserData(supabase, userId, {
    jobId,
    chatId,
    status: 'running',
    iteration: 0,
    tools: [],
    startedAt,
    updatedAt: startedAt,
  });

  const bgPromise = runCloudAgentJob({
    supabase,
    userId,
    jobId,
    chatId,
    userText,
    history,
    systemPrompt,
    tools,
    aiConfig: { apiKey, model, baseUrl },
    state,
    startedAt,
  });

  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    EdgeRuntime.waitUntil(bgPromise);
    return jsonResponse({ ok: true, accepted: true, jobId, mode: 'cloud-background' }, 202);
  }

  // Fallback si se ejecuta en un runtime sin EdgeRuntime.waitUntil
  await bgPromise;
  return jsonResponse({ ok: true, accepted: true, jobId, mode: 'cloud-sync' }, 200);
});

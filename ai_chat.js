// @ts-nocheck
/* ============================================================================
 *  ASISTA MULTY — MÓDULO DE IA v3
 *  v3: Fix de layout — modal con backdrop, sidebar off-canvas en mobile,
 *      input siempre clickeable, cleanup robusto del modal
 * ============================================================================ */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  //  CONFIGURACIÓN — la API key se carga desde localStorage (la setea el
  //  usuario en el modal de Configuración). Si está vacía, se le pide al
  //  usuario la primera vez que abre el chat.
  // --------------------------------------------------------------------------
  const STORAGE_KEY  = 'asista_openrouter_key';
  const STORAGE_MODEL = 'asista_openrouter_model';
  const STORAGE_BASE  = 'asista_openrouter_base';

  const DEFAULT_MODEL = 'minimax/minimax-m3';
  const DEFAULT_BASE  = 'https://openrouter.ai/api/v1/chat/completions';

  function loadAIConfig() {
    return {
      apiKey:  localStorage.getItem(STORAGE_KEY)  || '',
      model:   localStorage.getItem(STORAGE_MODEL) || DEFAULT_MODEL,
      baseUrl: localStorage.getItem(STORAGE_BASE)  || DEFAULT_BASE,
      maxToolIterations: 8,
    };
  }
  let AI_CONFIG = loadAIConfig();

  function reloadAIConfig() { AI_CONFIG = loadAIConfig(); }

  // --------------------------------------------------------------------------
  //  STORAGE
  // --------------------------------------------------------------------------
  const STORAGE = {
    chats:   'asista_ai_chats_v1',
    current: 'asista_ai_current_chat_v1',
    skills:  'asista_ai_skills_v1',
    sidebar: 'asista_ai_sidebar_v1',
  };

  const DEFAULT_SKILLS = [
    { id: 'skill_default_listar', name: 'Listar todo', icon: '📋',
      prompt: 'Listame todas las carpetas y tareas que tengo, en formato de lista clara con tiempos y pasos.', isDefault: true },
    { id: 'skill_default_resumen', name: 'Resumen del día', icon: '☀️',
      prompt: 'Armame un resumen breve de todo lo que tengo pendiente y sugerime un orden para empezar el día.', isDefault: true },
    { id: 'skill_default_vaciar', name: 'Vaciar papelera', icon: '🗑️',
      prompt: 'Eliminá permanentemente todo lo que hay en la papelera. Confirmá antes de borrar.', isDefault: true },
    { id: 'skill_default_exportar', name: 'Exportar todo', icon: '💾',
      prompt: 'Exportá todas mis carpetas y tareas en formato JSON legible.', isDefault: true }
  ];

  const SYSTEM_PROMPT = `Sos el asistente inteligente con CONTROL TOTAL sobre la app "ASISTA MULTY" (gestor de tareas y rutinas).

ESTRUCTURA DE LA APP:
- Carpetas (contienen tareas pendientes y completadas).
- Tareas (pueden tener pasos/subtareas, tiempos en minutos, prioridades y fechas de vencimiento).
- Recompensas (viven en la carpeta "Recompensas").
- Papelera de reciclaje.

TU ROL Y CAPACIDADES DE CONTROL TOTAL:
1. **Ejecución y Estado**: Podés crear, renombrar, mover, eliminar, marcar completadas y desmarcar tareas y pasos.
2. **Reproductor/Playlist**: Podés iniciar, pausar, reanudar, pasar al siguiente/anterior paso y detener el modo playlist.
3. **Plantillas y Clonación**: Podés aplicar plantillas integradas ("gimnasio", "estudio", "sprint", "matutina") y duplicar cualquier tarea o carpeta completa.
4. **Papelera y Metadatos**: Podés consultar la papelera, restaurar elementos, vaciar la papelera, asignar prioridad (alta, media, baja) y fechas límite (YYYY-MM-DD).
5. **Reportes y Búsqueda**: Podés buscar elementos por palabra clave y generar reportes de productividad con estadísticas detalladas.

IMPORTANTE:
- Usá SIEMPRE las tools (funciones) disponibles para aplicar cambios. NUNCA digas "ya está hecho" sin haber llamado a la tool correspondiente.
- Confirmá tus acciones en 1-2 oraciones claras y amigables.
- Si el usuario dice "marca la tarea X como lista", usá "marcar_tarea_completada".
- Si pide una rutina completa (ej: gimnasio), usá "aplicar_plantilla".
- Si pide un reporte o métricas, usá "obtener_reporte_productividad".`;

  // --------------------------------------------------------------------------
  //  TOOL DEFINITIONS
  // --------------------------------------------------------------------------
  const TOOLS = [
    { type: 'function', function: { name: 'obtener_estado',
      description: 'Devuelve el estado completo de la app.', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'crear_carpeta',
      description: 'Crea una carpeta nueva.',
      parameters: { type: 'object', properties: { nombre: { type: 'string' } }, required: ['nombre'] } } },
    { type: 'function', function: { name: 'renombrar_carpeta',
      description: 'Cambia el nombre de una carpeta.',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' }, nuevo_nombre: { type: 'string' } }, required: ['carpeta_id', 'nuevo_nombre'] } } },
    { type: 'function', function: { name: 'eliminar_carpeta',
      description: 'Envía una carpeta a la papelera.',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' } }, required: ['carpeta_id'] } } },
    { type: 'function', function: { name: 'crear_tarea',
      description: 'Crea una tarea nueva. tiempo_minutos opcional (null = sin tiempo).',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' }, nombre: { type: 'string' }, tiempo_minutos: { type: ['integer', 'null'] } }, required: ['carpeta_id', 'nombre'] } } },
    { type: 'function', function: { name: 'renombrar_tarea',
      description: 'Cambia el nombre de una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, nuevo_nombre: { type: 'string' } }, required: ['tarea_id', 'nuevo_nombre'] } } },
    { type: 'function', function: { name: 'asignar_tiempo_tarea',
      description: 'Asigna o quita el tiempo total de una tarea (minutos). null = quitar.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, tiempo_minutos: { type: ['integer', 'null'] } }, required: ['tarea_id', 'tiempo_minutos'] } } },
    { type: 'function', function: { name: 'cambiar_color_tarea',
      description: 'Cambia o quita el color de fondo de una tarea. Colores disponibles: rojo (#FF5252), naranja (#FF9800), amarillo (#FFEB3B), verde (#4CAF50), cian (#00BCD4), violeta (#9C27B0), rosa (#E91E63), ambar (#FFA000). Pasar null para volver al color default.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, color: { type: ['string', 'null'], description: 'Color hex (#RRGGBB) o null para quitar el color' } }, required: ['tarea_id', 'color'] } } },
    { type: 'function', function: { name: 'eliminar_tarea',
      description: 'Envía una tarea a la papelera.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'mover_tarea',
      description: 'Mueve una tarea a otra carpeta.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, carpeta_destino_id: { type: 'string' } }, required: ['tarea_id', 'carpeta_destino_id'] } } },
    { type: 'function', function: { name: 'reordenar_tareas',
      description: 'Cambia el orden de las tareas dentro de una carpeta.',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' }, nuevo_orden_ids: { type: 'array', items: { type: 'string' } } }, required: ['carpeta_id', 'nuevo_orden_ids'] } } },
    { type: 'function', function: { name: 'crear_paso',
      description: 'Agrega un paso nuevo a una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, descripcion: { type: 'string' }, posicion: { type: ['integer', 'null'] } }, required: ['tarea_id', 'descripcion'] } } },
    { type: 'function', function: { name: 'editar_paso',
      description: 'Cambia el texto de un paso.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, paso_indice: { type: 'integer' }, nueva_descripcion: { type: 'string' } }, required: ['tarea_id', 'paso_indice', 'nueva_descripcion'] } } },
    { type: 'function', function: { name: 'eliminar_paso',
      description: 'Elimina un paso de una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, paso_indice: { type: 'integer' } }, required: ['tarea_id', 'paso_indice'] } } },
    { type: 'function', function: { name: 'mover_paso',
      description: 'Cambia la posición de un paso dentro de la lista.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, paso_indice_actual: { type: 'integer' }, nueva_posicion: { type: 'integer' } }, required: ['tarea_id', 'paso_indice_actual', 'nueva_posicion'] } } },
    { type: 'function', function: { name: 'crear_recompensa',
      description: 'Crea una recompensa. tiempo_minutos opcional.',
      parameters: { type: 'object', properties: { nombre: { type: 'string' }, tiempo_minutos: { type: ['integer', 'null'] } }, required: ['nombre'] } } },
    { type: 'function', function: { name: 'eliminar_recompensa',
      description: 'Elimina una recompensa.',
      parameters: { type: 'object', properties: { recompensa_id: { type: 'string' } }, required: ['recompensa_id'] } } },
    { type: 'function', function: { name: 'iniciar_playlist',
      description: 'Inicia el modo play de una carpeta.',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' } }, required: ['carpeta_id'] } } },
    { type: 'function', function: { name: 'marcar_tarea_completada',
      description: 'Marca una tarea pendiente como completada.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'desmarcar_tarea',
      description: 'Devuelve una tarea completada a la lista de pendientes.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'completar_paso',
      description: 'Marca o desmarca un paso dentro de una tarea (completado: true/false).',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, paso_indice: { type: 'integer' }, completado: { type: 'boolean' } }, required: ['tarea_id', 'paso_indice'] } } },
    { type: 'function', function: { name: 'pausar_playlist',
      description: 'Pausa o reanuda la reproducción actual en vivo de la playlist.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'siguiente_paso',
      description: 'Avanza al siguiente paso en la reproducción activa.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'paso_anterior',
      description: 'Retrocede al paso anterior en la reproducción activa.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'detener_playlist',
      description: 'Cierra y detiene la pantalla completa de la playlist.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'aplicar_plantilla',
      description: 'Aplica una rutina/plantilla predefinida (gimnasio, estudio, sprint, matutina).',
      parameters: { type: 'object', properties: { nombre_plantilla: { type: 'string' }, carpeta_destino_id: { type: ['string', 'null'] } }, required: ['nombre_plantilla'] } } },
    { type: 'function', function: { name: 'duplicar_tarea',
      description: 'Duplica una tarea existente.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, carpeta_destino_id: { type: ['string', 'null'] } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'duplicar_carpeta',
      description: 'Duplica una carpeta completa con todas sus tareas y pasos.',
      parameters: { type: 'object', properties: { carpeta_id: { type: 'string' }, nuevo_nombre: { type: ['string', 'null'] } }, required: ['carpeta_id'] } } },
    { type: 'function', function: { name: 'obtener_papelera',
      description: 'Devuelve el contenido actual de la papelera de reciclaje.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'restaurar_elemento',
      description: 'Restaura una carpeta o tarea desde la papelera.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'vaciar_papelera',
      description: 'Vacía la papelera de reciclaje permanentemente.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'asignar_prioridad',
      description: 'Asigna prioridad a una tarea (alta, media, baja, ninguna).',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, prioridad: { type: 'string' } }, required: ['tarea_id', 'prioridad'] } } },
    { type: 'function', function: { name: 'asignar_fecha_vencimiento',
      description: 'Asigna una fecha límite/vencimiento a una tarea (YYYY-MM-DD o null).',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, fecha_iso: { type: ['string', 'null'] } }, required: ['tarea_id', 'fecha_iso'] } } },
    { type: 'function', function: { name: 'buscar_elementos',
      description: 'Busca rápido tareas, carpetas o pasos por palabra clave o prioridad.',
      parameters: { type: 'object', properties: { criterio: { type: 'string' } }, required: ['criterio'] } } },
    { type: 'function', function: { name: 'obtener_reporte_productividad',
      description: 'Genera métricas y reporte de productividad global o por carpeta.',
      parameters: { type: 'object', properties: { carpeta_id: { type: ['string', 'null'] } }, required: [] } } },
    { type: 'function', function: { name: 'ejecutar_accion_en_lote',
      description: 'Aplica una acción en masa (marcar_completada, eliminar, cambiar_prioridad, cambiar_color, mover) sobre múltiples tareas.',
      parameters: {
        type: 'object',
        properties: {
          filtro: { type: 'object', properties: { carpeta_id: { type: 'string' }, prioridad: { type: 'string' }, nombre_contiene: { type: 'string' } } },
          accion: { type: 'string', description: 'marcar_completada | eliminar | cambiar_prioridad | cambiar_color | mover' },
          parametros_accion: { type: 'object', properties: { nueva_prioridad: { type: 'string' }, nuevo_color: { type: 'string' }, carpeta_destino_id: { type: 'string' } } }
        },
        required: ['accion']
      } } },
    { type: 'function', function: { name: 'registrar_tiempo_real',
      description: 'Registra el tiempo real invertido/consumido en minutos en una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, minutos_reales: { type: 'integer' }, comentario: { type: ['string', 'null'] } }, required: ['tarea_id', 'minutos_reales'] } } },
    { type: 'function', function: { name: 'crear_regla_automatizacion',
      description: 'Crea una regla automática (ej: al completar tarea/carpeta -> crear recompensa, cambiar prioridad o cambiar color).',
      parameters: {
        type: 'object',
        properties: {
          evento: { type: 'string', description: 'tarea_completada | carpeta_completada' },
          condicion: { type: 'object', properties: { carpeta_id: { type: 'string' }, prioridad: { type: 'string' } } },
          accion_automatica: { type: 'string', description: 'crear_recompensa | asignar_prioridad | asignar_color' },
          parametros_accion: { type: 'object', properties: { nombre: { type: 'string' }, tiempo_minutos: { type: 'integer' }, nueva_prioridad: { type: 'string' }, nuevo_color: { type: 'string' } } }
        },
        required: ['evento', 'accion_automatica']
      } } },
    { type: 'function', function: { name: 'listar_reglas_automatizacion',
      description: 'Devuelve todas las reglas de automatización activas.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'eliminar_regla_automatizacion',
      description: 'Elimina una regla de automatización por su ID.',
      parameters: { type: 'object', properties: { regla_id: { type: 'string' } }, required: ['regla_id'] } } },
    { type: 'function', function: { name: 'crear_nota',
      description: 'Crea una nota de texto plano o Markdown vinculada a una carpeta o tarea.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          contenido: { type: 'string' },
          carpeta_id: { type: ['string', 'null'] },
          tarea_id: { type: ['string', 'null'] },
          etiquetas: { type: 'array', items: { type: 'string' } }
        },
        required: ['titulo', 'contenido']
      } } },
    { type: 'function', function: { name: 'listar_notas',
      description: 'Lista las notas guardadas opcionalmente filtrando por carpeta o tarea.',
      parameters: { type: 'object', properties: { carpeta_id: { type: ['string', 'null'] }, tarea_id: { type: ['string', 'null'] } }, required: [] } } },
    { type: 'function', function: { name: 'eliminar_nota',
      description: 'Elimina una nota existente por su ID.',
      parameters: { type: 'object', properties: { nota_id: { type: 'string' } }, required: ['nota_id'] } } },
    { type: 'function', function: { name: 'asignar_color_nota',
      description: 'Asigna un color de fondo personalizado (HEX o nombre de color) a una nota.',
      parameters: { type: 'object', properties: { nota_id: { type: 'string' }, color: { type: 'string' } }, required: ['nota_id', 'color'] } } },
    { type: 'function', function: { name: 'exportar_captura',
      description: 'Genera y descarga una captura en imagen HD de una tarea o nota específica.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID de la tarea o nota a capturar' },
          tipo: { type: 'string', description: 'tarea | nota' }
        },
        required: ['id']
      } } },
    { type: 'function', function: { name: 'asignar_etiquetas_tarea',
      description: 'Asigna etiquetas (#en_pc, #movil, #rapido_5min) a una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, required: ['tarea_id', 'etiquetas'] } } },
    { type: 'function', function: { name: 'filtrar_por_etiqueta',
      description: 'Busca todas las tareas que tengan una etiqueta específica (ej: #movil, #en_pc).',
      parameters: { type: 'object', properties: { etiqueta: { type: 'string' } }, required: ['etiqueta'] } } },
    { type: 'function', function: { name: 'desglosar_tarea_inteligente',
      description: 'Desglosa automáticamente una tarea en sub-pasos concretos de 5 a 15 minutos con estimaciones.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, max_pasos: { type: 'integer' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'generar_bloques_tiempo',
      description: 'Genera un itinerario Time-Blocking diario con horarios exactos y pausas de descanso.',
      parameters: {
        type: 'object',
        properties: {
          hora_inicio: { type: 'string', description: 'HH:MM, ej: 09:00' },
          hora_fin: { type: 'string', description: 'HH:MM, ej: 18:00' },
          duracion_descanso_min: { type: 'integer', description: 'ej: 5' },
          carpeta_id: { type: ['string', 'null'] }
        },
        required: ['hora_inicio']
      } } },
    { type: 'function', function: { name: 'obtener_estadisticas_gamificacion',
      description: 'Obtiene las estadísticas de XP total, nivel actual y racha de días consecutivos del usuario.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'configurar_audio_coach',
      description: 'Activa o desactiva la síntesis de voz en voz alta durante las rutinas / playlist.',
      parameters: { type: 'object', properties: { habilitado: { type: 'boolean' }, anunciar_pasos: { type: 'boolean' } }, required: ['habilitado'] } } }
  ];

  // --------------------------------------------------------------------------
  //  STATE HELPERS
  // --------------------------------------------------------------------------
  function getStateSnapshot() {
    return {
      carpeta_actual_id: (typeof currentFolderId !== 'undefined') ? currentFolderId : null,
      carpetas: (typeof folders !== 'undefined') ? folders.map(f => ({
        id: f.id, nombre: f.name, es_recompensas: !!f.isDefaultRewards,
        cantidad_tareas: (f.tasks || []).length,
        cantidad_completadas: (f.finished || []).length,
        tareas: (f.tasks || []).map(t => ({
          id: t.id, nombre: t.name, es_recompensa: !!t.isReward,
          tiempo_minutos: t.totalTime ? Math.round(t.totalTime / 60) : (t.rewardTime || null),
          color: t.color || null, prioridad: t.priority || null, fecha_vencimiento: t.dueDate || null,
          pasos: t.steps || []
        }))
      })) : []
    };
  }
  function findFolder(id) { return (typeof folders !== 'undefined') ? folders.find(f => f.id === id) : null; }
  function findTask(id) {
    if (typeof folders === 'undefined') return null;
    for (const f of folders) {
      const t = (f.tasks || []).find(x => x.id === id);
      if (t) return { folder: f, task: t };
      const t2 = (f.finished || []).find(x => x.id === id);
      if (t2) return { folder: f, task: t2, isFinished: true };
    }
    return null;
  }

  // --------------------------------------------------------------------------
  //  TOOL EXECUTORS
  // --------------------------------------------------------------------------
  const TOOL_EXECUTORS = {
    obtener_estado() { return getStateSnapshot(); },

    crear_carpeta({ nombre }) {
      if (!nombre || !nombre.trim()) return { ok: false, error: 'Nombre vacío' };
      const n = nombre.trim();
      if (typeof createFolder === 'function') {
        createFolder(n);
        const f = folders.find(x => x.name === n);
        return { ok: true, mensaje: `Carpeta "${n}" creada.`, carpeta_id: f ? f.id : null };
      }
      return { ok: false, error: 'createFolder no disponible' };
    },

    renombrar_carpeta({ carpeta_id, nuevo_nombre }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      const antes = f.name;
      f.name = nuevo_nombre.trim();
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      return { ok: true, mensaje: `Carpeta renombrada de "${antes}" a "${f.name}".` };
    },

    eliminar_carpeta({ carpeta_id }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      const nombre = f.name;
      if (typeof moveFolderToTrash === 'function') {
        moveFolderToTrash(carpeta_id);
        return { ok: true, mensaje: `Carpeta "${nombre}" enviada a la papelera.` };
      }
      return { ok: false, error: 'moveFolderToTrash no disponible' };
    },

    crear_tarea({ carpeta_id, nombre, tiempo_minutos }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      if (f.isDefaultRewards) return { ok: false, error: 'La carpeta de recompensas no acepta tareas; usá crear_recompensa.' };
      if (!nombre || !nombre.trim()) return { ok: false, error: 'Nombre vacío' };
      const task = {
        id: (typeof generateId === 'function') ? generateId() : '_' + Math.random().toString(36).substr(2, 9),
        name: nombre.trim(),
        steps: [],
        isExpanded: false,
        scheduledTimestamp: null,
        currentStepIndex: 0,
        totalTime: (tiempo_minutos && Number(tiempo_minutos) > 0) ? Number(tiempo_minutos) * 60 : null,
        stepTimes: []
      };
      f.tasks.push(task);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === carpeta_id && typeof renderTasks === 'function') {
        renderTasks();
      } else if (typeof renderFolders === 'function') {
        renderFolders();
      }
      return { ok: true, mensaje: `Tarea "${task.name}" creada${task.totalTime ? ' (' + tiempo_minutos + ' min)' : ''}.`, tarea_id: task.id };
    },

    renombrar_tarea({ tarea_id, nuevo_nombre }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const antes = found.task.name;
      found.task.name = nuevo_nombre.trim();
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Tarea renombrada de "${antes}" a "${found.task.name}".` };
    },

    asignar_tiempo_tarea({ tarea_id, tiempo_minutos }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.totalTime = (tiempo_minutos && Number(tiempo_minutos) > 0) ? Number(tiempo_minutos) * 60 : null;
      if (typeof recalcStepTimes === 'function') recalcStepTimes(found.task);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: found.task.totalTime
        ? `Tiempo de "${found.task.name}" actualizado a ${tiempo_minutos} min.`
        : `Tiempo de "${found.task.name}" eliminado.` };
    },

    cambiar_color_tarea({ tarea_id, color }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (color === null || color === '') {
        delete found.task.color;
        if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
        if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
          renderTasks();
        }
        return { ok: true, mensaje: `Color de "${found.task.name}" quitado.` };
      }
      // Validar formato hex
      const hex = String(color).trim();
      if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
        return { ok: false, error: `Color inválido. Usar formato #RRGGBB (ej. #FF5252 para rojo).` };
      }
      const normalized = hex.startsWith('#') ? hex : '#' + hex;
      found.task.color = normalized.toUpperCase();
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Color de "${found.task.name}" cambiado a ${found.task.color}.` };
    },

    eliminar_tarea({ tarea_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const nombre = found.task.name;
      if (typeof moveTaskToTrash === 'function') {
        moveTaskToTrash(found.folder, tarea_id, !!found.isFinished);
        if (typeof renderFolders === 'function') renderFolders();
        if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
          renderTasks();
        }
        return { ok: true, mensaje: `Tarea "${nombre}" enviada a la papelera.` };
      }
      return { ok: false, error: 'moveTaskToTrash no disponible' };
    },

    mover_tarea({ tarea_id, carpeta_destino_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const dest = findFolder(carpeta_destino_id);
      if (!dest) return { ok: false, error: 'Carpeta destino no encontrada' };
      if (dest.isDefaultRewards) return { ok: false, error: 'No se puede mover una tarea normal a la carpeta de recompensas.' };
      const idx = found.folder.tasks.findIndex(t => t.id === tarea_id);
      if (idx === -1) return { ok: false, error: 'Tarea no encontrada en carpeta origen' };
      const [task] = found.folder.tasks.splice(idx, 1);
      dest.tasks.push(task);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof currentFolderId !== 'undefined' && typeof renderTasks === 'function'
          && (currentFolderId === found.folder.id || currentFolderId === carpeta_destino_id)) {
        renderTasks();
      }
      return { ok: true, mensaje: `Tarea "${task.name}" movida a "${dest.name}".` };
    },

    reordenar_tareas({ carpeta_id, nuevo_orden_ids }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      if (!Array.isArray(nuevo_orden_ids)) return { ok: false, error: 'nuevo_orden_ids debe ser un array' };
      const byId = {};
      f.tasks.forEach(t => { byId[t.id] = t; });
      const nuevo = [];
      for (const id of nuevo_orden_ids) {
        if (byId[id]) { nuevo.push(byId[id]); delete byId[id]; }
      }
      Object.values(byId).forEach(t => nuevo.push(t));
      f.tasks = nuevo;
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === carpeta_id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Tareas reordenadas en "${f.name}".` };
    },

    crear_paso({ tarea_id, descripcion, posicion }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) found.task.steps = [];
      const txt = String(descripcion || '').trim();
      if (!txt) return { ok: false, error: 'Descripción vacía' };
      let pos = (posicion === null || posicion === undefined) ? found.task.steps.length : Number(posicion);
      if (pos < 0) pos = 0;
      if (pos > found.task.steps.length) pos = found.task.steps.length;
      found.task.steps.splice(pos, 0, txt);
      if (typeof recalcStepTimes === 'function') recalcStepTimes(found.task);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Paso "${txt}" agregado en posición ${pos}.` };
    },

    editar_paso({ tarea_id, paso_indice, nueva_descripcion }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const i = Number(paso_indice);
      if (!Number.isInteger(i) || i < 0 || i >= found.task.steps.length) {
        return { ok: false, error: `Índice inválido (debe ser entre 0 y ${found.task.steps.length - 1})` };
      }
      const antes = found.task.steps[i];
      found.task.steps[i] = String(nueva_descripcion).trim();
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Paso ${i} cambiado de "${antes}" a "${found.task.steps[i]}".` };
    },

    eliminar_paso({ tarea_id, paso_indice }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const i = Number(paso_indice);
      if (!Number.isInteger(i) || i < 0 || i >= found.task.steps.length) {
        return { ok: false, error: `Índice inválido (debe ser entre 0 y ${found.task.steps.length - 1})` };
      }
      const [removed] = found.task.steps.splice(i, 1);
      if (typeof recalcStepTimes === 'function') recalcStepTimes(found.task);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Paso "${removed}" eliminado.` };
    },

    mover_paso({ tarea_id, paso_indice_actual, nueva_posicion }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!Array.isArray(found.task.steps)) return { ok: false, error: 'La tarea no tiene pasos' };
      const desde = Number(paso_indice_actual);
      const hasta = Number(nueva_posicion);
      if (!Number.isInteger(desde) || desde < 0 || desde >= found.task.steps.length) return { ok: false, error: 'Índice actual inválido' };
      if (!Number.isInteger(hasta) || hasta < 0 || hasta >= found.task.steps.length) return { ok: false, error: 'Nueva posición inválida' };
      const [item] = found.task.steps.splice(desde, 1);
      found.task.steps.splice(hasta, 0, item);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Paso movido de posición ${desde} a ${hasta}.` };
    },

    crear_recompensa({ nombre, tiempo_minutos }) {
      if (!nombre || !nombre.trim()) return { ok: false, error: 'Nombre vacío' };
      if (typeof addReward === 'function') {
        const t = (tiempo_minutos && Number(tiempo_minutos) > 0) ? String(tiempo_minutos) : '';
        addReward(nombre.trim(), t);
        return { ok: true, mensaje: `Recompensa "${nombre.trim()}" creada${t ? ' (' + tiempo_minutos + ' min)' : ' (libre)'}.` };
      }
      const rewardsFolder = (typeof folders !== 'undefined') ? folders.find(x => x.isDefaultRewards) : null;
      if (!rewardsFolder) return { ok: false, error: 'No existe la carpeta Recompensas' };
      const r = {
        id: '_' + Math.random().toString(36).substr(2, 9),
        name: nombre.trim(),
        steps: [],
        isExpanded: false,
        scheduledTimestamp: null,
        isReward: true,
        currentStepIndex: 0,
        rewardTime: (tiempo_minutos && Number(tiempo_minutos) > 0) ? Number(tiempo_minutos) : null
      };
      rewardsFolder.tasks.unshift(r);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      return { ok: true, mensaje: `Recompensa "${r.name}" creada.` };
    },

    eliminar_recompensa({ recompensa_id }) {
      const rewardsFolder = (typeof folders !== 'undefined') ? folders.find(x => x.isDefaultRewards) : null;
      if (!rewardsFolder) return { ok: false, error: 'No existe la carpeta Recompensas' };
      const idx = rewardsFolder.tasks.findIndex(t => t.id === recompensa_id);
      if (idx === -1) return { ok: false, error: 'Recompensa no encontrada' };
      const nombre = rewardsFolder.tasks[idx].name;
      rewardsFolder.tasks.splice(idx, 1);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === rewardsFolder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: `Recompensa "${nombre}" eliminada.` };
    },

    iniciar_playlist({ carpeta_id }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      if (f.isDefaultRewards) return { ok: false, error: 'No se puede iniciar playlist en la carpeta de recompensas.' };
      if (!f.tasks || f.tasks.length === 0) return { ok: false, error: 'La carpeta no tiene tareas' };
      if (typeof startFolderPlay === 'function') {
        startFolderPlay(carpeta_id);
        return { ok: true, mensaje: `Iniciando playlist de "${f.name}" (${f.tasks.length} tareas).` };
      }
      return { ok: false, error: 'startFolderPlay no disponible' };
    },

    marcar_tarea_completada({ tarea_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (found.isFinished) return { ok: true, mensaje: `La tarea "${found.task.name}" ya estaba completada.` };
      if (typeof moveTaskToMiniFolder === 'function') {
        moveTaskToMiniFolder(found.folder, found.task);
        return { ok: true, mensaje: `Tarea "${found.task.name}" marcada como completada ✔️.` };
      }
      return { ok: false, error: 'moveTaskToMiniFolder no disponible' };
    },

    desmarcar_tarea({ tarea_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      if (!found.isFinished) return { ok: true, mensaje: `La tarea "${found.task.name}" no está completada.` };
      if (typeof restoreFromMiniFolder === 'function') {
        restoreFromMiniFolder(found.folder, tarea_id);
        return { ok: true, mensaje: `Tarea "${found.task.name}" devuelta a pendientes.` };
      }
      return { ok: false, error: 'restoreFromMiniFolder no disponible' };
    },

    completar_paso({ tarea_id, paso_indice, completado }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const steps = found.task.steps || [];
      const idx = Number(paso_indice);
      if (isNaN(idx) || idx < 0 || idx >= steps.length) return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
      const isDone = (completado !== undefined) ? !!completado : !steps[idx].completed;
      steps[idx].completed = isDone;
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Paso ${idx + 1} "${steps[idx].text || steps[idx]}" ${isDone ? 'marcado como completado ✔️' : 'desmarcado'}.` };
    },

    pausar_playlist() {
      if (typeof togglePausePresentation === 'function') {
        togglePausePresentation();
        return { ok: true, mensaje: 'Playlist pausada/reanudada.' };
      }
      return { ok: false, error: 'Playlist no activa' };
    },

    siguiente_paso() {
      if (typeof nextStep === 'function') {
        nextStep();
        return { ok: true, mensaje: 'Avanzado al siguiente paso.' };
      }
      return { ok: false, error: 'Playlist no activa' };
    },

    paso_anterior() {
      if (typeof prevStep === 'function') {
        prevStep();
        return { ok: true, mensaje: 'Retrocedido al paso anterior.' };
      }
      return { ok: false, error: 'Playlist no activa' };
    },

    detener_playlist() {
      if (typeof closePresentation === 'function') {
        closePresentation();
        return { ok: true, mensaje: 'Playlist detenida.' };
      }
      return { ok: false, error: 'closePresentation no disponible' };
    },

    aplicar_plantilla({ nombre_plantilla, carpeta_destino_id }) {
      const plantillas = {
        gimnasio: {
          nombre: '🏋️ Rutina de Gimnasio (Push / Pull / Legs)',
          tareas: [
            { nombre: 'Día 1: Pecho, Hombros y Tríceps', tiempo: 60, pasos: [{ text: 'Calentamiento manguito rotador', completed: false }, { text: 'Press de Banca Plano 4x10', completed: false }, { text: 'Press Inclinado con Mancuernas 3x12', completed: false }, { text: 'Press Militar Hombro 4x10', completed: false }, { text: 'Elevaciones Laterales 4x15', completed: false }, { text: 'Extensión de Tríceps Polea 4x12', completed: false }] },
            { nombre: 'Día 2: Espalda y Biceps', tiempo: 60, pasos: [{ text: 'Dominadas o Jalón al Pecho 4x10', completed: false }, { text: 'Remo con Barra 4x10', completed: false }, { text: 'Remo Gironda 3x12', completed: false }, { text: 'Curl de Biceps con Barra 4x12', completed: false }, { text: 'Curl Martillo 3x15', completed: false }] },
            { nombre: 'Día 3: Pierna Completa', tiempo: 60, pasos: [{ text: 'Sentadilla Libre 4x10', completed: false }, { text: 'Prensa de Piernas 4x12', completed: false }, { text: 'Peso Muerto Rumano 4x10', completed: false }, { text: 'Extensión de Cuádriceps 3x15', completed: false }, { text: 'Elevación de Gemelos 4x20', completed: false }] }
          ]
        },
        estudio: {
          nombre: '📚 Plan de Estudio e Investigación',
          tareas: [
            { nombre: 'Bloque 1: Lectura y Resumen', tiempo: 45, pasos: [{ text: 'Lectura rápida del capítulo', completed: false }, { text: 'Anotación de conceptos clave', completed: false }, { text: 'Elaboración de mapa mental', completed: false }] },
            { nombre: 'Bloque 2: Resolución de Ejercicios', tiempo: 50, pasos: [{ text: 'Resolver guía práctica', completed: false }, { text: 'Revisar respuestas con solución', completed: false }, { text: 'Anotar dudas frecuentes', completed: false }] },
            { nombre: 'Bloque 3: Repaso Spaced Repetition', tiempo: 30, pasos: [{ text: 'Repaso de fichas anki / flashcards', completed: false }, { text: 'Autoevaluación en voz alta', completed: false }] }
          ]
        },
        sprint: {
          nombre: '💻 Sprint de Desarrollo de Software',
          tareas: [
            { nombre: 'Planificación de Feature', tiempo: 30, pasos: [{ text: 'Revisar requerimientos', completed: false }, { text: 'Diseñar arquitectura / BD', completed: false }, { text: 'Desglosar sub-tareas', completed: false }] },
            { nombre: 'Codificación y Tests Unitarios', tiempo: 90, pasos: [{ text: 'Escribir lógica principal', completed: false }, { text: 'Escribir tests unitarios', completed: false }, { text: 'Refactorizar código', completed: false }] },
            { nombre: 'Code Review y Deployment', tiempo: 30, pasos: [{ text: 'Revisar diff de Git', completed: false }, { text: 'Ejecutar build local', completed: false }, { text: 'Desplegar a producción', completed: false }] }
          ]
        },
        matutina: {
          nombre: '☀️ Rutina Matutina de Alta Productividad',
          tareas: [
            { nombre: 'Activación Física y Mente', tiempo: 20, pasos: [{ text: 'Hidratación (500ml agua)', completed: false }, { text: 'Estiramientos / Calistenia 10 min', completed: false }, { text: 'Meditación o respiración 5 min', completed: false }] },
            { nombre: 'Planificación del Día', tiempo: 15, pasos: [{ text: 'Revisar agenda y prioridades', completed: false }, { text: 'Seleccionar las 3 tareas clave del día', completed: false }] }
          ]
        }
      };

      const key = (nombre_plantilla || '').toLowerCase();
      let targetP = null;
      for (const k in plantillas) {
        if (key.includes(k) || plantillas[k].nombre.toLowerCase().includes(key)) {
          targetP = plantillas[k]; break;
        }
      }
      if (!targetP) targetP = plantillas.gimnasio;

      let folder = findFolder(carpeta_destino_id);
      if (!folder) {
        if (typeof createFolder === 'function') {
          createFolder(targetP.nombre);
          folder = folders.find(x => x.name === targetP.nombre);
        }
      }
      if (!folder) return { ok: false, error: 'No se pudo obtener la carpeta destino' };

      targetP.tareas.forEach(tData => {
        const task = {
          id: '_' + Math.random().toString(36).substr(2, 9),
          name: tData.nombre,
          steps: tData.pasos || [],
          totalTime: tData.tiempo ? tData.tiempo * 60 : null
        };
        folder.tasks.push(task);
      });
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof renderTasks === 'function') renderTasks();

      return { ok: true, mensaje: `Plantilla "${targetP.nombre}" aplicada con éxito (${targetP.tareas.length} tareas cargadas).` };
    },

    duplicar_tarea({ tarea_id, carpeta_destino_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const targetFolder = findFolder(carpeta_destino_id) || found.folder;
      const clone = JSON.parse(JSON.stringify(found.task));
      clone.id = '_' + Math.random().toString(36).substr(2, 9);
      clone.name = clone.name + ' (Copia)';
      targetFolder.tasks.push(clone);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Tarea "${found.task.name}" duplicada en la carpeta "${targetFolder.name}".`, nueva_tarea_id: clone.id };
    },

    duplicar_carpeta({ carpeta_id, nuevo_nombre }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada' };
      const clone = JSON.parse(JSON.stringify(f));
      clone.id = '_' + Math.random().toString(36).substr(2, 9);
      clone.name = (nuevo_nombre && nuevo_nombre.trim()) ? nuevo_nombre.trim() : f.name + ' (Copia)';
      clone.tasks.forEach(t => { t.id = '_' + Math.random().toString(36).substr(2, 9); });
      if (Array.isArray(clone.finished)) clone.finished.forEach(t => { t.id = '_' + Math.random().toString(36).substr(2, 9); });
      folders.push(clone);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      return { ok: true, mensaje: `Carpeta "${f.name}" duplicada como "${clone.name}".`, nueva_carpeta_id: clone.id };
    },

    obtener_papelera() {
      if (typeof trash === 'undefined' || !Array.isArray(trash)) return { cantidad: 0, elementos: [] };
      return {
        cantidad: trash.length,
        elementos: trash.map(t => ({
          id: t.id,
          tipo: t.type || 'elemento',
          nombre: t.name || (t.data ? t.data.name : 'Elemento'),
          fecha_eliminado: t.deletedAt ? new Date(t.deletedAt).toLocaleDateString() : 'Reciente'
        }))
      };
    },

    restaurar_elemento({ id }) {
      if (typeof restoreFromTrash === 'function') {
        restoreFromTrash(id);
        return { ok: true, mensaje: `Elemento restaurado desde la papelera.` };
      }
      return { ok: false, error: 'restoreFromTrash no disponible' };
    },

    vaciar_papelera() {
      if (typeof cleanOldTrashItems === 'function') {
        cleanOldTrashItems();
      }
      if (typeof trash !== 'undefined') trash.length = 0;
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTrash === 'function') renderTrash();
      return { ok: true, mensaje: 'La papelera ha sido vaciada permanentemente.' };
    },

    asignar_prioridad({ tarea_id, prioridad }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const p = (prioridad || '').toLowerCase();
      if (!['alta', 'media', 'baja', 'ninguna'].includes(p)) return { ok: false, error: 'Prioridad no válida (alta, media, baja, ninguna)' };
      found.task.priority = p === 'ninguna' ? null : p;
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Prioridad "${p}" asignada a la tarea "${found.task.name}".` };
    },

    asignar_fecha_vencimiento({ tarea_id, fecha_iso }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.dueDate = fecha_iso ? fecha_iso : null;
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Fecha de vencimiento "${fecha_iso || 'sin fecha'}" asignada a "${found.task.name}".` };
    },

    buscar_elementos({ criterio }) {
      if (!criterio || !criterio.trim()) return { ok: false, error: 'Criterio vacío' };
      const q = criterio.trim().toLowerCase();
      const resultados = [];
      if (typeof folders !== 'undefined') {
        folders.forEach(f => {
          if (f.name.toLowerCase().includes(q)) resultados.push({ tipo: 'carpeta', id: f.id, nombre: f.name });
          (f.tasks || []).forEach(t => {
            if (t.name.toLowerCase().includes(q) || (t.priority && t.priority.includes(q))) {
              resultados.push({ tipo: 'tarea_pendiente', id: t.id, nombre: t.name, carpeta: f.name, prioridad: t.priority });
            }
          });
          (f.finished || []).forEach(t => {
            if (t.name.toLowerCase().includes(q)) {
              resultados.push({ tipo: 'tarea_completada', id: t.id, nombre: t.name, carpeta: f.name });
            }
          });
        });
      }
      return { ok: true, total: resultados.length, resultados };
    },

    obtener_reporte_productividad({ carpeta_id }) {
      let targetFolders = folders;
      if (carpeta_id) {
        const f = findFolder(carpeta_id);
        if (f) targetFolders = [f];
      }
      let totPendientes = 0;
      let totCompletadas = 0;
      let totTiempoMinutos = 0;

      targetFolders.forEach(f => {
        totPendientes += (f.tasks || []).length;
        totCompletadas += (f.finished || []).length;
        (f.tasks || []).forEach(t => { if (t.totalTime) totTiempoMinutos += Math.round(t.totalTime / 60); });
        (f.finished || []).forEach(t => { if (t.totalTime) totTiempoMinutos += Math.round(t.totalTime / 60); });
      });

      const totalTareas = totPendientes + totCompletadas;
      const pct = totalTareas > 0 ? Math.round((totCompletadas / totalTareas) * 100) : 0;

      return {
        ok: true,
        carpetas_analizadas: targetFolders.length,
        tareas_pendientes: totPendientes,
        tareas_completadas: totCompletadas,
        porcentaje_cumplimiento: pct + '%',
        tiempo_estimado_total: totTiempoMinutos + ' minutos (' + (totTiempoMinutos / 60).toFixed(1) + ' hrs)'
      };
    },

    ejecutar_accion_en_lote({ filtro, accion, parametros_accion }) {
      if (typeof folders === 'undefined') return { ok: false, error: 'State no disponible' };
      filtro = filtro || {};
      parametros_accion = parametros_accion || {};
      let afectades = [];

      folders.forEach(f => {
        if (filtro.carpeta_id && f.id !== filtro.carpeta_id) return;
        const matchingTasks = (f.tasks || []).filter(t => {
          if (filtro.prioridad && t.priority !== filtro.prioridad) return false;
          if (filtro.nombre_contiene && !t.name.toLowerCase().includes(filtro.nombre_contiene.toLowerCase())) return false;
          return true;
        });

        matchingTasks.forEach(t => {
          afectades.push({ folder: f, task: t });
        });
      });

      if (afectades.length === 0) return { ok: true, mensaje: 'No se encontraron tareas que coincidan con los filtros.', afectades: 0 };

      afectades.forEach(item => {
        if (accion === 'marcar_completada' && typeof moveTaskToMiniFolder === 'function') {
          moveTaskToMiniFolder(item.folder, item.task);
        } else if (accion === 'eliminar' && typeof moveTaskToTrash === 'function') {
          moveTaskToTrash(item.folder, item.task.id);
        } else if (accion === 'cambiar_prioridad') {
          item.task.priority = parametros_accion.nueva_prioridad || 'alta';
        } else if (accion === 'cambiar_color') {
          item.task.color = parametros_accion.nuevo_color || '#4CAF50';
        } else if (accion === 'mover' && parametros_accion.carpeta_destino_id) {
          const destF = findFolder(parametros_accion.carpeta_destino_id);
          if (destF) {
            item.folder.tasks = item.folder.tasks.filter(x => x.id !== item.task.id);
            destF.tasks.push(item.task);
          }
        }
      });

      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof renderTasks === 'function') renderTasks();

      return { ok: true, mensaje: `Acción en lote "${accion}" ejecutada sobre ${afectades.length} tareas.`, afectades: afectades.length };
    },

    registrar_tiempo_real({ tarea_id, minutos_reales, comentario }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const mins = Number(minutos_reales);
      if (isNaN(mins) || mins <= 0) return { ok: false, error: 'Minutos reales no válidos' };
      found.task.realTime = mins * 60;
      found.task.timeComment = comentario || null;

      const estimMins = found.task.totalTime ? Math.round(found.task.totalTime / 60) : 0;
      const desvio = estimMins > 0 ? mins - estimMins : 0;

      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();

      return {
        ok: true,
        mensaje: `Tiempo real de ${mins} min registrado en "${found.task.name}".`,
        tiempo_estimado_min: estimMins,
        tiempo_real_min: mins,
        desvio_minutos: (desvio > 0 ? `+${desvio} min (exceso)` : desvio < 0 ? `${desvio} min (ahorro)` : 'Exacto')
      };
    },

    crear_regla_automatizacion({ evento, condicion, accion_automatica, parametros_accion }) {
      if (!evento || !accion_automatica) return { ok: false, error: 'Parámetros incompletos' };
      const rule = {
        id: '_' + Math.random().toString(36).substr(2, 9),
        evento,
        condicion: condicion || {},
        accion_automatica,
        parametros_accion: parametros_accion || {}
      };
      if (typeof automationRules === 'undefined') window.automationRules = [];
      automationRules.push(rule);
      if (typeof saveAutomationRules === 'function') saveAutomationRules();
      return { ok: true, mensaje: `Regla de automatización creada (ID: ${rule.id}).`, regla: rule };
    },

    listar_reglas_automatizacion() {
      const rules = (typeof automationRules !== 'undefined') ? automationRules : [];
      return { ok: true, total: rules.length, reglas: rules };
    },

    eliminar_regla_automatizacion({ regla_id }) {
      if (typeof automationRules === 'undefined') return { ok: false, error: 'Sin reglas' };
      const idx = automationRules.findIndex(r => r.id === regla_id);
      if (idx === -1) return { ok: false, error: 'Regla no encontrada' };
      automationRules.splice(idx, 1);
      if (typeof saveAutomationRules === 'function') saveAutomationRules();
      return { ok: true, mensaje: 'Regla de automatización eliminada.' };
    },

    crear_nota({ titulo, contenido, carpeta_id, tarea_id, etiquetas }) {
      if (typeof notes === 'undefined') window.notes = [];
      const note = {
        id: '_' + Math.random().toString(36).substr(2, 9),
        title: titulo,
        content: contenido,
        folderId: carpeta_id || (typeof currentFolderId !== 'undefined' ? currentFolderId : null),
        taskId: tarea_id || null,
        tags: etiquetas || [],
        createdAt: Date.now()
      };
      notes.push(note);
      if (typeof saveNotes === 'function') saveNotes();
      if (typeof renderNotes === 'function') renderNotes();
      return { ok: true, mensaje: `Nota "${titulo}" creada con éxito.`, nota_id: note.id };
    },

    listar_notas({ carpeta_id, tarea_id }) {
      const list = (typeof notes !== 'undefined') ? notes : [];
      const res = list.filter(n => {
        if (carpeta_id && n.folderId !== carpeta_id) return false;
        if (tarea_id && n.taskId !== tarea_id) return false;
        return true;
      });
      return { ok: true, total: res.length, notas: res };
    },

    eliminar_nota({ nota_id }) {
      if (typeof notes === 'undefined') return { ok: false, error: 'Sin notas' };
      const idx = notes.findIndex(n => n.id === nota_id);
      if (idx === -1) return { ok: false, error: 'Nota no encontrada' };
      const title = notes[idx].title;
      notes.splice(idx, 1);
      if (typeof saveNotes === 'function') saveNotes();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Nota "${title}" eliminada.` };
    },

    asignar_color_nota({ nota_id, color }) {
      if (typeof notes === 'undefined') return { ok: false, error: 'Sin notas' };
      const note = notes.find(n => n.id === nota_id);
      if (!note) return { ok: false, error: 'Nota no encontrada' };
      note.color = color || null;
      if (typeof saveNotes === 'function') saveNotes();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Color "${color}" asignado a la nota "${note.title}".` };
    },

    exportar_captura({ id, tipo }) {
      let targetEl = null;
      let title = 'Captura';

      if (tipo === 'nota' || (!tipo && typeof notes !== 'undefined' && notes.some(n => n.id === id))) {
        const note = (typeof notes !== 'undefined') ? notes.find(n => n.id === id) : null;
        if (note) title = `Nota_${note.title}`;
        targetEl = document.querySelector(`[data-note-id="${id}"]`);
      } else {
        const found = findTask(id);
        if (found) title = `Tarea_${found.task.name}`;
        targetEl = document.querySelector(`[data-task-id="${id}"]`);
      }

      if (!targetEl) return { ok: false, error: 'Elemento no visible actualmente en pantalla' };

      if (typeof capturarElementoComoImagen === 'function') {
        capturarElementoComoImagen(targetEl, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        return { ok: true, mensaje: `Captura HD de "${title}" descargada exitosamente a la carpeta de Descargas.` };
      }
      return { ok: false, error: 'Función de captura no disponible' };
    },

    asignar_etiquetas_tarea({ tarea_id, etiquetas }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.tags = Array.isArray(etiquetas) ? etiquetas : [];
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Etiquetas [${(etiquetas || []).join(', ')}] asignadas a "${found.task.name}".` };
    },

    filtrar_por_etiqueta({ etiqueta }) {
      if (!etiqueta) return { ok: false, error: 'Etiqueta vacía' };
      const q = etiqueta.trim().toLowerCase();
      const resultados = [];
      if (typeof folders !== 'undefined') {
        folders.forEach(f => {
          (f.tasks || []).forEach(t => {
            if (Array.isArray(t.tags) && t.tags.some(tag => tag.toLowerCase().includes(q))) {
              resultados.push({ id: t.id, nombre: t.name, carpeta: f.name, etiquetas: t.tags });
            }
          });
        });
      }
      return { ok: true, total: resultados.length, resultados };
    },

    desglosar_tarea_inteligente({ tarea_id, max_pasos }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const t = found.task;
      const num = max_pasos || 4;
      const pasosSugeridos = [
        { text: `Paso 1: Definir requerimientos y alcance de "${t.name}" (10 min)`, completed: false },
        { text: `Paso 2: Recopilar recursos e información (15 min)`, completed: false },
        { text: `Paso 3: Ejecutar la fase principal de producción (25 min)`, completed: false },
        { text: `Paso 4: Revisar control de calidad y cerrar tarea (10 min)`, completed: false }
      ].slice(0, num);

      if (!Array.isArray(t.steps)) t.steps = [];
      t.steps.push(...pasosSugeridos);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderTasks === 'function') renderTasks();
      return { ok: true, mensaje: `Tarea "${t.name}" desglosada automáticamente en ${pasosSugeridos.length} pasos concretos.`, pasos: pasosSugeridos };
    },

    generar_bloques_tiempo({ hora_inicio, hora_fin, duracion_descanso_min, carpeta_id }) {
      let targetFolders = folders;
      if (carpeta_id) {
        const f = findFolder(carpeta_id);
        if (f) targetFolders = [f];
      }
      let allTasks = [];
      targetFolders.forEach(f => {
        (f.tasks || []).forEach(t => allTasks.push(t));
      });

      if (allTasks.length === 0) return { ok: false, error: 'No hay tareas pendientes para agendar.' };

      let currentMin = 9 * 60;
      if (hora_inicio && hora_inicio.includes(':')) {
        const [h, m] = hora_inicio.split(':').map(Number);
        currentMin = h * 60 + m;
      }
      const descanso = duracion_descanso_min || 5;
      const itinerario = [];

      allTasks.forEach(t => {
        const dur = t.totalTime ? Math.round(t.totalTime / 60) : 30;
        const startH = String(Math.floor(currentMin / 60)).padStart(2, '0');
        const startM = String(currentMin % 60).padStart(2, '0');
        const endMin = currentMin + dur;
        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
        const endM = String(endMin % 60).padStart(2, '0');

        itinerario.push({
          tarea: t.name,
          horario: `${startH}:${startM} - ${endH}:${endM}`,
          duracion: `${dur} min`
        });
        currentMin = endMin + descanso;
      });

      return { ok: true, total_tareas_agendadas: itinerario.length, itinerario };
    },

    obtener_estadisticas_gamificacion() {
      const stats = (typeof userStats !== 'undefined') ? userStats : { xp_total: 0, nivel: 1, racha_dias_consecutivos: 1 };
      return {
        ok: true,
        xp_total: stats.xp_total,
        nivel: stats.nivel,
        racha_dias_consecutivos: stats.racha_dias_consecutivos + ' días',
        proximo_nivel_xp: (stats.nivel * 250) - stats.xp_total + ' XP faltantes'
      };
    },

    configurar_audio_coach({ habilitado, anunciar_pasos }) {
      if (typeof audioCoachConfig === 'undefined') window.audioCoachConfig = { habilitado: true };
      audioCoachConfig.habilitado = !!habilitado;
      if (anunciar_pasos !== undefined) audioCoachConfig.anunciar_pasos = !!anunciar_pasos;
      if (habilitado && typeof speakAudioCoach === 'function') {
        speakAudioCoach('Audio Coach activado correctamente.');
      }
      return { ok: true, mensaje: `Audio Coach ${habilitado ? 'activado 🔊' : 'desactivado 🔇'}.` };
    }
  };

  // --------------------------------------------------------------------------
  //  OPENROUTER
  // --------------------------------------------------------------------------
  async function callOpenRouter(messages) {
    // Si no hay API key, devolvemos un mensaje claro pidiendo configurarla
    if (!AI_CONFIG.apiKey) {
      return {
        _needsKey: true,
        choices: [{
          message: {
            role: 'assistant',
            content: '⚠️ No hay API key de OpenRouter configurada. Tocá el ícono ⚙ junto al título del chat para configurarla.'
          }
        }]
      };
    }
    const body = {
      model: AI_CONFIG.model, messages,
      tools: TOOLS, tool_choice: 'auto',
      temperature: 0.4, max_tokens: 4000
    };
    const res = await fetch(AI_CONFIG.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + AI_CONFIG.apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://asista-multy.app',
        'X-Title': 'ASISTA MULTY'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let friendly = 'OpenRouter HTTP ' + res.status + ': ' + (errText || res.statusText);
      if (res.status === 401) {
        friendly = '🔑 API key inválida o sin permisos. Tocá el ⚙ del chat y verificá tu key de OpenRouter.';
      } else if (res.status === 429) {
        friendly = '⏱️ Límite de uso alcanzado en OpenRouter. Esperá unos minutos o cambiá de modelo.';
      } else if (res.status === 404) {
        friendly = '🤖 El modelo "' + AI_CONFIG.model + '" no existe o no está disponible. Probalo desde ⚙.';
      }
      throw new Error(friendly);
    }
    return res.json();
  }

  function getResumenEstadoRapido() {
    if (typeof folders === 'undefined' || !Array.isArray(folders)) return '';
    const lista = folders.map((f, i) => {
      const cantTareas = (f.tasks || []).length;
      const cantFin = (f.finished || []).length;
      return `- ${f.name} (ID: ${f.id}) [${cantTareas} tareas pdt, ${cantFin} fin]${f.isDefaultRewards ? ' (Recompensas)' : ''}`;
    }).join('\n');
    return '\n\nESTADO ACTUAL EN TIEMPO REAL EN LA APP (' + folders.length + ' carpetas en total):\n' + (lista || '(Sin carpetas)');
  }

  async function runAgent(userText, history) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + getResumenEstadoRapido() },
      ...(history || []),
      { role: 'user', content: userText }
    ];
    const toolTrace = [];
    let iterations = 0;
    let lastAssistantText = '';
    while (iterations < AI_CONFIG.maxToolIterations) {
      iterations++;
      let data;
      try { data = await callOpenRouter(messages); }
      catch (err) { return { text: '❌ Error: ' + err.message, tools: toolTrace, history: messages }; }
      if (!data.choices || !data.choices[0]) {
        return { text: '❌ Respuesta inválida del modelo.', tools: toolTrace, history: messages };
      }
      const choice = data.choices[0];
      const assistantMsg = choice.message || {};
      messages.push(assistantMsg);
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        for (const call of assistantMsg.tool_calls) {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = {}; }
          const fn = call.function.name;
          const exec = TOOL_EXECUTORS[fn];
          let result;
          if (!exec) result = { ok: false, error: 'Tool desconocida: ' + fn };
          else {
            try { result = exec(args); }
            catch (e) { result = { ok: false, error: 'Excepción: ' + (e && e.message ? e.message : String(e)) }; }
          }
          toolTrace.push({ tool: fn, args, result });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 80000)
          });
        }
        continue;
      }
      lastAssistantText = assistantMsg.content || '';
      break;
    }
    if (!lastAssistantText && iterations >= AI_CONFIG.maxToolIterations) {
      lastAssistantText = '⚠️ Alcanzé el máximo de iteraciones.';
    }
    return { text: lastAssistantText, tools: toolTrace, history: trimHistory(messages) };
  }

  function trimHistory(messages) {
    if (messages.length <= 61) return messages;
    return [messages[0], ...messages.slice(messages.length - 60)];
  }

  // --------------------------------------------------------------------------
  //  PERSISTENCE
  // --------------------------------------------------------------------------
  let chats = [];
  let currentChatId = null;
  let skills = [];
  let activeTab = 'history';
  let sidebarOpen = true;
  let isMobile = false;

  function loadChats() {
    try { chats = JSON.parse(localStorage.getItem(STORAGE.chats) || '[]'); } catch (e) { chats = []; }
    if (!Array.isArray(chats)) chats = [];
  }
  function saveChats() { localStorage.setItem(STORAGE.chats, JSON.stringify(chats)); }
  function loadCurrentId() { currentChatId = localStorage.getItem(STORAGE.current) || null; }
  function saveCurrentId() { if (currentChatId) localStorage.setItem(STORAGE.current, currentChatId); }
  function loadSkills() {
    try { skills = JSON.parse(localStorage.getItem(STORAGE.skills) || '[]'); } catch (e) { skills = null; }
    if (!Array.isArray(skills) || skills.length === 0) { skills = DEFAULT_SKILLS.slice(); saveSkills(); }
  }
  function saveSkills() { localStorage.setItem(STORAGE.skills, JSON.stringify(skills)); }
  function loadSidebar() { sidebarOpen = localStorage.getItem(STORAGE.sidebar) !== 'closed'; }
  function saveSidebar() { localStorage.setItem(STORAGE.sidebar, sidebarOpen ? 'open' : 'closed'); }

  function newChat() {
    const id = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const chat = { id, title: 'Nuevo chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    chats.unshift(chat);
    currentChatId = id;
    saveChats(); saveCurrentId();
    return chat;
  }
  function getCurrentChat() { return chats.find(c => c.id === currentChatId) || null; }
  function deleteChat(id) {
    const idx = chats.findIndex(c => c.id === id);
    if (idx === -1) return;
    chats.splice(idx, 1);
    if (currentChatId === id) { currentChatId = chats.length > 0 ? chats[0].id : null; saveCurrentId(); }
    saveChats();
  }
  function renameChat(id, newTitle) {
    const c = chats.find(x => x.id === id);
    if (!c) return;
    c.title = newTitle.trim() || 'Chat sin título';
    c.updatedAt = Date.now();
    saveChats();
  }
  function autoTitle(chat) {
    if (!chat || chat.title !== 'Nuevo chat') return;
    const firstUser = chat.messages.find(m => m.role === 'user');
    if (firstUser && firstUser.content) {
      let t = firstUser.content.trim().slice(0, 38);
      if (firstUser.content.length > 38) t += '…';
      chat.title = t; chat.updatedAt = Date.now(); saveChats();
    }
  }

  // --------------------------------------------------------------------------
  //  UI
  // --------------------------------------------------------------------------
  function initChat() {
    const fab = document.getElementById('aiFab');
    const panel = document.getElementById('aiPanel');
    const closeBtn = document.getElementById('aiCloseBtn');
    const input = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSendBtn');
    const msgs = document.getElementById('aiMessages');
    const sidebar = document.getElementById('aiSidebar');
    const sidebarToggle = document.getElementById('aiSidebarToggle');
    const chatTitle = document.getElementById('aiChatTitle');
    const newChatBtn = document.getElementById('aiNewChatBtn');
    const newSkillBtn = document.getElementById('aiNewSkillBtn');
    const tabs = document.querySelectorAll('.ai-tab');
    const tabContents = document.querySelectorAll('.ai-tab-content');

    if (!fab || !panel || !input || !sendBtn) {
      console.warn('[AI Chat] Faltan elementos del DOM.');
      return;
    }

    loadChats(); loadCurrentId(); loadSkills(); loadSidebar();
    isMobile = window.innerWidth <= 540;

    if (!getCurrentChat()) {
      if (chats.length > 0) currentChatId = chats[0].id;
      else newChat();
      saveCurrentId();
    }

    // ---------- OPEN / CLOSE PANEL ----------
    function openPanel() {
      panel.classList.add('open');
      panel.style.display = 'flex';
      fab.style.display = 'none';
      renderAll();
      applySidebarState();
      setTimeout(() => input.focus(), 200);
    }
    function closePanel() {
      panel.classList.remove('open');
      panel.style.display = 'none';
      fab.style.display = 'block';
    }
    function applySidebarState() {
      if (!isMobile) {
        if (sidebarOpen) sidebar.classList.remove('hidden');
        else sidebar.classList.add('hidden');
        panel.classList.toggle('sidebar-closed', !sidebarOpen);
      } else {
        // En mobile, sidebar está oculto por defecto y se muestra on-demand
        if (sidebarOpen) sidebar.classList.remove('hidden');
        else sidebar.classList.add('hidden');
        panel.classList.toggle('sidebar-closed', !sidebarOpen);
      }
      saveSidebar();
    }
    function toggleSidebar() {
      sidebarOpen = !sidebarOpen;
      applySidebarState();
    }

    // ---------- TABS ----------
    function switchTab(tabName) {
      activeTab = tabName;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
      tabContents.forEach(tc => {
        if (tc.dataset.tab === tabName) tc.classList.remove('hidden');
        else tc.classList.add('hidden');
      });
    }

    // ---------- RENDER ----------
    function renderAll() {
      renderHistory();
      renderSkills();
      renderMessages();
      renderChatTitle();
    }
    function renderChatTitle() {
      const c = getCurrentChat();
      chatTitle.textContent = c ? c.title : 'Chat';
    }
    function renderHistory() {
      const list = document.getElementById('aiHistoryList');
      if (!list) return;
      list.innerHTML = '';
      if (chats.length === 0) {
        const e = document.createElement('div');
        e.className = 'ai-empty';
        e.textContent = 'No hay chats. Tocá "+ Nuevo chat".';
        list.appendChild(e);
        return;
      }
      chats.forEach(c => {
        const item = document.createElement('div');
        item.className = 'ai-list-item';
        if (c.id === currentChatId) item.classList.add('active');
        const title = document.createElement('div');
        title.className = 'ai-list-item-title';
        title.textContent = c.title || 'Chat sin título';
        const meta = document.createElement('div');
        meta.className = 'ai-list-item-meta';
        const count = c.messages.filter(m => m.role === 'user').length;
        meta.textContent = count + ' mensaje' + (count !== 1 ? 's' : '') + ' · ' + formatDate(c.updatedAt);
        const actions = document.createElement('div');
        actions.className = 'ai-list-item-actions';
        const renameBtn = document.createElement('button');
        renameBtn.title = 'Renombrar'; renameBtn.innerHTML = '✏️';
        renameBtn.onclick = async (e) => {
          e.stopPropagation();
          const nuevo = await asistaPrompt('Nuevo título del chat:', c.title, { title: 'Renombrar chat' });
          if (nuevo != null && nuevo.trim()) { renameChat(c.id, nuevo); renderHistory(); renderChatTitle(); }
        };
        const delBtn = document.createElement('button');
        delBtn.title = 'Eliminar'; delBtn.innerHTML = '🗑️';
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const ok = await asistaConfirm('¿Eliminar el chat "' + c.title + '"?', { title: 'Eliminar chat', confirmText: 'Eliminar', cancelText: 'Cancelar' });
          if (ok) {
            deleteChat(c.id); renderHistory(); renderMessages(); renderChatTitle();
          }
        };
        actions.append(renameBtn, delBtn);
        item.append(title, meta, actions);
        item.onclick = () => {
          currentChatId = c.id; saveCurrentId();
          renderHistory(); renderMessages(); renderChatTitle();
          // En mobile, cerrar el sidebar al elegir un chat
          if (isMobile) { sidebarOpen = false; applySidebarState(); }
        };
        list.appendChild(item);
      });
    }
    function renderSkills() {
      const list = document.getElementById('aiSkillsList');
      if (!list) return;
      list.innerHTML = '';
      if (!skills || skills.length === 0) {
        const e = document.createElement('div');
        e.className = 'ai-empty';
        e.textContent = 'No hay skills. Tocá "+ Nuevo skill".';
        list.appendChild(e);
        return;
      }
      skills.forEach(s => {
        const item = document.createElement('div');
        item.className = 'ai-skill-item';
        const icon = document.createElement('div');
        icon.className = 'ai-skill-icon';
        icon.textContent = s.icon || '⚡';
        const body = document.createElement('div');
        body.className = 'ai-skill-body';
        const name = document.createElement('div');
        name.className = 'ai-skill-name';
        name.textContent = s.name;
        const preview = document.createElement('div');
        preview.className = 'ai-skill-preview';
        preview.textContent = s.prompt.length > 60 ? s.prompt.slice(0, 60) + '…' : s.prompt;
        body.append(name, preview);
        const actions = document.createElement('div');
        actions.className = 'ai-list-item-actions';
        const editBtn = document.createElement('button');
        editBtn.title = 'Editar'; editBtn.innerHTML = '✏️';
        editBtn.onclick = (e) => { e.stopPropagation(); openSkillModal(s); };
        const delBtn = document.createElement('button');
        delBtn.title = 'Eliminar'; delBtn.innerHTML = '🗑️';
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const ok = await asistaConfirm('¿Eliminar el skill "' + s.name + '"?', { title: 'Eliminar skill', confirmText: 'Eliminar', cancelText: 'Cancelar' });
          if (ok) {
            skills = skills.filter(x => x.id !== s.id); saveSkills(); renderSkills();
          }
        };
        actions.append(editBtn, delBtn);
        item.append(icon, body, actions);
        item.onclick = () => runSkill(s);
        list.appendChild(item);
      });
    }
    function renderMessages() {
      msgs.innerHTML = '';
      const c = getCurrentChat();
      if (!c) return;
      if (c.messages.length === 0) {
        addAssistantMsg('¡Hola! Soy el asistente de ASISTA MULTY. Puedo crear, editar y eliminar carpetas, tareas, pasos y recompensas por chat. ¿Qué querés hacer?');
        return;
      }
      c.messages.forEach(m => {
        if (m.role === 'user') addUserMsg(m.content);
        else if (m.role === 'assistant') {
          if (m.tools && m.tools.length > 0) {
            m.tools.forEach(t => {
              const r = t.result || {};
              addToolMsg((r.ok ? '✅' : '❌') + ' ' + t.tool + (r.mensaje ? ' → ' + r.mensaje : (r.error ? ' → ' + r.error : '')));
            });
          }
          if (m.content) addAssistantMsg(m.content);
        }
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

    // ---------- MESSAGE HELPERS ----------
    function addUserMsg(text) {
      const div = document.createElement('div');
      div.className = 'ai-msg user';
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function addAssistantMsg(text) {
      const div = document.createElement('div');
      div.className = 'ai-msg assistant';
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function addErrorMsg(text) {
      const div = document.createElement('div');
      div.className = 'ai-msg error';
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function addToolMsg(label) {
      const div = document.createElement('div');
      div.className = 'ai-msg tool';
      div.textContent = '⚙️ ' + label;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function showTyping() {
      const div = document.createElement('div');
      div.className = 'ai-typing';
      div.id = 'aiTyping';
      div.innerHTML = '<span></span><span></span><span></span>';
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function hideTyping() {
      const t = document.getElementById('aiTyping');
      if (t) t.remove();
    }

    function adjustInputHeight() {
      if (!input) return;
      input.style.height = '40px';
      const newH = Math.min(input.scrollHeight, 120);
      input.style.height = (newH > 40 ? newH : 40) + 'px';
    }

    // ---------- MODO HABLADO MANOS LIBRES CONTINUO (UNIFIED VOICE MODE) ----------
    let isVoiceModeActive = false;
    let recognition = null;
    let isListening = false;
    let silenceTimer = null;
    let isSpeechInputActive = false; // Flag para desacoplar el teclado de la voz
    const SILENCE_THRESHOLD_MS = 1200;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const unifiedVoiceBtn = document.getElementById('aiUnifiedVoiceBtn');

    // Desacoplar teclado: Al escribir manualmente por teclado, cancelar cualquier temporizador de silencio por voz
    if (input) {
      input.addEventListener('input', (e) => {
        if (!e.isTrusted || !isSpeechInputActive) {
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        }
      });
    }

    async function requestMicrophoneAccess() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          return true;
        } catch(err) {
          console.warn('Permiso de micrófono denegado:', err);
          if (typeof asistaAlert === 'function') {
            asistaAlert('Por favor activa el permiso de micrófono en tu navegador para usar el Modo Hablado.', { title: 'Micrófono Bloqueado' });
          }
          return false;
        }
      }
      return true;
    }

    function getBestSpanishVoice() {
      if (!('speechSynthesis' in window)) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      const esVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('es'));
      if (esVoices.length === 0) return null;

      const preferred = esVoices.find(v =>
        v.name.includes('Natural') ||
        v.name.includes('Google') ||
        v.name.includes('Neural') ||
        v.name.includes('Sabina') ||
        v.name.includes('Dalia') ||
        v.name.includes('Paulina') ||
        v.name.includes('Monica')
      );

      return preferred || esVoices[0];
    }

    // Asegurar carga de voces en navegadores que cargan voces asíncronamente
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => getBestSpanishVoice();
    }

    function updateUnifiedVoiceBtnState() {
      if (!unifiedVoiceBtn) return;
      if (!isVoiceModeActive) {
        unifiedVoiceBtn.textContent = '🎙️';
        unifiedVoiceBtn.className = 'ai-unified-voice-btn';
        unifiedVoiceBtn.title = 'Activar Modo Hablado Manos Libres';
      } else if (isListening) {
        unifiedVoiceBtn.textContent = '🔴';
        unifiedVoiceBtn.className = 'ai-unified-voice-btn listening';
        unifiedVoiceBtn.title = 'Escuchando tu voz... (tocá para detener el Modo Hablado)';
      } else if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        unifiedVoiceBtn.textContent = '🗣️';
        unifiedVoiceBtn.className = 'ai-unified-voice-btn speaking';
        unifiedVoiceBtn.title = 'Respondiendo... (hablá para interrumpir o tocá para detener)';
      } else {
        unifiedVoiceBtn.textContent = '🎙️';
        unifiedVoiceBtn.className = 'ai-unified-voice-btn active';
        unifiedVoiceBtn.title = 'Modo Hablado Activo (tocá para desactivar)';
      }
    }

    function speakAssistantText(text) {
      if (!isVoiceModeActive || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const clean = (text || '').replace(/[*_#`~>]/g, '').replace(/[\u{1F600}-\u{1F64F}]/gu, '');
        if (!clean.trim()) return;

        const u = new SpeechSynthesisUtterance(clean);
        const bestVoice = getBestSpanishVoice();
        if (bestVoice) {
          u.voice = bestVoice;
          u.lang = bestVoice.lang;
        } else {
          u.lang = 'es-AR';
        }
        u.rate = 1.05;

        u.onstart = () => {
          updateUnifiedVoiceBtnState();
        };

        u.onend = u.onerror = () => {
          updateUnifiedVoiceBtnState();
          if (isVoiceModeActive && recognition && !isListening && !isProcessing) {
            setTimeout(() => {
              try { recognition.start(); } catch(e){}
            }, 300);
          }
        };

        window.speechSynthesis.speak(u);
      } catch(e) {}
    }

    function stopAssistantSpeech() {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      updateUnifiedVoiceBtnState();
    }

    function stopVoiceMode() {
      isVoiceModeActive = false;
      isSpeechInputActive = false;
      if (silenceTimer) clearTimeout(silenceTimer);
      stopAssistantSpeech();
      if (recognition && isListening) {
        try { recognition.stop(); } catch(e){}
      }
      isListening = false;
      updateUnifiedVoiceBtnState();
    }

    if (SpeechRecognitionAPI && unifiedVoiceBtn) {
      try {
        recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-AR';

        recognition.onstart = () => {
          isListening = true;
          updateUnifiedVoiceBtnState();
        };

        recognition.onresult = (event) => {
          isSpeechInputActive = true;
          if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
            stopAssistantSpeech();
          }

          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (input) {
            input.value = transcript;
            adjustInputHeight();
          }

          // Detección de silencio: Solo auto-envía si el texto fue capturado por voz
          if (silenceTimer) clearTimeout(silenceTimer);

          if (transcript.trim().length > 0) {
            silenceTimer = setTimeout(() => {
              if (isVoiceModeActive && isSpeechInputActive && input && input.value.trim().length > 0 && !isProcessing) {
                try { recognition.stop(); } catch(e){}
                send();
              }
            }, SILENCE_THRESHOLD_MS);
          }
        };

        recognition.onerror = (event) => {
          console.warn('Speech error:', event.error);
          if (event.error === 'no-speech' || event.error === 'aborted') {
            isListening = false;
            updateUnifiedVoiceBtnState();
            if (isVoiceModeActive && !isProcessing) {
              setTimeout(() => {
                try { recognition.start(); } catch(e){}
              }, 400);
            }
          } else {
            isListening = false;
            updateUnifiedVoiceBtnState();
          }
        };

        recognition.onend = () => {
          isListening = false;
          updateUnifiedVoiceBtnState();

          if (!isVoiceModeActive) return;

          if (isSpeechInputActive && input && input.value.trim().length > 0) {
            send();
          } else if (!isProcessing && !window.speechSynthesis.speaking) {
            setTimeout(() => {
              if (isVoiceModeActive && !isListening && !isProcessing) {
                try { recognition.start(); } catch(e){}
              }
            }, 400);
          }
        };
      } catch(e) {
        console.error('SpeechRecognition init error:', e);
      }

      unifiedVoiceBtn.onclick = async () => {
        if (!recognition) {
          if (typeof asistaAlert === 'function') asistaAlert('El Modo Hablado por micrófono requiere Google Chrome, Edge o Safari.', { title: 'Navegador' });
          return;
        }
        if (isVoiceModeActive) {
          stopVoiceMode();
        } else {
          const hasMicAccess = await requestMicrophoneAccess();
          if (!hasMicAccess) return;

          isVoiceModeActive = true;
          stopAssistantSpeech();
          // Pequeño timeout para permitir liberación limpia de audio antes de start()
          setTimeout(() => {
            try {
              recognition.start();
            } catch(err) {
              console.error('Mic start err:', err);
            }
          }, 150);
          updateUnifiedVoiceBtnState();
        }
      };
    } else if (unifiedVoiceBtn) {
      unifiedVoiceBtn.onclick = () => {
        if (typeof asistaAlert === 'function') asistaAlert('El Modo Hablado por micrófono requiere Google Chrome, Edge o Safari.', { title: 'Navegador' });
      };
    }

    // ---------- SEND ----------
    let isProcessing = false;
    async function send() {
      const text = (input.value || '').trim();
      if (!text || isProcessing) return;
      isProcessing = true;
      sendBtn.disabled = true;
      input.value = '';
      adjustInputHeight();
      addUserMsg(text);
      let chat = getCurrentChat();
      if (!chat) { chat = newChat(); renderHistory(); }
      chat.messages.push({ role: 'user', content: text });
      chat.updatedAt = Date.now();
      showTyping();
      try {
        const history = chat.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content || '' }));
        const result = await runAgent(text, history);
        hideTyping();
        for (const t of result.tools) {
          const r = t.result || {};
          addToolMsg((r.ok ? '✅' : '❌') + ' ' + t.tool + (r.mensaje ? ' → ' + r.mensaje : (r.error ? ' → ' + r.error : '')));
        }
        addAssistantMsg(result.text || '(sin respuesta)');
        chat.messages.push({ role: 'assistant', content: result.text || '', tools: result.tools });
        chat.updatedAt = Date.now();
        autoTitle(chat);
        saveChats();
        renderHistory();
        renderChatTitle();

        // Hablar respuesta si la voz está activada
        speakAssistantText(result.text || '');
      } catch (err) {
        hideTyping();
        addErrorMsg('Error: ' + (err && err.message ? err.message : String(err)));
      } finally {
        isProcessing = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }
    async function runSkill(skill) {
      input.value = skill.prompt;
      adjustInputHeight();
      await send();
    }

    // ---------- AISLAMIENTO TOUCH MÓVIL (PULL-TO-REFRESH PREVENTION) ----------
    [msgs, input, sidebar].forEach(el => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        if (el.scrollTop === 0) el.scrollTop = 1;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
          el.scrollTop = el.scrollHeight - el.clientHeight - 1;
        }
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        e.stopPropagation();
      }, { passive: true });
    });

    // ---------- MODAL (con backdrop robusto) ----------
    function openSkillModal(existing) {
      const modal = document.getElementById('aiSkillModal');
      if (!modal) return;
      const nameInput = document.getElementById('aiSkillName');
      const iconInput = document.getElementById('aiSkillIcon');
      const promptInput = document.getElementById('aiSkillPrompt');
      const title = document.getElementById('aiSkillModalTitle');
      const saveBtn = document.getElementById('aiSkillSaveBtn');
      const cancelBtn = document.getElementById('aiSkillCancelBtn');

      title.textContent = existing ? 'Editar skill' : 'Nuevo skill';
      nameInput.value = existing ? existing.name : '';
      iconInput.value = existing ? (existing.icon || '⚡') : '⚡';
      promptInput.value = existing ? existing.prompt : '';
      modal.classList.add('open');
      modal.style.display = 'flex';
      nameInput.focus();

      function close() {
        modal.classList.remove('open');
        modal.style.display = 'none';
        saveBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
        document.removeEventListener('keydown', escHandler);
      }
      function escHandler(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', escHandler);

      modal.onclick = (e) => { if (e.target === modal) close(); };

      saveBtn.onclick = () => {
        const name = (nameInput.value || '').trim();
        const icon = (iconInput.value || '⚡').trim() || '⚡';
        const prompt = (promptInput.value || '').trim();
        if (!name) { nameInput.focus(); return; }
        if (!prompt) { promptInput.focus(); return; }
        if (existing) {
          existing.name = name; existing.icon = icon; existing.prompt = prompt;
        } else {
          skills.push({ id: 'skill_user_' + Date.now(), name, icon, prompt, isDefault: false });
        }
        saveSkills();
        renderSkills();
        close();
      };
      cancelBtn.onclick = close;
    }

    // ---------- EVENTS ----------
    fab.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    sidebarToggle.addEventListener('click', toggleSidebar);
    newChatBtn.addEventListener('click', () => {
      const c = newChat();
      renderHistory(); renderMessages(); renderChatTitle();
      if (isMobile) { sidebarOpen = false; applySidebarState(); }
      setTimeout(() => input.focus(), 100);
    });
    newSkillBtn.addEventListener('click', () => openSkillModal(null));
    chatTitle.addEventListener('click', async () => {
      const c = getCurrentChat();
      if (!c) return;
      const nuevo = await asistaPrompt('Título del chat:', c.title, { title: 'Renombrar chat' });
      if (nuevo != null && nuevo.trim()) {
        renameChat(c.id, nuevo); renderHistory(); renderChatTitle();
      }
    });

    const settingsBtn = document.getElementById('aiSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', async () => {
        await asistaSettings();
        reloadAIConfig();
        if (!AI_CONFIG.apiKey) {
          await asistaAlert('Sin API key no puedo responder. Configurala cuando quieras tocando este mismo botón.', { title: 'API key no configurada', type: 'warn' });
        }
      });
    }

    if (!AI_CONFIG.apiKey && !sessionStorage.getItem('asista_ai_prompted_key')) {
      sessionStorage.setItem('asista_ai_prompted_key', '1');
      setTimeout(async () => {
        await asistaSettings();
        reloadAIConfig();
      }, 600);
    }

    sendBtn.addEventListener('click', async function aiSendGuard(e) {
      if (!AI_CONFIG.apiKey) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const ok = await asistaSettings();
        reloadAIConfig();
        if (AI_CONFIG.apiKey) {
          sendBtn.click();
        } else {
          await asistaAlert('Sin API key no puedo responder mensajes. Tocá el ⚙ del header cuando quieras configurarla.', { title: 'Falta la API key', type: 'warn' });
        }
      }
    }, true);
    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    sendBtn.addEventListener('click', send);

    input.addEventListener('input', adjustInputHeight);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
        adjustInputHeight();
      }
    });
    window.addEventListener('resize', () => {
      const wasMobile = isMobile;
      isMobile = window.innerWidth <= 540;
      if (wasMobile !== isMobile) applySidebarState();
    });
    // Resize handling
    window.addEventListener('resize', () => {
      const wasMobile = isMobile;
      isMobile = window.innerWidth <= 540;
      if (wasMobile !== isMobile) applySidebarState();
    });
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ese = new Date(ts);
    ese.setHours(0, 0, 0, 0);
    if (ese.getTime() === hoy.getTime()) {
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    setTimeout(initChat, 50);
  }
})();

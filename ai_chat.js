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

  const SYSTEM_PROMPT = `Sos el Copiloto Proactivo de "Efectiva / ASISTA MULTY", con control total sobre tareas, memoria por nodos/grados y motor financiero multi-moneda (GTQ/USD).

REGLAS DE EFICIENCIA (OBLIGATORIAS):
1. **Lectura Lazy Loading**: Usá \`obtener_estado()\` en modo "resumen" (por defecto) y bajá a detalle solo lo necesario con \`obtener_carpeta\`, \`obtener_tarea\` o \`leer_nota\`. Para editar notas existentes preferí \`parchear_nota\` (append/prepend/reemplazar_seccion) en lugar de reenviar documentos enteros.
2. **Memoria por Nodos y Grados**:
   - Grado 0 (Núcleo, ≤8 registros breves): reglas globales siempre visibles.
   - Grado 1 (Nodos de dominio: \`finanzas\`, \`metas\`, \`ineb\`, \`iglesia\`, \`proyectos\`, \`hogar\`, \`investigacion\`): cargalos bajo demanda con \`cargar_nodo_memoria(nodo, grado_maximo=1)\`.
   - Grado 2 (Histórico detallado): solo con \`buscar_memoria_relevante\` o \`grado_maximo=2\`.
3. **Motor Financiero Estructurado (GTQ / USD)**: Para cuentas, movimientos, transferencias, deudas, por cobrar, inversiones (provee vs drena) y arqueos, usá SIEMPRE las tools \`fin_*\` (\`fin_obtener_resumen\`, \`fin_gestionar_cuenta\`, \`fin_registrar_movimiento\`, \`fin_gestionar_compromiso\`, \`fin_gestionar_inversion\`, \`fin_conciliar_arqueo\`, \`fin_exportar_a_nota\`) — el código calcula al centavo exacto sin reescribir notas Markdown.
4. **Control Operativo y Proactividad**: Usá \`guardar_tarea_completa\` (soporta minutos decimales exactos ej. 1.5 min = 90s), \`recalcular_agenda_dia\`, \`analizar_patrones_rendimiento\` (con filtros \`fecha_desde\`/\`fecha_hasta\`), \`buscar_web\` y \`leer_url_web\`. Confirmá siempre tus cambios con tools reales antes de responder.`;

  // --------------------------------------------------------------------------
  //  TOOL DEFINITIONS
  // --------------------------------------------------------------------------
  const TOOLS = [
    { type: 'function', function: { name: 'obtener_estado',
      description: 'Devuelve el estado de la app. Por defecto en modo "resumen" (ultraligero: solo carpetas y tareas activas sin pasos ni completadas).',
      parameters: {
        type: 'object',
        properties: {
          modo: { type: 'string', description: 'resumen (default) | completo' },
          incluir_completadas: { type: 'boolean', description: 'Default false' },
          incluir_pasos: { type: 'boolean', description: 'Default false' }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'obtener_carpeta',
      description: 'Lectura granular Grado 2: devuelve solo una carpeta específica con sus tareas.',
      parameters: {
        type: 'object',
        properties: {
          carpeta_id: { type: 'string' },
          incluir_completadas: { type: 'boolean', description: 'Default false' },
          incluir_pasos: { type: 'boolean', description: 'Default false' }
        },
        required: ['carpeta_id']
      } } },
    { type: 'function', function: { name: 'obtener_tarea',
      description: 'Lectura granular Grado 2: devuelve el detalle completo de una sola tarea (pasos, tiempos exactos en seg/min y delayLogs).',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'leer_nota',
      description: 'Lectura granular Grado 2: devuelve el contenido completo de una sola nota por su ID.',
      parameters: { type: 'object', properties: { nota_id: { type: 'string' } }, required: ['nota_id'] } } },
    { type: 'function', function: { name: 'parchear_nota',
      description: 'Edita una nota existente sin reenviar todo el documento (append, prepend o reemplazar_seccion Markdown).',
      parameters: {
        type: 'object',
        properties: {
          nota_id: { type: 'string' },
          modo: { type: 'string', description: 'append | prepend | reemplazar_seccion' },
          texto: { type: 'string' },
          encabezado_objetivo: { type: ['string', 'null'], description: 'Título de sección Markdown para reemplazar_seccion (ej: "## Deudas" o "Deudas")' }
        },
        required: ['nota_id', 'modo', 'texto']
      } } },
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
    { type: 'function', function: { name: 'guardar_tarea_completa',
      description: 'Crea o actualiza de forma atómica una tarea completa en una sola llamada: nombre, pasos (con minutos y estado completado), tiempo total, prioridad, color, fecha_iso, etiquetas y posición.',
      parameters: {
        type: 'object',
        properties: {
          carpeta_id: { type: 'string' },
          tarea_id: { type: ['string', 'null'], description: 'Si se envía, actualiza esta tarea existente en lugar de crear una nueva' },
          nombre: { type: 'string' },
          pasos: {
            type: 'array',
            items: {
              type: ['string', 'object'],
              properties: { descripcion: { type: 'string' }, minutos: { type: 'number' }, completado: { type: 'boolean' } }
            },
            description: 'Lista de pasos (strings u objetos {descripcion, minutos, completado})'
          },
          tiempo_minutos: { type: ['number', 'null'] },
          prioridad: { type: ['string', 'null'], description: 'alta | media | baja | ninguna' },
          color: { type: ['string', 'null'], description: 'Color hex #RRGGBB' },
          fecha_iso: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          etiquetas: { type: 'array', items: { type: 'string' } },
          posicion: { type: ['integer', 'null'], description: 'Posición 0-based dentro de la carpeta' }
        },
        required: ['carpeta_id', 'nombre']
      } } },
    { type: 'function', function: { name: 'registrar_retraso_paso',
      description: 'Justifica y registra un retraso (números rojos) en un paso de una tarea, con opción de sumar minutos extra al paso.',
      parameters: {
        type: 'object',
        properties: {
          tarea_id: { type: 'string' },
          paso_indice: { type: 'integer' },
          motivo: { type: 'string' },
          minutos_extra: { type: 'number', description: 'Minutos extra opcionales a sumar al paso' }
        },
        required: ['tarea_id', 'paso_indice', 'motivo']
      } } },
    { type: 'function', function: { name: 'renombrar_tarea',
      description: 'Cambia el nombre de una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, nuevo_nombre: { type: 'string' } }, required: ['tarea_id', 'nuevo_nombre'] } } },
    { type: 'function', function: { name: 'asignar_tiempo_tarea',
      description: 'Asigna o quita el tiempo total de una tarea (minutos) y lo reparte equitativamente entre los pasos. null = quitar.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, tiempo_minutos: { type: ['number', 'null'] } }, required: ['tarea_id', 'tiempo_minutos'] } } },
    { type: 'function', function: { name: 'asignar_tiempos_pasos',
      description: 'Asigna o distribuye tiempos personalizados en minutos a cada paso de una tarea (puede ser un array completo tiempos_minutos o un paso_indice + minutos puntual).',
      parameters: {
        type: 'object',
        properties: {
          tarea_id: { type: 'string' },
          tiempos_minutos: { type: 'array', items: { type: 'number' }, description: 'Lista de minutos por cada paso en orden, ej: [2, 3, 5]' },
          paso_indice: { type: 'integer', description: 'Índice (0-based) de un paso específico a editar' },
          minutos: { type: 'number', description: 'Minutos a asignar al paso_indice' },
          actualizar_total: { type: 'boolean', description: 'Si true, actualiza el totalTime de la tarea a la suma de los pasos' }
        },
        required: ['tarea_id']
      } } },
    { type: 'function', function: { name: 'iniciar_presentacion_tarea',
      description: 'Inicia la presentación (Play) de una tarea específica en un paso opcional, activando su temporizador y alarma.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, paso_indice: { type: 'integer', description: 'Paso inicial (0-based), por defecto 0' } }, required: ['tarea_id'] } } },
    { type: 'function', function: { name: 'silenciar_alarma',
      description: 'Silencia la alarma de tiempo agotado que esté sonando en la presentación activa.',
      parameters: { type: 'object', properties: {}, required: [] } } },
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
      description: 'Genera métricas y reporte de productividad global o por carpeta, con filtros opcionales de fecha.',
      parameters: {
        type: 'object',
        properties: {
          carpeta_id: { type: ['string', 'null'] },
          fecha_desde: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          fecha_hasta: { type: ['string', 'null'], description: 'YYYY-MM-DD' }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'ejecutar_accion_en_lote',
      description: 'Aplica una acción en masa (marcar_completada, eliminar, cambiar_prioridad, cambiar_color, mover) sobre múltiples tareas.',
      parameters: {
        type: 'object',
        properties: {
          filtro: { type: 'object', properties: { carpeta_id: { type: 'string' }, prioridad: { type: 'string' }, nombre_contiene: { type: 'string' }, etiqueta: { type: 'string' }, tarea_ids: { type: 'array', items: { type: 'string' } } } },
          accion: { type: 'string', description: 'marcar_completada | eliminar | cambiar_prioridad | cambiar_color | mover | asignar_fecha | asignar_etiquetas' },
          parametros_accion: { type: 'object', properties: { nueva_prioridad: { type: 'string' }, nuevo_color: { type: 'string' }, carpeta_destino_id: { type: 'string' }, fecha_iso: { type: ['string', 'null'] }, etiquetas: { type: 'array', items: { type: 'string' } } } }
        },
        required: ['accion']
      } } },
    { type: 'function', function: { name: 'registrar_tiempo_real',
      description: 'Registra el tiempo real invertido/consumido en minutos en una tarea.',
      parameters: { type: 'object', properties: { tarea_id: { type: 'string' }, minutos_reales: { type: 'integer' }, comentario: { type: ['string', 'null'] } }, required: ['tarea_id', 'minutos_reales'] } } },
    { type: 'function', function: { name: 'crear_regla_automatizacion',
      description: 'Crea una regla automática (disparadores: paso_completado, tiempo_paso_agotado, hora_programada, tarea_completada, carpeta_completada -> crear_tarea, mover_tarea, iniciar_presentacion_tarea, siguiente_paso, aplicar_plantilla, crear_recompensa, asignar_prioridad, asignar_color).',
      parameters: {
        type: 'object',
        properties: {
          evento: { type: 'string', description: 'paso_completado | tiempo_paso_agotado | hora_programada | tarea_completada | carpeta_completada' },
          condicion: { type: 'object', properties: { carpeta_id: { type: 'string' }, prioridad: { type: 'string' }, tarea_id: { type: 'string' }, paso_indice: { type: 'integer' }, paso_contiene: { type: 'string' }, hora: { type: 'string', description: 'HH:MM para hora_programada' }, dias: { type: 'array', items: { type: 'integer' }, description: 'Días 0=Dom..6=Sab' } } },
          accion_automatica: { type: 'string', description: 'crear_tarea | mover_tarea | iniciar_presentacion_tarea | siguiente_paso | aplicar_plantilla | crear_recompensa | asignar_prioridad | asignar_color' },
          parametros_accion: { type: 'object', properties: { nombre: { type: 'string' }, tiempo_minutos: { type: 'number' }, pasos: { type: 'array', items: { type: 'string' } }, prioridad: { type: 'string' }, color: { type: 'string' }, carpeta_destino_id: { type: 'string' }, tarea_id: { type: 'string' }, paso_indice: { type: 'integer' }, plantilla_id: { type: 'string' }, nueva_prioridad: { type: 'string' }, nuevo_color: { type: 'string' } } }
        },
        required: ['evento', 'accion_automatica']
      } } },
    { type: 'function', function: { name: 'guardar_plantilla_usuario',
      description: 'Crea o edita una plantilla personalizada (a partir de tarea_id o desde cero con pasos/tiempos, o actualizando plantilla_id existente), incluyendo formato_agradecimiento y alineacion_cuadridimensional.',
      parameters: {
        type: 'object',
        properties: {
          plantilla_id: { type: ['string', 'null'], description: 'Si se envía, edita la plantilla existente sin borrarla' },
          tarea_id: { type: ['string', 'null'], description: 'Opcional: tarea origen para clonar como plantilla' },
          nombre_plantilla: { type: 'string' },
          pasos: { type: 'array', items: { type: 'string' } },
          tiempo_minutos: { type: ['number', 'null'] },
          tiempos_pasos_minutos: { type: 'array', items: { type: 'number' } },
          color: { type: ['string', 'null'] },
          prioridad: { type: ['string', 'null'] },
          formato_agradecimiento: { type: 'string' },
          alineacion_cuadridimensional: {
            type: 'object',
            properties: {
              cuerpo: { type: 'string' },
              mente: { type: 'string' },
              emociones: { type: 'string' },
              espiritu: { type: 'string' }
            }
          }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'listar_plantillas_usuario',
      description: 'Lista todas las plantillas personalizadas guardadas por el usuario.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'aplicar_plantilla_usuario',
      description: 'Aplica una plantilla personalizada en una carpeta (opcionalmente cambiando nombre, fecha_iso y posición).',
      parameters: { type: 'object', properties: { plantilla_id: { type: 'string' }, carpeta_destino_id: { type: 'string' }, nombre_personalizado: { type: 'string' }, fecha_iso: { type: 'string' }, posicion: { type: 'integer' } }, required: ['plantilla_id'] } } },
    { type: 'function', function: { name: 'eliminar_plantilla_usuario',
      description: 'Elimina una plantilla personalizada por su ID.',
      parameters: { type: 'object', properties: { plantilla_id: { type: 'string' } }, required: ['plantilla_id'] } } },
    { type: 'function', function: { name: 'listar_reglas_automatizacion',
      description: 'Devuelve todas las reglas de automatización activas.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'actualizar_regla_automatizacion',
      description: 'Edita o activa/pausa una regla de automatización existente sin tener que borrarla.',
      parameters: {
        type: 'object',
        properties: {
          regla_id: { type: 'string' },
          activa: { type: 'boolean' },
          evento: { type: 'string' },
          condicion: { type: 'object' },
          accion_automatica: { type: 'string' },
          parametros_accion: { type: 'object' }
        },
        required: ['regla_id']
      } } },
    { type: 'function', function: { name: 'eliminar_regla_automatizacion',
      description: 'Elimina una regla de automatización por su ID.',
      parameters: { type: 'object', properties: { regla_id: { type: 'string' } }, required: ['regla_id'] } } },
    { type: 'function', function: { name: 'editar_nota',
      description: 'Edita el título, contenido, etiquetas o vínculo de una nota existente.',
      parameters: {
        type: 'object',
        properties: {
          nota_id: { type: 'string' },
          titulo: { type: 'string' },
          contenido: { type: 'string' },
          etiquetas: { type: 'array', items: { type: 'string' } },
          carpeta_id: { type: ['string', 'null'] },
          tarea_id: { type: ['string', 'null'] }
        },
        required: ['nota_id']
      } } },
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
      description: 'Lista notas guardadas. Por defecto incluir_contenido=false (solo metadata y preview de 120 chars para ahorrar tokens).',
      parameters: {
        type: 'object',
        properties: {
          carpeta_id: { type: ['string', 'null'] },
          tarea_id: { type: ['string', 'null'] },
          incluir_contenido: { type: 'boolean', description: 'Default false' }
        },
        required: []
      } } },
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
          carpeta_id: { type: ['string', 'null'] },
          aplicar_como_reglas: { type: 'boolean', description: 'Si true, crea reglas hora_programada para iniciar automáticamente la presentación de cada tarea a su hora' }
        },
        required: ['hora_inicio']
      } } },
    { type: 'function', function: { name: 'obtener_estadisticas_gamificacion',
      description: 'Obtiene las estadísticas de XP total, nivel actual y racha de días consecutivos del usuario.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'guardar_memoria_usuario',
      description: 'Guarda un recuerdo en el grafo de 3 grados: grado 0 (Núcleo, ≤8 reglas globales), grado 1 (Nodo de dominio: finanzas, metas, ineb, iglesia, proyectos, hogar, investigacion), grado 2 (histórico detallado).',
      parameters: {
        type: 'object',
        properties: {
          categoria: { type: 'string', description: 'Categoría o dominio' },
          nodo: { type: 'string', description: 'Dominio del nodo: finanzas | metas | ineb | iglesia | proyectos | hogar | investigacion | general' },
          grado: { type: 'integer', description: '0 (Núcleo) | 1 (Resumen de dominio) | 2 (Histórico profundo)' },
          clave: { type: 'string', description: 'Identificador corto único' },
          valor: { type: 'string', description: 'Información completa' },
          resumen_corto: { type: 'string', description: 'Resumen <=200 chars para carga barata' },
          conexiones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tipo: { type: 'string', description: 'carpeta | tarea | nota | regla | memoria' },
                id: { type: 'string' },
                relacion: { type: 'string' }
              }
            }
          },
          es_nucleo: { type: 'boolean', description: 'Compatibilidad: true equivale a grado 0' }
        },
        required: ['clave', 'valor']
      } } },
    { type: 'function', function: { name: 'buscar_memoria_relevante',
      description: 'Busca en la memoria histórica (Grado 0, 1 y 2) solo los recuerdos relevantes para la consulta actual.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Tema, proyecto o palabra clave a recordar' },
          nodo: { type: ['string', 'null'], description: 'Filtrar opcionalmente por nodo de dominio' },
          grado_maximo: { type: ['integer', 'null'], description: 'Opcional: 0, 1 o 2 (default 2)' },
          top_k: { type: 'integer', description: 'Máximo de recuerdos a traer (default 5)' }
        },
        required: ['consulta']
      } } },
    { type: 'function', function: { name: 'obtener_contexto_vivo',
      description: 'Tool ultracompacta (<150 tokens): devuelve hora local exacta, presentación/paso activo en pantalla y los próximos 3 bloques programados del día.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'consultar_memoria_usuario',
      description: 'Consulta los recuerdos guardados del usuario, opcionalmente filtrados por categoría.',
      parameters: { type: 'object', properties: { categoria: { type: ['string', 'null'] } }, required: [] } } },
    { type: 'function', function: { name: 'eliminar_memoria_usuario',
      description: 'Elimina un recuerdo de memoria por memoria_id o clave.',
      parameters: { type: 'object', properties: { memoria_id: { type: 'string' }, clave: { type: 'string' } }, required: [] } } },
    { type: 'function', function: { name: 'recalcular_agenda_dia',
      description: 'Motor GPS: recorre hacia adelante las reglas hora_programada activas del día cuando hay un retraso.',
      parameters: {
        type: 'object',
        properties: {
          minutos_retraso: { type: 'integer', description: 'Minutos a desplazar la agenda (ej: 15)' },
          hora_desde: { type: ['string', 'null'], description: 'HH:MM desde donde reajustar (por defecto hora local actual)' }
        },
        required: ['minutos_retraso']
      } } },
    { type: 'function', function: { name: 'analizar_patrones_rendimiento',
      description: 'Analiza retrasos (delayLogs) y tiempos reales vs estimados, opcionalmente acotado por fecha_desde / fecha_hasta.',
      parameters: {
        type: 'object',
        properties: {
          fecha_desde: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          fecha_hasta: { type: ['string', 'null'], description: 'YYYY-MM-DD' }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'buscar_web',
      description: 'Busca información actualizada en la web en tiempo real y opcionalmente la guarda en una Nota vinculada.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string' },
          guardar_en_nota_titulo: { type: ['string', 'null'] },
          carpeta_id: { type: ['string', 'null'] },
          tarea_id: { type: ['string', 'null'] }
        },
        required: ['consulta']
      } } },
    { type: 'function', function: { name: 'leer_url_web',
      description: 'Lee una página web (vía Jina Reader en Markdown limpio) y opcionalmente guarda el contenido en una Nota.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          guardar_en_nota_titulo: { type: ['string', 'null'] },
          carpeta_id: { type: ['string', 'null'] },
          tarea_id: { type: ['string', 'null'] }
        },
        required: ['url']
      } } },
    { type: 'function', function: { name: 'configurar_audio_coach',
      description: 'Activa o desactiva la síntesis de voz en voz alta durante las rutinas / playlist.',
      parameters: { type: 'object', properties: { habilitado: { type: 'boolean' }, anunciar_pasos: { type: 'boolean' } }, required: ['habilitado'] } } },
    { type: 'function', function: { name: 'cargar_nodo_memoria',
      description: 'Carga bajo demanda (<400 tokens) el resumen de un nodo de dominio (ej. finanzas, metas, ineb, iglesia, proyectos, hogar, investigacion) y sus IDs conectados.',
      parameters: {
        type: 'object',
        properties: {
          nodo: { type: 'string', description: 'Nombre del nodo de dominio' },
          grado_maximo: { type: 'integer', description: '0, 1 (default) o 2' }
        },
        required: ['nodo']
      } } },
    { type: 'function', function: { name: 'fin_gestionar_cuenta',
      description: 'Motor financiero (GTQ/USD en centavos): crea, actualiza, ajusta saldo o lista cuentas (banco, billetera_fisica, crypto, reserva).',
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', description: 'crear | actualizar | ajustar_saldo | listar' },
          cuenta_id: { type: ['string', 'null'] },
          nombre: { type: 'string' },
          tipo: { type: 'string', description: 'banco | billetera_fisica | crypto | reserva' },
          moneda: { type: 'string', description: 'GTQ | USD' },
          saldo_inicial: { type: 'number' },
          saldo_actual: { type: 'number' },
          notas: { type: 'string' }
        },
        required: ['accion']
      } } },
    { type: 'function', function: { name: 'fin_registrar_movimiento',
      description: 'Registra ingreso, egreso, transferencia, pago_deuda, cobro, aporte_inversion o retorno_inversion actualizando saldos exactos al centavo.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', description: 'ingreso | egreso | transferencia | pago_deuda | cobro | aporte_inversion | retorno_inversion' },
          monto: { type: 'number' },
          moneda: { type: 'string', description: 'GTQ | USD' },
          cuenta_id: { type: 'string' },
          cuenta_destino_id: { type: ['string', 'null'] },
          monto_destino: { type: ['number', 'null'] },
          tipo_cambio_usd_gtq: { type: ['number', 'null'] },
          categoria: { type: 'string' },
          descripcion: { type: 'string' },
          fecha_iso: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          tarea_id: { type: ['string', 'null'] },
          referencia_entidad_id: { type: ['string', 'null'], description: 'ID de compromiso o inversión' }
        },
        required: ['tipo', 'monto', 'cuenta_id']
      } } },
    { type: 'function', function: { name: 'fin_gestionar_compromiso',
      description: 'Gestiona cuentas por pagar (deudas) o por cobrar en GTQ/USD.',
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', description: 'crear | actualizar | listar | eliminar' },
          compromiso_id: { type: ['string', 'null'] },
          tipo: { type: 'string', description: 'por_pagar | por_cobrar' },
          contraparte: { type: 'string' },
          concepto: { type: 'string' },
          monto_total: { type: 'number' },
          saldo_pendiente: { type: 'number' },
          moneda: { type: 'string', description: 'GTQ | USD' },
          cuota_mensual: { type: ['number', 'null'] },
          dia_corte: { type: ['integer', 'null'] },
          fecha_limite: { type: ['string', 'null'] },
          estado: { type: 'string' }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'fin_gestionar_inversion',
      description: 'Gestiona inversiones/empresas/plataformas y calcula automáticamente flujo_neto, roi_porcentaje y clasificación (provee | equilibrio | drena).',
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', description: 'crear | actualizar | listar | eliminar' },
          inversion_id: { type: ['string', 'null'] },
          nombre: { type: 'string' },
          moneda: { type: 'string', description: 'GTQ | USD' },
          capital_invertido: { type: 'number' },
          retornos_acumulados: { type: 'number' },
          costos_acumulados: { type: 'number' },
          estado: { type: 'string', description: 'activa | pausada | cerrada' }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'fin_conciliar_arqueo',
      description: 'Compara el saldo contado real de una cuenta contra el calculado y opcionalmente crea ajuste_conciliacion exacto al centavo.',
      parameters: {
        type: 'object',
        properties: {
          cuenta_id: { type: 'string' },
          saldo_contado_real: { type: 'number' },
          crear_ajuste: { type: 'boolean' },
          descripcion: { type: 'string' }
        },
        required: ['cuenta_id', 'saldo_contado_real']
      } } },
    { type: 'function', function: { name: 'fin_obtener_resumen',
      description: 'Resumen financiero compacto (<250 tokens): liquidez por moneda/tipo, deudas, por cobrar, posición neta, flujo del mes, inversiones (provee vs drena) y últimos N movimientos.',
      parameters: {
        type: 'object',
        properties: {
          moneda_vista: { type: ['string', 'null'], description: 'GTQ | USD para consolidado' },
          incluir_movimientos_recientes: { type: 'integer', description: 'Default 5' },
          incluir_deudas: { type: 'boolean', description: 'Default true' },
          incluir_inversiones: { type: 'boolean', description: 'Default true' },
          tipo_cambio_usd_gtq: { type: ['number', 'null'] }
        },
        required: []
      } } },
    { type: 'function', function: { name: 'fin_exportar_a_nota',
      description: 'Genera un snapshot legible en Markdown del estado financiero y lo guarda como una Nota.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          carpeta_id: { type: ['string', 'null'] },
          tipo_cambio_usd_gtq: { type: ['number', 'null'] }
        },
        required: []
      } } }
  ];

  // --------------------------------------------------------------------------
  //  STATE HELPERS (v34 — COMPACT LAZY LOADING & EXACT DECIMAL MINUTES)
  // --------------------------------------------------------------------------
  function secToMinExact(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round((n / 60) * 100) / 100;
  }

  function serializeStepsUnified(t, forceCompleted = false) {
    const curIdx = t.currentStepIndex || 0;
    return (t.steps || []).map((s, idx) => {
      const seg = (Array.isArray(t.stepTimes) && typeof t.stepTimes[idx] === 'number') ? Math.round(t.stepTimes[idx]) : 0;
      return {
        i: idx,
        texto: (typeof s === 'string') ? s : (s && (s.text || s.texto || s.descripcion) ? String(s.text || s.texto || s.descripcion) : ''),
        min: seg > 0 ? secToMinExact(seg) : null,
        seg: seg > 0 ? seg : null,
        ok: forceCompleted ? true : ((typeof s === 'object' && s !== null && typeof s.completed === 'boolean') ? s.completed : (idx < curIdx))
      };
    });
  }

  function serializeTaskForAI(t, incluirPasos = false, isCompleted = false) {
    const base = {
      id: t.id,
      nombre: t.name,
      prioridad: t.priority || null,
      fecha_vencimiento: t.dueDate || null,
      etiquetas: Array.isArray(t.tags) ? t.tags : [],
      tiempo_minutos: t.totalTime ? secToMinExact(t.totalTime) : (t.rewardTime || null),
      cantidad_pasos: Array.isArray(t.steps) ? t.steps.length : 0,
      cantidad_retrasos: Array.isArray(t.delayLogs) ? t.delayLogs.length : 0
    };
    if (t.isReward) base.es_recompensa = true;
    if (isCompleted && t.completedAt) base.fecha_completada = t.completedAt;
    if (incluirPasos) {
      base.tiempo_total_segundos = t.totalTime ? Math.round(t.totalTime) : null;
      base.tiempo_real_min = t.actualTimeMinutes || null;
      base.color = t.color || null;
      base.pasos = serializeStepsUnified(t, isCompleted);
      if (Array.isArray(t.delayLogs) && t.delayLogs.length > 0) base.retrasos = t.delayLogs;
    }
    return base;
  }

  function serializeFolderForAI(f, incluirCompletadas = false, incluirPasos = false) {
    const out = {
      id: f.id,
      nombre: f.name,
      es_recompensas: !!f.isDefaultRewards,
      cantidad_tareas: (f.tasks || []).length,
      cantidad_completadas: (f.finished || []).length,
      tareas: (f.tasks || []).map(t => serializeTaskForAI(t, incluirPasos, false))
    };
    if (incluirCompletadas) {
      out.tareas_completadas = (f.finished || []).map(t => serializeTaskForAI(t, incluirPasos, true));
    }
    return out;
  }

  function getStateSnapshot(opts = {}) {
    const modo = String(opts.modo || 'resumen').toLowerCase();
    const isFull = modo === 'completo';
    const incluirCompletadas = opts.incluir_completadas !== undefined ? !!opts.incluir_completadas : isFull;
    const incluirPasos = opts.incluir_pasos !== undefined ? !!opts.incluir_pasos : isFull;

    const activePres = (typeof presentationOpen !== 'undefined' && presentationOpen && typeof currentPresentationTask !== 'undefined' && currentPresentationTask)
      ? {
          tarea_id: currentPresentationTask.id,
          tarea_nombre: currentPresentationTask.name,
          paso_actual_indice: (typeof currentStepIndex !== 'undefined') ? currentStepIndex : 0,
          total_pasos: (typeof presentationSteps !== 'undefined') ? presentationSteps.length : 0,
          segundos_restantes: currentPresentationTask.totalTime ? ((typeof currentStepCountdown !== 'undefined') ? currentStepCountdown : 0) : null,
          en_negativo: !!(currentPresentationTask.totalTime && typeof currentStepCountdown !== 'undefined' && currentStepCountdown < 0),
          alarma_sonando: (typeof stepAlarmActive !== 'undefined') ? !!stepAlarmActive : false
        }
      : null;

    const nowObj = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const ahoraLocal = `${nowObj.getFullYear()}-${pad2(nowObj.getMonth() + 1)}-${pad2(nowObj.getDate())} ${pad2(nowObj.getHours())}:${pad2(nowObj.getMinutes())}`;
    let zonaHoraria = 'local';
    try { zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone || zonaHoraria; } catch (e) {}

    const allNotes = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes : [];
    const allRules = (typeof automationRules !== 'undefined' && Array.isArray(automationRules)) ? automationRules : [];

    return {
      ok: true,
      modo: isFull ? 'completo' : 'resumen',
      ahora_local: ahoraLocal,
      zona_horaria: zonaHoraria,
      carpeta_actual_id: (typeof currentFolderId !== 'undefined') ? currentFolderId : null,
      notas_total: allNotes.length,
      plantillas_total: (typeof userTemplates !== 'undefined') ? userTemplates.length : 0,
      reglas_activas: allRules.filter(r => r.activa !== false).length,
      presentacion_activa: activePres,
      carpetas: (typeof folders !== 'undefined') ? folders.map(f => serializeFolderForAI(f, incluirCompletadas, incluirPasos)) : []
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
    obtener_estado(args = {}) { return getStateSnapshot(args || {}); },

    obtener_carpeta({ carpeta_id, incluir_completadas = false, incluir_pasos = false }) {
      const f = findFolder(carpeta_id);
      if (!f) return { ok: false, error: 'Carpeta no encontrada.' };
      return { ok: true, carpeta: serializeFolderForAI(f, !!incluir_completadas, !!incluir_pasos) };
    },

    obtener_tarea({ tarea_id }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada.' };
      return {
        ok: true,
        carpeta_id: found.folder.id,
        carpeta_nombre: found.folder.name,
        completada: !!found.isFinished,
        tarea: serializeTaskForAI(found.task, true, !!found.isFinished)
      };
    },

    leer_nota({ nota_id }) {
      const list = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes : [];
      const n = list.find(x => x.id === nota_id);
      if (!n) return { ok: false, error: 'Nota no encontrada.' };
      return {
        ok: true,
        nota: {
          id: n.id,
          titulo: n.title,
          contenido: n.content || '',
          carpeta_id: n.folderId || null,
          tarea_id: n.taskId || null,
          etiquetas: n.tags || [],
          color: n.color || null,
          updatedAt: n.updatedAt || n.createdAt || null
        }
      };
    },

    parchear_nota({ nota_id, modo, texto, encabezado_objetivo }) {
      const list = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes : [];
      const note = list.find(n => n.id === nota_id);
      if (!note) return { ok: false, error: 'Nota no encontrada.' };
      const m = String(modo || '').toLowerCase();
      const body = String(texto || '');
      const current = String(note.content || '');

      if (m === 'append') {
        note.content = current ? (current.trimEnd() + '\n\n' + body) : body;
      } else if (m === 'prepend') {
        note.content = current ? (body + '\n\n' + current.trimStart()) : body;
      } else if (m === 'reemplazar_seccion') {
        const targetRaw = String(encabezado_objetivo || '').trim();
        if (!targetRaw) return { ok: false, error: 'Indica encabezado_objetivo para reemplazar_seccion.' };
        const cleanTarget = targetRaw.replace(/^#+\s*/, '').toLowerCase();
        const lines = current.split(/\r?\n/);
        let startIdx = -1;
        let startLevel = 2;
        for (let i = 0; i < lines.length; i++) {
          const hm = lines[i].match(/^(#{1,6})\s+(.+)$/);
          if (hm && hm[2].trim().toLowerCase() === cleanTarget) {
            startIdx = i;
            startLevel = hm[1].length;
            break;
          }
        }
        if (startIdx === -1) {
          const heading = targetRaw.startsWith('#') ? targetRaw : ('## ' + targetRaw);
          note.content = (current ? current.trimEnd() + '\n\n' : '') + heading + '\n' + body;
        } else {
          let endIdx = lines.length;
          for (let i = startIdx + 1; i < lines.length; i++) {
            const hm = lines[i].match(/^(#{1,6})\s+/);
            if (hm && hm[1].length <= startLevel) {
              endIdx = i;
              break;
            }
          }
          const headingLine = lines[startIdx];
          const replacement = body.trimStart().startsWith('#') ? [body] : [headingLine, body];
          lines.splice(startIdx, endIdx - startIdx, ...replacement);
          note.content = lines.join('\n');
        }
      } else {
        return { ok: false, error: 'Modo inválido (append | prepend | reemplazar_seccion).' };
      }

      note.updatedAt = Date.now();
      if (typeof saveNotes === 'function') saveNotes();
      if (typeof renderNotes === 'function') renderNotes();
      return { ok: true, nota_id: note.id, titulo: note.title, longitud_chars: note.content.length };
    },

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

    guardar_tarea_completa({ carpeta_id, tarea_id, nombre, pasos, tiempo_minutos, prioridad, color, fecha_iso, etiquetas, posicion }) {
      const folder = findFolder(carpeta_id);
      if (!folder) return { ok: false, error: 'Carpeta no encontrada' };
      if (folder.isDefaultRewards) return { ok: false, error: 'No se pueden crear tareas normales en la carpeta de recompensas.' };
      if (!nombre || !String(nombre).trim()) return { ok: false, error: 'Nombre de tarea vacío' };

      let task = null;
      let isUpdate = false;
      if (tarea_id) {
        const found = findTask(tarea_id);
        if (!found) return { ok: false, error: 'Tarea a actualizar no encontrada' };
        task = found.task;
        isUpdate = true;
      } else {
        task = {
          id: (typeof generateId === 'function') ? generateId() : ('_' + Math.random().toString(36).substr(2, 9)),
          name: String(nombre).trim(),
          steps: [],
          isExpanded: false,
          scheduledTimestamp: null,
          isReward: false,
          currentStepIndex: 0,
          totalTime: null,
          stepTimes: []
        };
      }

      task.name = String(nombre).trim();

      if (Array.isArray(pasos)) {
        const parsedSteps = [];
        const parsedTimes = [];
        let hasAnyCustomMin = false;
        let firstUncompleted = pasos.length;

        pasos.forEach((p) => {
          const text = (typeof p === 'string') ? p.trim() : String((p && (p.descripcion || p.texto || p.text)) || '').trim();
          if (!text) return;
          parsedSteps.push(text);
          const mins = (typeof p === 'object' && p !== null && p.minutos !== undefined && p.minutos !== null) ? Number(p.minutos) : null;
          if (mins !== null && !isNaN(mins) && mins >= 0) {
            parsedTimes.push(Math.round(mins * 60));
            hasAnyCustomMin = true;
          } else {
            parsedTimes.push(0);
          }
          const isDone = (typeof p === 'object' && p !== null) ? !!p.completado : false;
          if (!isDone && firstUncompleted === pasos.length) {
            firstUncompleted = parsedSteps.length - 1;
          }
        });

        task.steps = parsedSteps;
        if (hasAnyCustomMin) {
          task.stepTimes = parsedTimes;
          task.hasCustomStepTimes = true;
          const sumSec = parsedTimes.reduce((a, b) => a + b, 0);
          task.totalTime = sumSec > 0
            ? sumSec
            : ((tiempo_minutos && Number(tiempo_minutos) > 0) ? Math.round(Number(tiempo_minutos) * 60) : null);
        } else if (tiempo_minutos && Number(tiempo_minutos) > 0) {
          task.totalTime = Math.round(Number(tiempo_minutos) * 60);
          if (typeof recalcStepTimes === 'function') recalcStepTimes(task, true);
        } else if (tiempo_minutos === null) {
          task.totalTime = null;
          task.stepTimes = [];
          task.hasCustomStepTimes = false;
        }
        if (firstUncompleted < parsedSteps.length) {
          task.currentStepIndex = firstUncompleted;
        }
      } else if (tiempo_minutos !== undefined) {
        task.totalTime = (tiempo_minutos && Number(tiempo_minutos) > 0) ? Math.round(Number(tiempo_minutos) * 60) : null;
        if (typeof recalcStepTimes === 'function') recalcStepTimes(task, true);
      }

      if (prioridad !== undefined) {
        const p = prioridad ? String(prioridad).toLowerCase() : null;
        task.priority = (p === 'ninguna' || !p) ? null : p;
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
      if (fecha_iso !== undefined) {
        task.dueDate = fecha_iso ? String(fecha_iso) : null;
      }
      if (Array.isArray(etiquetas)) {
        task.tags = etiquetas.map(x => String(x));
      }

      if (!isUpdate) {
        if (posicion !== undefined && posicion !== null && !isNaN(Number(posicion))) {
          const pos = Math.max(0, Math.min(folder.tasks.length, Number(posicion)));
          folder.tasks.splice(pos, 0, task);
        } else {
          folder.tasks.push(task);
        }
      } else if (posicion !== undefined && posicion !== null && !isNaN(Number(posicion))) {
        const curIdx = folder.tasks.findIndex(x => x.id === task.id);
        if (curIdx !== -1) {
          folder.tasks.splice(curIdx, 1);
          const pos = Math.max(0, Math.min(folder.tasks.length, Number(posicion)));
          folder.tasks.splice(pos, 0, task);
        }
      }

      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return {
        ok: true,
        mensaje: `Tarea "${task.name}" ${isUpdate ? 'actualizada' : 'creada'} atómicamente con ${task.steps.length} pasos.`,
        tarea_id: task.id
      };
    },

    registrar_retraso_paso({ tarea_id, paso_indice, motivo, minutos_extra }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const idx = Number(paso_indice);
      if (isNaN(idx) || idx < 0 || idx >= (found.task.steps || []).length) {
        return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
      }
      if (typeof logStepDelay !== 'function') return { ok: false, error: 'logStepDelay no disponible' };
      const overdue = (typeof currentPresentationTask !== 'undefined' && currentPresentationTask && currentPresentationTask.id === tarea_id && typeof currentStepCountdown !== 'undefined' && currentStepCountdown < 0)
        ? Math.abs(currentStepCountdown)
        : 0;
      const entry = logStepDelay(found.task, idx, motivo, minutos_extra || 0, overdue);
      return { ok: true, mensaje: `Retraso registrado en paso ${idx + 1}: "${entry.motivo}".`, registro: entry };
    },

    asignar_tiempo_tarea({ tarea_id, tiempo_minutos }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      found.task.totalTime = (tiempo_minutos && Number(tiempo_minutos) > 0) ? Math.round(Number(tiempo_minutos) * 60) : null;
      if (typeof recalcStepTimes === 'function') recalcStepTimes(found.task, true);
      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      return { ok: true, mensaje: found.task.totalTime
        ? `Tiempo de "${found.task.name}" actualizado a ${tiempo_minutos} min.`
        : `Tiempo de "${found.task.name}" eliminado.` };
    },

    asignar_tiempos_pasos({ tarea_id, tiempos_minutos, paso_indice, minutos, actualizar_total }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const task = found.task;
      if (!Array.isArray(task.steps) || task.steps.length === 0) {
        return { ok: false, error: 'La tarea no tiene pasos.' };
      }

      if (Array.isArray(tiempos_minutos)) {
        task.stepTimes = task.steps.map((_, i) => {
          const val = Number(tiempos_minutos[i]);
          return (!isNaN(val) && val >= 0) ? Math.round(val * 60) : 0;
        });
        task.hasCustomStepTimes = true;
        if (actualizar_total !== false) {
          task.totalTime = task.stepTimes.reduce((a, b) => a + b, 0);
        }
      } else if (paso_indice !== undefined && minutos !== undefined) {
        const idx = Number(paso_indice);
        if (isNaN(idx) || idx < 0 || idx >= task.steps.length) {
          return { ok: false, error: `Índice de paso inválido: ${paso_indice}` };
        }
        if (typeof setStepTimeMinutes === 'function') {
          setStepTimeMinutes(task, idx, Number(minutos));
        } else {
          if (!Array.isArray(task.stepTimes) || task.stepTimes.length !== task.steps.length) {
            task.stepTimes = task.steps.map(() => 0);
          }
          task.stepTimes[idx] = Math.max(0, Math.round(Number(minutos) * 60));
          task.hasCustomStepTimes = true;
        }
        if (actualizar_total !== false) {
          task.totalTime = task.stepTimes.reduce((a, b) => a + (Number(b) || 0), 0);
        }
      } else {
        return { ok: false, error: 'Debes pasar tiempos_minutos (array) o paso_indice + minutos.' };
      }

      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      const resumen = task.stepTimes.map((s, i) => `P${i + 1}: ${secToMinExact(s) || 0}m (${s}s)`).join(', ');
      return { ok: true, mensaje: `Tiempos actualizados en "${task.name}" (${resumen}).`, tiempo_total_min: secToMinExact(task.totalTime), tiempo_total_seg: task.totalTime };
    },

    iniciar_presentacion_tarea({ tarea_id, paso_indice }) {
      const found = findTask(tarea_id);
      if (!found) return { ok: false, error: 'Tarea no encontrada' };
      const task = found.task;
      if (!Array.isArray(task.steps) || task.steps.length === 0) {
        return { ok: false, error: 'La tarea no tiene pasos para reproducir.' };
      }
      if (typeof openFolder === 'function') openFolder(found.folder.id);
      if (paso_indice !== undefined && paso_indice !== null) {
        const idx = Math.max(0, Math.min(task.steps.length - 1, Number(paso_indice) || 0));
        task.currentStepIndex = idx;
      }
      if (typeof startPresentation === 'function') {
        startPresentation(task);
        return { ok: true, mensaje: `Presentación iniciada en "${task.name}" (paso ${(task.currentStepIndex || 0) + 1}/${task.steps.length}).` };
      }
      return { ok: false, error: 'startPresentation no disponible' };
    },

    silenciar_alarma() {
      if (typeof stopStepOvertimeAlarm === 'function') {
        stopStepOvertimeAlarm();
        return { ok: true, mensaje: 'Alarma silenciada 🔕.' };
      }
      return { ok: false, error: 'Control de alarma no disponible' };
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
      const task = found.task;
      if (typeof window.dedupeTaskAcrossFolders === 'function') {
        window.dedupeTaskAcrossFolders(task.id);
      } else {
        const idx = found.folder.tasks.findIndex(t => t.id === tarea_id);
        if (idx !== -1) found.folder.tasks.splice(idx, 1);
      }
      if (found.isFinished) {
        if (!Array.isArray(dest.finished)) dest.finished = [];
        dest.finished.push(task);
      } else {
        dest.tasks.push(task);
      }
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
      if (found.task.hasCustomStepTimes && Array.isArray(found.task.stepTimes)) {
        found.task.stepTimes.splice(pos, 0, 0);
      } else if (typeof recalcStepTimes === 'function') {
        recalcStepTimes(found.task, true);
      }
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
      const isDone = (completado !== undefined) ? !!completado : true;
      if (typeof steps[idx] === 'object' && steps[idx] !== null) {
        steps[idx].completed = isDone;
      } else if (isDone) {
        found.task.currentStepIndex = Math.max(found.task.currentStepIndex || 0, idx + 1);
      }
      if (isDone && typeof triggerAutomationEvent === 'function') {
        triggerAutomationEvent('paso_completado', {
          folderId: found.folder.id,
          task: found.task,
          stepIndex: idx,
          stepText: (typeof steps[idx] === 'string') ? steps[idx] : (steps[idx].text || '')
        });
      }
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
      if (typeof trash === 'undefined' || !Array.isArray(trash)) return { ok: true, cantidad: 0, elementos: [] };
      return {
        ok: true,
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

    obtener_reporte_productividad({ carpeta_id, fecha_desde, fecha_hasta } = {}) {
      let targetFolders = folders;
      if (carpeta_id) {
        const f = findFolder(carpeta_id);
        if (f) targetFolders = [f];
      }
      const dFrom = fecha_desde ? String(fecha_desde).slice(0, 10) : null;
      const dTo = fecha_hasta ? String(fecha_hasta).slice(0, 10) : null;
      const inRange = (iso) => {
        if (!dFrom && !dTo) return true;
        if (!iso) return false;
        const d = String(iso).slice(0, 10);
        if (dFrom && d < dFrom) return false;
        if (dTo && d > dTo) return false;
        return true;
      };

      let totPendientes = 0;
      let totCompletadas = 0;
      let totTiempoMinutos = 0;

      targetFolders.forEach(f => {
        const pend = (f.tasks || []).filter(t => (!dFrom && !dTo) || inRange(t.dueDate));
        const comp = (f.finished || []).filter(t => inRange(t.completedAt || t.dueDate));
        totPendientes += pend.length;
        totCompletadas += comp.length;
        pend.forEach(t => { if (t.totalTime) totTiempoMinutos += secToMinExact(t.totalTime) || 0; });
        comp.forEach(t => { if (t.totalTime) totTiempoMinutos += secToMinExact(t.totalTime) || 0; });
      });

      const totalTareas = totPendientes + totCompletadas;
      const pct = totalTareas > 0 ? Math.round((totCompletadas / totalTareas) * 100) : 0;
      const minsRound = Math.round(totTiempoMinutos * 10) / 10;

      return {
        ok: true,
        rango: (dFrom || dTo) ? { desde: dFrom, hasta: dTo } : 'todo',
        carpetas_analizadas: targetFolders.length,
        tareas_pendientes: totPendientes,
        tareas_completadas: totCompletadas,
        porcentaje_cumplimiento: pct + '%',
        tiempo_estimado_min: minsRound
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
          if (filtro.etiqueta && (!Array.isArray(t.tags) || !t.tags.some(tag => tag.toLowerCase() === String(filtro.etiqueta).toLowerCase()))) return false;
          if (Array.isArray(filtro.tarea_ids) && filtro.tarea_ids.length > 0 && !filtro.tarea_ids.includes(t.id)) return false;
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

    guardar_plantilla_usuario({ plantilla_id, tarea_id, nombre_plantilla, pasos, tiempo_minutos, tiempos_pasos_minutos, color, prioridad, formato_agradecimiento, alineacion_cuadridimensional }) {
      if (typeof userTemplates === 'undefined') return { ok: false, error: 'userTemplates no disponible' };

      // Edición de plantilla existente sin borrarla
      if (plantilla_id) {
        const existing = userTemplates.find(t => t.id === plantilla_id);
        if (!existing) return { ok: false, error: 'Plantilla no encontrada' };
        if (nombre_plantilla !== undefined) existing.name = String(nombre_plantilla).trim() || existing.name;
        if (Array.isArray(pasos)) existing.steps = pasos.map(s => String(s));
        if (Array.isArray(tiempos_pasos_minutos)) {
          existing.stepTimes = tiempos_pasos_minutos.map(m => Math.max(0, Math.round(Number(m || 0) * 60)));
          existing.hasCustomStepTimes = true;
          existing.totalTime = existing.stepTimes.reduce((a, b) => a + b, 0);
        } else if (tiempo_minutos !== undefined) {
          existing.totalTime = tiempo_minutos ? Math.round(Number(tiempo_minutos) * 60) : null;
        }
        if (color !== undefined) existing.color = color;
        if (prioridad !== undefined) existing.priority = prioridad;
        if (formato_agradecimiento !== undefined) existing.gratitudeFormat = formato_agradecimiento;
        if (alineacion_cuadridimensional !== undefined) existing.dimensions = alineacion_cuadridimensional;
        if (typeof saveUserTemplates === 'function') saveUserTemplates();
        if (typeof renderUserTemplatesPanel === 'function') renderUserTemplatesPanel();
        return { ok: true, mensaje: `Plantilla "${existing.name}" actualizada.`, plantilla: existing };
      }

      // Clonar desde tarea existente o crear desde cero
      let baseTask = null;
      if (tarea_id) {
        const found = findTask(tarea_id);
        if (!found) return { ok: false, error: 'Tarea no encontrada' };
        baseTask = found.task;
      } else {
        if (!nombre_plantilla) return { ok: false, error: 'Indica nombre_plantilla o tarea_id' };
        const stepArr = Array.isArray(pasos) ? pasos.map(s => String(s)) : [];
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
          priority: prioridad || null
        };
      }

      if (typeof saveTaskAsTemplate !== 'function') return { ok: false, error: 'saveTaskAsTemplate no disponible' };
      const tpl = saveTaskAsTemplate(baseTask, nombre_plantilla, {
        gratitudeFormat: formato_agradecimiento,
        dimensions: alineacion_cuadridimensional
      });
      return { ok: true, mensaje: `Plantilla "${tpl.name}" guardada (ID: ${tpl.id}).`, plantilla: tpl };
    },

    listar_plantillas_usuario() {
      const list = (typeof userTemplates !== 'undefined') ? userTemplates : [];
      return { ok: true, total: list.length, plantillas: list };
    },

    aplicar_plantilla_usuario({ plantilla_id, carpeta_destino_id, nombre_personalizado, fecha_iso, posicion }) {
      if (typeof applyUserTemplate !== 'function') return { ok: false, error: 'applyUserTemplate no disponible' };
      const destId = carpeta_destino_id || (typeof currentFolderId !== 'undefined' ? currentFolderId : null);
      const t = applyUserTemplate(plantilla_id, destId, { nombre_personalizado, fecha_iso, posicion });
      if (!t) return { ok: false, error: 'Plantilla o carpeta destino inválida' };
      return { ok: true, mensaje: `Plantilla "${t.name}" aplicada con éxito.`, tarea_id: t.id };
    },

    eliminar_plantilla_usuario({ plantilla_id }) {
      if (typeof deleteUserTemplate !== 'function') return { ok: false, error: 'deleteUserTemplate no disponible' };
      deleteUserTemplate(plantilla_id);
      return { ok: true, mensaje: 'Plantilla eliminada.' };
    },

    actualizar_regla_automatizacion({ regla_id, activa, evento, condicion, accion_automatica, parametros_accion }) {
      if (typeof automationRules === 'undefined') return { ok: false, error: 'Sin reglas' };
      const rule = automationRules.find(r => r.id === regla_id);
      if (!rule) return { ok: false, error: 'Regla no encontrada' };
      if (activa !== undefined) rule.activa = !!activa;
      if (evento !== undefined) rule.evento = evento;
      if (condicion !== undefined) rule.condicion = condicion;
      if (accion_automatica !== undefined) rule.accion_automatica = accion_automatica;
      if (parametros_accion !== undefined) rule.parametros_accion = parametros_accion;
      if (typeof saveAutomationRules === 'function') saveAutomationRules();
      return { ok: true, mensaje: `Regla ${regla_id} actualizada.`, regla: rule };
    },

    eliminar_regla_automatizacion({ regla_id }) {
      if (typeof automationRules === 'undefined') return { ok: false, error: 'Sin reglas' };
      const idx = automationRules.findIndex(r => r.id === regla_id);
      if (idx === -1) return { ok: false, error: 'Regla no encontrada' };
      automationRules.splice(idx, 1);
      if (typeof saveAutomationRules === 'function') saveAutomationRules();
      return { ok: true, mensaje: 'Regla de automatización eliminada.' };
    },

    editar_nota({ nota_id, titulo, contenido, etiquetas, carpeta_id, tarea_id }) {
      if (typeof notes === 'undefined') return { ok: false, error: 'Sin notas' };
      const note = notes.find(n => n.id === nota_id);
      if (!note) return { ok: false, error: 'Nota no encontrada' };
      if (titulo !== undefined) note.title = String(titulo).trim() || note.title;
      if (contenido !== undefined) note.content = String(contenido);
      if (Array.isArray(etiquetas)) note.tags = etiquetas.map(x => String(x));
      if (carpeta_id !== undefined) note.folderId = carpeta_id;
      if (tarea_id !== undefined) note.taskId = tarea_id;
      note.updatedAt = Date.now();
      if (typeof saveNotes === 'function') saveNotes();
      if (typeof renderNotes === 'function') renderNotes();
      return { ok: true, mensaje: `Nota "${note.title}" actualizada.`, nota: note };
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

    listar_notas({ carpeta_id, tarea_id, incluir_contenido = false } = {}) {
      const list = (typeof notes !== 'undefined') ? notes : [];
      const res = list.filter(n => {
        if (carpeta_id && n.folderId !== carpeta_id) return false;
        if (tarea_id && n.taskId !== tarea_id) return false;
        return true;
      });
      if (incluir_contenido) {
        return { ok: true, total: res.length, notas: res };
      }
      return {
        ok: true,
        total: res.length,
        notas: res.map(n => ({
          id: n.id,
          title: n.title,
          folderId: n.folderId || null,
          taskId: n.taskId || null,
          tags: Array.isArray(n.tags) ? n.tags : [],
          updatedAt: n.updatedAt || n.createdAt || null,
          preview_120_chars: String(n.content || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        }))
      };
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

    generar_bloques_tiempo({ hora_inicio, hora_fin, duracion_descanso_min, carpeta_id, aplicar_como_reglas }) {
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

        const startStr = `${startH}:${startM}`;
        itinerario.push({
          tarea_id: t.id,
          tarea: t.name,
          horario: `${startStr} - ${endH}:${endM}`,
          duracion: `${dur} min`
        });
        if (aplicar_como_reglas && !t.isReward && Array.isArray(t.steps) && t.steps.length > 0) {
          if (typeof automationRules === 'undefined') window.automationRules = [];
          const existing = automationRules.find(r => r.evento === 'hora_programada' && r.parametros_accion?.tarea_id === t.id);
          if (existing) {
            existing.condicion = { hora: startStr };
            existing.activa = true;
          } else {
            automationRules.push({
              id: '_' + Math.random().toString(36).substr(2, 9),
              activa: true,
              evento: 'hora_programada',
              condicion: { hora: startStr },
              accion_automatica: 'iniciar_presentacion_tarea',
              parametros_accion: { tarea_id: t.id }
            });
          }
        }
        currentMin = endMin + descanso;
      });

      if (aplicar_como_reglas && typeof saveAutomationRules === 'function') {
        saveAutomationRules();
      }
      return { ok: true, total_tareas_agendadas: itinerario.length, itinerario, reglas_programadas: !!aplicar_como_reglas };
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

    guardar_memoria_usuario({ categoria, nodo, grado, clave, valor, resumen_corto, conexiones, es_nucleo }) {
      const k = String(clave || '').trim();
      const v = String(valor || '').trim();
      if (!k || !v) return { ok: false, error: 'clave y valor son obligatorios.' };

      const cat = String(categoria || nodo || 'preferencias').trim();
      const domainNode = String(nodo || categoria || 'general').trim().toLowerCase();
      let gradeNum;
      if (grado !== undefined && grado !== null && [0, 1, 2].includes(Number(grado))) {
        gradeNum = Number(grado);
      } else if (es_nucleo !== undefined) {
        gradeNum = es_nucleo ? 0 : 2;
      } else {
        gradeNum = (cat === 'preferencias' || cat === 'energia_horarios' || cat === 'cuadridimensional') ? 0 : 1;
      }
      const isCore = gradeNum === 0;
      const shortSummary = String(resumen_corto || v).replace(/\s+/g, ' ').trim().slice(0, 200);
      const cleanConns = Array.isArray(conexiones)
        ? conexiones.filter(c => c && c.tipo && c.id).map(c => ({ tipo: String(c.tipo), id: String(c.id), relacion: String(c.relacion || 'relacionado') }))
        : undefined;

      const list = loadAgentMemory();
      const existing = list.find(m => m.clave === k && ((m.nodo || m.categoria || 'general').toLowerCase() === domainNode || m.categoria === cat));
      if (existing) {
        existing.categoria = cat;
        existing.nodo = domainNode;
        existing.grado = gradeNum;
        existing.valor = v;
        existing.resumen_corto = shortSummary;
        existing.es_nucleo = isCore;
        if (cleanConns !== undefined) existing.conexiones = cleanConns;
        existing.updatedAt = new Date().toISOString();
      } else {
        list.unshift({
          id: '_mem_' + Math.random().toString(36).substr(2, 8),
          categoria: cat,
          nodo: domainNode,
          grado: gradeNum,
          clave: k,
          valor: v,
          resumen_corto: shortSummary,
          conexiones: cleanConns || [],
          es_nucleo: isCore,
          updatedAt: new Date().toISOString()
        });
      }
      saveAgentMemory(list);
      return { ok: true, nodo: domainNode, grado: gradeNum, clave: k, total_memorias: list.length };
    },

    cargar_nodo_memoria({ nodo, grado_maximo = 1 }) {
      const target = String(nodo || '').trim().toLowerCase();
      if (!target) return { ok: false, error: 'Indica el nombre del nodo.' };
      const maxG = Math.max(0, Math.min(2, Number(grado_maximo)));
      const list = loadAgentMemory();
      const matched = list.filter(m => {
        const mNode = String(m.nodo || m.categoria || 'general').toLowerCase();
        const mGrade = (typeof m.grado === 'number') ? m.grado : (m.es_nucleo === false ? 2 : 0);
        return mNode === target && mGrade <= maxG;
      });
      const conexionesMap = [];
      const recuerdos = matched.slice(0, 12).map(m => {
        const mGrade = (typeof m.grado === 'number') ? m.grado : (m.es_nucleo === false ? 2 : 0);
        if (Array.isArray(m.conexiones)) {
          m.conexiones.forEach(c => conexionesMap.push(c));
        }
        const item = {
          id: m.id,
          clave: m.clave,
          grado: mGrade,
          resumen: String(m.resumen_corto || m.valor || '').slice(0, 200)
        };
        if (maxG >= 2 && m.valor && m.valor.length > 200) item.valor = m.valor.slice(0, 600);
        return item;
      });
      return {
        ok: true,
        nodo: target,
        grado_maximo: maxG,
        total: matched.length,
        recuerdos,
        conexiones: conexionesMap.slice(0, 20)
      };
    },

    buscar_memoria_relevante({ consulta, nodo, grado_maximo, top_k }) {
      const q = String(consulta || '').toLowerCase().trim();
      const k = Math.max(1, Math.min(15, Number(top_k) || 5));
      const targetNode = nodo ? String(nodo).trim().toLowerCase() : null;
      const maxG = (grado_maximo !== undefined && grado_maximo !== null) ? Number(grado_maximo) : 2;
      let list = loadAgentMemory().filter(m => {
        const mNode = String(m.nodo || m.categoria || 'general').toLowerCase();
        const mGrade = (typeof m.grado === 'number') ? m.grado : (m.es_nucleo === false ? 2 : 0);
        if (targetNode && mNode !== targetNode) return false;
        if (mGrade > maxG) return false;
        return true;
      });
      if (!q) return { ok: true, recuerdos: list.slice(0, k) };

      const terms = q.split(/\s+/).filter(Boolean);
      const scored = list.map(m => {
        const hay = `${m.nodo || ''} ${m.categoria || ''} ${m.clave || ''} ${m.resumen_corto || ''} ${m.valor || ''}`.toLowerCase();
        let score = 0;
        terms.forEach(t => { if (hay.includes(t)) score += (String(m.clave || '').toLowerCase().includes(t) ? 3 : 1); });
        return { item: m, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

      return {
        ok: true,
        consulta: q,
        total_coincidencias: scored.length,
        recuerdos: scored.slice(0, k).map(x => x.item)
      };
    },

    obtener_contexto_vivo() {
      const now = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const ahoraLocal = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      let tz = 'local';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}

      const pres = (typeof presentationOpen !== 'undefined' && presentationOpen && typeof currentPresentationTask !== 'undefined' && currentPresentationTask)
        ? {
            tarea: currentPresentationTask.name,
            paso: (typeof currentStepIndex !== 'undefined' ? currentStepIndex + 1 : 1) + '/' + (typeof presentationSteps !== 'undefined' ? presentationSteps.length : 1),
            paso_texto: (typeof presentationSteps !== 'undefined' && presentationSteps[currentStepIndex]) ? (presentationSteps[currentStepIndex].text || presentationSteps[currentStepIndex]) : '',
            seg_restantes: currentPresentationTask.totalTime ? ((typeof currentStepCountdown !== 'undefined') ? currentStepCountdown : 0) : null
          }
        : null;

      const rules = (typeof automationRules !== 'undefined' && Array.isArray(automationRules)) ? automationRules : [];
      const proximos = rules
        .filter(r => r.activa !== false && r.evento === 'hora_programada' && r.condicion && r.condicion.hora)
        .map(r => {
          const [h, m] = String(r.condicion.hora).split(':').map(Number);
          return { hora: r.condicion.hora, mins: (h * 60 + m), accion: r.accion_automatica, nombre: r.parametros_accion?.nombre || r.parametros_accion?.tarea_id || '' };
        })
        .filter(x => !isNaN(x.mins) && x.mins >= nowMin)
        .sort((a, b) => a.mins - b.mins)
        .slice(0, 3)
        .map(({ hora, accion, nombre }) => ({ hora, accion, nombre }));

      return { ok: true, ahora_local: ahoraLocal, zona_horaria: tz, presentacion_activa: pres, proximos_bloques: proximos };
    },

    consultar_memoria_usuario({ categoria }) {
      const list = loadAgentMemory();
      const filtered = categoria ? list.filter(m => m.categoria === categoria) : list;
      return { ok: true, total: filtered.length, memorias: filtered };
    },

    eliminar_memoria_usuario({ memoria_id, clave }) {
      let list = loadAgentMemory();
      const before = list.length;
      list = list.filter(m => (memoria_id ? m.id !== memoria_id : true) && (clave ? m.clave !== clave : true));
      saveAgentMemory(list);
      return { ok: true, mensaje: `Eliminadas ${before - list.length} memorias.` };
    },

    recalcular_agenda_dia({ minutos_retraso, hora_desde }) {
      const delta = Number(minutos_retraso);
      if (isNaN(delta) || delta === 0) return { ok: false, error: 'minutos_retraso debe ser distinto de 0' };
      if (typeof automationRules === 'undefined' || !Array.isArray(automationRules)) {
        return { ok: false, error: 'No hay reglas de agenda configuradas' };
      }
      const now = new Date();
      let fromMin = now.getHours() * 60 + now.getMinutes();
      if (hora_desde && String(hora_desde).includes(':')) {
        const [hh, mm] = String(hora_desde).split(':').map(Number);
        if (!isNaN(hh) && !isNaN(mm)) fromMin = hh * 60 + mm;
      }

      const ajustadas = [];
      automationRules.forEach(rule => {
        if (rule.activa === false || rule.evento !== 'hora_programada' || !rule.condicion || !rule.condicion.hora) return;
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

      if (ajustadas.length > 0 && typeof saveAutomationRules === 'function') {
        saveAutomationRules();
      }
      return {
        ok: true,
        mensaje: ajustadas.length > 0
          ? `Agenda recalculada (${delta > 0 ? '+' : ''}${delta} min) en ${ajustadas.length} reglas.`
          : 'No había reglas hora_programada pendientes desde esa hora.',
        ajustadas
      };
    },

    analizar_patrones_rendimiento({ fecha_desde, fecha_hasta } = {}) {
      const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
      const dFrom = fecha_desde ? String(fecha_desde).slice(0, 10) : null;
      const dTo = fecha_hasta ? String(fecha_hasta).slice(0, 10) : null;
      const inRange = (iso) => {
        if (!dFrom && !dTo) return true;
        if (!iso) return false;
        const d = String(iso).slice(0, 10);
        if (dFrom && d < dFrom) return false;
        if (dTo && d > dTo) return false;
        return true;
      };

      const delays = [];
      const desviaciones = [];
      const motivosCount = {};

      allFolders.forEach(f => {
        const allTasks = [...(f.tasks || []), ...(f.finished || [])];
        allTasks.forEach(t => {
          if (Array.isArray(t.delayLogs)) {
            t.delayLogs.forEach(d => {
              if (!inRange(d.fecha_iso || d.timestamp)) return;
              delays.push({ carpeta: f.name, tarea: t.name, ...d });
              const m = String(d.motivo || 'Sin especificar').trim().toLowerCase();
              motivosCount[m] = (motivosCount[m] || 0) + 1;
            });
          }
          if (t.totalTime && t.actualTimeMinutes && inRange(t.completedAt || t.dueDate)) {
            const est = secToMinExact(t.totalTime) || 0;
            desviaciones.push({
              carpeta: f.name,
              tarea: t.name,
              estimado_min: est,
              real_min: t.actualTimeMinutes,
              diferencia_min: Math.round((t.actualTimeMinutes - est) * 100) / 100
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
        rango: (dFrom || dTo) ? { desde: dFrom, hasta: dTo } : 'todo',
        total_retrasos_registrados: delays.length,
        top_motivos_retraso: topMotivos,
        ultimos_retrasos: delays.slice(-10),
        desviaciones_tiempo: desviaciones.slice(-10)
      };
    },

    async buscar_web({ consulta, guardar_en_nota_titulo, carpeta_id, tarea_id }) {
      const q = String(consulta || '').trim();
      if (!q) return { ok: false, error: 'Consulta vacía' };

      let texto = '';
      let fuente = '';

      // 1) Motor independiente del modelo: Jina Search (s.jina.ai) — sin API key y compatible con cualquier LLM
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);
        const jinaSearchUrl = 'https://s.jina.ai/' + encodeURIComponent(q);
        const res = await fetch(jinaSearchUrl, {
          headers: { 'Accept': 'text/plain' },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
          const body = (await res.text()).trim();
          if (body && body.length > 40) {
            texto = body.slice(0, 5000);
            fuente = 'jina_search';
          }
        }
      } catch (e) {}

      // 2) Fallback: OpenRouter :online
      if (!texto && AI_CONFIG.apiKey) {
        try {
          const baseModel = AI_CONFIG.model.replace(/:free$/i, '').replace(/:online$/i, '');
          const onlineModel = baseModel + ':online';
          const res = await fetch(AI_CONFIG.baseUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + AI_CONFIG.apiKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://asista-multy.app',
              'X-Title': 'ASISTA MULTY'
            },
            body: JSON.stringify({
              model: onlineModel,
              messages: [{ role: 'user', content: `Busca información actualizada y precisa en la web sobre: "${q}". Incluye datos concretos y URLs de las fuentes.` }],
              temperature: 0.2,
              max_tokens: 1400
            })
          });
          if (res.ok) {
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (content) {
              texto = content;
              fuente = 'openrouter:online';
            }
          }
        } catch (e) {}
      }

      // 3) Fallback gratuito sin API key: Wikipedia ES / EN
      if (!texto) {
        for (const lang of ['es', 'en']) {
          try {
            const wpUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=` + encodeURIComponent(q) + '&format=json&origin=*&srlimit=4';
            const r = await fetch(wpUrl);
            if (r.ok) {
              const j = await r.json();
              const hits = (j?.query?.search || []).map(h =>
                '- **' + h.title + '**: ' + h.snippet.replace(/<[^>]+>/g, '') + ` (https://${lang}.wikipedia.org/wiki/` + encodeURIComponent(h.title.replace(/ /g, '_')) + ')'
              );
              if (hits.length > 0) {
                texto = hits.join('\n');
                fuente = 'wikipedia_' + lang;
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (!texto) {
        return { ok: false, error: 'No se pudo obtener resultados web (revisa conexión o modelo :online).' };
      }

      let notaCreada = null;
      if (guardar_en_nota_titulo && typeof TOOL_EXECUTORS.crear_nota === 'function') {
        const resNota = TOOL_EXECUTORS.crear_nota({
          titulo: guardar_en_nota_titulo,
          contenido: texto,
          carpeta_id: carpeta_id || null,
          tarea_id: tarea_id || null,
          etiquetas: ['investigacion', 'web']
        });
        if (resNota && resNota.ok) notaCreada = resNota.nota || true;
      }

      return { ok: true, fuente, consulta: q, resumen: texto.slice(0, 4500), nota_guardada: !!notaCreada };
    },

    async leer_url_web({ url, guardar_en_nota_titulo, carpeta_id, tarea_id }) {
      const targetUrl = String(url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, error: 'URL inválida (debe iniciar con http:// o https://)' };
      try {
        const jinaUrl = 'https://r.jina.ai/' + targetUrl;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(jinaUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return { ok: false, error: 'Jina Reader HTTP ' + res.status };
        const md = (await res.text()).slice(0, 6000);

        let notaCreada = null;
        if (guardar_en_nota_titulo && typeof TOOL_EXECUTORS.crear_nota === 'function') {
          const resNota = TOOL_EXECUTORS.crear_nota({
            titulo: guardar_en_nota_titulo,
            contenido: `Fuente: ${targetUrl}\n\n${md}`,
            carpeta_id: carpeta_id || null,
            tarea_id: tarea_id || null,
            etiquetas: ['lectura-web']
          });
          if (resNota && resNota.ok) notaCreada = true;
        }
        return { ok: true, url: targetUrl, contenido_markdown: md, nota_guardada: !!notaCreada };
      } catch (e) {
        return { ok: false, error: 'Error leyendo URL: ' + (e && e.message ? e.message : String(e)) };
      }
    },

    configurar_audio_coach({ habilitado, anunciar_pasos }) {
      if (typeof audioCoachConfig === 'undefined') window.audioCoachConfig = { habilitado: true };
      audioCoachConfig.habilitado = !!habilitado;
      if (anunciar_pasos !== undefined) audioCoachConfig.anunciar_pasos = !!anunciar_pasos;
      if (habilitado && typeof speakAudioCoach === 'function') {
        speakAudioCoach('Audio Coach activado correctamente.');
      }
      return { ok: true, mensaje: `Audio Coach ${habilitado ? 'activado 🔊' : 'desactivado 🔇'}.` };
    },

    // --- MOTOR FINANCIERO ESTRUCTURADO (GTQ / USD EN CENTAVOS) ---
    fin_gestionar_cuenta(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.gestionarCuenta(args);
    },
    fin_registrar_movimiento(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.registrarMovimiento(args);
    },
    fin_gestionar_compromiso(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.gestionarCompromiso(args);
    },
    fin_gestionar_inversion(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.gestionarInversion(args);
    },
    fin_conciliar_arqueo(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.conciliarArqueo(args);
    },
    fin_obtener_resumen(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      return window.EfectivaFinance.obtenerResumen(args);
    },
    fin_exportar_a_nota(args = {}) {
      if (!window.EfectivaFinance) return { ok: false, error: 'Motor financiero no disponible.' };
      const md = window.EfectivaFinance.exportarMarkdown(args);
      const titulo = String(args.titulo || ('Estado Financiero ' + new Date().toISOString().slice(0, 10)));
      return TOOL_EXECUTORS.crear_nota({
        titulo,
        contenido: md,
        carpeta_id: args.carpeta_id || null,
        etiquetas: ['finanzas', 'snapshot']
      });
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
      temperature: 0.4, max_tokens: 8192
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

  const AGENT_MEMORY_KEY = 'efectivaAgentMemoryV1';
  function loadAgentMemory() {
    try {
      const raw = localStorage.getItem(AGENT_MEMORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function saveAgentMemory(list) {
    try {
      localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(list || []));
    } catch (e) {}
  }

  function getResumenEstadoRapido() {
    if (typeof folders === 'undefined' || !Array.isArray(folders)) return '';
    const lista = folders.map((f) => {
      const cantTareas = (f.tasks || []).length;
      const cantFin = (f.finished || []).length;
      return `- ${f.name} (ID: ${f.id}) [${cantTareas} pdt, ${cantFin} fin]${f.isDefaultRewards ? ' (Recompensas)' : ''}`;
    }).join('\n');

    const allMems = loadAgentMemory();
    const g0 = [];
    const nodeCounts = {};
    allMems.forEach(m => {
      const g = (typeof m.grado === 'number') ? m.grado : (m.es_nucleo === false ? 2 : 0);
      const n = String(m.nodo || m.categoria || 'general').toLowerCase();
      if (g === 0) {
        g0.push(m);
      } else {
        nodeCounts[n] = (nodeCounts[n] || 0) + 1;
      }
    });

    const coreList = g0.slice(0, 8);
    const nodesIdx = Object.entries(nodeCounts).map(([n, c]) => `${n}(${c})`).join(', ');
    const memBlock = (coreList.length > 0
      ? '\n\nMEMORIA GRADO 0 (Núcleo):\n' + coreList.map(m => `- [${m.nodo || m.categoria}] ${m.clave}: ${String(m.resumen_corto || m.valor || '').slice(0, 140)}`).join('\n')
      : '\n\nMEMORIA GRADO 0: (vacía)')
      + (nodesIdx ? `\nNODOS ACTIVOS (Grado 1/2 — 0 tokens hasta cargar con cargar_nodo_memoria): ${nodesIdx}` : '');

    return '\n\nCARPETAS (' + folders.length + '):\n' + (lista || '(Sin carpetas)') + memBlock;
  }

  const PENDING_AI_JOB_KEY = 'efectivaPendingAiJobV1';
  let isResumingPendingJob = false;

  function savePendingAiJob(job) {
    try {
      if (!job) localStorage.removeItem(PENDING_AI_JOB_KEY);
      else localStorage.setItem(PENDING_AI_JOB_KEY, JSON.stringify(job));
    } catch (e) {}
  }

  function loadPendingAiJob() {
    try {
      const raw = localStorage.getItem(PENDING_AI_JOB_KEY);
      if (!raw) return null;
      const job = JSON.parse(raw);
      // Expirar trabajos huérfanos de más de 30 minutos
      if (!job || !job.chatId || (Date.now() - (job.updatedAt || 0) > 30 * 60 * 1000)) {
        savePendingAiJob(null);
        return null;
      }
      return job;
    } catch (e) { return null; }
  }

  function isTransientNetworkError(err) {
    const msg = String(err && err.message ? err.message : err || '').toLowerCase();
    return msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('network') ||
      msg.includes('abort') ||
      !navigator.onLine;
  }

  async function runAgent(userText, history, resumeJob = null) {
    const messages = (resumeJob && Array.isArray(resumeJob.messages) && resumeJob.messages.length > 0)
      ? [{ role: 'system', content: SYSTEM_PROMPT + getResumenEstadoRapido() }, ...resumeJob.messages]
      : [
          { role: 'system', content: SYSTEM_PROMPT + getResumenEstadoRapido() },
          ...(history || []),
          { role: 'user', content: userText }
        ];
    const toolTrace = (resumeJob && Array.isArray(resumeJob.toolTrace)) ? [...resumeJob.toolTrace] : [];
    const jobChatId = (resumeJob && resumeJob.chatId) ? resumeJob.chatId : currentChatId;
    let iterations = 0;
    let emptyRetries = 0;
    let lastAssistantText = '';

    savePendingAiJob({
      chatId: jobChatId,
      userText,
      messages: messages.slice(1),
      toolTrace,
      interrupted: false,
      updatedAt: Date.now()
    });

    while (true) {
      iterations++;
      let data;
      try { data = await callOpenRouter(messages); }
      catch (err) {
        if (isTransientNetworkError(err)) {
          // Si Android/Brave cortó el socket por llamada o cambio de app, guardar checkpoint para reanudar automáticamente al volver
          savePendingAiJob({
            chatId: jobChatId,
            userText,
            messages: messages.slice(1),
            toolTrace,
            interrupted: true,
            updatedAt: Date.now()
          });
          return { interrupted: true, text: '', tools: toolTrace, history: messages };
        }
        savePendingAiJob(null);
        return { text: '❌ Error: ' + err.message, tools: toolTrace, history: messages };
      }
      if (!data.choices || !data.choices[0]) {
        return { text: '❌ Respuesta inválida del modelo.', tools: toolTrace, history: messages };
      }
      const choice = data.choices[0];
      const rawAssistantMsg = choice.message || {};

      // Extraer texto limpio aunque venga como array de bloques
      let extractedContent = '';
      if (typeof rawAssistantMsg.content === 'string') {
        extractedContent = rawAssistantMsg.content;
      } else if (Array.isArray(rawAssistantMsg.content)) {
        extractedContent = rawAssistantMsg.content
          .map(part => (typeof part === 'string' ? part : (part && part.text ? part.text : '')))
          .join('\n');
      }

      // Sanitizar mensaje antes de añadirlo al historial (evita que campos extra como reasoning rompan el turno siguiente en OpenRouter)
      const cleanAssistantMsg = {
        role: 'assistant',
        content: extractedContent || null
      };
      if (Array.isArray(rawAssistantMsg.tool_calls) && rawAssistantMsg.tool_calls.length > 0) {
        cleanAssistantMsg.tool_calls = rawAssistantMsg.tool_calls;
      }

      if (cleanAssistantMsg.tool_calls && cleanAssistantMsg.tool_calls.length > 0) {
        messages.push(cleanAssistantMsg);
        for (const call of cleanAssistantMsg.tool_calls) {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = {}; }
          const fn = call.function.name;
          const exec = TOOL_EXECUTORS[fn];
          let result;
          if (!exec) result = { ok: false, error: 'Tool desconocida: ' + fn };
          else {
            try { result = await exec(args); }
            catch (e) { result = { ok: false, error: 'Excepción: ' + (e && e.message ? e.message : String(e)) }; }
          }
          toolTrace.push({ tool: fn, args, result });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 60000)
          });
        }
        savePendingAiJob({
          chatId: jobChatId,
          userText,
          messages: messages.slice(1),
          toolTrace,
          interrupted: false,
          updatedAt: Date.now()
        });
        continue;
      }

      // Si el modelo devolvió respuesta vacía tras ejecutar tools (o por límite de tokens), reintentar automáticamente hasta 2 veces
      if (!extractedContent.trim() && emptyRetries < 2) {
        emptyRetries++;
        messages.push({
          role: 'user',
          content: choice.finish_reason === 'length'
            ? 'Tu respuesta anterior se cortó por longitud. Completa la acción pendiente (si falta editar algo, llama la herramienta ahora) y responde brevemente.'
            : 'Ya recibiste el resultado de las herramientas. Ejecuta el cambio pedido por el usuario (si aún no lo aplicaste) y responde en español con el resultado.'
        });
        continue;
      }

      messages.push(cleanAssistantMsg);
      lastAssistantText = extractedContent.trim();
      break;
    }

    // Fallback útil si el modelo igualmente dejó el texto vacío tras ejecutar herramientas
    if (!lastAssistantText && toolTrace.length > 0) {
      const done = toolTrace.map(t => {
        const msg = t.result && (t.result.mensaje || t.result.error);
        return '• ' + t.tool + (msg ? ': ' + msg : '');
      }).join('\n');
      lastAssistantText = 'Ejecuté estas acciones:\n' + done;
    }

    savePendingAiJob(null);
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
  let chatCloudReady = false;
  let chatCloudSaveTimer = null;
  let skills = [];
  let activeTab = 'history';
  let sidebarOpen = true;
  let isMobile = false;

  function loadChats() {
    try { chats = JSON.parse(localStorage.getItem(STORAGE.chats) || '[]'); } catch (e) { chats = []; }
    if (!Array.isArray(chats)) chats = [];
  }
  function scheduleCloudChatSave() {
    if (!chatCloudReady || !window.EfectivaCloud?.user) return;
    clearTimeout(chatCloudSaveTimer);
    chatCloudSaveTimer = setTimeout(() => {
      window.EfectivaCloud.saveAIChats(chats, currentChatId)
        .catch(error => console.error('No se pudo sincronizar el historial IA:', error.message));
    }, 500);
  }
  function saveChats() {
    localStorage.setItem(STORAGE.chats, JSON.stringify(chats));
    scheduleCloudChatSave();
  }
  function loadCurrentId() { currentChatId = localStorage.getItem(STORAGE.current) || null; }
  function saveCurrentId() {
    if (currentChatId) localStorage.setItem(STORAGE.current, currentChatId);
    scheduleCloudChatSave();
  }
  async function hydrateChatsFromCloud(render) {
    if (!window.EfectivaCloud?.user || !window.EfectivaCloud?.loadAIChats) return;
    try {
      const cloud = await window.EfectivaCloud.loadAIChats();
      if (cloud && Array.isArray(cloud.chats) && cloud.chats.length) {
        chats = cloud.chats;
        currentChatId = cloud.currentChatId || chats[0].id;
        localStorage.setItem(STORAGE.chats, JSON.stringify(chats));
        if (currentChatId) localStorage.setItem(STORAGE.current, currentChatId);
      }
      chatCloudReady = true;
      if (!cloud || !Array.isArray(cloud.chats) || cloud.chats.length === 0) scheduleCloudChatSave();
      if (render) render();
    } catch (error) {
      console.error('No se pudo cargar el historial IA:', error.message);
      chatCloudReady = true;
    }
  }
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
              addToolMsg((((r && r.ok !== undefined) ? r.ok : !(r && r.error)) ? '✅' : '❌') + ' ' + t.tool + (r.mensaje ? ' → ' + r.mensaje : (r.error ? ' → ' + r.error : '')));
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
      if (!isVoiceModeActive) return;
      try {
        const clean = (text || '').replace(/[*_#`~>]/g, '').replace(/[\u{1F600}-\u{1F64F}]/gu, '').trim();
        if (!clean) return;

        if (window.EfectivaTTS && typeof window.EfectivaTTS.speakChunks === 'function') {
          const maxLen = window.EfectivaTTS.isNativeAvailable() ? 320 : 190;
          const chunks = (typeof splitTextForSpeech === 'function') ? splitTextForSpeech(clean, maxLen) : [clean];
          const bestVoice = getBestSpanishVoice();
          window.EfectivaTTS.speakChunks(chunks, {
            rate: 1.05,
            lang: bestVoice ? bestVoice.lang : 'es-AR',
            voice: bestVoice || null,
            guard: () => isVoiceModeActive,
            onStart: () => updateUnifiedVoiceBtnState(),
            onEnd: () => {
              updateUnifiedVoiceBtnState();
              if (isVoiceModeActive && recognition && !isListening && !isProcessing) {
                setTimeout(() => {
                  try { recognition.start(); } catch(e){}
                }, 300);
              }
            }
          });
          return;
        }

        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean);
        const bestVoice = getBestSpanishVoice();
        if (bestVoice) {
          u.voice = bestVoice;
          u.lang = bestVoice.lang;
        } else {
          u.lang = 'es-AR';
        }
        u.rate = 1.05;
        u.onstart = () => updateUnifiedVoiceBtnState();
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
      if (window.EfectivaTTS && typeof window.EfectivaTTS.stop === 'function') {
        window.EfectivaTTS.stop();
      } else if ('speechSynthesis' in window) {
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


    async function finalizeAgentResult(chat, result) {
      hideTyping();
      if (result && result.interrupted) {
        addToolMsg('⏸️ Conexión suspendida en segundo plano; se reanudará automáticamente al volver.');
        return;
      }
      for (const t of (result.tools || [])) {
        const r = t.result || {};
        addToolMsg((((r && r.ok !== undefined) ? r.ok : !(r && r.error)) ? '✅' : '❌') + ' ' + t.tool + (r.mensaje ? ' → ' + r.mensaje : (r.error ? ' → ' + r.error : '')));
      }
      addAssistantMsg(result.text || '(sin respuesta)');
      chat.messages.push({ role: 'assistant', content: result.text || '', tools: result.tools || [] });
      chat.updatedAt = Date.now();
      autoTitle(chat);
      saveChats();
      renderHistory();
      renderChatTitle();
      speakAssistantText(result.text || '');
      if (fab && !panel.classList.contains('open')) fab.classList.add('has-unread');

      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const preview = (result.text || 'Tarea completada').slice(0, 120);
          if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(reg => reg.showNotification('Efectiva IA terminó', { body: preview, icon: './icon-192.png', tag: 'efectiva-ai-done' })).catch(() => {});
          } else {
            new Notification('Efectiva IA terminó', { body: preview, icon: './icon-192.png' });
          }
        } catch (e) {}
      }
    }

    // ---------- CLOUD AGENT (SUPABASE EDGE FUNCTION v26) ----------
    const ACTIVE_CLOUD_JOB_KEY = 'efectivaActiveCloudJobV1';
    const APPLIED_CLOUD_JOBS_KEY = 'efectivaAppliedCloudJobsV1';
    let cloudPollTimer = null;
    let isPollingCloudJob = false;
    let cloudUnavailableUntil = 0;

    function loadActiveCloudJob() {
      try {
        const raw = localStorage.getItem(ACTIVE_CLOUD_JOB_KEY);
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (!j || !j.jobId || (Date.now() - (j.startedAt || 0) > 10 * 60 * 1000)) {
          localStorage.removeItem(ACTIVE_CLOUD_JOB_KEY);
          return null;
        }
        return j;
      } catch (_) { return null; }
    }
    function saveActiveCloudJob(job) {
      try {
        if (!job) localStorage.removeItem(ACTIVE_CLOUD_JOB_KEY);
        else localStorage.setItem(ACTIVE_CLOUD_JOB_KEY, JSON.stringify(job));
      } catch (_) {}
    }
    function hasAppliedCloudJob(jobId) {
      if (!jobId) return false;
      try {
        const list = JSON.parse(localStorage.getItem(APPLIED_CLOUD_JOBS_KEY) || '[]');
        return Array.isArray(list) && list.includes(jobId);
      } catch (_) { return false; }
    }
    function markAppliedCloudJob(jobId) {
      if (!jobId) return;
      try {
        let list = JSON.parse(localStorage.getItem(APPLIED_CLOUD_JOBS_KEY) || '[]');
        if (!Array.isArray(list)) list = [];
        if (!list.includes(jobId)) list.unshift(jobId);
        localStorage.setItem(APPLIED_CLOUD_JOBS_KEY, JSON.stringify(list.slice(0, 30)));
      } catch (_) {}
    }
    function stopCloudJobPolling() {
      if (cloudPollTimer) {
        clearTimeout(cloudPollTimer);
        cloudPollTimer = null;
      }
    }
    function canTryCloudAgent() {
      return !!(
        window.EfectivaCloud &&
        window.EfectivaCloud.user &&
        typeof window.EfectivaCloud.getAccessToken === 'function' &&
        window.EfectivaStateBridge &&
        navigator.onLine &&
        AI_CONFIG.apiKey &&
        Date.now() > cloudUnavailableUntil
      );
    }

    async function dispatchCloudAgent(chat, userText, history) {
      if (!canTryCloudAgent()) return null;
      try {
        if (typeof window.EfectivaCloud.flushNow === 'function') {
          await window.EfectivaCloud.flushNow();
        }
        const token = await window.EfectivaCloud.getAccessToken();
        if (!token) return null;

        const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const endpoint = window.EfectivaCloud.supabaseUrl + '/functions/v1/efectiva-agent';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'apikey': window.EfectivaCloud.supabaseKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'start',
            jobId,
            chatId: chat.id,
            userText,
            history,
            apiKey: AI_CONFIG.apiKey,
            model: AI_CONFIG.model,
            baseUrl: AI_CONFIG.baseUrl,
            systemPrompt: SYSTEM_PROMPT + getResumenEstadoRapido(),
            tools: TOOLS,
            state: window.EfectivaStateBridge.exportFullState()
          }),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.status === 404 || res.status === 401 || res.status === 502 || res.status === 503) {
          // Edge Function aún no desplegada o no disponible: fallback transparente a modo local
          if (res.status === 404) cloudUnavailableUntil = Date.now() + 5 * 60 * 1000;
          return null;
        }
        if (!res.ok) return null;

        const data = await res.json().catch(() => null);
        if (!data || !data.accepted) return null;

        saveActiveCloudJob({
          jobId,
          chatId: chat.id,
          userText,
          startedAt: Date.now()
        });
        return { jobId };
      } catch (_) {
        // Error CORS/red (p. ej. función aún no desplegada): fallback transparente a modo local
        cloudUnavailableUntil = Date.now() + 3 * 60 * 1000;
        return null;
      }
    }

    async function pollCloudJobOnce() {
      if (isPollingCloudJob || !navigator.onLine || !window.EfectivaCloud?.user || typeof window.EfectivaCloud.getCloudJob !== 'function') {
        return false;
      }
      const localActive = loadActiveCloudJob();
      isPollingCloudJob = true;
      try {
        const cloudJob = await window.EfectivaCloud.getCloudJob();
        if (!cloudJob || !cloudJob.jobId) {
          if (localActive && (Date.now() - (localActive.startedAt || 0) > 20000)) {
            saveActiveCloudJob(null);
            stopCloudJobPolling();
            isProcessing = false;
            sendBtn.disabled = false;
            if (fab) fab.classList.remove('working');
            hideTyping();
          }
          return false;
        }

        if (cloudJob.consumed || hasAppliedCloudJob(cloudJob.jobId)) {
          if (localActive && localActive.jobId === cloudJob.jobId) {
            saveActiveCloudJob(null);
            stopCloudJobPolling();
            isProcessing = false;
            sendBtn.disabled = false;
            if (fab) fab.classList.remove('working');
            hideTyping();
          }
          return false;
        }

        const isOurJob = !localActive || localActive.jobId === cloudJob.jobId;
        if (!isOurJob) return false;

        if (cloudJob.status === 'running') {
          const age = Date.now() - (cloudJob.updatedAt || cloudJob.startedAt || Date.now());
          if (age > 175000) {
            markAppliedCloudJob(cloudJob.jobId);
            saveActiveCloudJob(null);
            stopCloudJobPolling();
            isProcessing = false;
            sendBtn.disabled = false;
            if (fab) fab.classList.remove('working');
            hideTyping();
            addErrorMsg('⏱️ La tarea en la nube superó el límite de tiempo (150s). Podés volver a enviarla.');
            return true;
          }
          if (fab) fab.classList.add('working');
          if (!document.getElementById('aiTyping')) showTyping();
          stopCloudJobPolling();
          if (!document.hidden) {
            cloudPollTimer = setTimeout(pollCloudJobOnce, 2500);
          }
          return true;
        }

        if (cloudJob.status === 'done' || cloudJob.status === 'error') {
          markAppliedCloudJob(cloudJob.jobId);
          saveActiveCloudJob(null);
          stopCloudJobPolling();

          if (cloudJob.mutated && cloudJob.state && window.EfectivaStateBridge) {
            window.EfectivaStateBridge.applyFullState(cloudJob.state);
          }
          if (Array.isArray(cloudJob.uiActions) && cloudJob.uiActions.length > 0) {
            for (const act of cloudJob.uiActions) {
              const fn = act && act.tool ? TOOL_EXECUTORS[act.tool] : null;
              if (typeof fn === 'function') {
                try { await fn(act.args || {}); } catch (_) {}
              }
            }
          }

          const targetChat = chats.find(c => c.id === cloudJob.chatId) || getCurrentChat();
          if (targetChat) {
            currentChatId = targetChat.id;
            saveCurrentId();
            await finalizeAgentResult(targetChat, {
              text: cloudJob.text || (cloudJob.error ? ('❌ ' + cloudJob.error) : 'Listo.'),
              tools: Array.isArray(cloudJob.tools) ? cloudJob.tools : []
            });
          } else {
            hideTyping();
          }

          isProcessing = false;
          sendBtn.disabled = false;
          if (fab) fab.classList.remove('working');
          if (panel.classList.contains('open')) input.focus();

          if (typeof window.EfectivaCloud.clearCloudJob === 'function') {
            window.EfectivaCloud.clearCloudJob(cloudJob.jobId).catch(() => {});
          }
          return true;
        }
        return false;
      } catch (_) {
        if (localActive && !document.hidden) {
          stopCloudJobPolling();
          cloudPollTimer = setTimeout(pollCloudJobOnce, 3500);
        }
        return false;
      } finally {
        isPollingCloudJob = false;
      }
    }

    async function resumePendingAiJobIfNeeded() {
      if (document.hidden || !navigator.onLine) return;
      // 1) Priorizar cualquier trabajo activo o terminado en Supabase Edge Function
      const handledCloud = await pollCloudJobOnce();
      if (handledCloud || loadActiveCloudJob()) return;

      // 2) Fallback: reanudar trabajo local interrumpido si existiera
      if (isResumingPendingJob) return;
      const job = loadPendingAiJob();
      if (!job) return;
      if (!job.interrupted && (Date.now() - (job.updatedAt || 0) < 4000)) return;
      const chat = chats.find(c => c.id === job.chatId) || getCurrentChat();
      if (!chat) { savePendingAiJob(null); return; }

      isResumingPendingJob = true;
      if (fab) fab.classList.add('working');
      try {
        currentChatId = chat.id;
        saveCurrentId();
        addToolMsg('🔄 Reanudando petición tras volver a la app...');
        showTyping();
        const result = await runAgent(job.userText, [], job);
        await finalizeAgentResult(chat, result);
      } catch (e) {
        hideTyping();
      } finally {
        isResumingPendingJob = false;
        if (fab) fab.classList.remove('working');
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resumePendingAiJobIfNeeded();
    });
    window.addEventListener('online', () => resumePendingAiJobIfNeeded());
    window.addEventListener('efectiva:authenticated', () => setTimeout(resumePendingAiJobIfNeeded, 800));
    setTimeout(resumePendingAiJobIfNeeded, 1200);

    // ---------- SEND ----------
    let isProcessing = false;
    async function send() {
      const text = (input.value || '').trim();
      if (!text || isProcessing) return;
      isProcessing = true;
      sendBtn.disabled = true;
      if (fab) { fab.classList.add('working'); fab.classList.remove('has-unread'); }
      input.value = '';
      adjustInputHeight();
      addUserMsg(text);
      let chat = getCurrentChat();
      if (!chat) { chat = newChat(); renderHistory(); }
      chat.messages.push({ role: 'user', content: text });
      chat.updatedAt = Date.now();
      autoTitle(chat);
      saveChats();
      renderHistory();
      showTyping();
      let handedOffToCloud = false;
      try {
        const history = chat.messages
          .slice(0, -1)
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content || '' }));

        // Intentar primero Supabase Edge Function (ejecución real en la nube aunque salgas a WhatsApp)
        if (canTryCloudAgent()) {
          const dispatched = await dispatchCloudAgent(chat, text, history);
          if (dispatched && dispatched.jobId) {
            handedOffToCloud = true;
            addToolMsg('☁️ Procesando en la nube (podés minimizar o ir a WhatsApp)...');
            stopCloudJobPolling();
            cloudPollTimer = setTimeout(pollCloudJobOnce, 2200);
            return;
          }
        }

        // Fallback automático a motor local si la Edge Function aún no está desplegada o sin sesión
        const result = await runAgent(text, history);
        await finalizeAgentResult(chat, result);
      } catch (err) {
        hideTyping();
        addErrorMsg('Error: ' + (err && err.message ? err.message : String(err)));
      } finally {
        if (!handedOffToCloud) {
          isProcessing = false;
          sendBtn.disabled = false;
          if (fab) fab.classList.remove('working');
          if (panel.classList.contains('open')) input.focus();
        }
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

    // Reemplaza el historial local por el historial privado de la cuenta al iniciar sesión.
    // Hasta que esto termina, ningún chat local se escribe sobre la nube.
    hydrateChatsFromCloud(renderAll);
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

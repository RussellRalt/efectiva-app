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

  const SYSTEM_PROMPT = `Sos el Copiloto Proactivo de "Efectiva / ASISTA MULTY", con CONTROL TOTAL sobre la app, memoria persistente entre sesiones y acceso a investigación web.

ESTRUCTURA Y CAPACIDADES QUE TENÉS HOY (v14):
1. **Control Atómico y Presentación en Vivo**: Podés crear/editar tareas completas en 1 llamada (\`guardar_tarea_completa\`), distribuir minutos por paso (\`asignar_tiempos_pasos\`), iniciar presentaciones (\`iniciar_presentacion_tarea\`), registrar/justificar retrasos en números rojos (\`registrar_retraso_paso\`) y silenciar alarmas.
2. **Memoria Persistente a Largo Plazo**: Tenés memoria propia (\`guardar_memoria_usuario\`, \`consultar_memoria_usuario\`, \`eliminar_memoria_usuario\`) que se inyecta automáticamente al inicio de cada conversación. Guardá ahí patrones de tiempo del usuario, horarios de máxima energía, motivos frecuentes de retraso, preferencias y metas cuadridimensionales (cuerpo, mente, emociones, espíritu).
3. **Motor GPS y Analítica Real**: Si el usuario se atrasa, usá \`recalcular_agenda_dia\` para recorrer automáticamente las reglas \`hora_programada\` restantes del día. Usá \`analizar_patrones_rendimiento\` para detectar dónde subestima tiempos y qué causas de retraso se repiten.
4. **Ojos al Exterior (Web Research Open-Source)**: Tenés \`buscar_web\` (búsqueda en línea en vivo) y \`leer_url_web\` (vía Jina Reader para leer páginas limpias en Markdown) con opción de guardar automáticamente la investigación en una Nota vinculada a una tarea (\`tarea_id\`).
5. **Plantillas, Notas y Reglas Operativas**: Podés crear/editar plantillas de usuario, notas (\`crear_nota\`, \`editar_nota\`) y automatizaciones por \`paso_completado\`, \`tiempo_paso_agotado\`, \`hora_programada\`, \`tarea_completada\` y \`carpeta_completada\`.

COMPORTAMIENTO PROACTIVO ESPERADO:
- Usá SIEMPRE las tools reales antes de afirmar un cambio o dato.
- Cuando el usuario te cuente una preferencia, horario ideal o patrón importante, guardalo proactivamente con \`guardar_memoria_usuario\` sin que tenga que pedírtelo.
- Cuando veas retrasos o una tarea de investigación pendiente, ofrecé o ejecutá proactivamente el pre-trabajo (investigar con \`buscar_web\` y dejar una Nota lista) o el reajuste GPS (\`recalcular_agenda_dia\`).
- Si detectás fricciones o oportunidades concretas de mejora en el ecosistema de Efectiva, aportá ideas accionables basadas en tu experiencia real usando las tools.`;

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
      description: 'Genera métricas y reporte de productividad global o por carpeta.',
      parameters: { type: 'object', properties: { carpeta_id: { type: ['string', 'null'] } }, required: [] } } },
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
          carpeta_id: { type: ['string', 'null'] },
          aplicar_como_reglas: { type: 'boolean', description: 'Si true, crea reglas hora_programada para iniciar automáticamente la presentación de cada tarea a su hora' }
        },
        required: ['hora_inicio']
      } } },
    { type: 'function', function: { name: 'obtener_estadisticas_gamificacion',
      description: 'Obtiene las estadísticas de XP total, nivel actual y racha de días consecutivos del usuario.',
      parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'guardar_memoria_usuario',
      description: 'Guarda un recuerdo persistente en 2 capas: es_nucleo=true (máx 8 hechos vitales siempre visibles) o es_nucleo=false (archivo histórico de 0 tokens recuperable con buscar_memoria_relevante).',
      parameters: {
        type: 'object',
        properties: {
          categoria: { type: 'string', description: 'patrones_tiempo | energia_horarios | motivos_retraso | preferencias | cuadridimensional | proyecto' },
          clave: { type: 'string', description: 'Identificador corto único' },
          valor: { type: 'string', description: 'Información aprendida' },
          es_nucleo: { type: 'boolean', description: 'true = Capa 1 Núcleo (siempre visible); false = Capa 2 Archivo (0 tokens hasta consultarlo)' }
        },
        required: ['categoria', 'clave', 'valor']
      } } },
    { type: 'function', function: { name: 'buscar_memoria_relevante',
      description: 'Busca en la memoria histórica (Capa 1 + Capa 2) solo los recuerdos relevantes para la consulta actual (ahorra tokens).',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Tema, proyecto o palabra clave a recordar' },
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
      description: 'Analiza el historial real de retrasos (delayLogs), tiempos reales vs estimados y recomienda ajustes.',
      parameters: { type: 'object', properties: {}, required: [] } } },
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
      parameters: { type: 'object', properties: { habilitado: { type: 'boolean' }, anunciar_pasos: { type: 'boolean' } }, required: ['habilitado'] } } }
  ];

  // --------------------------------------------------------------------------
  //  STATE HELPERS
  // --------------------------------------------------------------------------
  function getStateSnapshot() {
    const activePres = (typeof presentationOpen !== 'undefined' && presentationOpen && typeof currentPresentationTask !== 'undefined' && currentPresentationTask)
      ? {
          tarea_id: currentPresentationTask.id,
          tarea_nombre: currentPresentationTask.name,
          paso_actual_indice: (typeof currentStepIndex !== 'undefined') ? currentStepIndex : 0,
          paso_actual_texto: (typeof presentationSteps !== 'undefined' && presentationSteps[currentStepIndex]) ? (presentationSteps[currentStepIndex].text || presentationSteps[currentStepIndex]) : '',
          total_pasos: (typeof presentationSteps !== 'undefined') ? presentationSteps.length : 0,
          segundos_restantes: currentPresentationTask.totalTime ? ((typeof currentStepCountdown !== 'undefined') ? currentStepCountdown : 0) : null,
          en_negativo: !!(currentPresentationTask.totalTime && typeof currentStepCountdown !== 'undefined' && currentStepCountdown < 0),
          alarma_sonando: (typeof stepAlarmActive !== 'undefined') ? !!stepAlarmActive : false,
          retrasos_registrados: Array.isArray(currentPresentationTask.delayLogs) ? currentPresentationTask.delayLogs : []
        }
      : null;

    const nowObj = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const ahoraLocal = `${nowObj.getFullYear()}-${pad2(nowObj.getMonth() + 1)}-${pad2(nowObj.getDate())} ${pad2(nowObj.getHours())}:${pad2(nowObj.getMinutes())}:${pad2(nowObj.getSeconds())}`;
    let zonaHoraria = 'local';
    try { zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone || zonaHoraria; } catch (e) {}
    const offsetMin = -nowObj.getTimezoneOffset();
    const offsetSign = offsetMin >= 0 ? '+' : '-';
    const offsetStr = `UTC${offsetSign}${pad2(Math.floor(Math.abs(offsetMin) / 60))}:${pad2(Math.abs(offsetMin) % 60)}`;

    const allNotes = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes : [];
    const allRules = (typeof automationRules !== 'undefined' && Array.isArray(automationRules)) ? automationRules : [];

    return {
      ok: true,
      ahora_iso: nowObj.toISOString(),
      ahora_local: ahoraLocal,
      zona_horaria: `${zonaHoraria} (${offsetStr})`,
      carpeta_actual_id: (typeof currentFolderId !== 'undefined') ? currentFolderId : null,
      plantillas_usuario: (typeof userTemplates !== 'undefined') ? userTemplates.map(t => ({ id: t.id, nombre: t.name, pasos: (t.steps || []).length, tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : null, prioridad: t.priority || null })) : [],
      notas_resumen: {
        total: allNotes.length,
        recientes: allNotes.slice(0, 12).map(n => ({ id: n.id, titulo: n.title, carpeta_id: n.folderId || null, tarea_id: n.taskId || null, etiquetas: n.tags || [] }))
      },
      reglas_automatizacion_resumen: {
        total: allRules.length,
        activas: allRules.filter(r => r.activa !== false).length
      },
      presentacion_activa: activePres,
      carpetas: (typeof folders !== 'undefined') ? folders.map(f => ({
        id: f.id, nombre: f.name, es_recompensas: !!f.isDefaultRewards,
        cantidad_tareas: (f.tasks || []).length,
        cantidad_completadas: (f.finished || []).length,
        tareas: (f.tasks || []).map(t => {
          const curIdx = t.currentStepIndex || 0;
          return {
            id: t.id, nombre: t.name, es_recompensa: !!t.isReward,
            tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : (t.rewardTime || null),
            tiempo_real_min: t.actualTimeMinutes || null,
            tiempos_pasos_minutos: Array.isArray(t.stepTimes) ? t.stepTimes.map(s => Math.round(((Number(s) || 0) / 60) * 10) / 10) : [],
            tiempos_personalizados: !!t.hasCustomStepTimes,
            color: t.color || null, prioridad: t.priority || null, fecha_vencimiento: t.dueDate || null,
            etiquetas: Array.isArray(t.tags) ? t.tags : [],
            pasos: t.steps || [],
            pasos_detalle: (t.steps || []).map((s, idx) => ({
              indice: idx,
              texto: (typeof s === 'string') ? s : (s.text || ''),
              completado: (typeof s === 'object' && s !== null && typeof s.completed === 'boolean') ? s.completed : (idx < curIdx),
              minutos: (Array.isArray(t.stepTimes) && typeof t.stepTimes[idx] === 'number') ? Math.round((t.stepTimes[idx] / 60) * 10) / 10 : null
            })),
            retrasos: Array.isArray(t.delayLogs) ? t.delayLogs : []
          };
        }),
        tareas_completadas: (f.finished || []).map(t => ({
          id: t.id, nombre: t.name,
          tiempo_minutos: t.totalTime ? Math.round((t.totalTime / 60) * 10) / 10 : null,
          tiempo_real_min: t.actualTimeMinutes || null,
          fecha_completada: t.completedAt || null,
          color: t.color || null, prioridad: t.priority || null,
          etiquetas: Array.isArray(t.tags) ? t.tags : [],
          pasos_detalle: (t.steps || []).map((s, idx) => ({
            indice: idx,
            texto: (typeof s === 'string') ? s : (s.text || ''),
            completado: true,
            minutos: (Array.isArray(t.stepTimes) && typeof t.stepTimes[idx] === 'number') ? Math.round((t.stepTimes[idx] / 60) * 10) / 10 : null
          })),
          retrasos: Array.isArray(t.delayLogs) ? t.delayLogs : []
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
          task.totalTime = (tiempo_minutos && Number(tiempo_minutos) > 0)
            ? Math.round(Number(tiempo_minutos) * 60)
            : parsedTimes.reduce((a, b) => a + b, 0);
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
        if (actualizar_total || !task.totalTime) {
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
        if (actualizar_total) {
          task.totalTime = task.stepTimes.reduce((a, b) => a + (Number(b) || 0), 0);
        }
      } else {
        return { ok: false, error: 'Debes pasar tiempos_minutos (array) o paso_indice + minutos.' };
      }

      if (typeof saveDataToLocalStorage === 'function') saveDataToLocalStorage();
      if (typeof currentFolderId !== 'undefined' && currentFolderId === found.folder.id && typeof renderTasks === 'function') {
        renderTasks();
      }
      const resumen = task.stepTimes.map((s, i) => `P${i + 1}: ${Math.round((s / 60) * 10) / 10}m`).join(', ');
      return { ok: true, mensaje: `Tiempos de pasos actualizados en "${task.name}" (${resumen}).` };
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

    guardar_memoria_usuario({ categoria, clave, valor, es_nucleo }) {
      const cat = String(categoria || 'preferencias').trim();
      const k = String(clave || '').trim();
      const v = String(valor || '').trim();
      const isCore = (es_nucleo !== undefined) ? !!es_nucleo : (cat === 'preferencias' || cat === 'energia_horarios' || cat === 'cuadridimensional');
      if (!k || !v) return { ok: false, error: 'clave y valor son obligatorios' };
      const list = loadAgentMemory();
      const existing = list.find(m => m.categoria === cat && m.clave === k);
      if (existing) {
        existing.valor = v;
        existing.es_nucleo = isCore;
        existing.updatedAt = new Date().toISOString();
      } else {
        list.unshift({
          id: '_mem_' + Math.random().toString(36).substr(2, 8),
          categoria: cat,
          clave: k,
          valor: v,
          es_nucleo: isCore,
          updatedAt: new Date().toISOString()
        });
      }
      saveAgentMemory(list);
      return { ok: true, mensaje: `Memoria guardada [${cat}/${k}] (${isCore ? 'Capa 1 Núcleo' : 'Capa 2 Archivo'}).`, total_memorias: list.length };
    },

    buscar_memoria_relevante({ consulta, top_k }) {
      const q = String(consulta || '').toLowerCase().trim();
      const k = Math.max(1, Math.min(15, Number(top_k) || 5));
      const list = loadAgentMemory();
      if (!q) return { ok: true, recuerdos: list.slice(0, k) };

      const terms = q.split(/\s+/).filter(Boolean);
      const scored = list.map(m => {
        const hay = `${m.categoria} ${m.clave} ${m.valor}`.toLowerCase();
        let score = 0;
        terms.forEach(t => { if (hay.includes(t)) score += (m.clave.toLowerCase().includes(t) ? 3 : 1); });
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

    analizar_patrones_rendimiento() {
      const allFolders = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
      const delays = [];
      const desviaciones = [];
      const motivosCount = {};

      allFolders.forEach(f => {
        const allTasks = [...(f.tasks || []), ...(f.finished || [])];
        allTasks.forEach(t => {
          if (Array.isArray(t.delayLogs)) {
            t.delayLogs.forEach(d => {
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
              diferencia_min: Math.round((t.actualTimeMinutes - est) * 10) / 10
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
      return `- ${f.name} (ID: ${f.id}) [${cantTareas} tareas pdt, ${cantFin} fin]${f.isDefaultRewards ? ' (Recompensas)' : ''}`;
    }).join('\n');
    const allMems = loadAgentMemory();
    const coreMems = allMems.filter(m => m.es_nucleo !== false).slice(0, 8);
    const archiveCount = Math.max(0, allMems.length - coreMems.length);
    const memBlock = coreMems.length > 0
      ? '\n\nMEMORIA NÚCLEO DEL USUARIO (Capa 1, ' + coreMems.length + '):\n' + coreMems.map(m => `- [${m.categoria}] ${m.clave}: ${m.valor}`).join('\n') + (archiveCount > 0 ? `\n(Archivo Capa 2: ${archiveCount} recuerdos adicionales disponibles con buscar_memoria_relevante)` : '')
      : '\n\nMEMORIA NÚCLEO DEL USUARIO: (Aún vacía; guarda hechos vitales con es_nucleo=true o archivo con es_nucleo=false).' + (archiveCount > 0 ? ` (Archivo Capa 2: ${archiveCount} recuerdos)` : '');
    return '\n\nESTADO ACTUAL EN TIEMPO REAL EN LA APP (' + folders.length + ' carpetas en total):\n' + (lista || '(Sin carpetas)') + memBlock;
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
            try { result = await exec(args); }
            catch (e) { result = { ok: false, error: 'Excepción: ' + (e && e.message ? e.message : String(e)) }; }
          }
          toolTrace.push({ tool: fn, args, result });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 80000)
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
      lastAssistantText = assistantMsg.content || '';
      break;
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
      panel.classList.remove('open'); if (typeof window.stopAllSpeechSynthesis === 'function') window.stopAllSpeechSynthesis();
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

    async function resumePendingAiJobIfNeeded() {
      if (isResumingPendingJob || document.hidden || !navigator.onLine) return;
      const job = loadPendingAiJob();
      if (!job) return;
      if (!job.interrupted && (Date.now() - (job.updatedAt || 0) < 4000)) return;
      const chat = chats.find(c => c.id === job.chatId) || getCurrentChat();
      if (!chat) { savePendingAiJob(null); return; }

      isResumingPendingJob = true;
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
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resumePendingAiJobIfNeeded();
    });
    window.addEventListener('online', () => resumePendingAiJobIfNeeded());
    setTimeout(resumePendingAiJobIfNeeded, 1200);

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
      autoTitle(chat);
      saveChats();
      renderHistory();
      showTyping();
      try {
        const history = chat.messages
          .slice(0, -1)
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content || '' }));
        const result = await runAgent(text, history);
        await finalizeAgentResult(chat, result);
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

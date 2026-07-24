// @ts-nocheck

/************************************************************************
 * VARIABLES GLOBALES
 ************************************************************************/
// Estructura de cada carpeta: { id, name, tasks:[], finished:[], isDefaultRewards?:bool }
let folders = [];
let trash = [];
const rewardsFolderId = 'rewards-folder';
let currentFolderId = null;

let currentTheme = localStorage.getItem('appTheme') || 'dark';

let draggedFolderId = null;
let draggedTaskId = null;
let draggedStepIndex = null;

let presentationSteps = [];
let currentStepIndex = 0;
let timerSeconds = 0;
let currentStepCountdown = 0; // Temporizador específico para el paso actual
let timerInterval = null;
let presentationOpen = false;
let currentPresentationTask = null;
let isPresentationMinimized = false; // Estado para saber si está minimizada

let taskBeingScheduled = null;
let currentAlarmTask = null;
let taskBeingRewarded = null;
let folderOfTaskBeingRewarded = null;
let taskBeingMoved = null;
let folderOfTaskBeingMoved = null;
let isTaskCompletedBeingMoved = false;

// NUEVAS VARIABLES PARA DEBOUNCE DE INTERACCIONES EN LA PRESENTACIÓN
let lastPresentationInteraction = 0;
const PRESENTATION_DEBOUNCE_MS = 300; // tiempo en milisegundos

// NUEVA VARIABLE GLOBAL PARA MARCAR EL OCULTAMIENTO
let lastHiddenTime = 0;

// Variable para almacenar el wake lock.
let wakeLock = null;

// ============================================================================
// NUEVAS VARIABLES PARA MODO PLAY POR CARPETA + RECOMPENSAS ALEATORIAS
// ============================================================================
let folderPlayQueue = [];        // Cola de tareas a ejecutar en el modo play
let folderPlayIndex = 0;          // Índice actual en la cola
let folderPlayOriginalLength = 0; // Largo ORIGINAL de la queue (no cambia al mover a finished)
let folderPlayFolderId = null;    // Carpeta en modo play
let rewardTimerInterval = null;   // Intervalo del cronómetro de recompensa
let rewardSecondsLeft = 0;        // Segundos restantes del cronómetro de recompensa
let rewardIsFree = false;         // true = tiempo libre (sin límite)
let currentReward = null;        // Recompensa actual mostrándose
let pendingRewardNext = null;     // Callback a ejecutar cuando termine la recompensa
let pendingNoRewardCallback = null; // Callback si no hay recompensas (mostrar aviso)

/************************************************************************
 * ELEMENTOS DEL DOM
 ************************************************************************/
const foldersSection = document.getElementById('foldersSection');
const folderContainer = document.getElementById('folderContainer');
const themeButton = document.getElementById('themeButton');
const importFileInput = document.getElementById('importFileInput');
const trashButton = document.getElementById('trashButton');
const newFolderInput = document.getElementById('newFolderInput');
const tasksSection = document.getElementById('tasksSection');
const tasksTitle = document.getElementById('tasksTitle');
const newTaskInput = document.getElementById('newTaskInput');
// Nuevo input para asignar tiempo (en minutos) a la tarea
const newTaskTimeInput = document.getElementById('newTaskTimeInput');
const tasksList = document.getElementById('tasksList');
const completedMiniFolder = document.getElementById('completedMiniFolder');
const completedMiniFolderList = document.getElementById('completedMiniFolderList');
const trashSection = document.getElementById('trashSection');
const trashList = document.getElementById('trashList');
const presentationModal = document.getElementById('presentationModal');
const presentationStep = document.getElementById('presentationStep');
const timerDisplay = document.getElementById('timerDisplay');
const scheduleModal = document.getElementById('scheduleModal');
const scheduleDateInput = document.getElementById('scheduleDateInput');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');
const cancelScheduleBtn = document.getElementById('cancelScheduleBtn');
const alarmModal = document.getElementById('alarmModal');
const alarmTitle = document.getElementById('alarmTitle');
const disableAlarmBtn = document.getElementById('disableAlarmBtn');
const rewardSection = document.getElementById('rewardSection');
const rewardInput = document.getElementById('rewardInput');
const moveModal = document.getElementById('moveModal');
const targetFolderSelect = document.getElementById('targetFolderSelect');
const confirmMoveBtn = document.getElementById('confirmMoveBtn');
const cancelMoveBtn = document.getElementById('cancelMoveBtn');

// Elementos del modal de confirmación
const confirmModal = document.getElementById('confirmModal');
const confirmMessageElem = document.getElementById('confirmMessage');
const confirmYesBtn = document.getElementById('confirmYesBtn');
const confirmNoBtn = document.getElementById('confirmNoBtn');

/************************************************************************
 * EVENTOS DE CARGA
 ************************************************************************/
let efectivaInitialized = false;

async function initializeEfectiva() {
  if (efectivaInitialized || !window.EfectivaCloud?.user) return;
  efectivaInitialized = true;
  loadDataFromLocalStorage();

  try {
    const cloudData = await window.EfectivaCloud.loadData();
    if (cloudData && Array.isArray(cloudData.folders)) {
      folders = cloudData.folders;
      trash = cloudData.trash || [];
      localStorage.setItem('foldersDataV4', JSON.stringify({ folders, trash }));
    } else {
      window.EfectivaCloud.scheduleSave({ folders, trash });
    }
  } catch (error) {
    console.error('No se pudo cargar la nube:', error.message);
  }

  ensureRewardsFolder();
  applyTheme(currentTheme);
  renderFolders();
  cleanOldTrashItems();
  window.addEventListener('popstate', handlePopState);
  setInterval(checkAlarms, 60 * 1000);
}

window.addEventListener('load', initializeEfectiva);
window.addEventListener('efectiva:authenticated', initializeEfectiva);

newFolderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const name = newFolderInput.value.trim();
    if (name) {
      createFolder(name);
      newFolderInput.value = '';
    }
  }
});

// Listener para el input del nombre de la tarea
newTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const taskName = newTaskInput.value.trim();
    if (!taskName || !currentFolderId) return;
    if (currentFolderId === rewardsFolderId) {
      // En la carpeta de recompensas, este input + el de tiempo crean una recompensa
      const timeMinutes = newTaskTimeInput.value.trim();
      addReward(taskName, timeMinutes);
      newTaskInput.value = '';
      newTaskTimeInput.value = '';
    } else {
      createTask(currentFolderId, taskName);
      newTaskInput.value = '';
      newTaskTimeInput.value = '';
    }
  }
});

// Listener adicional para el input del temporizador (tiempo)
newTaskTimeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const taskName = newTaskInput.value.trim();
    if (!taskName || !currentFolderId) return;
    if (currentFolderId === rewardsFolderId) {
      const timeMinutes = newTaskTimeInput.value.trim();
      addReward(taskName, timeMinutes);
      newTaskInput.value = '';
      newTaskTimeInput.value = '';
    } else {
      createTask(currentFolderId, taskName);
      newTaskInput.value = '';
      newTaskTimeInput.value = '';
    }
  }
});

themeButton.addEventListener('click', () => {
  if (currentTheme === 'dark') applyTheme('light');
  else if (currentTheme === 'light') applyTheme('cyberpunk');
  else applyTheme('dark');
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const importedJSON = JSON.parse(event.target.result);
      if (!importedJSON.folders) {
        await asistaAlert("El archivo no es válido o no contiene 'folders'.", { title: 'Importar JSON', type: 'warn' });
        return;
      }
      const importedFolders = importedJSON.folders.filter(f => !f.isDefaultRewards);
      folders = [...folders, ...importedFolders];
      ensureRewardsFolder();
      saveDataToLocalStorage();
      renderFolders();
      await asistaAlert('¡Datos importados con éxito!', { title: 'Importar JSON', type: 'success' });
    } catch (err) {
      await asistaAlert('Error al leer el JSON: ' + err, { title: 'Importar JSON', type: 'error' });
    }
  };
  reader.readAsText(file);
  importFileInput.value = '';
});

trashButton.addEventListener('click', () => showTrash());
// NOTA: El listener de rewardInput ya no se usa. Las recompensas ahora se crean
// desde la carpeta "Recompensas" usando newTaskInput + newTaskTimeInput (Enter).
// Se conserva el elemento en el HTML por compatibilidad con posibles referencias,
// pero el flujo de "registrar recompensa" del final de cada tarea ya no existe.
// (Para añadir recompensas: abre la carpeta "Recompensas" y escribe nombre + tiempo.)

saveScheduleBtn.addEventListener('click', () => {
  if (!taskBeingScheduled) return;
  const newDate = scheduleDateInput.value;
  taskBeingScheduled.scheduledTimestamp = newDate ? new Date(newDate).getTime() : null;
  closeScheduleModal();
  saveDataToLocalStorage();
  renderTasks();
});
cancelScheduleBtn.addEventListener('click', () => closeScheduleModal());
disableAlarmBtn.addEventListener('click', () => {
  alarmModal.style.display = 'none';
  if (currentAlarmTask) {
    currentAlarmTask.scheduledTimestamp = null;
    saveDataToLocalStorage();
    renderTasks();
  }
  currentAlarmTask = null;
});

/************************************************************************
 * CONFIRM MODAL PERSONALIZADO
 ************************************************************************/
function showConfirm(message, onConfirm, onCancel) {
  confirmMessageElem.textContent = message;
  confirmModal.style.display = 'flex';

  const handleYes = () => {
    confirmModal.style.display = 'none';
    confirmYesBtn.removeEventListener('click', handleYes);
    confirmNoBtn.removeEventListener('click', handleNo);
    if (onConfirm) onConfirm();
  };

  const handleNo = () => {
    confirmModal.style.display = 'none';
    confirmYesBtn.removeEventListener('click', handleYes);
    confirmNoBtn.removeEventListener('click', handleNo);
    if (onCancel) onCancel();
  };

  confirmYesBtn.addEventListener('click', handleYes);
  confirmNoBtn.addEventListener('click', handleNo);
}

/************************************************************************
 * HISTORIAL / NAVEGACIÓN
 ************************************************************************/
window.removeEventListener('popstate', handlePopState);
window.addEventListener('popstate', handlePopState);

function handlePopState(event) {
  console.log('popstate event:', event.state);
  // Si la presentación está activa en pantalla grande, cerrarla y detener navegación.
  if (presentationOpen && !isPresentationMinimized) {
    console.log('Cerrando presentación por popstate');
    closePresentation(true);
    return; // No procesar más cambios
  }
  // Procesa la navegación normal solo si hay un estado
  if (event.state) {
    if (event.state.rewards) {
      showFolders();
    } else if (event.state.folderId) {
      openFolder(event.state.folderId, false);
    } else if (event.state.trash) {
      showTrash(false);
    }
  } else {
    showFolders();
  }
}

// Aquí seguirían los demás segmentos, como CARPETAS – NAVEGACIÓN, etc.
function showFolders() {
  // Oculta las secciones de tareas, recompensas, agenda, alarma y papelera.
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  trashSection.style.display = 'none';
  // Muestra la vista de carpetas.
  foldersSection.style.display = 'block';
  // Marca que ya no estamos en una carpeta.
  currentFolderId = null;
  // Si no hay una mini presentación activa, oculta el modal de presentación.
  if (!isPresentationMinimized) {
    presentationModal.style.display = 'none';
  }
}

function openFolder(folderId, pushToHistory = true) {
  currentFolderId = folderId;
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  tasksTitle.textContent = folder.name;
  // Oculta las secciones innecesarias y muestra la vista de tareas
  foldersSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  presentationModal.style.display = 'none';
  trashSection.style.display = 'none';
  tasksSection.style.display = 'block';
  renderTasks();

  // Empuja el estado al historial: si es la carpeta de Recompensas, usa un estado especial
  if (pushToHistory) {
    if (folderId === rewardsFolderId) {
      history.pushState({ rewards: true }, '', '');
    } else {
      history.pushState({ folderId }, '', '');
    }
  }
}

function showTrash(pushHistory = true) {
  // Oculta todas las secciones excepto la de la papelera.
  foldersSection.style.display = 'none';
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  presentationModal.style.display = 'none';
  trashSection.style.display = 'block';
  renderTrash();
  if (pushHistory) {
    history.pushState({ trash: true }, '', '');
  }
}

/************************************************************************
 * CARPETAS – NAVEGACIÓN
 ************************************************************************/
function showFolders() {
  // Se ocultan las vistas de tareas, recompensas, agenda, alarma, papelera…
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  trashSection.style.display = 'none';
  // Se muestra la vista de carpetas
  foldersSection.style.display = 'block';
  // Se marca que ya no estamos en una carpeta
  currentFolderId = null;
  // Si NO hay una mini presentación activa, se oculta el modal de presentación.
  if (!isPresentationMinimized) {
    presentationModal.style.display = 'none';
  }
}

function openFolder(folderId, pushToHistory = true) {
  currentFolderId = folderId;
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  tasksTitle.textContent = folder.name;
  // Ocultamos la vista de carpetas y mostramos la vista de tareas
  foldersSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';

  /* Si hay una presentación activa y está en modo minimizado (mini presentación),
     se deja visible; en caso contrario se oculta. */
  if (!presentationOpen || (presentationOpen && !isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }

  trashSection.style.display = 'none';
  tasksSection.style.display = 'block';
  renderTasks();

  // Empujamos el estado de la carpeta al historial, sin excluir ninguna carpeta (incluso la de recompensas)
  if (pushToHistory) {
    history.pushState({ folderId: folderId }, '', '');
  }
}

/************************************************************************
 * CARPETAS – NAVEGACIÓN
 ************************************************************************/
function showFolders() {
  // Oculta las secciones de tareas, recompensas, agenda, alarma y papelera.
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  trashSection.style.display = 'none';
  // Muestra la vista de carpetas.
  foldersSection.style.display = 'block';
  // Marca que ya no estamos en una carpeta.
  currentFolderId = null;
  // Si no hay una mini presentación activa, oculta el modal de presentación.
  if (!isPresentationMinimized) {
    presentationModal.style.display = 'none';
  }
}

function openFolder(folderId, pushToHistory = true) {
  currentFolderId = folderId;
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  tasksTitle.textContent = folder.name;
  // Oculta la vista de carpetas y muestra la vista de tareas.
  foldersSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';

  /* Si hay una presentación activa y está en modo minimizado (mini presentación),
     la dejamos visible; de lo contrario se oculta. */
  if (!presentationOpen || (presentationOpen && !isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }

  trashSection.style.display = 'none';
  tasksSection.style.display = 'block';
  renderTasks();

  // Empuja el estado de la carpeta al historial.
  // Para la carpeta de recompensas, se marca un estado especial (rewards: true)
  if (pushToHistory) {
    if (folderId === rewardsFolderId) {
      history.pushState({ rewards: true }, '', '');
    } else {
      history.pushState({ folderId }, '', '');
    }
  }
}

function showTrash(pushHistory = true) {
  // Oculta todas las secciones excepto la de la papelera.
  foldersSection.style.display = 'none';
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  presentationModal.style.display = 'none';
  trashSection.style.display = 'block';
  renderTrash();
  if (pushHistory) {
    history.pushState({ trash: true }, '', '');
  }
}

/************************************************************************
 * CARPETAS
 ************************************************************************/
// ... Funciones existentes como createFolder, renderFolders, toggleFolderDropdownMenu, etc.

function showFolders() {
  // Se ocultan las vistas de tareas, recompensas, agenda, alarma, papelera…
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  trashSection.style.display = 'none';
  // Se muestra la vista de carpetas
  foldersSection.style.display = 'block';
  // Se marca que ya no estamos en una carpeta
  currentFolderId = null;
  // Si NO hay una mini presentación activa, se oculta el modal de presentación.
  if (!isPresentationMinimized) {
    presentationModal.style.display = 'none';
  }
}

function openFolder(folderId, pushToHistory = true) {
  currentFolderId = folderId;
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  tasksTitle.textContent = folder.name;
  // Ocultamos la vista de carpetas y mostramos la vista de tareas
  foldersSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';

  /* Si hay una presentación activa y está en modo minimizado (mini presentación),
     se deja visible; en caso contrario se oculta. */
  if (!presentationOpen || (presentationOpen && !isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }

  trashSection.style.display = 'none';
  tasksSection.style.display = 'block';
  // NUEVO: ajustar placeholders según la carpeta
  if (folderId === rewardsFolderId) {
    if (newTaskInput) newTaskInput.placeholder = 'Describe tu recompensa (Enter)...';
    if (newTaskTimeInput) newTaskTimeInput.placeholder = 'Tiempo en min (opcional)';
  } else {
    if (newTaskInput) newTaskInput.placeholder = 'Agrega una tarea (Enter)...';
    if (newTaskTimeInput) newTaskTimeInput.placeholder = 'Tiempo (min) (opcional)';
  }
  renderTasks();

  // Empujamos el estado de la carpeta al historial para que el botón "atrás" nos permita salir
  if (pushToHistory && !presentationOpen) { // Evita cambiar el historial si se está en presentación
    if (folderId === rewardsFolderId) {
      history.pushState({ rewards: true }, '', '');
    } else {
      history.pushState({ folderId: folderId }, '', '');
    }
  }
}

// ... Continúa con el resto de funciones de la sección CARPETAS.

/************************************************************************
 * TEMA
 ************************************************************************/
function applyTheme(themeName) {
  document.body.classList.remove('light-theme', 'cyberpunk-theme');
  if (themeName === 'light') {
    document.body.classList.add('light-theme');
    themeButton.textContent = '☀️';
  } else if (themeName === 'cyberpunk') {
    document.body.classList.add('cyberpunk-theme');
    themeButton.textContent = '🔥';
  } else {
    themeButton.textContent = '🌙';
  }
  currentTheme = themeName;
  localStorage.setItem('appTheme', themeName);
}

/************************************************************************
 * CARPETAS
 ************************************************************************/
function ensureRewardsFolder() {
  let rf = folders.find(f => f.id === rewardsFolderId);
  if (!rf) {
    rf = {
      id: rewardsFolderId,
      name: 'Recompensas',
      tasks: [],
      finished: [],
      isDefaultRewards: true
    };
    folders.push(rf);
  }
}

function createFolder(name) {
  const folder = {
    id: generateId(),
    name,
    tasks: [],
    finished: [],
    isDefaultRewards: false
  };
  folders.push(folder);
  saveDataToLocalStorage();
  renderFolders();
}

function renderFolders() {
  folderContainer.innerHTML = '';
  folders.forEach(folder => {
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';
    folderDiv.dataset.id = folder.id;
    folderDiv.draggable = true;

    const miniFolder = document.createElement('div');
    miniFolder.className = 'mini-folder';
    miniFolder.innerHTML = '📁';
    miniFolder.onclick = () => showFinishedTasks(folder.id);

    folderDiv.addEventListener('dragstart', handleFolderDragStart);
    folderDiv.addEventListener('dragover', handleFolderDragOver);
    folderDiv.addEventListener('drop', handleFolderDrop);
    folderDiv.addEventListener('click', () => openFolder(folder.id));

    const folderIcon = document.createElement('div');
    folderIcon.className = 'folder-icon';

    const folderName = document.createElement('div');
    folderName.className = 'folder-name';
    folderName.textContent = folder.name;

    const folderOptionsBtn = document.createElement('button');
    folderOptionsBtn.className = 'folder-options-btn';
    folderOptionsBtn.innerHTML = '⋮';
    folderOptionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolderDropdownMenu(folder.id);
    });

    const folderDropdownMenu = document.createElement('div');
    folderDropdownMenu.className = 'folder-dropdown-menu';
    folderDropdownMenu.id = `folderMenu-${folder.id}`;

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Exportar JSON';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportFolder(folder);
      folderDropdownMenu.style.display = 'none';
    });
    folderDropdownMenu.appendChild(exportBtn);

    // NUEVO: botón PLAY para iniciar el modo play de TODA la carpeta
    // FIX v2: se muestra también en la carpeta de recompensas (aunque no tenga tareas con pasos,
    // el usuario puede ver el botón y entender que esa carpeta es especial)
    {
      const playFolderBtn = document.createElement('button');
      playFolderBtn.textContent = folder.isDefaultRewards ? '▶ Reproducir (sin tareas)' : '▶ Reproducir carpeta';
      playFolderBtn.className = 'play-folder-btn';
      playFolderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        folderDropdownMenu.style.display = 'none';
        if (folder.isDefaultRewards) {
          if (typeof showConfirm === 'function') {
            showConfirm('La carpeta de Recompensas no se reproduce. Andá a una carpeta con tareas.', () => {});
          }
          return;
        }
        startFolderPlay(folder.id);
      });
      folderDropdownMenu.appendChild(playFolderBtn);
    }

    if (!folder.isDefaultRewards) {
      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Renombrar';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFolder(folder);
        folderDropdownMenu.style.display = 'none';
      });
      folderDropdownMenu.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm(`¿Eliminar la carpeta "${folder.name}"?`, () => {
          moveFolderToTrash(folder.id);
          folderDropdownMenu.style.display = 'none';
        });
      });
      folderDropdownMenu.appendChild(deleteBtn);
    }

    folderDiv.append(folderOptionsBtn, folderDropdownMenu, folderIcon, folderName);
    folderContainer.appendChild(folderDiv);
  });
}

function toggleFolderDropdownMenu(folderId) {
  document.querySelectorAll('.folder-dropdown-menu').forEach(menu => {
    menu.style.display = 'none';
  });

  const menu = document.getElementById(`folderMenu-${folderId}`);
  if (!menu) return;

  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';

  if (menu.style.display === 'block') {
    setTimeout(() => {
      document.addEventListener('click', function clickListener(e) {
        if (!menu.contains(e.target) && !e.target.closest('.folder-options-btn')) {
          menu.style.display = 'none';
          document.removeEventListener('click', clickListener);
        }
      });
    }, 100);
  }
}

window.addEventListener('popstate', (event) => {
  if (event.state) {
    // Si se detecta el estado especial de Recompensas, se vuelve a la vista de carpetas
    if (event.state.rewards) {
      showFolders();
    } else if (event.state.folderId) {
      openFolder(event.state.folderId, false);
    } else if (event.state.trash) {
      showTrash(false);
    }
  } else {
    // Por defecto, mostrar la vista de carpetas
    showFolders();
  }
});


function renameFolder(folder) {
  const folderElement = document.querySelector(`[data-id="${folder.id}"]`);
  const nameElement = folderElement.querySelector('.folder-name');

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'folder-edit-input';
  editInput.value = folder.name;

  const finishEdit = () => {
    const newName = editInput.value.trim();
    if (newName && newName !== folder.name) {
      folder.name = newName;
      saveDataToLocalStorage();
      renderFolders();
    } else {
      nameElement.textContent = folder.name;
    }
    editInput.replaceWith(nameElement);
  };

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishEdit();
    if (e.key === 'Escape') {
      nameElement.textContent = folder.name;
      editInput.replaceWith(nameElement);
    }
  });

  editInput.addEventListener('blur', finishEdit);

  nameElement.replaceWith(editInput);
  editInput.focus();
}

/************************************************************************
 * PAPELERA
 ************************************************************************/
function moveFolderToTrash(folderId) {
  const idx = folders.findIndex(f => f.id === folderId);
  if (idx === -1) return;

  const folder = folders[idx];
  folders.splice(idx, 1);

  trash.push({
    id: generateId(),
    type: 'folder',
    data: folder,
    deletedAt: Date.now()
  });
  saveDataToLocalStorage();
  renderFolders();
  if (currentFolderId === folderId) showFolders();
}

function moveTaskToTrash(folder, taskId, isFinished = false) {
  const arr = isFinished ? folder.finished : folder.tasks;
  const index = arr.findIndex(t => t.id === taskId);
  if (index === -1) return;

  const task = arr[index];
  arr.splice(index, 1);

  trash.push({
    id: generateId(),
    type: 'task',
    data: { folderId: folder.id, task },
    deletedAt: Date.now()
  });
  saveDataToLocalStorage();
}

function renderTrash() {
  trashList.innerHTML = '';
  if (trash.length === 0) {
    trashList.innerHTML = '<p>La papelera está vacía.</p>';
    return;
  }

  trash.forEach(item => {
    const trashItemDiv = document.createElement('div');
    trashItemDiv.className = 'trash-item';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = item.type === 'folder'
      ? `Carpeta eliminada: ${item.data.name}`
      : `Tarea eliminada: ${item.data.task.name}`;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'trash-buttons';

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restaurar';
    restoreBtn.addEventListener('click', () => restoreFromTrash(item.id));

    const permDeleteBtn = document.createElement('button');
    permDeleteBtn.textContent = 'Eliminar';
    permDeleteBtn.addEventListener('click', () => permanentlyDelete(item.id));

    buttonsDiv.append(restoreBtn, permDeleteBtn);
    trashItemDiv.append(titleSpan, buttonsDiv);
    trashList.appendChild(trashItemDiv);
  });
}

function restoreFromTrash(trashItemId) {
  const idx = trash.findIndex(t => t.id === trashItemId);
  if (idx === -1) return;
  const item = trash[idx];

  if (item.type === 'folder') folders.push(item.data);
  else if (item.type === 'task') {
    const folder = folders.find(f => f.id === item.data.folderId);
    if (folder) folder.tasks.push(item.data.task);
  }

  trash.splice(idx, 1);
  saveDataToLocalStorage();
  trashSection.style.display = 'block';
  renderTrash();
  renderFolders();
}

function permanentlyDelete(trashItemId) {
  trash = trash.filter(t => t.id !== trashItemId);
  saveDataToLocalStorage();
  renderTrash();
}

function cleanOldTrashItems() {
  const now = Date.now();
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
  trash = trash.filter(item => (now - item.deletedAt) < fifteenDaysMs);
  saveDataToLocalStorage();
}

/************************************************************************
 * EXPORTAR CARPETA
 ************************************************************************/
function exportFolder(folder) {
  const dataToExport = { version: 1, folders: [folder] };
  const jsonString = JSON.stringify(dataToExport);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `carpeta_${folder.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/************************************************************************
 * TAREAS (MODIFICACIONES PRINCIPALES)
 ************************************************************************/
function createTask(folderId, taskName) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  // Si la carpeta es de recompensas, no permitimos crear tareas
  if (folder.id === rewardsFolderId) return;
  // Leer el valor opcional del input de tiempo (en minutos) y convertirlo a segundos
  let totalTime = null;
  if (newTaskTimeInput.value.trim() !== "") {
    totalTime = parseInt(newTaskTimeInput.value, 10) * 60; // Convertir minutos a segundos
  }
  const newTask = {
    id: generateId(),
    name: taskName,
    steps: [],
    isExpanded: false,
    scheduledTimestamp: null,
    currentStepIndex: 0,
    totalTime: totalTime, // Tiempo total en segundos (opcional)
    stepTimes: [] // Se calculará a medida que se agreguen pasos
  };
  folder.tasks.push(newTask);
  saveDataToLocalStorage();
  renderTasks();
}

async function capturarElementoComoImagen(element, nombreArchivo = 'Captura.png') {
  if (typeof html2canvas === 'undefined') {
    if (typeof asistaAlert === 'function') asistaAlert('La librería de captura se está cargando, reintentá en un instante.', { title: 'Cargando...' });
    return null;
  }
  try {
    const stepsDiv = element.querySelector('.task-steps');
    const noteBody = element.querySelector('.note-expanded-body');
    const prevStepsDisplay = stepsDiv ? stepsDiv.style.display : null;
    const prevNoteDisplay = noteBody ? noteBody.style.display : null;

    if (stepsDiv) stepsDiv.style.display = 'block';
    if (noteBody) noteBody.style.display = 'block';

    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#1e1e2f',
      useCORS: true,
      logging: false
    });

    if (stepsDiv && prevStepsDisplay !== null) stepsDiv.style.display = prevStepsDisplay;
    if (noteBody && prevNoteDisplay !== null) noteBody.style.display = prevNoteDisplay;

    const dataUrl = canvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.download = nombreArchivo;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return dataUrl;
  } catch (err) {
    console.error('Error al generar captura:', err);
    return null;
  }
}

function buildNoteItem(note) {
  const noteDiv = document.createElement('div');
  noteDiv.className = 'task note-item';
  noteDiv.dataset.noteId = note.id;

  if (note.color) {
    noteDiv.style.backgroundColor = note.color;
    if (typeof darkenColor === 'function') {
      noteDiv.style.borderColor = darkenColor(note.color, 0.3);
    }
  }

  const noteHeader = document.createElement('div');
  noteHeader.className = 'task-header note-header';

  const noteNameSpan = document.createElement('span');
  noteNameSpan.className = 'task-name-text note-name-text';
  const safeTitle = (note.title || 'Sin título').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  noteNameSpan.innerHTML = `<span class="note-icon-badge">📝</span> ${safeTitle}`;

  const noteButtons = document.createElement('div');
  noteButtons.className = 'task-buttons note-buttons';

  // Botón Paleta 🎨
  const colorBtn = document.createElement('button');
  colorBtn.textContent = '🎨';
  colorBtn.title = 'Cambiar color de la nota';
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof openColorPicker === 'function') {
      openColorPicker(colorBtn, note.color, (newColor) => {
        note.color = newColor;
        saveNotes();
        renderTasks();
      });
    } else {
      const palette = ['#4CAF50', '#4285F4', '#FF5252', '#FF9800', '#9C27B0', '#607D8B'];
      const nextColor = palette[(palette.indexOf(note.color) + 1) % palette.length];
      note.color = nextColor;
      saveNotes();
      renderTasks();
    }
  });

  // Botón Captura 📸
  const captureBtn = document.createElement('button');
  captureBtn.textContent = '📸';
  captureBtn.title = 'Capturar nota en imagen HD';
  captureBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    capturarElementoComoImagen(noteDiv, `Nota_${(note.title || 'Nota').replace(/[^a-zA-Z0-9]/g, '_')}.png`);
  });

  // Botón Toggle / Desplegar ▼
  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = note.isExpanded ? '▼' : '◀';
  toggleBtn.title = 'Ver/Ocultar contenido';
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    note.isExpanded = !note.isExpanded;
    saveNotes();
    renderTasks();
  });

  // Botón Eliminar 🗑
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Eliminar nota';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const confirm = await asistaConfirm(`¿Eliminar la nota "${note.title}"?`, { title: 'Eliminar Nota', danger: true });
    if (!confirm) return;
    const idx = notes.findIndex(n => n.id === note.id);
    if (idx !== -1) notes.splice(idx, 1);
    saveNotes();
    renderTasks();
  });

  noteButtons.appendChild(colorBtn);
  noteButtons.appendChild(captureBtn);
  noteButtons.appendChild(toggleBtn);
  noteButtons.appendChild(deleteBtn);

  noteHeader.appendChild(noteNameSpan);
  noteHeader.appendChild(noteButtons);
  noteDiv.appendChild(noteHeader);

  // Cuerpo desplegable de la nota (multilínea vertical)
  const noteBodyDiv = document.createElement('div');
  noteBodyDiv.className = 'note-expanded-body';
  noteBodyDiv.style.display = note.isExpanded ? 'block' : 'none';

  const safeContent = (note.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : '';

  noteBodyDiv.innerHTML = `
    <div class="note-reader-content">${safeContent}</div>
    <div class="note-reader-footer">
      <span>📅 ${dateStr}</span>
      ${note.tags && note.tags.length > 0 ? `<span>${note.tags.map(t => '#' + t.replace(/^#/, '')).join(' ')}</span>` : ''}
      <button class="note-btn edit-note-inline-btn" style="margin-left: auto;">✏️ Editar texto</button>
    </div>
  `;

  const editInlineBtn = noteBodyDiv.querySelector('.edit-note-inline-btn');
  if (editInlineBtn) {
    editInlineBtn.onclick = (e) => {
      e.stopPropagation();
      noteBodyDiv.innerHTML = `
        <div class="note-edit-form">
          <label class="note-edit-label">Título de la nota</label>
          <input type="text" class="note-edit-title" value="${safeTitle.replace(/"/g, '&quot;')}" />
          <label class="note-edit-label">Contenido vertical</label>
          <textarea class="note-edit-content" rows="6">${(note.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
          <div class="note-edit-actions">
            <button class="save-edit-btn">💾 Guardar</button>
            <button class="cancel-edit-btn">✕ Cancelar</button>
          </div>
        </div>
      `;
      noteBodyDiv.querySelector('.save-edit-btn').onclick = (ev) => {
        ev.stopPropagation();
        note.title = noteBodyDiv.querySelector('.note-edit-title').value.trim() || 'Sin título';
        note.content = noteBodyDiv.querySelector('.note-edit-content').value.trim();
        saveNotes();
        renderTasks();
      };
      noteBodyDiv.querySelector('.cancel-edit-btn').onclick = (ev) => {
        ev.stopPropagation();
        renderTasks();
      };
    };
  }

  noteHeader.onclick = () => {
    note.isExpanded = !note.isExpanded;
    saveNotes();
    renderTasks();
  };

  noteDiv.appendChild(noteBodyDiv);
  return noteDiv;
}

function renderTasks() {
  const folder = folders.find(f => f.id === currentFolderId);
  if (!folder) return;

  tasksList.innerHTML = '';
  completedMiniFolderList.innerHTML = '';

  // Renderizar tareas pendientes
  folder.tasks.forEach(task => tasksList.appendChild(buildPendingTaskItem(folder, task)));

  // Renderizar notas en la misma lista unificada
  const currentNotes = (typeof notes !== 'undefined' ? notes : []).filter(n => n.folderId === currentFolderId || !n.folderId);
  currentNotes.forEach(note => tasksList.appendChild(buildNoteItem(note)));

  newTaskInput.style.display = 'block';
  newTaskTimeInput.style.display = 'block';

  completedMiniFolder.style.display = 'block';
  completedMiniFolderList.innerHTML = '';
  folder.finished.forEach(task => completedMiniFolderList.appendChild(buildFinishedTaskItem(folder, task)));

  document.querySelector('.mini-folder-icon').onclick = () => {
    completedMiniFolder.classList.toggle('expanded');
  };

  // Lógica del Selector Unificado de Modo (Tarea / Nota)
  const modeTabTask = document.getElementById('modeTabTask');
  const modeTabNote = document.getElementById('modeTabNote');
  const taskCreationForm = document.getElementById('taskCreationForm');
  const noteCreationForm = document.getElementById('noteCreationForm');
  const saveNewNoteBtn = document.getElementById('saveNewNoteBtn');
  const newNoteTitleInput = document.getElementById('newNoteTitleInput');
  const newNoteContentInput = document.getElementById('newNoteContentInput');

  if (modeTabTask && modeTabNote && taskCreationForm && noteCreationForm) {
    modeTabTask.onclick = () => {
      modeTabTask.classList.add('active');
      modeTabNote.classList.remove('active');
      taskCreationForm.style.display = 'flex';
      noteCreationForm.style.display = 'none';
      if (newTaskInput) newTaskInput.focus();
    };
    modeTabNote.onclick = () => {
      modeTabNote.classList.add('active');
      modeTabTask.classList.remove('active');
      taskCreationForm.style.display = 'none';
      noteCreationForm.style.display = 'flex';
      if (newNoteTitleInput) newNoteTitleInput.focus();
    };
  }

  if (saveNewNoteBtn && newNoteTitleInput && newNoteContentInput) {
    saveNewNoteBtn.onclick = () => {
      const title = (newNoteTitleInput.value || '').trim();
      const content = (newNoteContentInput.value || '').trim();
      if (!title && !content) return;

      notes.push({
        id: '_' + Math.random().toString(36).substr(2, 9),
        title: title || 'Sin título',
        content: content,
        folderId: currentFolderId,
        createdAt: Date.now()
      });
      saveNotes();
      newNoteTitleInput.value = '';
      newNoteContentInput.value = '';
      renderTasks();
    };
  }
}

function renameTask(task) {
  const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
  const nameSpan = taskElement.querySelector('.task-name-text');

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'task-edit-input';
  editInput.value = task.name;

  const finishEdit = () => {
    const newName = editInput.value.trim();
    if (newName && newName !== task.name) {
      task.name = newName;
      saveDataToLocalStorage();
      renderTasks();
    } else {
      nameSpan.textContent = task.name;
    }
    editInput.replaceWith(nameSpan);
  };

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishEdit();
    if (e.key === 'Escape') {
      nameSpan.textContent = task.name;
      editInput.replaceWith(nameSpan);
    }
  });

  editInput.addEventListener('blur', finishEdit);

  nameSpan.replaceWith(editInput);
  editInput.focus();
}

/**
 * v2.7.0 — Paleta de colores y selección de color para tareas.
 *
 * Paleta de 8 colores + opción "sin color":
 *   🔴 rojo       #FF5252
 *   🟠 naranja    #FF9800
 *   🟡 amarillo   #FFEB3B
 *   🟢 verde      #4CAF50
 *   🔵 cian       #00BCD4
 *   🟣 violeta    #9C27B0
 *   🩷 rosa       #E91E63
 *   🟤 ámbar      #FFA000
 *   ⚪ sin color  (volver al default)
 */
const TASK_COLOR_PALETTE = [
  '#FF5252', // rojo
  '#FF9800', // naranja
  '#FFEB3B', // amarillo
  '#4CAF50', // verde
  '#00BCD4', // cian
  '#9C27B0', // violeta
  '#E91E63', // rosa
  '#FFA000', // ámbar
  null       // sin color (quitar)
];

/**
 * Oscurece un color hex en un porcentaje (0-1). Usado para bordes
 * que combinen con el color de fondo.
 */
function darkenColor(hex, amount) {
  if (!hex || typeof hex !== 'string') return '#555';
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const dr = Math.max(0, Math.floor(r * (1 - amount)));
  const dg = Math.max(0, Math.floor(g * (1 - amount)));
  const db = Math.max(0, Math.floor(b * (1 - amount)));
  return '#' + [dr, dg, db].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Abre un popover con la paleta de colores al lado del botón 🎨.
 * Al elegir un color (o "sin color"), se aplica a la tarea y se persiste.
 */
function openColorPicker(task, anchorBtn) {
  // Si ya hay un picker abierto para esta tarea, cerrarlo
  const existing = document.getElementById('taskColorPicker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'taskColorPicker';
  picker.className = 'task-color-picker';

  TASK_COLOR_PALETTE.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    if (color === null) {
      swatch.textContent = '✕';
      swatch.title = 'Quitar color (volver al default)';
      swatch.classList.add('color-swatch--none');
    } else {
      swatch.style.backgroundColor = color;
      swatch.title = color;
      if (task.color && task.color.toLowerCase() === color.toLowerCase()) {
        swatch.classList.add('color-swatch--selected');
      }
    }
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      applyTaskColor(task, color);
      picker.remove();
    });
    picker.appendChild(swatch);
  });

  // Posicionar el picker cerca del botón
  anchorBtn.parentElement.style.position = 'relative';
  picker.style.position = 'absolute';
  picker.style.top = '100%';
  picker.style.right = '0';
  picker.style.zIndex = '1000';

  anchorBtn.parentElement.appendChild(picker);

  // Cerrar al click fuera
  setTimeout(() => {
    const closeOnOutside = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    document.addEventListener('click', closeOnOutside);
  }, 0);
}

/**
 * Aplica un color a la tarea, persiste en localStorage y re-renderiza.
 * Si color === null, se quita el color (vuelve al default).
 */
function applyTaskColor(task, color) {
  if (color === null) {
    delete task.color;
  } else {
    task.color = color;
  }
  saveDataToLocalStorage();
  renderTasks();
}

function buildPendingTaskItem(folder, task) {
  const taskDiv = document.createElement('div');
  taskDiv.className = 'task';
  taskDiv.dataset.taskId = task.id;
  taskDiv.draggable = true;

  // v2.7.0: aplicar color de la tarea si tiene uno asignado
  if (task.color) {
    taskDiv.style.backgroundColor = task.color;
    // Borde sutil que combine con el color, para mejor contraste
    taskDiv.style.borderColor = darkenColor(task.color, 0.3);
  }

  taskDiv.addEventListener('dragstart', handleTaskDragStart);
  taskDiv.addEventListener('dragover', handleTaskDragOver);
  taskDiv.addEventListener('drop', handleTaskDrop);

  const taskHeader = document.createElement('div');
  taskHeader.className = 'task-header';

  const taskNameSpan = document.createElement('span');
  taskNameSpan.className = 'task-name-text';
  // Si es una recompensa, mostramos su tiempo estimado
  if (task.isReward) {
    const timeText = (task.rewardTime && Number(task.rewardTime) > 0)
      ? ` ⏱️${task.rewardTime}m`
      : ' ⏱️libre';
    taskNameSpan.textContent = task.name + timeText;
  } else {
    taskNameSpan.textContent = task.name;
  }
  // v2.7.0: doble click / doble touch sobre el nombre → activa renameTask()
  // (reemplaza el botón ✏ que existía antes)
  taskNameSpan.title = 'Doble click para renombrar';
  let lastTap = 0;
  taskNameSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    renameTask(task);
  });
  taskNameSpan.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      e.stopPropagation();
      e.preventDefault();
      renameTask(task);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: false });

  const taskButtons = document.createElement('div');
  taskButtons.className = 'task-buttons';

  if (folder.id === rewardsFolderId || task.isReward) {
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm(`¿Eliminar "${task.name}"?`, () => {
        moveTaskToTrash(folder, task.id, false);
        saveDataToLocalStorage();
        renderTasks();
      });
    });
    taskButtons.appendChild(deleteBtn);
  } else {
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = task.isExpanded ? '▼' : '◀';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskStepsVisibility(task, taskStepsDiv, toggleBtn);
    });

    const moveBtn = document.createElement('button');
    moveBtn.textContent = '↪';
    moveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      inlineMoveTask(task, false);
    });

    // v2.7.0: botón de color (paleta) en reemplazo del botón ✏ eliminado
    const colorBtn = document.createElement('button');
    colorBtn.textContent = '🎨';
    colorBtn.title = 'Cambiar color de la tarea';
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPicker(task, colorBtn);
    });

    // Botón Captura 📸
    const captureBtn = document.createElement('button');
    captureBtn.textContent = '📸';
    captureBtn.title = 'Capturar tarea en imagen HD';
    captureBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      capturarElementoComoImagen(taskDiv, `Tarea_${task.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
    });

    const playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // FIX v2.7.1: el play individual debe continuar automáticamente con
      // las demás tareas con pasos de la misma carpeta (modo secuencial).
      // Si solo hay 1 tarea con pasos, se mantiene el comportamiento de
      // play individual (cierra después de la recompensa).
      if (currentFolderId) {
        const folder = folders.find(f => f.id === currentFolderId);
        if (folder) {
          const tasksWithSteps = (folder.tasks || []).filter(t => t.steps && t.steps.length > 0);
          if (tasksWithSteps.length > 1) {
            const taskIndex = tasksWithSteps.findIndex(t => t.id === task.id);
            if (taskIndex >= 0) {
              folderPlayQueue = tasksWithSteps;
              folderPlayIndex = taskIndex;
              folderPlayFolderId = currentFolderId;
              folderPlayOriginalLength = tasksWithSteps.length;
            }
          }
        }
      }
      startPresentation(task);
    });

    const scheduleBtn = document.createElement('button');
    scheduleBtn.textContent = '📅';
    scheduleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openScheduleModal(task);
    });

    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.textContent = '●●●';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = e.currentTarget.nextElementSibling;
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      setTimeout(() => {
        document.addEventListener('click', function taskMenuClickListener(ev) {
          if (!menu.contains(ev.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', taskMenuClickListener);
          }
        });
      }, 100);
    });

    const taskMenu = document.createElement('div');
    taskMenu.className = 'task-menu';
    taskMenu.style.display = 'none';

    // v2.7.0: el botón "Editar" del menú desplegable fue eliminado
    // (la edición de nombre ahora se hace con doble click sobre el nombre).

    const moveMenuItem = document.createElement('button');
    moveMenuItem.textContent = 'Mover';
    moveMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      inlineMoveTask(task, false);
      taskMenu.style.display = 'none';
    });

    const scheduleMenuItem = document.createElement('button');
    scheduleMenuItem.textContent = 'Programar';
    scheduleMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      openScheduleModal(task);
      taskMenu.style.display = 'none';
    });

    const deleteMenuItem = document.createElement('button');
    deleteMenuItem.textContent = 'Eliminar';
    deleteMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm(`¿Eliminar la tarea "${task.name}"?`, () => {
        moveTaskToTrash(folder, task.id, false);
        saveDataToLocalStorage();
        renderTasks();
      });
      taskMenu.style.display = 'none';
    });

    taskMenu.append(moveMenuItem, scheduleMenuItem, deleteMenuItem);
    taskButtons.append(toggleBtn, colorBtn, playBtn, menuBtn, taskMenu);
  }

  taskHeader.append(taskNameSpan, taskButtons);

  const taskStepsDiv = document.createElement('div');
  taskStepsDiv.className = 'task-steps';
  taskStepsDiv.style.display = task.isExpanded ? 'flex' : 'none';

  const newStepContainer = document.createElement('div');
  newStepContainer.className = 'new-step-container';
  const newStepInput = document.createElement('input');
  newStepInput.type = 'text';
  newStepInput.placeholder = 'Agrega un paso (Enter)...';
  newStepInput.className = 'new-step-input';
  newStepInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addNewStep(task, newStepInput);
    }
  });

  newStepContainer.appendChild(newStepInput);
  taskStepsDiv.appendChild(newStepContainer);

  task.steps.forEach((step, index) => {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step-item';
    stepDiv.draggable = true;
    stepDiv.dataset.stepIndex = index;

    stepDiv.addEventListener('dragstart', handleStepDragStart);
    stepDiv.addEventListener('dragover', handleStepDragOver);
    stepDiv.addEventListener('drop', (ev) => handleStepDrop(ev, task));

    const stepTextSpan = document.createElement('span');
    stepTextSpan.className = 'step-text';
    stepTextSpan.textContent = step;

    let completedIndex = 0;
    if (currentPresentationTask && currentPresentationTask.id === task.id) {
      completedIndex = currentStepIndex;
    } else if (task.currentStepIndex !== undefined) {
      completedIndex = task.currentStepIndex;
    }
    if (index < completedIndex) {
      stepTextSpan.classList.add('completed-step');
    }

    // v2.7.0: doble click / doble touch sobre el texto del paso
    // → activa inlineEditStep(). Reemplaza el botón ✏ anterior.
    let lastStepTap = 0;
    stepTextSpan.title = 'Doble click para editar';
    stepTextSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      inlineEditStep(task, index);
    });
    stepTextSpan.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastStepTap < 300) {
        e.stopPropagation();
        e.preventDefault();
        inlineEditStep(task, index);
        lastStepTap = 0;
      } else {
        lastStepTap = now;
      }
    }, { passive: false });

    const stepButtons = document.createElement('div');
    stepButtons.className = 'step-buttons';

    // v2.7.0: el botón ✏ de paso fue eliminado. Solo queda el de borrar.
    const deleteStepBtn = document.createElement('button');
    deleteStepBtn.textContent = '🗑';
    deleteStepBtn.addEventListener('click', () => {
      showConfirm(`¿Eliminar el paso "${step}"?`, () => {
        removeStep(task, index);
      });
    });

    stepButtons.append(deleteStepBtn);
    stepDiv.append(stepTextSpan, stepButtons);
    taskStepsDiv.appendChild(stepDiv);
  });

  taskDiv.append(taskHeader, taskStepsDiv);
  return taskDiv;
}

function buildFinishedTaskItem(folder, task) {
  const taskDiv = document.createElement('div');
  taskDiv.className = 'task';
  taskDiv.dataset.taskId = task.id;
  taskDiv.style.background = 'transparent';
  taskDiv.style.border = '1px solid rgba(255, 215, 0, 0.3)';

  const taskHeader = document.createElement('div');
  taskHeader.className = 'task-header';
  taskHeader.style.padding = '0.3rem';

  const taskNameSpan = document.createElement('span');
  taskNameSpan.className = 'task-name-text';
  taskNameSpan.textContent = `✅ ${task.name}`;
  taskNameSpan.style.color = '#ffd700';

  const taskButtons = document.createElement('div');
  taskButtons.className = 'task-buttons';

  const restoreBtn = document.createElement('button');
  restoreBtn.textContent = '↩';
  restoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    restoreFromMiniFolder(folder, task.id);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm(`¿Eliminar "${task.name}"?`, () => {
      moveTaskToTrash(folder, task.id, true);
      saveDataToLocalStorage();
      renderTasks();
    });
  });

  taskButtons.append(restoreBtn, deleteBtn);
  taskHeader.append(taskNameSpan, taskButtons);
  taskDiv.appendChild(taskHeader);

  return taskDiv;
}

/************************************************************************
 * COMPLETAR TAREA
 ************************************************************************/
function openRewardSection(folder, task) {
  folderOfTaskBeingRewarded = folder;
  taskBeingRewarded = task;
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'block';
}

let notes = [];
function loadNotes() {
  try {
    const raw = localStorage.getItem('asista_notes');
    notes = raw ? JSON.parse(raw) : [];
  } catch(e) { notes = []; }
}
function saveNotes() {
  try {
    localStorage.setItem('asista_notes', JSON.stringify(notes));
  } catch(e) {}
}
loadNotes();

let userStats = { xp_total: 0, nivel: 1, racha_dias_consecutivos: 1, ultimo_dia_activo: null };
function loadUserStats() {
  try {
    const raw = localStorage.getItem('asista_user_stats');
    if (raw) userStats = Object.assign(userStats, JSON.parse(raw));
  } catch(e) {}
}
function saveUserStats() {
  try {
    localStorage.setItem('asista_user_stats', JSON.stringify(userStats));
  } catch(e) {}
}
loadUserStats();

function addXP(amount, motivo) {
  userStats.xp_total += amount;
  const oldLevel = userStats.nivel;
  userStats.nivel = Math.floor(userStats.xp_total / 250) + 1;
  saveUserStats();
  if (userStats.nivel > oldLevel) {
    speakAudioCoach(`¡Felicidades! Subiste al Nivel ${userStats.nivel}.`);
  }
}

let audioCoachConfig = { habilitado: true, anunciar_pasos: true };
function speakAudioCoach(text) {
  if (!audioCoachConfig.habilitado || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-AR';
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  } catch(e) {}
}

let automationRules = [];
function loadAutomationRules() {
  try {
    const raw = localStorage.getItem('asista_automation_rules');
    automationRules = raw ? JSON.parse(raw) : [];
  } catch(e) { automationRules = []; }
}
function saveAutomationRules() {
  try {
    localStorage.setItem('asista_automation_rules', JSON.stringify(automationRules));
  } catch(e) {}
}
loadAutomationRules();

function triggerAutomationEvent(eventType, payload) {
  if (!Array.isArray(automationRules) || automationRules.length === 0) return;
  automationRules.forEach(rule => {
    if (rule.evento !== eventType) return;
    if (rule.condicion) {
      if (rule.condicion.carpeta_id && payload.folderId && rule.condicion.carpeta_id !== payload.folderId) return;
      if (rule.condicion.prioridad && payload.task && rule.condicion.prioridad !== payload.task.priority) return;
    }
    try {
      if (rule.accion_automatica === 'crear_recompensa') {
        const rewardsFolder = folders.find(f => f.isDefaultRewards);
        if (rewardsFolder && rule.parametros_accion) {
          rewardsFolder.tasks.push({
            id: '_' + Math.random().toString(36).substr(2, 9),
            name: rule.parametros_accion.nombre || '🎮 Recompensa Automática',
            totalTime: rule.parametros_accion.tiempo_minutos ? rule.parametros_accion.tiempo_minutos * 60 : null,
            isReward: true
          });
          saveDataToLocalStorage();
          if (typeof renderFolders === 'function') renderFolders();
        }
      } else if (rule.accion_automatica === 'asignar_prioridad' && payload.task && rule.parametros_accion) {
        payload.task.priority = rule.parametros_accion.nueva_prioridad || 'alta';
        saveDataToLocalStorage();
        if (typeof renderTasks === 'function') renderTasks();
      } else if (rule.accion_automatica === 'asignar_color' && payload.task && rule.parametros_accion) {
        payload.task.color = rule.parametros_accion.nuevo_color || '#FF5252';
        saveDataToLocalStorage();
        if (typeof renderTasks === 'function') renderTasks();
      }
    } catch(err) {
      console.warn('Error al ejecutar regla de automatización:', err);
    }
  });
}

function moveTaskToMiniFolder(folder, task) {
  folder.tasks = folder.tasks.filter(t => t.id !== task.id);
  // FIX: si la carpeta no tiene array "finished" (datos legacy o importados), inicializarlo
  if (!Array.isArray(folder.finished)) folder.finished = [];

  if (task.reward) {
    const rewardsFolder = folders.find(f => f.id === rewardsFolderId);
    if (rewardsFolder) {
      rewardsFolder.tasks.unshift(task);
    }
  } else {
    folder.finished.push(task);
  }

  folderOfTaskBeingRewarded = null;
  taskBeingRewarded = null;

  // Trigger eventos de automatización
  triggerAutomationEvent('tarea_completada', { folderId: folder.id, task });
  if (folder.tasks.length === 0) {
    triggerAutomationEvent('carpeta_completada', { folderId: folder.id, folder });
  }

  saveDataToLocalStorage();
  renderTasks();
  renderFolders();
}

function restoreFromMiniFolder(folder, taskId) {
  const idx = folder.finished.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const t = folder.finished[idx];
  // Reiniciar el índice de paso y cualquier otro estado relacionado
  t.currentStepIndex = 0;
  // ...posible reinicio de otros estados de pasos si fuese necesario...
  folder.finished.splice(idx, 1);
  folder.tasks.push(t);
  saveDataToLocalStorage();
  renderTasks();
}

/************************************************************************
 * PASOS
 ************************************************************************/
function recalcStepTimes(task) {
  if (task.totalTime && task.steps.length > 0) {
    const allocated = Math.floor(task.totalTime / task.steps.length);
    task.stepTimes = [];
    for (let i = 0; i < task.steps.length; i++) {
      task.stepTimes.push(allocated);
    }
  }
}

function addNewStep(task, inputElem) {
  const text = inputElem.value.trim();
  if (text) {
    task.steps.push(text);
    inputElem.value = '';
    if (task.totalTime) {
      recalcStepTimes(task);
    }
    saveDataToLocalStorage();
    renderTasks();
    setTimeout(() => {
      const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
      if (taskElement) {
        const newInput = taskElement.querySelector('.new-step-input');
        if (newInput) newInput.focus();
      }
    }, 0);
  }
}

function removeStep(task, stepIndex) {
  task.steps.splice(stepIndex, 1);
  if (task.totalTime) {
    recalcStepTimes(task);
  }
  saveDataToLocalStorage();
  renderTasks();
}

function inlineEditStep(task, stepIndex) {
  const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
  if (!taskElement) {
    console.error("No se encontró el contenedor de la tarea:", task.id);
    return;
  }
  const stepElement = taskElement.querySelector(`[data-step-index="${stepIndex}"]`);
  if (!stepElement) {
    console.error("No se encontró el paso:", stepIndex);
    return;
  }
  const stepTextSpan = stepElement.querySelector('.step-text');

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'step-edit-input';
  editInput.value = task.steps[stepIndex];

  const finishEdit = () => {
    const newStep = editInput.value.trim();
    if (newStep && newStep !== task.steps[stepIndex]) {
      task.steps[stepIndex] = newStep;
      saveDataToLocalStorage();
      renderTasks();
    } else {
      stepTextSpan.textContent = task.steps[stepIndex];
    }
    editInput.replaceWith(stepTextSpan);
  };

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishEdit();
    if (e.key === 'Escape') {
      stepTextSpan.textContent = task.steps[stepIndex];
      editInput.replaceWith(stepTextSpan);
    }
  });

  editInput.addEventListener('blur', finishEdit);

  stepTextSpan.replaceWith(editInput);
  editInput.focus();
}

function toggleTaskStepsVisibility(task, stepsDiv, toggleBtn) {
  task.isExpanded = !task.isExpanded;
  stepsDiv.style.display = task.isExpanded ? 'flex' : 'none';
  toggleBtn.textContent = task.isExpanded ? '▼' : '◀';
  saveDataToLocalStorage();
}

/************************************************************************
 * PRESENTACIÓN
 ************************************************************************/
function startPresentation(task) {
  if (!task.steps || !task.steps.length) return;
  presentationSteps = task.steps;
  currentStepIndex = task.currentStepIndex || 0;
  presentationOpen = true;
  currentPresentationTask = task;
  if (task.totalTime && task.steps.length > 0) {
    if (!task.stepTimes || task.stepTimes.length !== task.steps.length) {
      recalcStepTimes(task);
    }
    // Se inicia el contador con el tiempo base asignado al paso actual
    currentStepCountdown = task.stepTimes[currentStepIndex];
  }
  // Se elimina el pushState de presentación para no interferir con la navegación entre carpetas
  // history.pushState({ presentation: true }, '', '');
  presentationModal.style.display = 'flex';
  showPresentationStep();
  startTimer();
  addMinimizeButton();
  // FIX: limpiar listeners viejos para evitar que se acumulen entre tareas
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.addEventListener('click', handlePresentationClick);
  presentationModal.addEventListener('touchstart', handleTouchStart);
  presentationModal.addEventListener('touchend', handleTouchEnd);
  requestWakeLock();
}

// Modificar el manejador de clic para descartar clics en el botón de minimizar/maximizar
// y para que NO dispare next/prev cuando la presentación está minimizada.
function handlePresentationClick(e) {
  // Si el clic proviene del botón de minimizar, salir sin realizar acción.
  if (e.target.closest('#minimizePresentationBtn')) return;
  // FIX v2.7.1: cuando la presentación está minimizada, el click en el body
  // NO debe disparar next/prev (el modal se arrastra con touch y se maximiza
  // con el botón explícito). Esto evita que un click accidental en el
  // body del PiP avance al siguiente paso.
  if (isPresentationMinimized) return;

  const now = Date.now();
  if (now - lastPresentationInteraction < PRESENTATION_DEBOUNCE_MS) return;
  lastPresentationInteraction = now;

  const halfWidth = window.innerWidth / 2;
  if (e.clientX > halfWidth) {
    nextStep(); // Click derecho: avanzar
  } else {
    prevStep(); // Click izquierdo: retroceder
  }
}

let touchStartX = 0; // Se conserva o agrega si no existe

function handleTouchStart(e) {
    // FIX v2.7.1: si el touch se origina en el botón minimizar/maximizar,
    // no registrar el touchStartX — el botón tiene su propio handler
    // y no debe contaminar el flujo de next/prev.
    if (e.target && e.target.closest && e.target.closest('#minimizePresentationBtn')) return;
    // FIX v2.7.1: si la presentación está minimizada, los toques NO deben
    // setear touchStartX con la intención de hacer next/prev. El touch es
    // para arrastrar el PiP; si fuera un tap, lo maneja el drag handler.
    if (isPresentationMinimized) return;
    // Capturamos la posición inicial del toque
    if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
    }
}

// Modificar el manejador de toque de forma similar:
// FIX v2.7.1: BUG FIX CRÍTICO — antes el touchend NO chequeaba si provenía del
// botón minimizar. En touch mobile, el touchend se dispara ANTES que el click
// handler del botón tenga oportunidad de stopPropagation, así que `nextStep()`
// se llamaba automáticamente (el botón está a la derecha → touchEndX > halfWidth
// → avanza al siguiente paso). Ahora se ignora el touchend cuyo target es el
// botón, igual que el click handler.
function handleTouchEnd(e) {
  // Si el touch proviene del botón minimizar, NO hacer next/prev.
  if (e.target && e.target.closest && e.target.closest('#minimizePresentationBtn')) return;
  // Si la presentación está minimizada, el touch es para arrastrar, no
  // para avanzar/retroceder. El drag handler tiene su propia lógica.
  if (isPresentationMinimized) return;

  const now = Date.now();
  if (now - lastPresentationInteraction < PRESENTATION_DEBOUNCE_MS) return;
  lastPresentationInteraction = now;

  if (e.changedTouches && e.changedTouches[0]) {
    const touchEndX = e.changedTouches[0].clientX;
    const halfWidth = window.innerWidth / 2;
    if (touchEndX > halfWidth) {
      nextStep(); // Touch derecho: avanzar
    } else {
      prevStep(); // Touch izquierdo: retroceder
    }
  }
}

// Modificar la función prevStep para que reste el tiempo consumido, permitiendo números negativos
function prevStep() {
  if (currentStepIndex > 0) {
    if (currentPresentationTask && currentPresentationTask.totalTime) {
      // Guardamos el tiempo actual antes de retroceder
      const currentBaseTime = currentPresentationTask.stepTimes[currentStepIndex];
      currentStepIndex--;
      
      // Calculamos cuánto tiempo se ha consumido del paso actual
      const timeUsed = currentBaseTime - currentStepCountdown;
      
      // Al retroceder, tomamos el tiempo base del paso anterior y le restamos el tiempo usado
      currentStepCountdown = currentPresentationTask.stepTimes[currentStepIndex] - timeUsed;
    } else {
      currentStepIndex--;
    }
    showPresentationStep();
  }
}

function nextStep() {
  if (currentStepIndex < presentationSteps.length - 1) {
    if (currentPresentationTask && currentPresentationTask.totalTime) {
      // Al avanzar mantenemos el comportamiento de sumar el tiempo restante
      let leftover = currentStepCountdown;
      currentStepIndex++;
      let baseTime = currentPresentationTask.stepTimes[currentStepIndex];
      currentStepCountdown = baseTime + leftover;
    } else {
      currentStepIndex++;
    }
    showPresentationStep();
  } else {
    showCongratulations();
  }
}

/**
 * Ajusta el font-size del texto de la presentación para que SIEMPRE
 * entre en el viewport sin desbordar, manteniendo estética y simetría.
 *
 * Estrategia de dos pasadas:
 *   1) NIVEL INICIAL según cantidad de caracteres (4 niveles):
 *      - corto  (<25 chars)  → 2.5rem  (grande, vistoso)
 *      - medio  (25-60)      → 1.8rem
 *      - largo  (61-150)     → 1.3rem
 *      - muy largo (>150)    → 1.0rem
 *   2) VERIFICACIÓN REAL: si después de aplicar el nivel el texto aún
 *      se desborda (scrollHeight > maxHeight disponible), reduce 0.1rem
 *      por iteración hasta que entre perfecto (mínimo 0.7rem).
 *
 * @param {HTMLElement} el        Elemento cuyo textContent se va a setear
 * @param {string}      text      Texto a mostrar
 * @param {object}      [opts]
 * @param {number}      [opts.minFontRem=0.7]   Tamaño mínimo permitido
 * @param {number}      [opts.maxHeightRatio=0.6] Altura máx como fracción del viewport
 */
function fitPresentationText(el, text, opts) {
  opts = opts || {};
  const minFontRem = opts.minFontRem || 0.7;
  const maxHeightRatio = opts.maxHeightRatio || 0.6;

  // 1) Limpiar y setear el texto
  el.textContent = text;

  // 2) Elegir nivel inicial según cantidad de caracteres
  const len = (text || '').length;
  let fontRem;
  if (len < 25) {
    fontRem = 2.5;
  } else if (len < 60) {
    fontRem = 1.8;
  } else if (len < 150) {
    fontRem = 1.3;
  } else {
    fontRem = 1.0;
  }

  // 3) Aplicar y verificar contra el viewport
  const viewportH = window.innerHeight || 800;
  const maxH = viewportH * maxHeightRatio;
  el.style.fontSize = fontRem + 'rem';
  el.style.lineHeight = '1.3';
  el.style.wordBreak = 'break-word';
  el.style.overflowWrap = 'break-word';

  // 4) Si se desborda, reducir 0.1rem por iteración
  let attempts = 0;
  while (el.scrollHeight > maxH && fontRem > minFontRem && attempts < 30) {
    fontRem = Math.max(minFontRem, fontRem - 0.1);
    el.style.fontSize = fontRem + 'rem';
    attempts++;
  }

  return {
    finalFontRem: parseFloat(el.style.fontSize),
    chars: len,
    scrollHeight: el.scrollHeight,
    maxHeight: maxH,
    fit: el.scrollHeight <= maxH
  };
}

let presentationAudioCoachEnabled = true;

function speakPresentationStep(stepText) {
  if (!presentationAudioCoachEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const clean = (stepText || '').replace(/[*_#`~>]/g, '');
    if (!clean.trim()) return;
    const u = new SpeechSynthesisUtterance(`Paso ${currentStepIndex + 1}: ${clean}`);
    u.lang = 'es-AR';
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  } catch(e) {}
}

const presentationAudioCoachBtn = document.getElementById('presentationAudioCoachBtn');
if (presentationAudioCoachBtn) {
  presentationAudioCoachBtn.onclick = (e) => {
    e.stopPropagation();
    presentationAudioCoachEnabled = !presentationAudioCoachEnabled;
    presentationAudioCoachBtn.textContent = presentationAudioCoachEnabled ? '📣 Voz ON' : '🔇 Voz OFF';
    presentationAudioCoachBtn.classList.toggle('active', presentationAudioCoachEnabled);
    if (!presentationAudioCoachEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };
}

function showPresentationStep() {
  const text = presentationSteps[currentStepIndex] || '';
  fitPresentationText(presentationStep, text, { minFontRem: 0.9 });
  speakPresentationStep(text);
}

function showCongratulations() {
  // Calcular el progreso (tarea X de Y) usando la queue ORIGINAL del modo play
  // (no la queue actual, que puede haber cambiado si se mueven tareas a finished)
  let progressHtml = '';
  if (folderPlayFolderId && folderPlayOriginalLength > 0) {
    const current = folderPlayIndex + 1;
    const total = folderPlayOriginalLength;
    progressHtml = '<div style="font-size:0.85rem;opacity:0.6;margin-top:0.4rem;">Tarea ' + current + ' de ' + total + '</div>';
  }

  // El texto principal es fijo ("¡Tarea completada!") así que fitPresentationText
  // va a darle 2.5rem (texto corto, <25 chars). Pero dejamos el wrapper con
  // el emoji y el subtítulo para mantener la composición original.
  // Primero aplicamos el ajuste al wrapper (es la "caja" completa).
  presentationStep.style.textAlign = 'center';
  presentationStep.style.lineHeight = '1.4';

  // Construimos el HTML completo y dejamos que fitPresentationText actúe sobre
  // el contenedor completo midiendo el wrapper en lugar de solo el texto.
  presentationStep.innerHTML =
    '<div style="font-size:3rem;margin-bottom:0.5rem;">🎉</div>' +
    '<div class="congrats-main">¡Tarea completada!</div>' +
    progressHtml +
    '<div style="font-size:1rem;opacity:0.7;margin-top:0.8rem;">Tocá para recibir tu recompensa 🎁</div>';

  // Ajustar el tamaño del texto principal ("¡Tarea completada!") según
  // su largo. Como tiene 19 chars, va a quedar en 2.5rem.
  const mainEl = presentationStep.querySelector('.congrats-main');
  if (mainEl) {
    fitPresentationText(mainEl, mainEl.textContent, { minFontRem: 1.0, maxHeightRatio: 0.3 });
  }

  // FIX CRÍTICO: remover TODOS los listeners viejos para que handleFinalClick
  // sea el único que se ejecute. Antes handlePresentationClick quedaba colgado
  // y procesaba el click como "nextStep" → showCongratulations → loop.
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.addEventListener('click', handleFinalClick);
}

function handleFinalClick(e) {
  // Si el click fue en el botón de minimizar, no hacer nada
  if (e.target && e.target.closest && e.target.closest('#minimizePresentationBtn')) return;

  // Removemos el listener para evitar llamadas duplicadas
  presentationModal.removeEventListener('click', handleFinalClick);

  // Capturamos la carpeta y tarea actuales ANTES de cualquier movimiento
  const currentFolder = folders.find(f => f.id === currentFolderId);
  const currentTask = currentPresentationTask;

  // Si no hay carpeta/tarea, cerrar
  if (!currentFolder || !currentTask) {
    closePresentation(true);
    return;
  }

  // Marcamos la tarea como completada (la movemos a la mini carpeta de finalizadas)
  // ANTES de mostrar la recompensa, para que cuando se vuelva a la lista ya no esté.
  folderOfTaskBeingRewarded = currentFolder;
  taskBeingRewarded = currentTask;
  moveTaskToMiniFolder(currentFolder, currentTask);
  saveDataToLocalStorage();
  renderTasks();

  // Definimos el callback: cuando termine la recompensa, decidir qué hacer
  const afterReward = () => {
    // Usar la cantidad ORIGINAL de la queue (no la actual, que puede haber cambiado
    // cuando movimos la tarea a finished). Esto es crucial para que "última tarea"
    // se calcule correctamente.
    const totalOriginal = folderPlayOriginalLength;
    const isInFolderPlay = (folderPlayFolderId === currentFolder.id);

    if (isInFolderPlay && folderPlayIndex < totalOriginal - 1) {
      // Quedan tareas en la queue: avanzar a la siguiente
      folderPlayIndex++;
      // Re-renderizar la lista de tareas para que la actual desaparezca de "pendientes"
      // y aparezca en "finalizadas"
      if (typeof renderTasks === 'function') renderTasks();
      setTimeout(() => playCurrentInFolder(), 400);
    } else {
      // Era la última tarea (o play individual): cerrar la presentación
      // y devolver al usuario a la vista de la carpeta con sus tareas
      folderPlayQueue = [];
      folderPlayIndex = 0;
      folderPlayOriginalLength = 0;
      folderPlayFolderId = null;

      // Mostrar mensaje de cierre breve y luego cerrar
      presentationStep.innerHTML =
        '<div style="font-size:3rem;margin-bottom:0.5rem;">🏆</div>' +
        '<div>¡Todas las tareas completadas!</div>';
      if (timerDisplay) timerDisplay.textContent = '✓';

      setTimeout(() => {
        // Cerrar la presentación SIN dejar overlays ni restos
        closePresentation(true);
        // FIX v2.7.0: asegurar que SOLO la vista de la carpeta está visible.
        // El bug anterior era foldersSection.style.display = '' (cadena vacía)
        // que NO oculta nada — vuelve al default 'block' de <section>,
        // dejando #foldersSection y #tasksSection visibles AL MISMO TIEMPO
        // (exactamente lo que Russell reportó en la captura: las dos
        // ventanas mezcladas).
        foldersSection.style.display = 'none';
        tasksSection.style.display = 'block';
        // Re-renderizar la lista de tareas (las completadas aparecen en la mini carpeta)
        if (typeof renderTasks === 'function') renderTasks();
      }, 1500);
    }
  };

  // Mostrar la recompensa (reutiliza presentationModal, NO cierra la presentación)
  pickRandomRewardAndShow(afterReward);
}

function startTimer() {
  if (currentPresentationTask && currentPresentationTask.totalTime) {
    timerDisplay.textContent = formatTime(currentStepCountdown);
  } else {
    timerSeconds = 0;
    timerDisplay.textContent = formatTime(timerSeconds);
  }
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentPresentationTask && currentPresentationTask.totalTime) {
      // Se decrementa el contador sin avanzar automáticamente al siguiente paso
      currentStepCountdown--;
      timerDisplay.textContent = formatTime(currentStepCountdown);
    } else {
      timerSeconds++;
      timerDisplay.textContent = formatTime(timerSeconds);
    }
  }, 1000);
}

/************************************************************************
 * FUNCIONALIDAD DE MINIMIZAR/EXPANDIR PRESENTACIÓN CON DRAG POR TOUCH
 ************************************************************************/
function togglePresentationMinimized() {
  isPresentationMinimized = !isPresentationMinimized;
  if (isPresentationMinimized) {
    presentationModal.classList.add('minimized');
    // FIX v2.7.1: poner la posición inicial exacta desde JS.
    // Antes dependíamos de `bottom: 10px; left: 50%; margin-left: -150px`
    // en CSS, pero el margin interfería con el cálculo del drag.
    // Calculamos left/top en píxeles para que el drag sea directo:
    // newLeft = origLeft (visual) + dx, sin compensaciones raras.
    const initialLeft = Math.max(0, (window.innerWidth - 300) / 2);
    const initialTop = Math.max(0, window.innerHeight - 170 - 10);
    presentationModal.style.left = initialLeft + 'px';
    presentationModal.style.top = initialTop + 'px';
    presentationModal.style.bottom = 'auto';
    presentationModal.style.right = 'auto';
    presentationModal.style.transform = '';
    presentationModal.style.marginLeft = '0px';
    // Activar drag (con rAF para asegurar que el CSS ya se aplicó)
    requestAnimationFrame(() => setupMinimizedDrag());
  } else {
    presentationModal.classList.remove('minimized');
    // Limpiar posición inline para que el CSS base tome el control
    presentationModal.style.left = '';
    presentationModal.style.top = '';
    presentationModal.style.bottom = '';
    presentationModal.style.right = '';
    presentationModal.style.transform = '';
    presentationModal.style.marginLeft = '';
    teardownMinimizedDrag();
  }
}

/**
 * FIX v2.7.1: hace que el modal minimizado sea arrastrable.
 *
 * Soporta mouse (desktop testing) Y touch (APK mobile) usando Pointer Events,
 * que es la abstracción estándar moderna. Antes usaba solo touch events
 * → funcionaba en el APK pero NO en PC con mouse (Russell probando en
 * localhost no podía arrastrar).
 *
 * Comportamiento:
 *   - Tap en el body del PiP (sin moverse) → no hace nada
 *   - Drag en el body del PiP → mueve el modal a la nueva posición
 *   - Drag con botón maximizar → se ignora (lo maneja el botón)
 *
 * El estado de drag se mantiene en `pipDragState` para distinguir tap de drag
 * (umbral de 6px). El movimiento se aplica con `left`/`top` en píxeles (no
 * transform) para que el clamping a los bordes de la pantalla sea trivial
 * y no requiera leer el computed style.
 *
 * Importante: NO usar `passive: true` en pointermove porque necesitamos
 * `e.preventDefault()` para que el navegador no haga scroll mientras
 * arrastramos el PiP.
 */
let pipDragState = null;

function setupMinimizedDrag() {
  const modal = presentationModal;
  if (!modal) return;
  // Idempotente: si ya está configurado, no duplicar listeners
  if (modal._pipDragSetup) return;
  modal._pipDragSetup = true;

  function onPipPointerDown(e) {
    // No iniciar drag si el pointerdown fue en el botón maximizar
    if (e.target && e.target.closest && e.target.closest('#minimizePresentationBtn')) return;
    // Solo primary pointer (evita multi-touch accidental)
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // Capturar pointer para que los pointermove/pointerup sigan llegando
    // aunque el cursor salga del modal
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}

    // Guardar posición actual del modal (en píxeles, lectura del rect)
    const rect = modal.getBoundingClientRect();
    pipDragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false
    };
  }

  function onPipPointerMove(e) {
    if (!pipDragState || pipDragState.pointerId !== e.pointerId) return;
    const dx = e.clientX - pipDragState.startX;
    const dy = e.clientY - pipDragState.startY;

    // Umbral: 6px para distinguir tap de drag
    if (!pipDragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      pipDragState.moved = true;
      modal.style.cursor = 'grabbing';
    }

    if (pipDragState.moved) {
      // Limpiar bottom/right (que es lo que el CSS usa en posición inicial)
      modal.style.bottom = 'auto';
      modal.style.right = 'auto';

      // Calcular nueva posición con clamp a los bordes del viewport
      const newLeft = Math.max(0, Math.min(
        window.innerWidth - modal.offsetWidth,
        pipDragState.origLeft + dx
      ));
      const newTop = Math.max(0, Math.min(
        window.innerHeight - modal.offsetHeight,
        pipDragState.origTop + dy
      ));

      modal.style.left = newLeft + 'px';
      modal.style.top = newTop + 'px';

      // Prevenir scroll del navegador mientras arrastramos
      e.preventDefault();
    }
  }

  function onPipPointerUp(e) {
    if (!pipDragState) return;
    if (pipDragState.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
    modal.style.cursor = 'grab';
    pipDragState = null;
  }

  // Pointer Events = mouse + touch + pen en una sola API
  modal.addEventListener('pointerdown', onPipPointerDown);
  modal.addEventListener('pointermove', onPipPointerMove);
  modal.addEventListener('pointerup', onPipPointerUp);
  modal.addEventListener('pointercancel', onPipPointerUp);

  // Guardar referencia para limpieza
  modal._pipDragCleanup = () => {
    modal.removeEventListener('pointerdown', onPipPointerDown);
    modal.removeEventListener('pointermove', onPipPointerMove);
    modal.removeEventListener('pointerup', onPipPointerUp);
    modal.removeEventListener('pointercancel', onPipPointerUp);
    modal._pipDragSetup = false;
    modal.style.cursor = '';
  };
}

function teardownMinimizedDrag() {
  if (presentationModal && presentationModal._pipDragCleanup) {
    presentationModal._pipDragCleanup();
  }
  pipDragState = null;
}

function addMinimizeButton() {
  if (!document.getElementById('minimizePresentationBtn')) {
    const btn = document.createElement('button');
    btn.id = 'minimizePresentationBtn';
    btn.className = 'minimize-btn'; // Asegura que exista una clase con estilos definidos en CSS si es necesario
    btn.textContent = isPresentationMinimized ? 'Maximizar' : 'Minimizar';

    // Se asignan estilos en línea para posicionar el botón (opcional, de acuerdo al diseño deseado)
    btn.style.position = 'absolute';
    btn.style.top = '10px';
    btn.style.right = '10px';
    btn.style.zIndex = '10';

    // Al hacer clic se evita la propagación del evento, se alterna el estado y se actualiza el texto
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePresentationMinimized();
      btn.textContent = isPresentationMinimized ? 'Maximizar' : 'Minimizar';
    });

    // Inserta el botón en el contenedor de contenido de la presentación
    const presentationContent = presentationModal.querySelector('.presentation-content');
    if (presentationContent) {
      presentationContent.appendChild(btn);
    } else {
      // Si no se encuentra, se inserta directamente en el modal
      presentationModal.appendChild(btn);
    }
  }
}

/************************************************************************
 * CLOSE PRESENTATION
 ************************************************************************/
function closePresentation(force = false) {
  // Si la presentación está minimizada y no se fuerza, se evita el cierre
  if (isPresentationMinimized && !force) return;

  presentationModal.style.display = 'none';
  presentationOpen = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerSeconds = 0;
  currentStepCountdown = 0;
  timerDisplay.textContent = '00:00';
  presentationStep.textContent = '';
  // Limpiar estilos inline que pudieron haber sido seteados por showCongratulations
  presentationStep.style.fontSize = '';
  presentationStep.style.lineHeight = '';
  presentationStep.style.textAlign = '';
  presentationStep.innerHTML = '';
  if (isPresentationMinimized) {
    presentationModal.classList.remove('minimized');
    isPresentationMinimized = false;
  }
  // FIX v2.7.1: limpiar drag del PiP al cerrar
  teardownMinimizedDrag();
  // FIX v2.7.1: limpiar estilos inline de posición que pudo haber dejado el drag
  presentationModal.style.left = '';
  presentationModal.style.top = '';
  presentationModal.style.bottom = '';
  presentationModal.style.right = '';
  presentationModal.style.transform = '';
  const minBtn = document.getElementById('minimizePresentationBtn');
  if (minBtn) minBtn.remove();
  // FIX: limpiar TODOS los listeners para que no queden colgados
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.onclick = null;
  if (currentPresentationTask) {
    currentPresentationTask.currentStepIndex = currentStepIndex;
  }
  // FIX: limpiar estados de play por carpeta al cerrar (si quedó algo colgado)
  // Solo si NO estamos en medio de un flujo (folderPlayFolderId != null Y no es cierre explícito)
  if (currentPresentationTask) {
    currentPresentationTask = null;
  }
  // Asegurar que la UI vuelve a la vista de carpetas/tareas (no pantalla gris)
  // Solo si no estamos en una vista específica (papelera, etc.)
  if (trashSection && trashSection.style.display !== 'block' &&
      scheduleModal && scheduleModal.style.display !== 'flex' &&
      alarmModal && alarmModal.style.display !== 'flex' &&
      moveModal && moveModal.style.display !== 'flex') {
    // Si currentFolderId está seteado, mostrar la vista de tareas
    if (currentFolderId) {
      foldersSection.style.display = 'none';
      tasksSection.style.display = 'block';
    } else {
      // FIX v2.7.0: usar 'block' explícito en vez de ''. Cadena vacía
      // vuelve al default del navegador y puede dejar la sección invisible
      // si la regla CSS no está definida.
      foldersSection.style.display = 'block';
      tasksSection.style.display = 'none';
    }
  }
  saveDataToLocalStorage();
  renderTasks();
  releaseWakeLock();
}

function formatTime(sec) {
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/************************************************************************
 * RECOMPENSA
 ************************************************************************/
function addReward(text, timeMinutes) {
  const rewardsFolder = folders.find(f => f.id === rewardsFolderId);
  if (rewardsFolder) {
    const rewardTask = {
      id: generateId(),
      name: text,
      steps: [],
      isExpanded: false,
      scheduledTimestamp: null,
      isReward: true,
      currentStepIndex: 0,
      // NUEVO: tiempo estimado en minutos. null/0/undefined = tiempo libre
      rewardTime: (timeMinutes && Number(timeMinutes) > 0) ? Number(timeMinutes) : null
    };
    rewardsFolder.tasks.unshift(rewardTask);
    saveDataToLocalStorage();
    renderFolders();
    // FIX v2: si estamos dentro de la carpeta de recompensas, también re-renderizar
    // la lista de tareas para que la recompensa recién agregada se vea de inmediato.
    if (typeof currentFolderId !== 'undefined' && currentFolderId === rewardsFolderId) {
      if (typeof renderTasks === 'function') renderTasks();
    }
    if (folderOfTaskBeingRewarded && taskBeingRewarded) {
      moveTaskToMiniFolder(folderOfTaskBeingRewarded, taskBeingRewarded);
    }
    rewardSection.style.display = 'none';
    tasksSection.style.display = 'block';
  }
}

// ============================================================================
// NUEVAS FUNCIONES: RECOMPENSA ALEATORIA + MODO PLAY POR CARPETA
// ============================================================================

/**
 * Elige una recompensa aleatoria de la carpeta "Recompensas".
 * Si no hay recompensas, ejecuta onNoReward (aviso + callback del caller).
 * Si hay recompensas, ejecuta runReward con la elegida.
 */
function pickRandomRewardAndShow(onCompleted) {
  const rewardsFolder = folders.find(f => f.id === rewardsFolderId);
  if (!rewardsFolder || !rewardsFolder.tasks || rewardsFolder.tasks.length === 0) {
    showNoRewardNotice(onCompleted);
    return;
  }
  const idx = Math.floor(Math.random() * rewardsFolder.tasks.length);
  const reward = rewardsFolder.tasks[idx];
  runReward(reward, onCompleted);
}

/**
 * Muestra la recompensa con cronómetro (si tiene tiempo) o libre.
 * Al terminar llama a onCompleted.
 */
function runReward(reward, onCompleted) {
  currentReward = reward;
  pendingRewardNext = onCompleted || null;

  // Ocultar secciones, mostrar modal de presentación reutilizado
  foldersSection.style.display = 'none';
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  presentationModal.style.display = 'flex';
  isPresentationMinimized = false;
  presentationOpen = true;

  // FIX: limpiar TODOS los listeners viejos para que solo el de recompensa esté activo
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);

  // Mostrar texto de la recompensa
  const totalTime = reward.rewardTime; // minutos, o null/undefined
  if (totalTime && Number(totalTime) > 0) {
    rewardIsFree = false;
    rewardSecondsLeft = Math.floor(Number(totalTime) * 60);
  } else {
    rewardIsFree = true;
    rewardSecondsLeft = 0;
  }
  showRewardStep(reward);

  // Botón minimizar (igual que en presentación)
  addMinimizeButton();

  // Listener: el click ahora maneja "saltar al final" (cerrar recompensa)
  presentationModal.onclick = function(ev) {
    if (ev.target && ev.target.closest && ev.target.closest('#minimizePresentationBtn')) return;
    // Click = terminar recompensa y avanzar
    endReward();
  };

  // Iniciar cronómetro si hay tiempo
  if (!rewardIsFree) {
    startRewardTimer();
  } else {
    if (timerDisplay) timerDisplay.textContent = '⏱️ Libre';
  }
  requestWakeLock();
}

function showRewardStep(reward) {
  presentationStep.style.fontSize = '1.6rem';
  let txt = `🎁 ${reward.name}`;
  if (reward.rewardTime && Number(reward.rewardTime) > 0) {
    txt += `  ⏱️ ${reward.rewardTime} min`;
  } else {
    txt += `  ⏱️ (tiempo libre)`;
  }
  presentationStep.textContent = txt;
}

function startRewardTimer() {
  if (rewardTimerInterval) clearInterval(rewardTimerInterval);
  updateRewardTimerDisplay();
  rewardTimerInterval = setInterval(() => {
    rewardSecondsLeft--;
    updateRewardTimerDisplay();
    if (rewardSecondsLeft <= 0) {
      clearInterval(rewardTimerInterval);
      rewardTimerInterval = null;
      // Auto terminar al acabarse el tiempo
      endReward();
    }
  }, 1000);
}

function updateRewardTimerDisplay() {
  if (!timerDisplay) return;
  if (rewardIsFree) {
    timerDisplay.textContent = '⏱️ Libre';
    return;
  }
  const m = Math.floor(rewardSecondsLeft / 60);
  const s = rewardSecondsLeft % 60;
  timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function endReward() {
  if (rewardTimerInterval) {
    clearInterval(rewardTimerInterval);
    rewardTimerInterval = null;
  }
  presentationModal.onclick = null;
  releaseWakeLock();
  // NO cerramos la presentación acá — el callback afterReward se encarga:
  //   - si hay más tareas en el modo play, inicia la siguiente
  //   - si era la última, muestra "¡Todas las tareas completadas!" y cierra
  // Cerrar acá interrumpiría la siguiente tarea.
  currentReward = null;
  const cb = pendingRewardNext;
  pendingRewardNext = null;
  if (typeof cb === 'function') {
    // Pequeño delay para que se vea el cierre de la recompensa
    setTimeout(() => cb(), 250);
  }
}

/**
 * Muestra un aviso de que no hay recompensas y luego continúa (sin cerrar la presentación).
 * El callback onContinue se encarga de avanzar a la siguiente tarea o cerrar.
 */
function showNoRewardNotice(onContinue) {
  foldersSection.style.display = 'none';
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  presentationModal.style.display = 'flex';
  isPresentationMinimized = false;
  presentationOpen = true;
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationStep.style.lineHeight = '1.4';
  presentationStep.style.textAlign = 'center';
  presentationStep.innerHTML =
    '<div style="font-size:2.5rem;margin-bottom:0.5rem;">⚠️</div>' +
    '<div class="no-rewards-main">No hay recompensas en la carpeta.</div>' +
    '<div class="no-rewards-sub" style="opacity:0.75;margin-top:0.6rem;">Creá al menos una en la carpeta "Recompensas" para recibirlas al final de cada tarea.</div>' +
    '<div style="font-size:0.9rem;opacity:0.6;margin-top:1rem;">Tocá para continuar</div>';

  // Ajustar tamaños de los textos según su largo. Ambos son cortos/medios
  // así que van a quedar en 2.5rem y ~1.4rem respectivamente. Pero dejamos
  // el sistema preparado por si en el futuro se traducen/localizan con más texto.
  const mainEl = presentationStep.querySelector('.no-rewards-main');
  if (mainEl) {
    fitPresentationText(mainEl, mainEl.textContent, { minFontRem: 1.0, maxHeightRatio: 0.25 });
  }
  const subEl = presentationStep.querySelector('.no-rewards-sub');
  if (subEl) {
    fitPresentationText(subEl, subEl.textContent, { minFontRem: 0.8, maxHeightRatio: 0.35 });
  }
  if (timerDisplay) timerDisplay.textContent = '—';

  presentationModal.onclick = function(ev) {
    if (ev.target && ev.target.closest && ev.target.closest('#minimizePresentationBtn')) return;
    presentationModal.onclick = null;
    // NO cerramos la presentación — el callback se encarga de avanzar o cerrar.
    if (typeof onContinue === 'function') onContinue();
  };
}

// ============================================================================
// MODO PLAY POR CARPETA
// ============================================================================

/**
 * Inicia el modo play sobre TODAS las tareas de la carpeta, en orden lineal.
 * El usuario mantiene el orden arrastrando las tareas; este modo lo respeta.
 */
function startFolderPlay(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  // Filtrar solo tareas que tengan pasos (las recompensas en esta carpeta no aplican)
  const tasks = (folder.tasks || []).filter(t => t.steps && t.steps.length > 0);
  if (tasks.length === 0) {
    showConfirm('Esta carpeta no tiene tareas con pasos. Agrega tareas con pasos para iniciar el modo play.', () => {});
    return;
  }
  folderPlayQueue = tasks;
  folderPlayIndex = 0;
  folderPlayFolderId = folderId;
  // FIX: guardar el largo ORIGINAL de la queue para que el progreso y la
  // decisión de "última tarea" no cambien cuando se mueven tareas a finished.
  folderPlayOriginalLength = tasks.length;
  // FIX: asegurar que currentFolderId apunte a la carpeta en modo play
  // (handleFinalClick usa currentFolderId para encontrar la carpeta)
  currentFolderId = folderId;
  if (typeof currentFolderId !== 'undefined') {
    // re-renderizar la lista de tareas para reflejar el cambio de carpeta
    if (typeof renderTasks === 'function') renderTasks();
  }
  // Limpiar el play individual
  currentPresentationTask = null;
  playCurrentInFolder();
}

function playCurrentInFolder() {
  // Si la tarea actual fue eliminada/eliminada de la carpeta (no debería pasar
  // en flujo normal, pero por seguridad), saltar a la siguiente
  if (folderPlayIndex < folderPlayQueue.length) {
    const currentTaskRef = folderPlayQueue[folderPlayIndex];
    if (currentTaskRef) {
      // Verificar que la tarea sigue en folder.tasks
      const folder = folders.find(f => f.id === folderPlayFolderId);
      const stillInFolder = folder && folder.tasks && folder.tasks.some(t => t.id === currentTaskRef.id);
      if (stillInFolder) {
        startPresentation(currentTaskRef);
        return;
      }
    }
  }
  // Saltar tareas inválidas hasta encontrar una válida
  while (folderPlayIndex < folderPlayQueue.length) {
    const task = folderPlayQueue[folderPlayIndex];
    if (task) {
      const folder = folders.find(f => f.id === folderPlayFolderId);
      const stillInFolder = folder && folder.tasks && folder.tasks.some(t => t.id === task.id);
      if (stillInFolder) {
        startPresentation(task);
        return;
      }
    }
    folderPlayIndex++;
  }
  // No hay más tareas válidas
  folderPlayQueue = [];
  folderPlayIndex = 0;
  folderPlayFolderId = null;
  return;
}

/************************************************************************
 * SCHEDULE
 ************************************************************************/
function openScheduleModal(task) {
  taskBeingScheduled = task;
  scheduleDateInput.value = task.scheduledTimestamp ? toLocalDateTime(task.scheduledTimestamp) : '';
  scheduleModal.style.display = 'flex';
}

function closeScheduleModal() {
  scheduleModal.style.display = 'none';
  taskBeingScheduled = null;
}

function toLocalDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/************************************************************************
 * ALARMA
 ************************************************************************/
function checkAlarms() {
  if (alarmModal.style.display === 'flex') return;
  const now = Date.now();
  for (let folder of folders) {
    for (let t of folder.tasks) {
      if (t.scheduledTimestamp && t.scheduledTimestamp <= now) {
        showAlarm(t);
        return;
      }
    }
  }
}

function showAlarm(task) {
  currentAlarmTask = task;
  alarmTitle.textContent = `¡Es hora de: "${task.name}"!`;
  alarmModal.style.display = 'flex';
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  saveDataToLocalStorage();
}

/************************************************************************
 * DRAG & DROP
 ************************************************************************/
function handleFolderDragStart(e) {
  draggedFolderId = e.currentTarget.dataset.id;
}

function handleFolderDragOver(e) {
  e.preventDefault();
}

function handleFolderDrop(e) {
  e.preventDefault();
  const targetFolderId = e.currentTarget.dataset.id;
  if (!targetFolderId || targetFolderId === draggedFolderId) return;
  const draggedIndex = folders.findIndex(f => f.id === draggedFolderId);
  const targetIndex = folders.findIndex(f => f.id === targetFolderId);
  if (draggedIndex > -1 && targetIndex > -1) {
    const draggedFolder = folders[draggedIndex];
    folders.splice(draggedIndex, 1);
    folders.splice(targetIndex, 0, draggedFolder);
    saveDataToLocalStorage();
    renderFolders();
  }
}

function handleTaskDragStart(e) {
  draggedTaskId = e.currentTarget.dataset.taskId;
}

function handleTaskDragOver(e) {
  e.preventDefault();
}

function handleTaskDrop(e) {
  e.preventDefault();
  const targetTaskId = e.currentTarget.dataset.taskId;
  if (!targetTaskId || targetTaskId === draggedTaskId) return;
  const folder = folders.find(f => f.id === currentFolderId);
  if (!folder) return;
  const draggedIndex = folder.tasks.findIndex(t => t.id === draggedTaskId);
  const targetIndex = folder.tasks.findIndex(t => t.id === targetTaskId);
  if (draggedIndex > -1 && targetIndex > -1) {
    const draggedTask = folder.tasks[draggedIndex];
    folder.tasks.splice(draggedIndex, 1);
    folder.tasks.splice(targetIndex, 0, draggedTask);
    saveDataToLocalStorage();
    renderTasks();
    return;
  }
  const draggedFinishedIndex = folder.finished.findIndex(t => t.id === draggedTaskId);
  const targetFinishedIndex = folder.finished.findIndex(t => t.id === targetTaskId);
  if (draggedFinishedIndex > -1 && targetFinishedIndex > -1) {
    const draggedTask = folder.finished[draggedFinishedIndex];
    folder.finished.splice(draggedFinishedIndex, 1);
    folder.finished.splice(targetFinishedIndex, 0, draggedTask);
    saveDataToLocalStorage();
    renderTasks();
  }
}

function handleStepDragStart(e) {
  draggedStepIndex = parseInt(e.currentTarget.dataset.stepIndex, 10);
}

function handleStepDragOver(e) {
  e.preventDefault();
}

function handleStepDrop(e, task) {
  e.preventDefault();
  const targetStepIndex = parseInt(e.currentTarget.dataset.stepIndex, 10);
  if (targetStepIndex === draggedStepIndex || isNaN(targetStepIndex)) return;
  const draggedStep = task.steps[draggedStepIndex];
  task.steps.splice(draggedStepIndex, 1);
  task.steps.splice(targetStepIndex, 0, draggedStep);
  saveDataToLocalStorage();
  renderTasks();
}

/************************************************************************
 * MOVER TAREA
 ************************************************************************/
confirmMoveBtn.addEventListener('click', async () => {
  const targetFolderId = targetFolderSelect.value;
  if (!targetFolderId) {
    await asistaAlert('Selecciona una carpeta de destino.', { title: 'Mover tarea', type: 'warn' });
    return;
  }
  doMoveTask(targetFolderId);
});

cancelMoveBtn.addEventListener('click', () => closeMoveModal());

function inlineMoveTask(task, isFinished) {
  taskBeingMoved = task;
  folderOfTaskBeingMoved = folders.find(f => f.id === currentFolderId);
  isTaskCompletedBeingMoved = isFinished;
  targetFolderSelect.innerHTML = '';
  folders.forEach(folder => {
    if (folder.id === folderOfTaskBeingMoved.id || folder.isDefaultRewards) return;
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.name;
    targetFolderSelect.appendChild(option);
  });
  moveModal.style.display = 'flex';
}

function doMoveTask(targetFolderId) {
  if (!folderOfTaskBeingMoved || !taskBeingMoved) return;
  const arr = isTaskCompletedBeingMoved
    ? folderOfTaskBeingMoved.finished
    : folderOfTaskBeingMoved.tasks;
  const idx = arr.findIndex(t => t.id === taskBeingMoved.id);
  if (idx > -1) arr.splice(idx, 1);
  const targetFolder = folders.find(f => f.id === targetFolderId);
  if (targetFolder) targetFolder.tasks.push(taskBeingMoved);
  saveDataToLocalStorage();
  renderTasks();
  renderFolders();
  closeMoveModal();
}

function closeMoveModal() {
  moveModal.style.display = 'none';
  taskBeingMoved = null;
  folderOfTaskBeingMoved = null;
  isTaskCompletedBeingMoved = false;
}

/************************************************************************
 * LOCALSTORAGE
 ************************************************************************/
function saveDataToLocalStorage() {
  const payload = { folders, trash };
  localStorage.setItem('foldersDataV4', JSON.stringify(payload));
  window.EfectivaCloud?.scheduleSave(payload);
}

function loadDataFromLocalStorage() {
  const dataString = localStorage.getItem('foldersDataV4');
  if (dataString) {
    const dataObj = JSON.parse(dataString);
    folders = dataObj.folders || [];
    trash = dataObj.trash || [];
  } else {
    folders = [];
    trash = [];
  }
}

/************************************************************************
 * UTILIDADES
 ************************************************************************/
function generateId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

document.querySelectorAll('.restore-btn').forEach(button => {
  button.addEventListener('click', function() {
    restoreTask(this);
  });
});

function restoreTask(button) {
  console.log('Tarea restaurada');
}

/*
 * Función para recalcular el tiempo asignado a cada paso
 * Se distribuye de forma equitativa: cada paso recibe (totalTime / número de pasos) segundos.
 */
function recalcStepTimes(task) {
  if (task.totalTime && task.steps.length > 0) {
    const allocated = Math.floor(task.totalTime / task.steps.length);
    task.stepTimes = [];
    for (let i = 0; i < task.steps.length; i++) {
      task.stepTimes.push(allocated);
    }
  }
}

// Reemplazar (o definir) la función handlePopState:
function handlePopState(event) {
  // Si la presentación está abierta en pantalla grande, al pulsar "atrás" solo se cierra la presentación.
  if (presentationOpen && !isPresentationMinimized) {
    closePresentation(true); // skipHistory true para que no invoque history.back()
    return;
  }
  // Sino, proceder con la navegación normal
  if (event.state) {
    if (event.state.rewards) {
      showFolders();
    } else if (event.state.folderId) {
      openFolder(event.state.folderId, false);
    } else if (event.state.trash) {
      showTrash(false);
    }
  } else {
    showFolders();
  }
}

// Modificar la función closePresentation para omitir history.back() en caso de cerrar presentación
function closePresentation(skipHistory = false) {
  // Si la presentación está minimizada, no se cierra (se mantiene en mini pantalla)
  if (isPresentationMinimized) return;
  
  presentationModal.style.display = 'none';
  presentationOpen = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerSeconds = 0;
  currentStepCountdown = 0;
  timerDisplay.textContent = '00:00';
  presentationStep.textContent = '';
  if (isPresentationMinimized) {
    presentationModal.classList.remove('minimized');
    isPresentationMinimized = false;
  }
  const minBtn = document.getElementById('minimizePresentationBtn');
  if (minBtn) minBtn.remove();
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  if (currentPresentationTask) {
    currentPresentationTask.currentStepIndex = currentStepIndex;
  }
  // Eliminar la llamada a history.back() para que no se abandone la carpeta
  // if (!skipHistory && currentFolderId !== rewardsFolderId) { history.back(); } <-- ELIMINADA

  saveDataToLocalStorage();
  renderTasks();
  currentPresentationTask = null;
  releaseWakeLock();
}

// Modificar la función nextStep para sumar/restar el tiempo residual al siguiente paso
function nextStep() {
  if (currentPresentationTask && currentPresentationTask.totalTime) {
    if (currentStepIndex < presentationSteps.length - 1) {
      // Calcular el ajuste: el valor actual de currentStepCountdown se usará (positivo o negativo)
      let leftover = currentStepCountdown;
      currentStepIndex++;
      let baseTime = currentPresentationTask.stepTimes[currentStepIndex];
      currentStepCountdown = baseTime + leftover;
      showPresentationStep();
    } else {
      showCongratulations();
    }
  } else {
    if (currentStepIndex < presentationSteps.length - 1) {
      currentStepIndex++;
      showPresentationStep();
    } else {
      showCongratulations();
    }
  }
}

// (Opcional) Modificar prevStep de forma similar para ajustar el tiempo al paso anterior
function prevStep() {
  if (currentStepIndex > 0) {
    let leftover = currentStepCountdown;
    currentStepIndex--;
    let baseTime = currentPresentationTask.stepTimes[currentStepIndex];
    currentStepCountdown = baseTime + leftover;
    showPresentationStep();
  }
}

// AGREGAR HANDLER PARA VISIBILITYCHANGE
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Guardar el momento en que la app se oculta
    lastHiddenTime = Date.now();
  } else {
    // Cuando se vuelve a ver la app, calcular el tiempo transcurrido en segundos
    const elapsedSec = Math.floor((Date.now() - lastHiddenTime) / 1000);
    // Si hay una presentación activa con temporizador, descontar el tiempo
    if (presentationOpen && currentPresentationTask && currentPresentationTask.totalTime) {
      currentStepCountdown = Math.max(0, currentStepCountdown - elapsedSec);
      timerDisplay.textContent = formatTime(currentStepCountdown);
    }
    // (Opcional) Mostrar Notificación con el paso actual y tiempo restante
    if (Notification.permission === "granted") {
      const notificationOptions = {
        body: `Paso: "${presentationSteps[currentStepIndex]}"\nTiempo restante: ${formatTime(currentStepCountdown)}`,
        icon: "icon.png" // Asegúrate de tener un icono adecuado
      };
      new Notification("Actualización de Temporizador", notificationOptions);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }
});

// Función para reiniciar la presentación de pasos al finalizar la tarea
function resetPresentationSteps() {
    const stepsList = document.getElementById('presentationStepsList');
    if (stepsList) {
        // Elimina la clase que resalta los pasos completados (por ejemplo, 'completed')
        stepsList.querySelectorAll('li.completed').forEach(li => li.classList.remove('completed'));
        // Opcional: limpiar completamente la lista
        // stepsList.innerHTML = '';
    }
    // Reinicia la visualización del paso actual y el timer
    const presentationStep = document.getElementById('presentationStep');
    if (presentationStep) presentationStep.innerHTML = '';
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) timerDisplay.textContent = '00:00';
}

let presentationTimer = {
    startTime: 0,
    elapsedTime: 0,
    previousStepTime: 0,
    currentStepStartTime: 0
};

function handlePresentationNavigation(direction) {
    const currentStep = getCurrentStep();
    const previousStepTime = presentationTimer.previousStepTime;
    const currentTime = Date.now();
    const stepDuration = currentTime - presentationTimer.currentStepStartTime;

    if (direction === 'next') {
        presentationTimer.elapsedTime += stepDuration;
    } else if (direction === 'prev') {
        presentationTimer.elapsedTime -= stepDuration;
    }

    presentationTimer.currentStepStartTime = currentTime;
    updateTimerDisplay(presentationTimer.elapsedTime);

    // Actualizar el paso actual según la dirección
    if (direction === 'next' && currentStep < presentationSteps.length - 1) {
        setCurrentStep(currentStep + 1);
    } else if (direction === 'prev' && currentStep > 0) {
        setCurrentStep(currentStep - 1);
    }
}

function updateTimerDisplay(elapsedTime) {
    const minutes = Math.floor(Math.abs(elapsedTime) / 60000);
    const seconds = Math.floor((Math.abs(elapsedTime) % 60000) / 1000);
    const sign = elapsedTime < 0 ? '-' : '';
    
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.textContent = `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Eventos de navegación
document.addEventListener('keydown', (e) => {
    if (!isPresentationMode) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        handlePresentationNavigation('next');
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePresentationNavigation('prev');
    }
});

// Función para solicitar el wake lock.
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock liberado');
      });
      console.log('Wake Lock activado');
    }
  } catch (err) {
    console.error(`Error al solicitar Wake Lock: ${err.message}`);
  }
}

// Función para liberar el wake lock.
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
    console.log('Wake Lock liberado manualmente');
  }
}

// Reiniciar el wake lock si la visibilidad de la página cambia.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    requestWakeLock();
  }
});
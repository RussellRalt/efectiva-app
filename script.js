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
      if (Array.isArray(cloudData.notes) && (cloudData.notes.length > 0 || notes.length === 0)) {
        notes = cloudData.notes;
        saveNotes();
      }
      if (Array.isArray(cloudData.userTemplates) && (cloudData.userTemplates.length > 0 || userTemplates.length === 0)) {
        userTemplates = cloudData.userTemplates;
        saveUserTemplates();
      }
      if (Array.isArray(cloudData.automationRules) && (cloudData.automationRules.length > 0 || automationRules.length === 0)) {
        automationRules = cloudData.automationRules;
        saveAutomationRules();
      }
      if (Array.isArray(cloudData.agentMemory) && cloudData.agentMemory.length > 0) {
        try { localStorage.setItem('efectivaAgentMemoryV1', JSON.stringify(cloudData.agentMemory)); } catch (_) {}
      }
      if (cloudData.userStats && typeof cloudData.userStats === 'object') {
        userStats = Object.assign(userStats, cloudData.userStats);
        saveUserStats();
      }
      if (cloudData.finance && window.EfectivaFinance && typeof window.EfectivaFinance.hydrateFromCloud === 'function') {
        window.EfectivaFinance.hydrateFromCloud(cloudData.finance);
      }
      if (Array.isArray(cloudData.tables) && window.EfectivaTables && typeof window.EfectivaTables.hydrateFromCloud === 'function') {
        window.EfectivaTables.hydrateFromCloud(cloudData.tables);
      }
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
  setInterval(checkAlarms, 60 * 1000);
  restoreActivePresentationIfAny();
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
 * HISTORIAL / NAVEGACIÓN UNIFICADA (v34 — SIN DUPLICADOS NI BLOQUEO PiP)
 ************************************************************************/
function handleAppBackAction() {
  // 1) Cerrar modales auxiliares si hay alguno abierto
  const aiPanel = document.getElementById('aiPanel');
  if (aiPanel && aiPanel.classList.contains('open')) {
    const aiClose = document.getElementById('aiCloseBtn');
    if (aiClose) aiClose.click();
    return true;
  }
  const idleAlarmModal = document.getElementById('idleAlarmModal');
  if (idleAlarmModal) {
    if (window.EfectivaIdleAlarm) window.EfectivaIdleAlarm.closePanel();
    else idleAlarmModal.remove();
    return true;
  }
  const colorPickerEl = document.getElementById('taskColorPicker');
  if (colorPickerEl) {
    if (typeof closeColorPicker === 'function') closeColorPicker();
    else colorPickerEl.remove();
    return true;
  }
  const finActionModal = document.getElementById('finActionModal');
  if (finActionModal) {
    finActionModal.remove();
    return true;
  }
  const tableEditorModal = document.getElementById('tableEditorModal');
  if (tableEditorModal) {
    tableEditorModal.remove();
    return true;
  }
  const ccModal = document.getElementById('controlCenterModal');
  if (ccModal && ccModal.style.display === 'flex') {
    ccModal.style.display = 'none';
    return true;
  }
  if (scheduleModal && scheduleModal.style.display === 'flex') {
    scheduleModal.style.display = 'none';
    return true;
  }
  if (moveModal && moveModal.style.display === 'flex') {
    moveModal.style.display = 'none';
    return true;
  }
  if (confirmModal && confirmModal.style.display === 'flex') {
    confirmModal.style.display = 'none';
    return true;
  }

  // 2) Si la presentación está abierta en pantalla completa (NO minimizada), cerrarla
  if (presentationOpen && !isPresentationMinimized) {
    closePresentation(true);
    return true;
  }

  // 3) Si estamos dentro de una carpeta, papelera, finanzas o recompensas, volver siempre a Carpetas (con o sin PiP activo)
  const inTasks = tasksSection && tasksSection.style.display !== 'none';
  const inTrash = trashSection && trashSection.style.display !== 'none';
  const inReward = rewardSection && rewardSection.style.display !== 'none';
  const finSec = document.getElementById('financeSection');
  const inFinance = finSec && finSec.style.display !== 'none';
  if (currentFolderId || inTasks || inTrash || inReward || inFinance) {
    showFolders();
    return true;
  }
  return false;
}

function handlePopState(event) {
  // Si la presentación está activa en pantalla completa, cerrarla y mantener la vista actual
  if (presentationOpen && !isPresentationMinimized) {
    closePresentation(true);
    return;
  }
  if (event.state) {
    if (event.state.finance && window.EfectivaFinanceUI && typeof window.EfectivaFinanceUI.openFinanceView === 'function') {
      window.EfectivaFinanceUI.openFinanceView(false);
    } else if (event.state.rewards) {
      openFolder(rewardsFolderId, false);
    } else if (event.state.folderId) {
      openFolder(event.state.folderId, false);
    } else if (event.state.trash) {
      showTrash(false);
    } else {
      showFolders();
    }
  } else {
    showFolders();
  }
}

window.removeEventListener('popstate', handlePopState);
window.addEventListener('popstate', handlePopState);

// Botón físico / gesto Atrás nativo de Android (Capacitor 6) — nunca atrapa al usuario con PiP activo
try {
  const CapAppNav = window.Capacitor?.Plugins?.App;
  if (CapAppNav && typeof CapAppNav.addListener === 'function' && !window.__efectivaBackListenerBound) {
    window.__efectivaBackListenerBound = true;
    CapAppNav.addListener('backButton', () => {
      const handled = handleAppBackAction();
      if (!handled && typeof CapAppNav.minimizeApp === 'function') {
        CapAppNav.minimizeApp().catch(() => {});
      }
    });
  }
} catch (_) {}

// Botones visuales "←" en encabezados de Carpeta y Papelera
const backToFoldersBtnEl = document.getElementById('backToFoldersBtn');
if (backToFoldersBtnEl) {
  backToFoldersBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    showFolders();
  });
}
const backFromTrashBtnEl = document.getElementById('backFromTrashBtn');
if (backFromTrashBtnEl) {
  backFromTrashBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    showFolders();
  });
}

function showFolders() {
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  trashSection.style.display = 'none';
  const finSec = document.getElementById('financeSection');
  if (finSec) finSec.style.display = 'none';
  foldersSection.style.display = 'block';
  currentFolderId = null;
  if (!(presentationOpen && isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }
  renderFolders();
}

function openFolder(folderId, pushToHistory = true) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  currentFolderId = folderId;

  tasksTitle.textContent = folder.name;
  foldersSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  const finSec = document.getElementById('financeSection');
  if (finSec) finSec.style.display = 'none';

  // Si hay PiP minimizado activo, mantenerlo visible; de lo contrario ocultar el modal
  if (!(presentationOpen && isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }

  trashSection.style.display = 'none';
  tasksSection.style.display = 'block';

  if (folderId === rewardsFolderId) {
    if (newTaskInput) newTaskInput.placeholder = 'Describe tu recompensa (Enter)...';
    if (newTaskTimeInput) newTaskTimeInput.placeholder = 'Tiempo en min (opcional)';
  } else {
    if (newTaskInput) newTaskInput.placeholder = 'Agrega una tarea (Enter)...';
    if (newTaskTimeInput) newTaskTimeInput.placeholder = 'Tiempo (min) (opcional)';
  }
  renderTasks();

  // FIX v34: empujar al historial también cuando el PiP está minimizado (solo evitarlo en pantalla completa)
  if (pushToHistory && (!presentationOpen || isPresentationMinimized)) {
    if (folderId === rewardsFolderId) {
      history.pushState({ rewards: true }, '', '');
    } else {
      history.pushState({ folderId }, '', '');
    }
  }
}

function showTrash(pushHistory = true) {
  foldersSection.style.display = 'none';
  tasksSection.style.display = 'none';
  rewardSection.style.display = 'none';
  scheduleModal.style.display = 'none';
  alarmModal.style.display = 'none';
  const finSec = document.getElementById('financeSection');
  if (finSec) finSec.style.display = 'none';
  if (!(presentationOpen && isPresentationMinimized)) {
    presentationModal.style.display = 'none';
  }
  trashSection.style.display = 'block';
  currentFolderId = null;
  renderTrash();
  if (pushHistory && (!presentationOpen || isPresentationMinimized)) {
    history.pushState({ trash: true }, '', '');
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
      closeAllFolderDropdowns();
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
        closeAllFolderDropdowns();
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
        closeAllFolderDropdowns();
      });
      folderDropdownMenu.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm(`¿Eliminar la carpeta "${folder.name}"?`, () => {
          moveFolderToTrash(folder.id);
          closeAllFolderDropdowns();
        });
      });
      folderDropdownMenu.appendChild(deleteBtn);
    }

    folderDiv.append(folderOptionsBtn, folderDropdownMenu, folderIcon, folderName);
    folderContainer.appendChild(folderDiv);
  });
}

function closeAllFolderDropdowns() {
  document.querySelectorAll('.folder-dropdown-menu').forEach(m => {
    m.style.display = 'none';
    m.classList.remove('open-up');
  });
  document.querySelectorAll('.folder.menu-open').forEach(f => f.classList.remove('menu-open'));
}

function toggleFolderDropdownMenu(folderId) {
  const menu = document.getElementById(`folderMenu-${folderId}`);
  if (!menu) return;
  const wasOpen = menu.style.display === 'block';
  closeAllFolderDropdowns();

  if (!wasOpen) {
    const parentFolder = menu.closest('.folder');
    if (parentFolder) parentFolder.classList.add('menu-open');
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16) {
      menu.classList.add('open-up');
    }
    setTimeout(() => {
      document.addEventListener('click', function clickListener(e) {
        if (!menu.contains(e.target) && !e.target.closest('.folder-options-btn')) {
          closeAllFolderDropdowns();
          document.removeEventListener('click', clickListener);
        }
      });
    }, 50);
  }
}

// [v34: eliminado listener popstate anónimo duplicado — manejado exclusivamente por handlePopState]


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
  if (presentationOpen && currentFolderId === folderId) {
    closePresentation(true);
  } else {
    stopAllSpeechSynthesis();
  }
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

  if (note.color && typeof applyCardColorTheme === 'function') {
    applyCardColorTheme(noteDiv, note.color);
  }

  const noteHeader = document.createElement('div');
  noteHeader.className = 'task-header note-header';

  const noteNameSpan = document.createElement('span');
  noteNameSpan.className = 'task-name-text note-name-text';
  const safeTitle = (note.title || 'Sin título').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  noteNameSpan.innerHTML = `<span class="note-icon-badge">📝</span> ${safeTitle}`;

  const noteButtons = document.createElement('div');
  noteButtons.className = 'task-buttons note-buttons';

  // Botón Paleta 🎨 (conectado al motor unificado de popover portal + paleta pastel)
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.textContent = '🎨';
  colorBtn.title = 'Cambiar color de la nota';
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPicker(colorBtn, note.color || null, (newColor) => {
      if (newColor === null) {
        delete note.color;
      } else {
        note.color = newColor;
      }
      saveNotes();
      renderTasks();
    });
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

  // Renderizar tablas genéricas de esta carpeta (Módulo Tablas v36)
  if (window.EfectivaTables && typeof window.EfectivaTables.listarTablas === 'function') {
    const tblRes = window.EfectivaTables.listarTablas({ carpeta_id: currentFolderId, incluir_filas: false });
    (tblRes.tablas || []).forEach(tbl => {
      const card = document.createElement('div');
      card.className = 'table-card-item';
      const main = document.createElement('div');
      main.className = 'table-card-main';
      main.innerHTML = `<span class="table-card-title">📊 ${tbl.title.replace(/</g, '&lt;')}</span><span class="table-card-meta">${(tbl.columns || []).length} columnas · ${tbl.rowCount} fila(s)</span>`;
      main.onclick = () => window.EfectivaTables.openTableEditor(tbl.id);

      const actions = document.createElement('div');
      actions.className = 'table-card-actions';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'fin-btn sm primary';
      openBtn.textContent = 'Abrir';
      openBtn.onclick = () => window.EfectivaTables.openTableEditor(tbl.id);

      const csvBtn = document.createElement('button');
      csvBtn.type = 'button';
      csvBtn.className = 'fin-btn sm';
      csvBtn.title = 'Exportar a Excel (.csv)';
      csvBtn.textContent = '📥 CSV';
      csvBtn.onclick = () => window.EfectivaTables.downloadTableCsv(tbl.id);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'fin-btn sm danger';
      delBtn.title = 'Eliminar tabla';
      delBtn.textContent = '🗑';
      delBtn.onclick = () => {
        const doDel = () => {
          window.EfectivaTables.gestionarTabla({ accion: 'eliminar', tabla_id: tbl.id });
          renderTasks();
        };
        if (typeof asistaConfirm === 'function') {
          asistaConfirm(`¿Eliminar la tabla "${tbl.title}"?`, { title: 'Eliminar tabla', confirmText: 'Eliminar' }).then(ok => { if (ok) doDel(); });
        } else if (confirm(`¿Eliminar la tabla "${tbl.title}"?`)) {
          doDel();
        }
      };

      actions.append(openBtn, csvBtn, delBtn);
      card.append(main, actions);
      tasksList.appendChild(card);
    });
  }

  newTaskInput.style.display = 'block';
  newTaskTimeInput.style.display = 'block';

  completedMiniFolder.style.display = 'block';
  completedMiniFolderList.innerHTML = '';
  folder.finished.forEach(task => completedMiniFolderList.appendChild(buildFinishedTaskItem(folder, task)));

  document.querySelector('.mini-folder-icon').onclick = () => {
    completedMiniFolder.classList.toggle('expanded');
  };

  // Lógica del Selector Unificado de Modo (Tarea / Nota / Tabla)
  const modeTabTask = document.getElementById('modeTabTask');
  const modeTabNote = document.getElementById('modeTabNote');
  const modeTabTable = document.getElementById('modeTabTable');
  const modeTabTemplates = document.getElementById('modeTabTemplates');
  const taskCreationForm = document.getElementById('taskCreationForm');
  const noteCreationForm = document.getElementById('noteCreationForm');
  const tableCreationForm = document.getElementById('tableCreationForm');
  const userTemplatesPanel = document.getElementById('userTemplatesPanel');
  const saveNewNoteBtn = document.getElementById('saveNewNoteBtn');
  const newNoteTitleInput = document.getElementById('newNoteTitleInput');
  const newNoteContentInput = document.getElementById('newNoteContentInput');
  const saveNewTableBtn = document.getElementById('saveNewTableBtn');
  const newTableTitleInput = document.getElementById('newTableTitleInput');
  const newTableColsInput = document.getElementById('newTableColsInput');

  const activateCreationTab = (mode) => {
    [modeTabTask, modeTabNote, modeTabTable, modeTabTemplates].forEach(b => b && b.classList.remove('active'));
    if (taskCreationForm) taskCreationForm.style.display = mode === 'task' ? 'flex' : 'none';
    if (noteCreationForm) noteCreationForm.style.display = mode === 'note' ? 'flex' : 'none';
    if (tableCreationForm) tableCreationForm.style.display = mode === 'table' ? 'flex' : 'none';
    if (userTemplatesPanel) userTemplatesPanel.style.display = mode === 'templates' ? 'flex' : 'none';
    if (mode === 'task' && modeTabTask) { modeTabTask.classList.add('active'); if (newTaskInput) newTaskInput.focus(); }
    if (mode === 'note' && modeTabNote) { modeTabNote.classList.add('active'); if (newNoteTitleInput) newNoteTitleInput.focus(); }
    if (mode === 'table' && modeTabTable) { modeTabTable.classList.add('active'); if (newTableTitleInput) newTableTitleInput.focus(); }
    if (mode === 'templates' && modeTabTemplates) { modeTabTemplates.classList.add('active'); }
  };

  if (modeTabTask && modeTabNote && taskCreationForm && noteCreationForm) {
    modeTabTask.onclick = () => activateCreationTab('task');
    modeTabNote.onclick = () => activateCreationTab('note');
    if (modeTabTable) modeTabTable.onclick = () => activateCreationTab('table');
  }

  if (saveNewTableBtn && newTableTitleInput) {
    saveNewTableBtn.onclick = () => {
      if (!window.EfectivaTables) return;
      const title = (newTableTitleInput.value || '').trim();
      if (!title) return;
      const rawCols = (newTableColsInput ? newTableColsInput.value : '').split(',').map(s => s.trim()).filter(Boolean);
      const columns = (rawCols.length ? rawCols : ['Item', 'Valor']).map(name => {
        const lower = name.toLowerCase();
        const type = /precio|monto|costo|total|saldo|presupuesto|q|usd/.test(lower) ? 'currency'
          : /cant|num|nota|punt|edad|hora|min/.test(lower) ? 'number'
          : /fecha|dia|venc/.test(lower) ? 'date'
          : /hecho|listo|check|ok/.test(lower) ? 'checkbox'
          : 'text';
        return { name, type };
      });
      const res = window.EfectivaTables.gestionarTabla({
        accion: 'crear',
        titulo: title,
        carpeta_id: currentFolderId,
        columnas: columns
      });
      newTableTitleInput.value = '';
      renderTasks();
      if (res && res.ok && res.tabla) {
        window.EfectivaTables.openTableEditor(res.tabla.id);
      }
    };
  }

  if (!window.__efectivaTablesRenderBound) {
    window.__efectivaTablesRenderBound = true;
    window.addEventListener('efectiva:tables-updated', () => {
      if (currentFolderId && tasksSection && tasksSection.style.display !== 'none') {
        renderTasks();
      }
    });
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
 * v37 — Sistema de Paleta Pastel Curada + Popover Portal Flotante + Armonización Integral por Tarjeta.
 *
 * 8 tonos pastel desaturados y estéticos + "Sin color":
 *   mint     (#A7E3C6) Menta suave
 *   lavender (#C9B8F5) Lavanda
 *   peach    (#F7C5A8) Durazno
 *   sky      (#A8D4F5) Cielo pastel
 *   rose     (#F2B8C6) Rosa empolvado
 *   sand     (#EDE0B4) Arena cálida
 *   sage     (#B8D4B8) Salvia
 *   slate    (#B4C6DC) Azul pizarra suave
 */
const PASTEL_COLOR_PRESETS = [
  { key: 'mint',     hex: '#A7E3C6', name: 'Menta suave' },
  { key: 'lavender', hex: '#C9B8F5', name: 'Lavanda' },
  { key: 'peach',    hex: '#F7C5A8', name: 'Durazno' },
  { key: 'sky',      hex: '#A8D4F5', name: 'Cielo pastel' },
  { key: 'rose',     hex: '#F2B8C6', name: 'Rosa empolvado' },
  { key: 'sand',     hex: '#EDE0B4', name: 'Arena cálida' },
  { key: 'sage',     hex: '#B8D4B8', name: 'Salvia' },
  { key: 'slate',    hex: '#B4C6DC', name: 'Azul pizarra' }
];

const TASK_COLOR_PALETTE = [...PASTEL_COLOR_PRESETS.map(p => p.hex), null];

// Mapeo automático de colores antiguos saturados hacia su equivalente pastel suave
const LEGACY_COLOR_TO_PASTEL = {
  '#4caf50': 'mint',
  '#22c55e': 'mint',
  '#10b981': 'mint',
  '#9c27b0': 'lavender',
  '#a78bfa': 'lavender',
  '#7c3aed': 'lavender',
  '#ff9800': 'peach',
  '#f97316': 'peach',
  '#00bcd4': 'sky',
  '#4285f4': 'sky',
  '#38bdf8': 'sky',
  '#2563eb': 'sky',
  '#ff5252': 'rose',
  '#e91e63': 'rose',
  '#ef4444': 'rose',
  '#ffeb3b': 'sand',
  '#ffa000': 'sand',
  '#fbbf24': 'sand',
  '#607d8b': 'slate',
  '#64748b': 'slate'
};

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let clean = hex.trim().replace('#', '');
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

/**
 * Resuelve cualquier color (pastel nuevo o hex legado) a uno de los 8 presets pastel.
 */
function resolvePastelPreset(color) {
  if (!color || typeof color !== 'string') return null;
  const lower = color.trim().toLowerCase();
  const byKey = PASTEL_COLOR_PRESETS.find(p => p.key === lower || p.hex.toLowerCase() === lower);
  if (byKey) return byKey;

  const legacyKey = LEGACY_COLOR_TO_PASTEL[lower];
  if (legacyKey) {
    return PASTEL_COLOR_PRESETS.find(p => p.key === legacyKey) || PASTEL_COLOR_PRESETS[0];
  }

  // Fallback por distancia euclidiana RGB al tono pastel más cercano
  const rgb = hexToRgb(lower);
  if (!rgb) return PASTEL_COLOR_PRESETS[0];
  let best = PASTEL_COLOR_PRESETS[0];
  let bestDist = Infinity;
  PASTEL_COLOR_PRESETS.forEach(p => {
    const pr = hexToRgb(p.hex);
    if (!pr) return;
    const d = (rgb.r - pr.r) ** 2 + (rgb.g - pr.g) ** 2 + (rgb.b - pr.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  });
  return best;
}

function normalizePastelColor(color) {
  if (!color) return null;
  const preset = resolvePastelPreset(color);
  return preset ? preset.hex : null;
}

/**
 * Oscurece un color hex en un porcentaje (0-1). Se mantiene por compatibilidad.
 */
function darkenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#555555';
  const dr = Math.max(0, Math.floor(rgb.r * (1 - amount)));
  const dg = Math.max(0, Math.floor(rgb.g * (1 - amount)));
  const db = Math.max(0, Math.floor(rgb.b * (1 - amount)));
  return '#' + [dr, dg, db].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Aplica la armonización integral por tokens CSS a una tarjeta de Tarea o Nota.
 * Los matices se adaptan automáticamente a Dark, Light y Cyberpunk mediante CSS.
 */
function applyCardColorTheme(cardEl, color) {
  if (!cardEl) return;
  if (!color) {
    cardEl.classList.remove('ef-colored-card');
    delete cardEl.dataset.cardColor;
    return;
  }
  const preset = resolvePastelPreset(color);
  if (!preset) return;
  cardEl.classList.add('ef-colored-card');
  cardEl.dataset.cardColor = preset.key;
}

let activeColorPickerCleanup = null;

function closeColorPicker() {
  const existing = document.getElementById('taskColorPicker');
  if (existing) existing.remove();
  if (typeof activeColorPickerCleanup === 'function') {
    activeColorPickerCleanup();
    activeColorPickerCleanup = null;
  }
}

/**
 * Popover flotante de colores renderizado como portal en document.body (position: fixed).
 * Soporta firma unificada: openColorPicker(anchorBtn, currentColor, onSelect)
 * y firma retrocompatible: openColorPicker(taskObj, anchorBtn).
 */
function openColorPicker(arg1, arg2, arg3) {
  let anchorBtn = arg1;
  let currentColor = arg2;
  let onSelect = arg3;

  // Retrocompatibilidad si alguien invoca openColorPicker(taskObj, anchorBtn)
  if (arg1 && !(arg1 instanceof Element) && arg2 instanceof Element) {
    const legacyTask = arg1;
    anchorBtn = arg2;
    currentColor = legacyTask.color || null;
    onSelect = (c) => applyTaskColor(legacyTask, c);
  }

  if (!anchorBtn || typeof anchorBtn.getBoundingClientRect !== 'function') return;

  // Toggle si se toca el mismo botón que ya abrió el popover
  const existing = document.getElementById('taskColorPicker');
  const wasSameAnchor = existing && existing._anchorBtn === anchorBtn;
  closeColorPicker();
  if (wasSameAnchor) return;

  const activePreset = resolvePastelPreset(currentColor);
  const picker = document.createElement('div');
  picker.id = 'taskColorPicker';
  picker.className = 'task-color-picker';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Selector de color pastel');
  picker._anchorBtn = anchorBtn;

  // Cabecera del popover con botón cerrar X
  const header = document.createElement('div');
  header.className = 'color-picker-header';
  const title = document.createElement('span');
  title.className = 'color-picker-title';
  title.textContent = 'Color de tarjeta';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'color-picker-close';
  closeBtn.title = 'Cerrar selector';
  closeBtn.setAttribute('aria-label', 'Cerrar selector de color');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeColorPicker();
  });
  header.append(title, closeBtn);
  picker.appendChild(header);

  // Cuadrícula de 8 tonos pastel suaves
  const grid = document.createElement('div');
  grid.className = 'color-picker-grid';

  PASTEL_COLOR_PRESETS.forEach((preset) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = preset.hex;
    swatch.title = preset.name;
    swatch.setAttribute('aria-label', preset.name);
    if (activePreset && activePreset.key === preset.key) {
      swatch.classList.add('color-swatch--selected');
    }
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      closeColorPicker();
      if (typeof onSelect === 'function') onSelect(preset.hex);
    });
    grid.appendChild(swatch);
  });
  picker.appendChild(grid);

  // Botón inferior "Sin color (tema base)"
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'color-picker-reset';
  resetBtn.textContent = '↺ Sin color (tema base)';
  if (!activePreset) resetBtn.classList.add('active');
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeColorPicker();
    if (typeof onSelect === 'function') onSelect(null);
  });
  picker.appendChild(resetBtn);

  // Montar en portal body con position: fixed y cálculo inteligente de bordes
  picker.style.visibility = 'hidden';
  document.body.appendChild(picker);

  const rect = anchorBtn.getBoundingClientRect();
  const popW = picker.offsetWidth || 208;
  const popH = picker.offsetHeight || 152;
  const pad = 12;
  const vw = window.innerWidth || document.documentElement.clientWidth || 360;
  const vh = window.innerHeight || document.documentElement.clientHeight || 640;

  let left = rect.right - popW;
  if (left < pad) left = pad;
  if (left + popW > vw - pad) left = Math.max(pad, vw - popW - pad);

  let top = rect.bottom + 8;
  if (top + popH > vh - pad) {
    const above = rect.top - popH - 8;
    top = above >= pad ? above : Math.max(pad, vh - popH - pad);
  }

  picker.style.left = `${Math.round(left)}px`;
  picker.style.top = `${Math.round(top)}px`;
  picker.style.visibility = 'visible';

  // Cierre limpio al tocar fuera, presionar Escape o hacer scroll
  const onOutside = (e) => {
    if (!picker.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
      closeColorPicker();
    }
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') closeColorPicker();
  };
  const onScrollOrResize = () => closeColorPicker();

  const timerId = setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
  }, 0);

  activeColorPickerCleanup = () => {
    clearTimeout(timerId);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
  };
}

/**
 * Aplica un color pastel a la tarea, persiste en localStorage y re-renderiza.
 * Si color === null, se quita el color (vuelve al default).
 */
function applyTaskColor(task, color) {
  if (color === null) {
    delete task.color;
  } else {
    task.color = normalizePastelColor(color) || color;
  }
  saveDataToLocalStorage();
  renderTasks();
}

function buildPendingTaskItem(folder, task) {
  const taskDiv = document.createElement('div');
  taskDiv.className = 'task';
  taskDiv.dataset.taskId = task.id;
  taskDiv.draggable = true;

  // v37: aplicar armonización cromática pastel integral si la tarea tiene color
  if (task.color) {
    applyCardColorTheme(taskDiv, task.color);
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

    // v37: botón de color (paleta pastel en popover portal)
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.textContent = '🎨';
    colorBtn.title = 'Cambiar color de la tarea';
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPicker(colorBtn, task.color || null, (newColor) => applyTaskColor(task, newColor));
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
      const wasOpen = menu.style.display === 'block';
      document.querySelectorAll('.task-menu').forEach(m => { m.style.display = 'none'; m.classList.remove('open-up'); });
      document.querySelectorAll('.task.menu-open').forEach(t => t.classList.remove('menu-open'));

      if (!wasOpen) {
        const parentTask = menu.closest('.task');
        if (parentTask) parentTask.classList.add('menu-open');
        menu.style.display = 'block';
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 16) {
          menu.classList.add('open-up');
        }
        setTimeout(() => {
          document.addEventListener('click', function taskMenuClickListener(ev) {
            if (!menu.contains(ev.target)) {
              menu.style.display = 'none';
              menu.classList.remove('open-up');
              if (parentTask) parentTask.classList.remove('menu-open');
              document.removeEventListener('click', taskMenuClickListener);
            }
          });
        }, 50);
      }
    });

    const taskMenu = document.createElement('div');
    taskMenu.className = 'task-menu';
    taskMenu.style.display = 'none'; taskMenu.classList.remove('open-up'); taskDiv.classList.remove('menu-open');

    // v2.7.0: el botón "Editar" del menú desplegable fue eliminado
    // (la edición de nombre ahora se hace con doble click sobre el nombre).

    const moveMenuItem = document.createElement('button');
    moveMenuItem.textContent = 'Mover';
    moveMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      inlineMoveTask(task, false);
      taskMenu.style.display = 'none'; taskMenu.classList.remove('open-up'); taskDiv.classList.remove('menu-open');
    });

    const scheduleMenuItem = document.createElement('button');
    scheduleMenuItem.textContent = 'Programar';
    scheduleMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      openScheduleModal(task);
      taskMenu.style.display = 'none'; taskMenu.classList.remove('open-up'); taskDiv.classList.remove('menu-open');
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
      taskMenu.style.display = 'none'; taskMenu.classList.remove('open-up'); taskDiv.classList.remove('menu-open');
    });

    const saveTplMenuItem = document.createElement('button');
    saveTplMenuItem.textContent = '📌 Guardar plantilla';
    saveTplMenuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      taskMenu.style.display = 'none'; taskMenu.classList.remove('open-up'); taskDiv.classList.remove('menu-open');
      saveTaskAsTemplate(task, task.name);
      saveTplMenuItem.textContent = '✅ ¡Guardada!';
      if (typeof asistaAlert === 'function') {
        asistaAlert(`La tarea "${task.name}" se guardó como plantilla reutilizable.`, { title: 'Plantilla guardada', type: 'info' });
      }
    });

    taskMenu.append(moveMenuItem, scheduleMenuItem, saveTplMenuItem, deleteMenuItem);
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

  // Barra de balance de tiempo por pasos
  if (task.steps.length > 0 && (task.totalTime || (task.stepTimes && task.stepTimes.some(t => t > 0)))) {
    if (!task.stepTimes || task.stepTimes.length !== task.steps.length) {
      recalcStepTimes(task, true);
    }
    const assignedSec = (task.stepTimes || []).reduce((acc, s) => acc + (Number(s) || 0), 0);
    const totalSec = task.totalTime || assignedSec;
    const diffSec = totalSec - assignedSec;

    const balanceBar = document.createElement('div');
    balanceBar.className = 'step-time-balance-bar';

    const infoSpan = document.createElement('span');
    infoSpan.className = 'step-time-balance-info';
    const assignedMin = Math.round((assignedSec / 60) * 10) / 10;
    const totalMin = Math.round((totalSec / 60) * 10) / 10;
    const diffMin = Math.round((Math.abs(diffSec) / 60) * 10) / 10;

    if (diffSec === 0) {
      balanceBar.classList.add('balanced');
      infoSpan.textContent = `⏱ Distribuido: ${assignedMin} / ${totalMin} min (completo)`;
    } else if (diffSec > 0) {
      balanceBar.classList.add('remaining');
      infoSpan.textContent = `⏱ Asignado: ${assignedMin} / ${totalMin} min · Faltan ${diffMin} min`;
    } else {
      balanceBar.classList.add('over');
      infoSpan.textContent = `⏱ Asignado: ${assignedMin} / ${totalMin} min · Excede por ${diffMin} min`;
    }

    const equalizeBtn = document.createElement('button');
    equalizeBtn.className = 'step-equalize-btn';
    equalizeBtn.type = 'button';
    equalizeBtn.title = 'Repartir el tiempo total en partes iguales';
    equalizeBtn.textContent = '⚖️ Equilibrar';
    equalizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recalcStepTimes(task, true);
      saveDataToLocalStorage();
      renderTasks();
    });

    balanceBar.append(infoSpan, equalizeBtn);
    taskStepsDiv.appendChild(balanceBar);
  }

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

    const stepTimeSec = (task.stepTimes && typeof task.stepTimes[index] === 'number')
      ? task.stepTimes[index]
      : (task.totalTime && task.steps.length > 0 ? Math.floor(task.totalTime / task.steps.length) : 0);

    const timeBadge = document.createElement('button');
    timeBadge.type = 'button';
    timeBadge.className = 'step-time-badge';
    timeBadge.title = 'Editar minutos de este paso';
    timeBadge.textContent = formatStepTimeBadge(stepTimeSec);
    timeBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      inlineEditStepTime(task, index, timeBadge);
    });

    const deleteStepBtn = document.createElement('button');
    deleteStepBtn.textContent = '🗑';
    deleteStepBtn.addEventListener('click', () => {
      showConfirm(`¿Eliminar el paso "${step}"?`, () => {
        removeStep(task, index);
      });
    });

    stepButtons.append(timeBadge, deleteStepBtn);
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
function showGlobalSpeechBar() {
  let pill = document.getElementById('globalSpeechStopPill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'globalSpeechStopPill';
    pill.className = 'global-speech-pill';
    pill.innerHTML = '<span class="speech-wave">🔊 Leyendo...</span><button type="button" id="globalSpeechStopBtn" title="Detener narración">⏹ Detener</button>';
    document.body.appendChild(pill);
    const stopBtn = pill.querySelector('#globalSpeechStopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stopAllSpeechSynthesis();
      });
    }
  }
  pill.style.display = 'inline-flex';
}

function hideGlobalSpeechBar() {
  const pill = document.getElementById('globalSpeechStopPill');
  if (pill) pill.style.display = 'none';
}

let speechSessionId = 0;
let cachedNativeTtsLang = null;

function showVoiceNotice(msg) {
  if (!msg) return;
  try {
    let el = document.getElementById('efectivaVoiceNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'efectivaVoiceNotice';
      el.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:10099;background:rgba(15,23,42,0.95);color:#f8fafc;border:1px solid rgba(56,189,248,0.5);padding:9px 14px;border-radius:12px;font-size:0.82rem;max-width:88vw;text-align:center;box-shadow:0 10px 28px rgba(0,0,0,0.45);pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4200);
  } catch (_) {}
}

const __androidTtsWaiters = new Map();
window.__efectivaAndroidTtsEvent = function (utteranceId, type, errMsg) {
  const waiter = __androidTtsWaiters.get(utteranceId);
  if (!waiter) return;
  if (type === 'start') {
    if (typeof waiter.onStart === 'function') waiter.onStart();
    return;
  }
  __androidTtsWaiters.delete(utteranceId);
  if (type === 'error') {
    waiter.reject(new Error(errMsg || 'Error TTS Android'));
  } else {
    waiter.resolve({ type });
  }
};

function getDirectAndroidBridge() {
  try {
    const b = window.EfectivaAndroidBridge;
    return (b && typeof b.speak === 'function') ? b : null;
  } catch (_) {
    return null;
  }
}

function getCustomNativeTTSPlugin() {
  try {
    const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    const plugin = window.Capacitor?.Plugins?.EfectivaTts;
    return (isNative && plugin && typeof plugin.speak === 'function') ? plugin : null;
  } catch (_) {
    return null;
  }
}

function getCommunityNativeTTSPlugin() {
  try {
    const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    const plugin = window.Capacitor?.Plugins?.TextToSpeech;
    return (isNative && plugin && typeof plugin.speak === 'function') ? plugin : null;
  } catch (_) {
    return null;
  }
}

function updateAppVersionBadge() {
  try {
    const el = document.getElementById('appVersionBadge');
    if (!el) return;
    el.textContent = 'v41 · 🔊';
    el.title = 'Efectiva v34 — PiP blindado, Memoria por Nodos y Motor Financiero';
  } catch (_) {}
}
setTimeout(updateAppVersionBadge, 150);

// === MOTOR MP3 NEURAL OTA (Funciona en cualquier APK Android WebView sin reinstalar) ===
let __ttsAudioEl = null;
let __ttsAudioUnlocked = false;
const __ttsMp3Cache = new Map();

function getTtsAudioElement() {
  if (!__ttsAudioEl) {
    __ttsAudioEl = document.createElement('audio');
    __ttsAudioEl.id = 'efectivaTtsAudio';
    __ttsAudioEl.preload = 'auto';
    __ttsAudioEl.setAttribute('playsinline', '');
    __ttsAudioEl.style.display = 'none';
    if (document.body) document.body.appendChild(__ttsAudioEl);
  }
  return __ttsAudioEl;
}

function unlockTtsAudioElement() {
  if (__ttsAudioUnlocked) return;
  __ttsAudioUnlocked = true;
  try {
    const a = getTtsAudioElement();
    a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    a.volume = 0.01;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (a.src.startsWith('data:audio/wav')) a.pause();
        a.volume = 1.0;
      }).catch(() => {
        __ttsAudioUnlocked = false;
        a.volume = 1.0;
      });
    } else {
      a.volume = 1.0;
    }
  } catch (_) {
    __ttsAudioUnlocked = false;
  }
}
document.addEventListener('touchstart', unlockTtsAudioElement, { once: true, passive: true });
document.addEventListener('click', unlockTtsAudioElement, { once: true, passive: true });

async function fetchCloudTtsAudioSrc(chunkText) {
  const key = chunkText.trim();
  if (__ttsMp3Cache.has(key)) return __ttsMp3Cache.get(key);

  // Proveedor 1: Voz Neural Español Latino (es_mx_002) vía base64 MP3 (CORS abierto)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch('https://tiktok-tts.weilnet.workers.dev/api/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: key, voice: 'es_mx_002' }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data && json.data.length > 100) {
        const dataUri = 'data:audio/mp3;base64,' + json.data;
        if (__ttsMp3Cache.size >= 30) {
          const oldest = __ttsMp3Cache.keys().next().value;
          __ttsMp3Cache.delete(oldest);
        }
        __ttsMp3Cache.set(key, dataUri);
        return dataUri;
      }
    }
  } catch (_) {}

  // Proveedor 2 (Respaldo instantáneo): Google Translate TTS MP3 (funciona con <meta name="referrer" content="no-referrer">)
  return 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=' + encodeURIComponent(key);
}

function playSingleAudioSrc(audioEl, src, rate, mySession, guard) {
  return new Promise((resolve, reject) => {
    if (mySession !== speechSessionId || !guard()) {
      resolve({ stopped: true });
      return;
    }
    const cleanup = () => {
      audioEl.onended = null;
      audioEl.onerror = null;
      clearTimeout(safetyTimer);
    };
    const safetyTimer = setTimeout(() => {
      cleanup();
      resolve({ timeout: true });
    }, 28000);

    audioEl.onended = () => { cleanup(); resolve({ ok: true }); };
    audioEl.onerror = (e) => { cleanup(); reject(new Error('Audio MP3 error')); };
    audioEl.volume = 1.0;
    audioEl.src = src;
    try { audioEl.playbackRate = Math.max(0.75, Math.min(1.5, Number(rate) || 1.0)); } catch (_) {}
    const p = audioEl.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => { cleanup(); reject(err); });
    }
  });
}

async function speakViaCloudMp3(chunks, opts = {}, mySession) {
  const rate = opts.rate || 1.0;
  const onStart = opts.onStart;
  const onEnd = opts.onEnd;
  const guard = opts.guard || (() => true);
  const verbose = !!opts.verbose;
  const audioEl = getTtsAudioElement();

  if (!navigator.onLine) {
    if (verbose) showVoiceNotice('📴 Conectate a internet para reproducir la voz');
    if (typeof onEnd === 'function') onEnd();
    return;
  }

  try {
    showGlobalSpeechBar();
    if (typeof onStart === 'function') onStart();

    // Pre-cargar primer fragmento y mantener 1 fragmento adelantado (cero pausas entre oraciones)
    let nextPromise = fetchCloudTtsAudioSrc(chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      if (mySession !== speechSessionId || !guard()) break;
      const currentSrc = await nextPromise;
      if (i + 1 < chunks.length && mySession === speechSessionId && guard()) {
        nextPromise = fetchCloudTtsAudioSrc(chunks[i + 1]);
      }
      if (mySession !== speechSessionId || !guard()) break;

      try {
        await playSingleAudioSrc(audioEl, currentSrc, rate, mySession, guard);
      } catch (_) {
        // Si falló el proveedor 1 en reproducción, probar directo el respaldo Google MP3
        if (mySession !== speechSessionId || !guard()) break;
        const fallbackUrl = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=' + encodeURIComponent(chunks[i]);
        if (currentSrc !== fallbackUrl) {
          await playSingleAudioSrc(audioEl, fallbackUrl, rate, mySession, guard);
        }
      }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err || 'Error de audio');
    console.warn('[Cloud MP3 TTS]:', msg);
    if (verbose) showVoiceNotice('⚠️ No se pudo reproducir el audio (' + msg + ')');
  } finally {
    if (mySession === speechSessionId) {
      hideGlobalSpeechBar();
      if (typeof onEnd === 'function') onEnd();
    }
  }
}

function getNativeTTSPlugin() {
  return getDirectAndroidBridge() || getCustomNativeTTSPlugin() || getCommunityNativeTTSPlugin();
}

async function resolveNativeSpanishLang(tts) {
  if (cachedNativeTtsLang) return cachedNativeTtsLang;
  try {
    if (typeof tts.getSupportedLanguages === 'function') {
      const res = await tts.getSupportedLanguages();
      const langs = Array.isArray(res?.languages) ? res.languages : [];
      if (langs.length > 0) {
        const prefs = ['es-GT', 'es-MX', 'es-419', 'es-US', 'es-ES', 'es-AR', 'es-CO'];
        for (const p of prefs) {
          const hit = langs.find(l => String(l).toLowerCase() === p.toLowerCase());
          if (hit) { cachedNativeTtsLang = hit; return hit; }
        }
        const anyEs = langs.find(l => String(l).toLowerCase().startsWith('es'));
        if (anyEs) { cachedNativeTtsLang = anyEs; return anyEs; }
        cachedNativeTtsLang = langs[0];
        return langs[0];
      }
    }
  } catch (_) {}
  return 'es-ES';
}

function stopAllSpeechSynthesis(skipNativeStop = false) {
  speechSessionId++;
  // Resolver cualquier waiter pendiente del puente directo Android
  __androidTtsWaiters.forEach((w) => { try { w.resolve({ type: 'stop' }); } catch (_) {} });
  __androidTtsWaiters.clear();
  if (!skipNativeStop) {
    const directBridge = getDirectAndroidBridge();
    if (directBridge && typeof directBridge.stop === 'function') {
      try { directBridge.stop(); } catch (_) {}
    }
    const customTts = getCustomNativeTTSPlugin();
    if (customTts && typeof customTts.stop === 'function') {
      try { customTts.stop().catch(() => {}); } catch (_) {}
    }
    const commTts = getCommunityNativeTTSPlugin();
    if (commTts && typeof commTts.stop === 'function') {
      try { commTts.stop().catch(() => {}); } catch (_) {}
    }
  }
  if (__ttsAudioEl) {
    try {
      __ttsAudioEl.onended = null;
      __ttsAudioEl.onerror = null;
      __ttsAudioEl.pause();
      __ttsAudioEl.removeAttribute('src');
    } catch (_) {}
  }
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
  hideGlobalSpeechBar();
}
window.stopAllSpeechSynthesis = stopAllSpeechSynthesis;

// Motor unificado de voz (v31: EfectivaAndroidBridge directo -> EfectivaTts -> TextToSpeech -> Web Speech API)
window.EfectivaTTS = {
  isNativeAvailable() {
    return !!getNativeTTSPlugin();
  },
  stop: () => stopAllSpeechSynthesis(false),
  async speakChunks(chunks, opts = {}) {
    if (!Array.isArray(chunks) || chunks.length === 0) return;
    const rate = opts.rate || 1.0;
    const onStart = opts.onStart;
    const onEnd = opts.onEnd;
    const guard = opts.guard || (() => true);
    const verbose = !!opts.verbose;

    // 0) Prioridad absoluta: puente directo @JavascriptInterface EfectivaAndroidBridge (inmune a SW y Capacitor origin rules)
    const directBridge = getDirectAndroidBridge();
    if (directBridge) {
      stopAllSpeechSynthesis(true);
      const mySession = speechSessionId;
      try {
        if (typeof directBridge.getStatusJson === 'function') {
          const st = JSON.parse(directBridge.getStatusJson() || '{}');
          if (typeof st.mediaVolume === 'number' && st.mediaVolume === 0) {
            showVoiceNotice('🔇 Subí el volumen multimedia del teléfono para escuchar la voz');
          }
        }
      } catch (_) {}

      let startedNotified = false;
      try {
        showGlobalSpeechBar();
        for (let i = 0; i < chunks.length; i++) {
          if (mySession !== speechSessionId || !guard()) break;
          const uid = 'ef_' + mySession + '_' + i + '_' + Date.now();
          await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              __androidTtsWaiters.delete(uid);
              resolve({ type: 'timeout' });
            }, 35000);
            __androidTtsWaiters.set(uid, {
              onStart: () => {
                if (!startedNotified && typeof onStart === 'function') {
                  startedNotified = true;
                  onStart();
                }
              },
              resolve: (val) => { clearTimeout(timeoutId); resolve(val); },
              reject: (err) => { clearTimeout(timeoutId); reject(err); }
            });
            directBridge.speak(chunks[i], Number(rate) || 1.0, uid);
          });
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Error TTS');
        console.warn('[EfectivaAndroidBridge]:', msg);
        if (verbose) showVoiceNotice('⚠️ Voz Android: ' + msg);
      } finally {
        if (mySession === speechSessionId) {
          hideGlobalSpeechBar();
          if (typeof onEnd === 'function') onEnd();
        }
      }
      return;
    }

    // 1) Respaldo nativo: Plugin Capacitor EfectivaTts
    const customTts = getCustomNativeTTSPlugin();
    if (customTts) {
      stopAllSpeechSynthesis(true);
      const mySession = speechSessionId;
      try {
        if (typeof customTts.getStatus === 'function') {
          const st = await customTts.getStatus().catch(() => null);
          if (st && typeof st.mediaVolume === 'number' && st.mediaVolume === 0) {
            showVoiceNotice('🔇 Subí el volumen multimedia del teléfono para escuchar la voz');
          }
        }
        if (mySession !== speechSessionId || !guard()) return;
        showGlobalSpeechBar();
        if (typeof onStart === 'function') onStart();
        for (const chunk of chunks) {
          if (mySession !== speechSessionId || !guard()) break;
          await customTts.speak({ text: chunk, rate, pitch: 1.0, volume: 1.0 });
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Error de voz');
        console.warn('[EfectivaTTS nativo]:', msg);
        if (verbose) showVoiceNotice('⚠️ Voz Android: ' + msg);
      } finally {
        if (mySession === speechSessionId) {
          hideGlobalSpeechBar();
          if (typeof onEnd === 'function') onEnd();
        }
      }
      return;
    }

    // 2) Respaldo: Plugin comunitario TextToSpeech
    const commTts = getCommunityNativeTTSPlugin();
    if (commTts) {
      stopAllSpeechSynthesis(true);
      const mySession = speechSessionId;
      try {
        if (typeof commTts.stop === 'function') {
          await commTts.stop().catch(() => {});
        }
        const lang = await resolveNativeSpanishLang(commTts);
        if (mySession !== speechSessionId || !guard()) return;
        showGlobalSpeechBar();
        if (typeof onStart === 'function') onStart();
        for (const chunk of chunks) {
          if (mySession !== speechSessionId || !guard()) break;
          await commTts.speak({ text: chunk, lang, rate, pitch: 1.0, volume: 1.0, category: 'playback' });
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Error TTS');
        console.warn('[TextToSpeech]:', msg);
        if (verbose) showVoiceNotice('⚠️ Voz APK: ' + msg);
      } finally {
        if (mySession === speechSessionId) {
          hideGlobalSpeechBar();
          if (typeof onEnd === 'function') onEnd();
        }
      }
      return;
    }

    // 3) En APK Capacitor (Android WebView) o visores sin speechSynthesis real: usar Motor MP3 Neural OTA directo (sin reinstalar APK)
    stopAllSpeechSynthesis(true);
    const mySession = speechSessionId;
    const isCapacitorWebView = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    if (isCapacitorWebView || !('speechSynthesis' in window)) {
      await speakViaCloudMp3(chunks, opts, mySession);
      return;
    }
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (_) {}

    let idx = 0;
    function speakNextWebChunk() {
      if (mySession !== speechSessionId || !guard()) {
        hideGlobalSpeechBar();
        return;
      }
      if (idx >= chunks.length) {
        hideGlobalSpeechBar();
        if (typeof onEnd === 'function') onEnd();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[idx]);
      u.lang = opts.lang || 'es-AR';
      u.rate = rate;
      if (opts.voice) u.voice = opts.voice;
      u.onstart = () => {
        if (mySession === speechSessionId && guard()) {
          showGlobalSpeechBar();
          if (idx === 0 && typeof onStart === 'function') onStart();
        } else {
          stopAllSpeechSynthesis();
        }
      };
      u.onend = () => {
        idx++;
        speakNextWebChunk();
      };
      u.onerror = () => {
        // Si speechSynthesis falla en este navegador móvil, caer automáticamente al Motor MP3 Neural OTA
        if (mySession === speechSessionId && guard()) {
          speakViaCloudMp3(chunks.slice(idx), opts, mySession);
        }
      };
      window.speechSynthesis.speak(u);
    }
    speakNextWebChunk();
  }
};

function speakAudioCoach(text) {
  if (!audioCoachConfig.habilitado) return;
  const chunks = (typeof splitTextForSpeech === 'function') ? splitTextForSpeech(text, 240) : [String(text || '')];
  if (chunks.length === 0) return;
  window.EfectivaTTS.speakChunks(chunks, { rate: 1.0, lang: 'es-AR' });
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

// === PLANTILLAS DE USUARIO PERSONALIZADAS ===
const USER_TEMPLATES_KEY = 'efectivaUserTemplatesV1';
let userTemplates = [];

function loadUserTemplates() {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY);
    userTemplates = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(userTemplates)) userTemplates = [];
  } catch (e) { userTemplates = []; }
}

function saveUserTemplates() {
  try {
    localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(userTemplates));
  } catch (e) {}
}
loadUserTemplates();

function saveTaskAsTemplate(task, templateName, extraMeta = {}) {
  if (!task) return null;
  const tpl = {
    id: '_tpl_' + Math.random().toString(36).substr(2, 9),
    name: (templateName && templateName.trim()) ? templateName.trim() : (task.name || 'Plantilla sin nombre'),
    steps: Array.isArray(task.steps) ? [...task.steps] : [],
    totalTime: task.totalTime || null,
    stepTimes: Array.isArray(task.stepTimes) ? [...task.stepTimes] : [],
    hasCustomStepTimes: !!task.hasCustomStepTimes,
    color: task.color || null,
    priority: task.priority || null,
    gratitudeFormat: extraMeta.gratitudeFormat !== undefined ? extraMeta.gratitudeFormat : (task.gratitudeFormat || ''),
    dimensions: extraMeta.dimensions || task.dimensions || {
      cuerpo: '',
      mente: '',
      emociones: '',
      espiritu: ''
    },
    createdAt: Date.now()
  };
  userTemplates.unshift(tpl);
  saveUserTemplates();
  renderUserTemplatesPanel();
  return tpl;
}

function applyUserTemplate(templateId, targetFolderId, options = {}) {
  const tpl = userTemplates.find(t => t.id === templateId);
  if (!tpl) return null;
  const folder = folders.find(f => f.id === (targetFolderId || currentFolderId));
  if (!folder || folder.isDefaultRewards) return null;

  const newTask = {
    id: generateId(),
    name: (options.nombre_personalizado && String(options.nombre_personalizado).trim()) ? String(options.nombre_personalizado).trim() : tpl.name,
    steps: Array.isArray(tpl.steps) ? [...tpl.steps] : [],
    isExpanded: true,
    scheduledTimestamp: null,
    isReward: false,
    currentStepIndex: 0,
    totalTime: tpl.totalTime || null,
    stepTimes: Array.isArray(tpl.stepTimes) ? [...tpl.stepTimes] : [],
    hasCustomStepTimes: !!tpl.hasCustomStepTimes,
    color: tpl.color || undefined,
    priority: tpl.priority || undefined,
    dueDate: options.fecha_iso !== undefined ? (options.fecha_iso || null) : null,
    gratitudeFormat: tpl.gratitudeFormat || '',
    dimensions: tpl.dimensions ? { ...tpl.dimensions } : undefined
  };
  if (newTask.totalTime && newTask.steps.length > 0 && (!newTask.stepTimes || newTask.stepTimes.length !== newTask.steps.length)) {
    recalcStepTimes(newTask, true);
  }
  if (options.posicion !== undefined && options.posicion !== null && !isNaN(Number(options.posicion))) {
    const pos = Math.max(0, Math.min(folder.tasks.length, Number(options.posicion)));
    folder.tasks.splice(pos, 0, newTask);
  } else {
    folder.tasks.push(newTask);
  }
  saveDataToLocalStorage();
  if (currentFolderId === folder.id) renderTasks();
  renderFolders();
  return newTask;
}

function deleteUserTemplate(templateId) {
  userTemplates = userTemplates.filter(t => t.id !== templateId);
  saveUserTemplates();
  renderUserTemplatesPanel();
}

function renderUserTemplatesPanel() {
  const panel = document.getElementById('userTemplatesPanel');
  if (!panel) return;
  panel.innerHTML = '';

  if (userTemplates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'user-templates-empty';
    empty.textContent = 'Aún no tienes plantillas guardadas. Abre el menú (⋮) de cualquier tarea y elige "📌 Guardar plantilla".';
    panel.appendChild(empty);
    return;
  }

  userTemplates.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'user-template-card';
    if (tpl.color) card.style.borderLeft = `4px solid ${tpl.color}`;

    const info = document.createElement('div');
    info.className = 'user-template-info';

    const title = document.createElement('div');
    title.className = 'user-template-title';
    title.textContent = tpl.name;

    const metaParts = [];
    metaParts.push(`${(tpl.steps || []).length} pasos`);
    if (tpl.totalTime) metaParts.push(`${Math.round((tpl.totalTime / 60) * 10) / 10} min`);
    if (tpl.priority) metaParts.push(`Prioridad: ${tpl.priority}`);
    const meta = document.createElement('div');
    meta.className = 'user-template-meta';
    meta.textContent = metaParts.join(' · ');

    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'user-template-actions';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'user-template-apply-btn';
    applyBtn.textContent = '+ Aplicar';
    applyBtn.addEventListener('click', () => {
      applyUserTemplate(tpl.id, currentFolderId);
      panel.style.display = 'none';
      const tabTask = document.getElementById('modeTabTask');
      const tabTpl = document.getElementById('modeTabTemplates');
      if (tabTask && tabTpl) {
        tabTpl.classList.remove('active');
        tabTask.classList.add('active');
        const taskForm = document.getElementById('taskCreationForm');
        if (taskForm) taskForm.style.display = '';
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'user-template-del-btn';
    delBtn.title = 'Eliminar plantilla';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => {
      deleteUserTemplate(tpl.id);
    });

    actions.append(applyBtn, delBtn);
    card.append(info, actions);
    panel.appendChild(card);
  });
}

// === REGLAS DE AUTOMATIZACIÓN EXPANDIDAS ===
function triggerAutomationEvent(eventType, payload) {
  if (!Array.isArray(automationRules) || automationRules.length === 0) return;
  automationRules.forEach(rule => {
    if (rule.activa === false) return;
    if (rule.evento !== eventType) return;
    if (rule.condicion) {
      if (rule.condicion.carpeta_id && payload.folderId && rule.condicion.carpeta_id !== payload.folderId) return;
      if (rule.condicion.prioridad && payload.task && rule.condicion.prioridad !== payload.task.priority) return;
      if (rule.condicion.tarea_id && payload.task && rule.condicion.tarea_id !== payload.task.id) return;
      if (rule.condicion.paso_indice !== undefined && rule.condicion.paso_indice !== null && payload.stepIndex !== undefined) {
        if (Number(rule.condicion.paso_indice) !== Number(payload.stepIndex)) return;
      }
      if (rule.condicion.paso_contiene && payload.stepText !== undefined) {
        const needle = String(rule.condicion.paso_contiene).toLowerCase();
        if (!String(payload.stepText).toLowerCase().includes(needle)) return;
      }
    }
    try {
      const params = rule.parametros_accion || {};
      if (rule.accion_automatica === 'crear_recompensa') {
        const rewardsFolder = folders.find(f => f.isDefaultRewards);
        if (rewardsFolder) {
          rewardsFolder.tasks.push({
            id: '_' + Math.random().toString(36).substr(2, 9),
            name: params.nombre || '🎮 Recompensa Automática',
            steps: [],
            isExpanded: false,
            scheduledTimestamp: null,
            totalTime: params.tiempo_minutos ? params.tiempo_minutos * 60 : null,
            rewardTime: params.tiempo_minutos || null,
            isReward: true,
            currentStepIndex: 0
          });
          saveDataToLocalStorage();
          if (typeof renderFolders === 'function') renderFolders();
          if (currentFolderId === rewardsFolder.id && typeof renderTasks === 'function') renderTasks();
        }
      } else if (rule.accion_automatica === 'asignar_prioridad' && payload.task) {
        payload.task.priority = params.nueva_prioridad || params.prioridad || 'alta';
        saveDataToLocalStorage();
        if (typeof renderTasks === 'function') renderTasks();
      } else if (rule.accion_automatica === 'asignar_color' && payload.task) {
        payload.task.color = normalizePastelColor(params.nuevo_color || params.color || '#F2B8C6') || '#F2B8C6';
        saveDataToLocalStorage();
        if (typeof renderTasks === 'function') renderTasks();
      } else if (rule.accion_automatica === 'crear_tarea') {
        const targetFolder = folders.find(f => f.id === (params.carpeta_destino_id || payload.folderId) && !f.isDefaultRewards);
        if (targetFolder) {
          const stepsArr = Array.isArray(params.pasos) ? params.pasos.map(s => String(s)) : [];
          const totalSec = params.tiempo_minutos ? Number(params.tiempo_minutos) * 60 : null;
          const newTask = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            name: params.nombre || 'Nueva tarea automática',
            steps: stepsArr,
            isExpanded: false,
            scheduledTimestamp: null,
            totalTime: totalSec,
            stepTimes: [],
            isReward: false,
            currentStepIndex: 0,
            priority: params.prioridad || undefined,
            color: params.color || undefined
          };
          if (totalSec && stepsArr.length > 0 && typeof recalcStepTimes === 'function') {
            recalcStepTimes(newTask, true);
          }
          targetFolder.tasks.push(newTask);
          saveDataToLocalStorage();
          if (typeof renderFolders === 'function') renderFolders();
          if (currentFolderId === targetFolder.id && typeof renderTasks === 'function') renderTasks();
        }
      } else if (rule.accion_automatica === 'mover_tarea' && payload.task && params.carpeta_destino_id) {
        const srcFolder = folders.find(f => f.id === payload.folderId);
        const destFolder = folders.find(f => f.id === params.carpeta_destino_id && !f.isDefaultRewards);
        if (srcFolder && destFolder && srcFolder.id !== destFolder.id) {
          const idx = (srcFolder.tasks || []).findIndex(t => t.id === payload.task.id);
          if (idx !== -1) {
            const [moved] = srcFolder.tasks.splice(idx, 1);
            destFolder.tasks.push(moved);
            saveDataToLocalStorage();
            if (typeof renderFolders === 'function') renderFolders();
            if ((currentFolderId === srcFolder.id || currentFolderId === destFolder.id) && typeof renderTasks === 'function') {
              renderTasks();
            }
          }
        }
      } else if (rule.accion_automatica === 'iniciar_presentacion_tarea') {
        const targetId = params.tarea_id || (payload.task && payload.task.id);
        let foundTask = null;
        let foundFolderId = payload.folderId;
        for (const f of folders) {
          const t = (f.tasks || []).find(x => x.id === targetId);
          if (t) { foundTask = t; foundFolderId = f.id; break; }
        }
        if (foundTask && Array.isArray(foundTask.steps) && foundTask.steps.length > 0) {
          if (params.paso_indice !== undefined && params.paso_indice !== null) {
            foundTask.currentStepIndex = Math.max(0, Math.min(foundTask.steps.length - 1, Number(params.paso_indice) || 0));
          }
          if (typeof openFolder === 'function') openFolder(foundFolderId);
          if (typeof startPresentation === 'function') startPresentation(foundTask);
        }
      } else if (rule.accion_automatica === 'siguiente_paso') {
        if (presentationOpen && typeof nextStep === 'function') {
          nextStep(true);
        }
      } else if (rule.accion_automatica === 'aplicar_plantilla' && params.plantilla_id) {
        if (typeof applyUserTemplate === 'function') {
          applyUserTemplate(params.plantilla_id, params.carpeta_destino_id || payload.folderId);
        }
      }
    } catch(err) {
      console.warn('Error al ejecutar regla de automatización:', err);
    }
  });
}

function dedupeTaskAcrossFolders(taskId) {
  if (!taskId || !Array.isArray(folders)) return;
  folders.forEach(f => {
    if (Array.isArray(f.tasks)) f.tasks = f.tasks.filter(t => t && t.id !== taskId);
    if (Array.isArray(f.finished)) f.finished = f.finished.filter(t => t && t.id !== taskId);
  });
}
window.dedupeTaskAcrossFolders = dedupeTaskAcrossFolders;

function moveTaskToMiniFolder(folder, task) {
  dedupeTaskAcrossFolders(task.id);
  // FIX: si la carpeta no tiene array "finished" (datos legacy o importados), inicializarlo
  if (!Array.isArray(folder.finished)) folder.finished = [];

  if (task.reward) {
    const rewardsFolder = folders.find(f => f.id === rewardsFolderId);
    if (rewardsFolder) {
      rewardsFolder.tasks.unshift(task);
    }
  } else {
    task.completedAt = new Date().toISOString();
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
  t.currentStepIndex = 0;
  dedupeTaskAcrossFolders(taskId);
  folder.tasks.push(t);
  saveDataToLocalStorage();
  renderTasks();
}

/************************************************************************
 * PASOS
 ************************************************************************/
function formatStepTimeBadge(sec) {
  if (!sec || sec <= 0) return '⏱ 0m';
  if (sec < 60) return `⏱ ${sec}s`;
  const mins = Math.round((sec / 60) * 10) / 10;
  return `⏱ ${mins}m`;
}

function setStepTimeMinutes(task, stepIndex, minutes) {
  if (!task || !Array.isArray(task.steps) || stepIndex < 0 || stepIndex >= task.steps.length) return false;
  if (!Array.isArray(task.stepTimes) || task.stepTimes.length !== task.steps.length) {
    const fallback = (task.totalTime && task.steps.length > 0) ? Math.floor(task.totalTime / task.steps.length) : 0;
    task.stepTimes = task.steps.map((_, idx) =>
      (task.stepTimes && typeof task.stepTimes[idx] === 'number') ? task.stepTimes[idx] : fallback
    );
  }
  const sec = Math.max(0, Math.round(Number(minutes) * 60));
  task.stepTimes[stepIndex] = sec;
  task.hasCustomStepTimes = true;
  if (!task.totalTime && sec > 0) {
    task.totalTime = task.stepTimes.reduce((a, b) => a + (Number(b) || 0), 0);
  }
  saveDataToLocalStorage();
  return true;
}

function inlineEditStepTime(task, stepIndex, badgeBtn) {
  const currentSec = (task.stepTimes && typeof task.stepTimes[stepIndex] === 'number') ? task.stepTimes[stepIndex] : 0;
  const currentMin = Math.round((currentSec / 60) * 10) / 10;

  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.5';
  input.min = '0';
  input.className = 'step-time-input';
  input.value = String(currentMin);
  input.title = 'Minutos para este paso';

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      setStepTimeMinutes(task, stepIndex, val);
    }
    renderTasks();
  };

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      committed = true;
      renderTasks();
    }
  });
  input.addEventListener('blur', commit);

  badgeBtn.replaceWith(input);
  input.focus();
  input.select();
}

function recalcStepTimes(task, force = false) {
  if (!task || !Array.isArray(task.steps)) return;
  if (!force && task.hasCustomStepTimes && Array.isArray(task.stepTimes) && task.stepTimes.length === task.steps.length) {
    return;
  }
  if (task.totalTime && task.steps.length > 0) {
    const allocated = Math.floor(task.totalTime / task.steps.length);
    task.stepTimes = [];
    for (let i = 0; i < task.steps.length; i++) {
      task.stepTimes.push(allocated);
    }
    task.hasCustomStepTimes = false;
  } else {
    task.stepTimes = task.steps.map(() => 0);
    task.hasCustomStepTimes = false;
  }
}

function addNewStep(task, inputElem) {
  const text = inputElem.value.trim();
  if (text) {
    task.steps.push(text);
    inputElem.value = '';
    if (task.hasCustomStepTimes && Array.isArray(task.stepTimes)) {
      task.stepTimes.push(0);
    } else if (task.totalTime) {
      recalcStepTimes(task, true);
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
  if (task.hasCustomStepTimes && Array.isArray(task.stepTimes)) {
    task.stepTimes.splice(stepIndex, 1);
  } else if (task.totalTime) {
    recalcStepTimes(task, true);
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
 * PRESENTACIÓN (MODO TIKTOK VERTICAL & ESCALA DINÁMICA)
 ************************************************************************/
const ACTIVE_PRESENTATION_KEY = 'efectivaActivePresentationV1';
let isPresentationTransitioning = false;
let presentationTouchStartY = 0;
let presentationTouchStartX = 0;
let presentationTouchCurrentY = 0;
let presentationTouchStartTime = 0;
let isPresentationDragging = false;
let lastSwipeTime = 0;
let presentationStepStartedAt = null;
let presentationBaseSeconds = 0;
let presentationAlarmFired = false;

function saveActivePresentationState() {
  if (!presentationOpen || !currentPresentationTask) return;
  try {
    const state = {
      folderId: currentFolderId,
      taskId: currentPresentationTask.id,
      currentStepIndex,
      hasTotalTime: Boolean(currentPresentationTask.totalTime),
      baseStepSeconds: presentationBaseSeconds,
      stepStartedAt: presentationStepStartedAt,
      alarmFired: presentationAlarmFired,
      folderPlayFolderId,
      folderPlayQueue,
      folderPlayIndex,
      folderPlayOriginalLength,
      savedAt: Date.now()
    };
    localStorage.setItem(ACTIVE_PRESENTATION_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar estado de presentación:', e);
  }
}

function clearActivePresentationState() {
  try {
    localStorage.removeItem(ACTIVE_PRESENTATION_KEY);
  } catch (e) {}
}

function restoreActivePresentationIfAny() {
  try {
    const raw = localStorage.getItem(ACTIVE_PRESENTATION_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (!state || !state.taskId || !state.folderId) {
      clearActivePresentationState();
      return;
    }
    const folder = folders.find(f => f.id === state.folderId);
    if (!folder) {
      clearActivePresentationState();
      return;
    }
    const task = (folder.tasks || []).find(t => t.id === state.taskId);
    if (!task || !task.steps || !task.steps.length) {
      clearActivePresentationState();
      return;
    }

    currentFolderId = folder.id;
    folderPlayFolderId = state.folderPlayFolderId || null;
    folderPlayQueue = Array.isArray(state.folderPlayQueue) ? state.folderPlayQueue : [];
    folderPlayIndex = typeof state.folderPlayIndex === 'number' ? state.folderPlayIndex : 0;
    folderPlayOriginalLength = typeof state.folderPlayOriginalLength === 'number' ? state.folderPlayOriginalLength : 0;

    // Mostrar la carpeta detrás del modal para que al cerrar quede en el lugar correcto
    if (typeof openFolder === 'function') {
      openFolder(folder.id);
    }
    startPresentation(task, state);
  } catch (e) {
    console.warn('Error restaurando presentación:', e);
    clearActivePresentationState();
  }
}

function extractStepText(rawStep) {
  if (typeof rawStep === 'string') return rawStep.trim();
  if (rawStep && typeof rawStep === 'object') {
    const direct = rawStep.text ?? rawStep.texto ?? rawStep.descripcion ?? rawStep.description ?? rawStep.title ?? rawStep.titulo ?? rawStep.content ?? rawStep.contenido ?? rawStep.name ?? rawStep.nombre ?? rawStep.paso ?? rawStep.step ?? rawStep.label;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    for (const v of Object.values(rawStep)) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

function startPresentation(task, restoredState = null) {
  if (!task || !Array.isArray(task.steps) || !task.steps.length) return;
  presentationSteps = task.steps;
  const rawIdx = restoredState ? Number(restoredState.currentStepIndex) : Number(task.currentStepIndex);
  currentStepIndex = (Number.isFinite(rawIdx) && rawIdx >= 0 && rawIdx < task.steps.length) ? Math.floor(rawIdx) : 0;
  task.currentStepIndex = currentStepIndex;
  presentationOpen = true;
  currentPresentationTask = task;
  isPresentationTransitioning = false;
  isPresentationDragging = false;

  // Garantizar estado visual limpio (nunca heredar posición PiP ni opacidad 0 de una sesión previa)
  if (isPresentationMinimized) {
    isPresentationMinimized = false;
    teardownMinimizedDrag();
  }
  presentationModal.classList.remove('minimized');
  presentationModal.style.left = '';
  presentationModal.style.top = '';
  presentationModal.style.right = '';
  presentationModal.style.bottom = '';
  presentationModal.style.width = '';
  presentationModal.style.height = '';
  presentationModal.style.transform = '';
  presentationStep.style.opacity = '1';
  presentationStep.style.transform = 'translateY(0px)';
  presentationStep.style.transition = '';

  if (task.totalTime && task.steps.length > 0) {
    if (!task.stepTimes || task.stepTimes.length !== task.steps.length) {
      recalcStepTimes(task);
    }
    if (restoredState && typeof restoredState.baseStepSeconds === 'number' && restoredState.stepStartedAt) {
      presentationBaseSeconds = restoredState.baseStepSeconds;
      presentationStepStartedAt = restoredState.stepStartedAt;
      presentationAlarmFired = Boolean(restoredState.alarmFired);
      const elapsed = Math.floor((Date.now() - presentationStepStartedAt) / 1000);
      currentStepCountdown = presentationBaseSeconds - elapsed;
    } else {
      presentationBaseSeconds = task.stepTimes[currentStepIndex] || 0;
      presentationStepStartedAt = Date.now();
      presentationAlarmFired = false;
      currentStepCountdown = presentationBaseSeconds;
    }
  } else {
    if (restoredState && typeof restoredState.baseStepSeconds === 'number' && restoredState.stepStartedAt) {
      presentationBaseSeconds = restoredState.baseStepSeconds;
      presentationStepStartedAt = restoredState.stepStartedAt;
      const elapsed = Math.floor((Date.now() - presentationStepStartedAt) / 1000);
      timerSeconds = presentationBaseSeconds + elapsed;
    } else {
      presentationBaseSeconds = 0;
      presentationStepStartedAt = Date.now();
      timerSeconds = 0;
    }
    presentationAlarmFired = false;
  }

  unlockStepAlarmAudio();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }
  stopAllSpeechSynthesis();
  presentationModal.style.display = 'flex';
  addMinimizeButton();
  setupDelayJustificationUI();
  updateLinkedNoteInPresentation();
  showPresentationStep('none');
  startTimer();
  if (task.totalTime && currentStepCountdown > 0) scheduleNativeStepAlarm(currentStepCountdown, presentationSteps[currentStepIndex]);
  saveActivePresentationState();
  if (window.EfectivaIdleAlarm && typeof window.EfectivaIdleAlarm.evaluate === 'function') {
    window.EfectivaIdleAlarm.evaluate(false);
  }

  // Limpiar y registrar listeners de interacción (click y swipe vertical)
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchmove', handleTouchMove);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.removeEventListener('touchcancel', handleTouchCancel);
  presentationModal.removeEventListener('mousedown', handleMouseDown);
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);

  presentationModal.addEventListener('click', handlePresentationClick);
  presentationModal.addEventListener('touchstart', handleTouchStart, { passive: true });
  presentationModal.addEventListener('touchmove', handleTouchMove, { passive: false });
  presentationModal.addEventListener('touchend', handleTouchEnd, { passive: true });
  presentationModal.addEventListener('touchcancel', handleTouchCancel, { passive: true });
  presentationModal.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);

  requestWakeLock();
}

/**
 * Actualiza el encabezado, contador y barra de progreso segmentada estilo TikTok/Stories.
 */
function updatePresentationUI() {
  const task = currentPresentationTask;
  if (!task) return;

  const taskNameEl = document.getElementById('presentationTaskName');
  const folderTagEl = document.getElementById('presentationFolderTag');
  if (taskNameEl) taskNameEl.textContent = task.name || 'Tarea';
  if (folderTagEl) {
    const folder = folders.find(f => f.id === currentFolderId);
    folderTagEl.textContent = folder ? folder.name : 'Efectiva';
  }

  const counterEl = document.getElementById('presentationStepCounter');
  if (counterEl) {
    counterEl.textContent = `Paso ${currentStepIndex + 1} de ${presentationSteps.length}`;
  }

  const progressContainer = document.getElementById('presentationProgressContainer');
  if (progressContainer) {
    progressContainer.innerHTML = '';
    const total = presentationSteps.length;
    for (let i = 0; i < total; i++) {
      const seg = document.createElement('div');
      seg.className = 'presentation-progress-segment';
      if (i < currentStepIndex) {
        seg.classList.add('completed');
      } else if (i === currentStepIndex) {
        seg.classList.add('active');
      }
      progressContainer.appendChild(seg);
    }
  }
}

/**
 * Click / Tap: si se pulsa a la derecha avanza, a la izquierda retrocede.
 */
function handlePresentationClick(e) {
  if (e.target && e.target.closest && ((e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer')) || (e.target.closest('#presentationAudioCoachBtn') || e.target.closest('#presentationReplayVoiceBtn')) || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer'))) return;
  if (isPresentationMinimized || isPresentationTransitioning) return;

  // Si acaba de ocurrir un swipe, descartar el clic sintético que emite el navegador móvil
  if (Date.now() - lastSwipeTime < 450) return;

  const now = Date.now();
  if (now - lastPresentationInteraction < PRESENTATION_DEBOUNCE_MS) return;
  lastPresentationInteraction = now;

  const halfWidth = window.innerWidth / 2;
  if (e.clientX > halfWidth) {
    nextStep(true); // Clic derecho: avanzar
  } else {
    prevStep(true); // Clic izquierdo: retroceder
  }
}

/**
 * Manejadores de toque para swipe vertical estilo TikTok:
 * Deslizar hacia arriba (Swipe Up) -> Avanza al siguiente paso
 * Deslizar hacia abajo (Swipe Down) -> Regresa al paso anterior
 */
let presentationTouchInScrollableCard = false;

function handleTouchStart(e) {
  if (e.target && e.target.closest && ((e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer')) || (e.target.closest('#presentationAudioCoachBtn') || e.target.closest('#presentationReplayVoiceBtn')))) return;
  if (isPresentationMinimized || isPresentationTransitioning) return;

  if (e.touches && e.touches[0]) {
    presentationTouchStartX = e.touches[0].clientX;
    presentationTouchStartY = e.touches[0].clientY;
    presentationTouchCurrentY = presentationTouchStartY;
    presentationTouchStartTime = Date.now();
    isPresentationDragging = false;
    presentationTouchInScrollableCard = Boolean(
      e.target && e.target.closest && e.target.closest('#presentationStep') &&
      presentationStep && (presentationStep.scrollHeight > presentationStep.clientHeight + 4)
    );
  }
}

function handleTouchMove(e) {
  if (isPresentationMinimized || isPresentationTransitioning) return;
  if (!e.touches || !e.touches[0]) return;

  const currentX = e.touches[0].clientX;
  const currentY = e.touches[0].clientY;
  const dx = currentX - presentationTouchStartX;
  const dy = currentY - presentationTouchStartY;

  // Si el texto es largo y tiene mini-scroll disponible en la dirección del dedo, dejar scrollear el texto
  if (!isPresentationDragging && presentationTouchInScrollableCard && presentationStep) {
    const atTop = presentationStep.scrollTop <= 4;
    const atBottom = (presentationStep.scrollTop + presentationStep.clientHeight) >= (presentationStep.scrollHeight - 4);
    if ((dy < 0 && !atBottom) || (dy > 0 && !atTop)) {
      lastSwipeTime = Date.now(); // evita que al soltar tras scrollear se dispare un clic
      return;
    }
  }

  // Detección de arrastre vertical dominante
  if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) {
    isPresentationDragging = true;
    presentationTouchCurrentY = currentY;

    // Resistencia si estamos en los límites
    let effectiveDy = dy;
    if ((currentStepIndex === 0 && dy > 0) || (currentStepIndex === presentationSteps.length - 1 && dy < 0)) {
      effectiveDy = dy * 0.35;
    }

    presentationStep.style.transition = 'none';
    presentationStep.style.transform = `translateY(${effectiveDy}px)`;
    presentationStep.style.opacity = `${Math.max(0.45, 1 - Math.abs(dy) / 450)}`;

    if (e.cancelable) e.preventDefault();
  }
}

function handleTouchEnd(e) {
  if (e.target && e.target.closest && ((e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer')) || (e.target.closest('#presentationAudioCoachBtn') || e.target.closest('#presentationReplayVoiceBtn')))) return;
  if (isPresentationMinimized) return;

  if (isPresentationDragging) {
    lastSwipeTime = Date.now();
    isPresentationDragging = false;

    const dy = presentationTouchCurrentY - presentationTouchStartY;
    const dt = Math.max(1, Date.now() - presentationTouchStartTime);
    const velocityY = dy / dt;

    // Umbral de swipe vertical
    const isSwipeUp = dy < -45 || (dy < -20 && velocityY < -0.4);
    const isSwipeDown = dy > 45 || (dy > 20 && velocityY > 0.4);

    if (isSwipeUp) {
      // Arrastrar hacia arriba: avanza al siguiente paso (estilo TikTok)
      nextStep(true);
    } else if (isSwipeDown) {
      // Arrastrar hacia abajo: retrocede al paso anterior
      if (currentStepIndex > 0) {
        prevStep(true);
      } else {
        // En el primer paso, regresar al centro suavemente
        presentationStep.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
        presentationStep.style.transform = 'translateY(0px)';
        presentationStep.style.opacity = '1';
      }
    } else {
      // No alcanzó el umbral -> regresar a posición original
      presentationStep.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
      presentationStep.style.transform = 'translateY(0px)';
      presentationStep.style.opacity = '1';
    }
  }
}

function handleTouchCancel() {
  if (isPresentationDragging) {
    isPresentationDragging = false;
    presentationStep.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
    presentationStep.style.transform = 'translateY(0px)';
    presentationStep.style.opacity = '1';
  }
}

/**
 * Soporte de arrastre vertical con ratón para pruebas en navegadores de escritorio
 */
let mouseStartY = 0;
let mouseStartX = 0;
let isMouseDragging = false;
let mouseStartTime = 0;

function handleMouseDown(e) {
  if (e.button !== 0) return;
  if (e.target && e.target.closest && ((e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer')) || (e.target.closest('#presentationAudioCoachBtn') || e.target.closest('#presentationReplayVoiceBtn')))) return;
  if (isPresentationMinimized || isPresentationTransitioning) return;
  mouseStartY = e.clientY;
  mouseStartX = e.clientX;
  mouseStartTime = Date.now();
  isMouseDragging = false;
}

function handleMouseMove(e) {
  if (!presentationOpen || isPresentationMinimized || isPresentationTransitioning) return;
  if (mouseStartY === 0) return;
  const dy = e.clientY - mouseStartY;
  const dx = e.clientX - mouseStartX;
  if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) {
    isMouseDragging = true;
    let effectiveDy = dy;
    if ((currentStepIndex === 0 && dy > 0) || (currentStepIndex === presentationSteps.length - 1 && dy < 0)) {
      effectiveDy = dy * 0.35;
    }
    presentationStep.style.transition = 'none';
    presentationStep.style.transform = `translateY(${effectiveDy}px)`;
    presentationStep.style.opacity = `${Math.max(0.45, 1 - Math.abs(dy) / 450)}`;
  }
}

function handleMouseUp(e) {
  if (!presentationOpen || isPresentationMinimized) {
    mouseStartY = 0;
    isMouseDragging = false;
    return;
  }
  if (mouseStartY === 0) return;
  const dy = e.clientY - mouseStartY;
  const dt = Math.max(1, Date.now() - mouseStartTime);
  const velocityY = dy / dt;
  mouseStartY = 0;

  if (isMouseDragging) {
    lastSwipeTime = Date.now();
    isMouseDragging = false;
    const isSwipeUp = dy < -45 || (dy < -20 && velocityY < -0.4);
    const isSwipeDown = dy > 45 || (dy > 20 && velocityY > 0.4);

    if (isSwipeUp) {
      nextStep(true);
    } else if (isSwipeDown) {
      if (currentStepIndex > 0) {
        prevStep(true);
      } else {
        presentationStep.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
        presentationStep.style.transform = 'translateY(0px)';
        presentationStep.style.opacity = '1';
      }
    } else {
      presentationStep.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
      presentationStep.style.transform = 'translateY(0px)';
      presentationStep.style.opacity = '1';
    }
  }
}

/**
 * Navega hacia atrás con animación vertical suave
 */
function prevStep(animated = true) {
  if (isPresentationTransitioning) return;
  if (currentStepIndex > 0) {
    if (!animated) {
      retreatStepData();
      showPresentationStep('none');
      return;
    }
    isPresentationTransitioning = true;
    // Animar salida hacia abajo
    presentationStep.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.2s ease';
    presentationStep.style.transform = 'translateY(70px)';
    presentationStep.style.opacity = '0';

    setTimeout(() => {
      retreatStepData();
      showPresentationStep('prev');
      setTimeout(() => {
        isPresentationTransitioning = false;
      }, 260);
    }, 180);
  }
}

/**
 * Navega hacia adelante con animación vertical suave
 */
function nextStep(animated = true) {
  if (isPresentationTransitioning) return;
  if (currentStepIndex < presentationSteps.length - 1) {
    if (!animated) {
      advanceStepData();
      showPresentationStep('none');
      return;
    }
    isPresentationTransitioning = true;
    // Animar salida hacia arriba
    presentationStep.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.2s ease';
    presentationStep.style.transform = 'translateY(-70px)';
    presentationStep.style.opacity = '0';

    setTimeout(() => {
      advanceStepData();
      showPresentationStep('next');
      setTimeout(() => {
        isPresentationTransitioning = false;
      }, 260);
    }, 180);
  } else {
    if (currentPresentationTask) {
      triggerAutomationEvent('paso_completado', {
        folderId: currentFolderId,
        task: currentPresentationTask,
        stepIndex: currentStepIndex,
        stepText: presentationSteps[currentStepIndex] || ''
      });
    }
    showCongratulations();
  }
}

function advanceStepData() {
  syncPresentationClock();
  const completedIdx = currentStepIndex;
  const completedText = presentationSteps[completedIdx] || '';
  if (currentPresentationTask && currentPresentationTask.totalTime) {
    const leftover = currentStepCountdown;
    currentStepIndex++;
    const baseTime = (currentPresentationTask.stepTimes && currentPresentationTask.stepTimes[currentStepIndex]) || 0;
    presentationBaseSeconds = baseTime + leftover;
    currentStepCountdown = presentationBaseSeconds;
  } else {
    currentStepIndex++;
  }
  presentationStepStartedAt = Date.now();
  presentationAlarmFired = false;
  stopStepOvertimeAlarm();
  if (currentPresentationTask) {
    currentPresentationTask.currentStepIndex = currentStepIndex;
    if (currentPresentationTask.totalTime && currentStepCountdown > 0) scheduleNativeStepAlarm(currentStepCountdown, presentationSteps[currentStepIndex]); else cancelNativeStepAlarm();
    triggerAutomationEvent('paso_completado', {
      folderId: currentFolderId,
      task: currentPresentationTask,
      stepIndex: completedIdx,
      stepText: completedText
    });
  }
  saveActivePresentationState();
}

function retreatStepData() {
  syncPresentationClock();
  if (currentPresentationTask && currentPresentationTask.totalTime) {
    const currentBaseTime = (currentPresentationTask.stepTimes && currentPresentationTask.stepTimes[currentStepIndex]) || 0;
    currentStepIndex--;
    const timeUsed = currentBaseTime - currentStepCountdown;
    const prevBaseTime = (currentPresentationTask.stepTimes && currentPresentationTask.stepTimes[currentStepIndex]) || 0;
    presentationBaseSeconds = prevBaseTime - timeUsed;
    currentStepCountdown = presentationBaseSeconds;
  } else {
    currentStepIndex--;
  }
  presentationStepStartedAt = Date.now();
  presentationAlarmFired = false;
  stopStepOvertimeAlarm();
  if (currentPresentationTask) {
    currentPresentationTask.currentStepIndex = currentStepIndex;
    if (currentPresentationTask.totalTime && currentStepCountdown > 0) scheduleNativeStepAlarm(currentStepCountdown, presentationSteps[currentStepIndex]); else cancelNativeStepAlarm();
  }
  saveActivePresentationState();
}

/**
 * Escala dinámica y verificación de viewport para que los textos
 * (incluso muy extensos) siempre se vean elegantes y nunca desborden.
 */
function fitPresentationText(el, text, opts) {
  opts = opts || {};
  const minFontRem = opts.minFontRem || 0.96;

  el.classList.remove('has-scroll');
  el.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'presentation-step-inner';
  inner.textContent = text || '(Paso sin texto)';
  el.appendChild(inner);
  el.scrollTop = 0;

  const len = (text || '').length;

  let fontRem;
  if (len < 30) {
    fontRem = 2.35;
  } else if (len < 75) {
    fontRem = 1.78;
  } else if (len < 180) {
    fontRem = 1.32;
  } else if (len < 420) {
    fontRem = 1.1;
  } else {
    fontRem = 1.02;
  }

  el.style.fontSize = fontRem + 'rem';
  el.style.lineHeight = len < 50 ? '1.32' : '1.5';
  el.style.letterSpacing = len < 30 ? '0.02em' : 'normal';
  el.style.wordBreak = 'break-word';
  el.style.overflowWrap = 'break-word';
  el.style.maxHeight = '';
  el.style.overflowY = 'auto';

  const measureAndFit = () => {
    const boxH = el.clientHeight || Math.max(220, (window.innerHeight || 800) * 0.55);
    let f = parseFloat(el.style.fontSize) || fontRem;
    let attempts = 0;
    while (el.scrollHeight > boxH + 4 && f > minFontRem && attempts < 18) {
      f = Math.max(minFontRem, Math.round((f - 0.08) * 100) / 100);
      el.style.fontSize = f + 'rem';
      attempts++;
    }
    const needsScroll = el.scrollHeight > (el.clientHeight + 6);
    el.classList.toggle('has-scroll', needsScroll);
    if (el === presentationStep) {
      const badge = document.getElementById('presentationScrollBadge');
      if (badge) badge.style.display = needsScroll ? 'inline-flex' : 'none';
    }
    return needsScroll;
  };

  const needsScroll = measureAndFit();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (el.isConnected && el.firstElementChild === inner) {
        measureAndFit();
      }
    });
  }

  return {
    finalFontRem: parseFloat(el.style.fontSize),
    chars: len,
    scrollHeight: el.scrollHeight,
    maxHeight: el.clientHeight,
    fit: !needsScroll
  };
}

let presentationAudioCoachEnabled = true;

function getCurrentPresentationStepText() {
  return extractStepText(presentationSteps[currentStepIndex]);
}

function splitTextForSpeech(text, maxLen = 160) {
  // Limpiar emojis, viñetas y símbolos para lectura natural y evitar superar límite UTF-8 de motores TTS
  const clean = String(text || '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/\[(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})\]/g, '$1 a $2.')
    .replace(/[→⇒]/g, ', ')
    .replace(/[—–·•]/g, '. ')
    .replace(/[*_#`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.split(/(?<=[.!?¡¿;:\n])\s+/);
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).trim().length <= maxLen) {
      buf = (buf + ' ' + s).trim();
    } else {
      if (buf) chunks.push(buf);
      if (s.length <= maxLen) {
        buf = s;
      } else {
        // Cortar frases muy largas sin puntuación por palabras
        const words = s.split(' ');
        let wBuf = '';
        for (const w of words) {
          if ((wBuf + ' ' + w).trim().length <= maxLen) {
            wBuf = (wBuf + ' ' + w).trim();
          } else {
            if (wBuf) chunks.push(wBuf);
            wBuf = w;
          }
        }
        buf = wBuf;
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function speakPresentationStep(stepText, forceReplay = false) {
  if (!presentationOpen || (!presentationAudioCoachEnabled && !forceReplay)) return;
  try {
    if (forceReplay) unlockTtsAudioElement();
    const maxLen = window.EfectivaTTS?.isNativeAvailable() ? 280 : 160;
    const chunks = splitTextForSpeech(`Paso ${currentStepIndex + 1}: ${stepText || ''}`, maxLen);
    if (chunks.length === 0) return;
    window.EfectivaTTS.speakChunks(chunks, {
      rate: 1.0,
      lang: 'es-AR',
      verbose: !!forceReplay,
      guard: () => presentationOpen
    });
  } catch (e) {}
}

const presentationReplayVoiceBtn = document.getElementById('presentationReplayVoiceBtn');
if (presentationReplayVoiceBtn) {
  presentationReplayVoiceBtn.onclick = (e) => {
    e.stopPropagation();
    const txt = getCurrentPresentationStepText();
    if (txt) speakPresentationStep(txt, true);
  };
}

const presentationAudioCoachBtn = document.getElementById('presentationAudioCoachBtn');
if (presentationAudioCoachBtn) {
  presentationAudioCoachBtn.onclick = (e) => {
    e.stopPropagation();
    presentationAudioCoachEnabled = !presentationAudioCoachEnabled;
    presentationAudioCoachBtn.textContent = presentationAudioCoachEnabled ? '📣 Voz ON' : '🔇 Voz OFF';
    presentationAudioCoachBtn.classList.toggle('active', presentationAudioCoachEnabled);
    if (!presentationAudioCoachEnabled) {
      stopAllSpeechSynthesis();
    }
  };
}

function showPresentationStep(direction = 'none') {
  if (!Array.isArray(presentationSteps) || presentationSteps.length === 0) return;
  if (!Number.isFinite(currentStepIndex) || currentStepIndex < 0 || currentStepIndex >= presentationSteps.length) {
    currentStepIndex = 0;
  }
  updatePresentationUI();
  const text = extractStepText(presentationSteps[currentStepIndex]);

  // Limpiar estados de congrats si veníamos de allí
  presentationStep.style.textAlign = '';
  presentationStep.style.lineHeight = '';

  fitPresentationText(presentationStep, text, { minFontRem: 0.85 });
  speakPresentationStep(text);

  if (direction === 'next') {
    // Entra desde abajo (slide up)
    presentationStep.style.transition = 'none';
    presentationStep.style.transform = 'translateY(60px)';
    presentationStep.style.opacity = '0';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        presentationStep.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease';
        presentationStep.style.transform = 'translateY(0px)';
        presentationStep.style.opacity = '1';
      });
    });
  } else if (direction === 'prev') {
    // Entra desde arriba (slide down)
    presentationStep.style.transition = 'none';
    presentationStep.style.transform = 'translateY(-60px)';
    presentationStep.style.opacity = '0';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        presentationStep.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease';
        presentationStep.style.transform = 'translateY(0px)';
        presentationStep.style.opacity = '1';
      });
    });
  } else {
    presentationStep.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    presentationStep.style.transform = 'translateY(0px)';
    presentationStep.style.opacity = '1';
  }
}

function showCongratulations() {
  stopAllSpeechSynthesis();
  updatePresentationUI();
  const counterEl = document.getElementById('presentationStepCounter');
  if (counterEl) counterEl.textContent = '¡Completado!';

  const progressSegments = document.querySelectorAll('.presentation-progress-segment');
  progressSegments.forEach(seg => {
    seg.classList.remove('active');
    seg.classList.add('completed');
  });

  let progressHtml = '';
  if (folderPlayFolderId && folderPlayOriginalLength > 0) {
    const current = folderPlayIndex + 1;
    const total = folderPlayOriginalLength;
    progressHtml = '<div style="font-size:0.85rem;opacity:0.7;margin-top:0.4rem;">Tarea ' + current + ' de ' + total + '</div>';
  }

  presentationStep.style.textAlign = 'center';
  presentationStep.style.lineHeight = '1.4';
  presentationStep.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease';
  presentationStep.style.transform = 'translateY(0px)';
  presentationStep.style.opacity = '1';

  presentationStep.innerHTML =
    '<div style="font-size:3.2rem;margin-bottom:0.4rem;">🎉</div>' +
    '<div class="congrats-main" style="font-size:2.2rem;font-weight:700;color:#fbbf24;">¡Tarea completada!</div>' +
    progressHtml +
    '<div style="font-size:0.95rem;opacity:0.8;margin-top:0.8rem;color:#cbd5e1;">Tocá para recibir tu recompensa 🎁</div>';

  const mainEl = presentationStep.querySelector('.congrats-main');
  if (mainEl) {
    fitPresentationText(mainEl, mainEl.textContent, { minFontRem: 1.1, maxHeightRatio: 0.3 });
  }

  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchmove', handleTouchMove);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.removeEventListener('touchcancel', handleTouchCancel);
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.addEventListener('click', handleFinalClick);
}

function handleFinalClick(e) {
  // Si el click fue en el botón de minimizar, no hacer nada
  if (e.target && e.target.closest && (e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer'))) return;

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

let stepAlarmAudioCtx = null;
let stepAlarmBeepInterval = null;
let stepAlarmActive = false;

function unlockStepAlarmAudio() {
  unlockTtsAudioElement();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!stepAlarmAudioCtx) {
      stepAlarmAudioCtx = new AudioCtx();
    }
    if (stepAlarmAudioCtx.state === 'suspended') {
      stepAlarmAudioCtx.resume();
    }
  } catch (e) {}
}

function playStepAlarmChime() {
  try {
    unlockStepAlarmAudio();
    if (!stepAlarmAudioCtx) return;
    const now = stepAlarmAudioCtx.currentTime;
    // Dos tonos claros tipo alarma de enfoque
    [0, 0.22].forEach((offset, idx) => {
      const osc = stepAlarmAudioCtx.createOscillator();
      const gain = stepAlarmAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 880 : 1046.5, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.19);
      osc.connect(gain);
      gain.connect(stepAlarmAudioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch (e) {}
}

function logStepDelay(task, stepIndex, reason, extraMinutes = 0, overdueSeconds = 0) {
  if (!task) return null;
  if (!Array.isArray(task.delayLogs)) task.delayLogs = [];
  const cleanReason = String(reason || '').trim() || 'Retraso sin especificar';
  const extraMin = Math.max(0, Number(extraMinutes) || 0);
  const entry = {
    id: '_dly_' + Math.random().toString(36).substr(2, 8),
    paso_indice: stepIndex,
    paso_texto: (task.steps && task.steps[stepIndex]) ? (task.steps[stepIndex].text || task.steps[stepIndex]) : '',
    motivo: cleanReason,
    segundos_exceso: Math.max(0, Math.round(overdueSeconds)),
    minutos_extra: extraMin,
    fecha_iso: new Date().toISOString()
  };
  task.delayLogs.push(entry);

  // Si el usuario indicó minutos extra, sumarlos al paso y replanificar en vivo
  if (extraMin > 0 && task.totalTime) {
    const extraSec = Math.round(extraMin * 60);
    if (!Array.isArray(task.stepTimes)) task.stepTimes = task.steps.map(() => 0);
    task.stepTimes[stepIndex] = (task.stepTimes[stepIndex] || 0) + extraSec;
    task.totalTime += extraSec;
    task.hasCustomStepTimes = true;
    if (currentPresentationTask && currentPresentationTask.id === task.id && currentStepIndex === stepIndex) {
      presentationBaseSeconds += extraSec;
      syncPresentationClock();
      if (currentStepCountdown > 0) {
        presentationAlarmFired = false;
        stopStepOvertimeAlarm();
      }
      saveActivePresentationState();
    }
  }
  saveDataToLocalStorage();
  return entry;
}

function setupDelayJustificationUI() {
  const justifyBtn = document.getElementById('justifyDelayBtn');
  const box = document.getElementById('delayJustifyBox');
  const reasonInput = document.getElementById('delayReasonInput');
  const extraInput = document.getElementById('delayExtraMinInput');
  const saveBtn = document.getElementById('saveDelayBtn');
  const cancelBtn = document.getElementById('cancelDelayBtn');
  if (!justifyBtn || !box || justifyBtn._setupDone) return;
  justifyBtn._setupDone = true;

  justifyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
    if (box.style.display === 'flex' && reasonInput) {
      reasonInput.value = '';
      if (extraInput) extraInput.value = '';
      reasonInput.focus();
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      box.style.display = 'none';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!currentPresentationTask) return;
      const reason = reasonInput ? reasonInput.value : '';
      const extraMin = extraInput ? parseFloat(extraInput.value) : 0;
      const overdueSec = (currentStepCountdown < 0) ? Math.abs(currentStepCountdown) : 0;
      logStepDelay(currentPresentationTask, currentStepIndex, reason, isNaN(extraMin) ? 0 : extraMin, overdueSec);
      box.style.display = 'none';
      justifyBtn.textContent = '✅ Retraso guardado';
      setTimeout(() => {
        if (justifyBtn) justifyBtn.textContent = '📝 Justificar retraso';
      }, 2000);
    });
  }
}

// === PUENTE NATIVO CAPACITOR PARA ALARMAS CON PANTALLA BLOQUEADA ===
const NATIVE_STEP_ALARM_ID = 9001;

async function scheduleNativeStepAlarm(secondsFromNow, stepText) {
  try {
    const LocalNotif = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotif || !secondsFromNow || secondsFromNow <= 0) return;
    await LocalNotif.requestPermissions();
    await LocalNotif.cancel({ notifications: [{ id: NATIVE_STEP_ALARM_ID }] });
    await LocalNotif.schedule({
      notifications: [{
        id: NATIVE_STEP_ALARM_ID,
        title: '⏰ Efectiva — ¡Tiempo agotado!',
        body: 'Paso vencido: ' + String(stepText || 'Paso actual').slice(0, 100),
        schedule: { at: new Date(Date.now() + secondsFromNow * 1000), allowWhileIdle: true },
        sound: 'default'
      }]
    });
  } catch (e) {}
}

async function cancelNativeStepAlarm() {
  try {
    const LocalNotif = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotif) return;
    await LocalNotif.cancel({ notifications: [{ id: NATIVE_STEP_ALARM_ID }] });
  } catch (e) {}
}

function triggerStepOvertimeAlarm() {
  if (presentationAlarmFired) return;
  presentationAlarmFired = true;
  stepAlarmActive = true;
  saveActivePresentationState();
  if (currentPresentationTask) {
    triggerAutomationEvent('tiempo_paso_agotado', {
      folderId: currentFolderId,
      task: currentPresentationTask,
      stepIndex: currentStepIndex,
      stepText: presentationSteps[currentStepIndex] || ''
    });
  }

  // Sonido inmediato y repetición suave cada 2.5s hasta silenciar o cambiar de paso
  playStepAlarmChime();
  if (stepAlarmBeepInterval) clearInterval(stepAlarmBeepInterval);
  stepAlarmBeepInterval = setInterval(() => {
    if (!presentationOpen || !stepAlarmActive) {
      stopStepOvertimeAlarm();
      return;
    }
    playStepAlarmChime();
  }, 2500);

  if (navigator.vibrate) {
    try { navigator.vibrate([300, 150, 300, 150, 400]); } catch (e) {}
  }

  showSilenceAlarmButton(true);

  // Notificación del sistema (útil si el teléfono está bloqueado o en otra app)
  const stepText = presentationSteps[currentStepIndex] || 'Paso actual';
  const msg = `⏰ Tiempo agotado en: "${stepText}" (contando en negativo)`;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification('Efectiva — ¡Tiempo agotado!', {
            body: msg,
            icon: './icon-192.png',
            tag: 'efectiva-step-alarm',
            renotify: true
          });
        }).catch(() => {});
      } else {
        new Notification('Efectiva — ¡Tiempo agotado!', { body: msg, icon: './icon-192.png' });
      }
    } catch (e) {}
  }
}

function stopStepOvertimeAlarm() {
  stepAlarmActive = false;
  if (stepAlarmBeepInterval) {
    clearInterval(stepAlarmBeepInterval);
    stepAlarmBeepInterval = null;
  }
  showSilenceAlarmButton(false);
}

function showSilenceAlarmButton(visible) {
  let btn = document.getElementById('silenceStepAlarmBtn');
  if (visible) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'silenceStepAlarmBtn';
      btn.className = 'silence-alarm-btn';
      btn.textContent = '🔕 Silenciar alarma';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        stopStepOvertimeAlarm();
      });
      const bottomBar = presentationModal.querySelector('.presentation-bottom-bar');
      if (bottomBar) bottomBar.prepend(btn);
    }
    btn.style.display = 'inline-flex';
  } else if (btn) {
    btn.style.display = 'none';
  }
}

function syncPresentationClock() {
  if (!presentationOpen || !currentPresentationTask || !presentationStepStartedAt) return;
  const elapsed = Math.floor((Date.now() - presentationStepStartedAt) / 1000);
  if (currentPresentationTask.totalTime) {
    currentStepCountdown = presentationBaseSeconds - elapsed;
    timerDisplay.textContent = formatTime(currentStepCountdown);
    const isOverdue = currentStepCountdown <= 0;
    timerDisplay.classList.toggle('timer-overdue', isOverdue);
    const jBtn = document.getElementById('justifyDelayBtn');
    if (jBtn) {
      jBtn.style.display = 'inline-flex';
      jBtn.classList.toggle('urgent', isOverdue);
    }
    if (isOverdue && !presentationAlarmFired) {
      triggerStepOvertimeAlarm();
    }
  } else {
    timerSeconds = presentationBaseSeconds + elapsed;
    timerDisplay.textContent = formatTime(timerSeconds);
    timerDisplay.classList.remove('timer-overdue');
  const _jBtn = document.getElementById('justifyDelayBtn'); if (_jBtn) _jBtn.style.display = 'none';
  const _dBox = document.getElementById('delayJustifyBox'); if (_dBox) _dBox.style.display = 'none';
    const jBtn = document.getElementById('justifyDelayBtn');
    if (jBtn) jBtn.style.display = 'none';
  }
}

function startTimer() {
  syncPresentationClock();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(syncPresentationClock, 250);
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
    if (e.target && e.target.closest && (e.target.closest('#minimizePresentationBtn') || e.target.closest('#closePresentationBtn') || e.target.closest('#justifyDelayBtn') || e.target.closest('#delayJustifyBox') || e.target.closest('#silenceStepAlarmBtn') || e.target.closest('#presentationLinkedNoteBtn') || e.target.closest('#presentationLinkedNoteDrawer'))) return;
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
  const windowActions = presentationModal.querySelector('.presentation-window-actions');
  const headerActions = presentationModal.querySelector('.presentation-header-actions');
  const container = windowActions || headerActions || presentationModal.querySelector('.presentation-content') || presentationModal;

  let btn = document.getElementById('minimizePresentationBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'minimizePresentationBtn';
    btn.type = 'button';
    btn.className = 'audio-coach-btn minimize-btn';
    container.appendChild(btn);
  }
  btn.textContent = isPresentationMinimized ? '🗖 Maximizar' : '🗕 Minimizar';
  btn.onclick = (e) => {
    e.stopPropagation();
    togglePresentationMinimized();
    btn.textContent = isPresentationMinimized ? '🗖 Maximizar' : '🗕 Minimizar';
  };

  let closeBtn = document.getElementById('closePresentationBtn');
  if (!closeBtn) {
    closeBtn = document.createElement('button');
    closeBtn.id = 'closePresentationBtn';
    closeBtn.type = 'button';
    closeBtn.className = 'audio-coach-btn close-pres-btn';
    closeBtn.title = 'Cerrar presentación';
    closeBtn.textContent = '✖';
    container.appendChild(closeBtn);
  }
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closePresentation(true);
  };
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
  presentationStepStartedAt = null;
  presentationBaseSeconds = 0;
  presentationAlarmFired = false;
  stopAllSpeechSynthesis();
  stopStepOvertimeAlarm();
  cancelNativeStepAlarm();
  clearActivePresentationState();
  timerDisplay.textContent = '00:00';
  timerDisplay.classList.remove('timer-overdue');
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
  if (minBtn) minBtn.textContent = '🗕 Minimizar';
  const scrollBadge = document.getElementById('presentationScrollBadge');
  if (scrollBadge) scrollBadge.style.display = 'none';
  presentationStep.classList.remove('has-scroll');
  presentationStep.style.transform = '';
  presentationStep.style.opacity = '';
  presentationStep.style.transition = '';
  // FIX: limpiar TODOS los listeners para que no queden colgados
  presentationModal.removeEventListener('click', handlePresentationClick);
  presentationModal.removeEventListener('click', handleFinalClick);
  presentationModal.removeEventListener('touchstart', handleTouchStart);
  presentationModal.removeEventListener('touchmove', handleTouchMove);
  presentationModal.removeEventListener('touchend', handleTouchEnd);
  presentationModal.removeEventListener('touchcancel', handleTouchCancel);
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
  if (window.EfectivaIdleAlarm && typeof window.EfectivaIdleAlarm.evaluate === 'function') {
    window.EfectivaIdleAlarm.evaluate(false);
  }
}

function formatTime(sec) {
  const isNeg = sec < 0;
  const abs = Math.abs(Math.trunc(sec));
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${isNeg ? '-' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
function checkScheduledAutomationRules() {
  if (!Array.isArray(automationRules) || automationRules.length === 0) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayStr = now.toISOString().slice(0, 10);
  const dayOfWeek = now.getDay(); // 0=Dom..6=Sab

  let firedAny = false;
  automationRules.forEach(rule => {
    if (rule.activa === false || rule.evento !== 'hora_programada' || !rule.condicion || !rule.condicion.hora) return;
    if (rule.condicion.hora !== hhmm) return;
    if (Array.isArray(rule.condicion.dias) && rule.condicion.dias.length > 0 && !rule.condicion.dias.includes(dayOfWeek)) return;
    if (rule._lastFiredDate === todayStr) return;

    rule._lastFiredDate = todayStr;
    firedAny = true;
    triggerAutomationEvent('hora_programada', { folderId: rule.condicion.carpeta_id || currentFolderId });
  });
  if (firedAny) saveAutomationRules();
}

function checkAlarms() {
  checkScheduledAutomationRules();
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

// [Entropía cero v27: eliminados duplicados legados de recalcStepTimes, handlePopState y closePresentation que sobreescribían las versiones modernas arriba]

// [Duplicates removed: nextStep and prevStep are unified above]

// Sincronizar reloj real al volver de otra app o desbloquear la pantalla
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (presentationOpen) saveActivePresentationState();
  } else {
    if (presentationOpen) {
      syncPresentationClock();
      if (wakeLock === null) requestWakeLock();
    }
  }
});

// Eventos de navegación con teclado para la presentación (TikTok style)
document.addEventListener('keydown', (e) => {
    if (!presentationOpen || isPresentationMinimized) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextStep(true);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevStep(true);
    } else if (e.key === 'Escape') {
        closePresentation();
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



// Toggle del panel de plantillas personalizadas en la vista de tareas
(function setupUserTemplatesTab() {
  const tabTask = document.getElementById('modeTabTask');
  const tabNote = document.getElementById('modeTabNote');
  const tabTable = document.getElementById('modeTabTable');
  const tabTpl = document.getElementById('modeTabTemplates');
  const tplPanel = document.getElementById('userTemplatesPanel');
  const taskForm = document.getElementById('taskCreationForm');
  const noteForm = document.getElementById('noteCreationForm');
  const tableForm = document.getElementById('tableCreationForm');
  if (!tabTpl || !tplPanel) return;

  tabTpl.addEventListener('click', () => {
    [tabTask, tabNote, tabTable].forEach(b => b && b.classList.remove('active'));
    tabTpl.classList.add('active');
    if (taskForm) taskForm.style.display = 'none';
    if (noteForm) noteForm.style.display = 'none';
    if (tableForm) tableForm.style.display = 'none';
    tplPanel.style.display = 'flex';
    renderUserTemplatesPanel();
  });

  [tabTask, tabNote, tabTable].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        tabTpl.classList.remove('active');
        tplPanel.style.display = 'none';
      });
    }
  });
})();


/************************************************************************
 * CENTRO DE CONTROL VISUAL (REGLAS, RETRASOS Y MEMORIA IA)
 ************************************************************************/
(function setupControlCenter() {
  const btn = document.getElementById('controlCenterBtn');
  const modal = document.getElementById('controlCenterModal');
  const closeBtn = document.getElementById('closeControlCenterBtn');
  const body = document.getElementById('controlCenterBody');
  if (!btn || !modal || !body) return;

  let activeTab = 'rules';

  function renderControlCenter() {
    body.innerHTML = '';
    if (activeTab === 'rules') {
      const icsBtn = document.createElement('button');
      icsBtn.type = 'button';
      icsBtn.className = 'cc-ics-btn';
      icsBtn.textContent = '📅 Exportar bloques a Calendario (.ics)';
      icsBtn.addEventListener('click', () => { if (!exportScheduleToICS() && typeof asistaAlert === 'function') asistaAlert('No hay bloques horarios ni tareas agendadas para exportar.', { title: 'Calendario', type: 'info' }); });
      body.appendChild(icsBtn);
      const rules = Array.isArray(automationRules) ? automationRules : [];
      if (rules.length === 0) {
        body.innerHTML = '<div class="cc-empty">No hay reglas de automatización aún.<br><small>Podés pedirle al asistente: "Cuando complete el paso 1 de X, creá la tarea Y" o "Cada día a las 08:00 iniciá mi rutina".</small></div>';
        return;
      }
      rules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'cc-item' + (rule.activa === false ? ' inactive' : '');

        const info = document.createElement('div');
        info.className = 'cc-item-info';

        const title = document.createElement('div');
        title.className = 'cc-item-title';
        const evLabels = {
          paso_completado: 'Al completar paso',
          tiempo_paso_agotado: 'Al agotarse tiempo',
          hora_programada: 'Horario programado' + (rule.condicion?.hora ? ' (' + rule.condicion.hora + ')' : ''),
          tarea_completada: 'Al completar tarea',
          carpeta_completada: 'Al completar carpeta'
        };
        title.textContent = evLabels[rule.evento] || rule.evento;

        const sub = document.createElement('div');
        sub.className = 'cc-item-sub';
        const accLabels = {
          crear_tarea: 'Crear tarea',
          mover_tarea: 'Mover tarea',
          iniciar_presentacion_tarea: 'Iniciar presentación',
          siguiente_paso: 'Siguiente paso',
          aplicar_plantilla: 'Aplicar plantilla',
          crear_recompensa: 'Crear recompensa',
          asignar_prioridad: 'Cambiar prioridad',
          asignar_color: 'Cambiar color'
        };
        const targetName = rule.parametros_accion?.nombre || '';
        sub.textContent = (accLabels[rule.accion_automatica] || rule.accion_automatica) + (targetName ? ': ' + targetName : '');

        info.append(title, sub);

        const controls = document.createElement('div');
        controls.className = 'cc-item-controls';

        const labelSwitch = document.createElement('label');
        labelSwitch.className = 'ef-switch';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = rule.activa !== false;
        chk.addEventListener('change', () => {
          rule.activa = chk.checked;
          saveAutomationRules();
          renderControlCenter();
        });
        const slider = document.createElement('span');
        slider.className = 'ef-slider';
        labelSwitch.append(chk, slider);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cc-del-btn';
        delBtn.textContent = '🗑';
        delBtn.title = 'Eliminar regla';
        delBtn.addEventListener('click', () => {
          automationRules = automationRules.filter(r => r.id !== rule.id);
          saveAutomationRules();
          renderControlCenter();
        });

        controls.append(labelSwitch, delBtn);
        item.append(info, controls);
        body.appendChild(item);
      });
    } else if (activeTab === 'delays') {
      const delays = [];
      let finishedCount = 0;
      let totalExtraMin = 0;
      (folders || []).forEach(f => {
        finishedCount += (f.finished || []).length;
        [...(f.tasks || []), ...(f.finished || [])].forEach(t => {
          if (Array.isArray(t.delayLogs)) {
            t.delayLogs.forEach(d => {
              totalExtraMin += Number(d.minutos_extra) || 0;
              delays.push({ folderName: f.name, taskName: t.name, ...d });
            });
          }
        });
      });

      const kpiRow = document.createElement('div');
      kpiRow.className = 'cc-kpi-row';
      kpiRow.innerHTML =
        '<div class="cc-kpi"><span class="cc-kpi-val">' + finishedCount + '</span><span class="cc-kpi-lbl">Completadas</span></div>' +
        '<div class="cc-kpi"><span class="cc-kpi-val">' + delays.length + '</span><span class="cc-kpi-lbl">Retrasos</span></div>' +
        '<div class="cc-kpi"><span class="cc-kpi-val">+' + totalExtraMin + 'm</span><span class="cc-kpi-lbl">Tiempo extra</span></div>';
      body.appendChild(kpiRow);

      if (delays.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cc-empty';
        empty.textContent = 'Sin retrasos justificados todavía. Cuando entres en números rojos durante una presentación, tocá "📝 Justificar retraso".';
        body.appendChild(empty);
        return;
      }

      delays.slice().reverse().slice(0, 25).forEach(d => {
        const item = document.createElement('div');
        item.className = 'cc-item';
        const info = document.createElement('div');
        info.className = 'cc-item-info';

        const title = document.createElement('div');
        title.className = 'cc-item-title';
        title.textContent = d.motivo;

        const sub = document.createElement('div');
        sub.className = 'cc-item-sub';
        const ex = d.segundos_exceso ? (' · Exceso: ' + Math.round(d.segundos_exceso / 60 * 10) / 10 + ' min') : '';
        const ext = d.minutos_extra ? (' · +' + d.minutos_extra + 'm añadidos') : '';
        sub.textContent = d.taskName + ' (Paso ' + ((d.paso_indice || 0) + 1) + ')' + ex + ext;

        info.append(title, sub);
        item.appendChild(info);
        body.appendChild(item);
      });
    } else if (activeTab === 'memory') {
      let mems = [];
      try {
        const raw = localStorage.getItem('efectivaAgentMemoryV1');
        mems = raw ? JSON.parse(raw) : [];
      } catch (e) { mems = []; }

      if (!Array.isArray(mems) || mems.length === 0) {
        body.innerHTML = '<div class="cc-empty">Tu asistente aún no ha guardado recuerdos a largo plazo.<br><small>A medida que chatees o le cuentes tus horarios ideales y preferencias, los recordará aquí entre sesiones.</small></div>';
        return;
      }

      mems.forEach(m => {
        const item = document.createElement('div');
        item.className = 'cc-item';

        const info = document.createElement('div');
        info.className = 'cc-item-info';

        const badge = document.createElement('span');
        badge.className = 'cc-mem-tag';
        badge.textContent = m.categoria;

        const title = document.createElement('div');
        title.className = 'cc-item-title';
        title.textContent = m.clave;

        const sub = document.createElement('div');
        sub.className = 'cc-item-sub';
        sub.textContent = m.valor;

        info.append(badge, title, sub);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cc-del-btn';
        delBtn.textContent = '🗑';
        delBtn.title = 'Olvidar recuerdo';
        delBtn.addEventListener('click', () => {
          const next = mems.filter(x => x.id !== m.id);
          localStorage.setItem('efectivaAgentMemoryV1', JSON.stringify(next));
          renderControlCenter();
        });

        item.append(info, delBtn);
        body.appendChild(item);
      });
    }
  }

  btn.addEventListener('click', () => {
    modal.style.display = 'flex';
    renderControlCenter();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  modal.querySelectorAll('.cc-seg-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      modal.querySelectorAll('.cc-seg-btn').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      activeTab = tabBtn.dataset.ccTab || 'rules';
      renderControlCenter();
    });
  });
})();


/************************************************************************
 * INSTALACIÓN PWA (APP INSTALABLE CON 1 TOQUE)
 ************************************************************************/
(function setupPwaInstallButton() {
  let deferredInstallPrompt = null;
  const topBar = document.querySelector('.top-icon-bar');
  if (!topBar) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    let installBtn = document.getElementById('pwaInstallBtn');
    if (!installBtn) {
      installBtn = document.createElement('button');
      installBtn.id = 'pwaInstallBtn';
      installBtn.className = 'icon-button pwa-install-btn';
      installBtn.title = 'Instalar Efectiva como App';
      installBtn.innerHTML = '📲';
      installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (err) {}
        deferredInstallPrompt = null;
        installBtn.remove();
      });
      topBar.appendChild(installBtn);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.remove();
  });
})();


/************************************************************************
 * NOTAS VIVAS EN PLAY + QUICK START 1-CLIC + EXPORTADOR .ICS
 ************************************************************************/
function updateLinkedNoteInPresentation() {
  const btn = document.getElementById('presentationLinkedNoteBtn');
  const drawer = document.getElementById('presentationLinkedNoteDrawer');
  if (!btn || !drawer) return;
  drawer.style.display = 'none';
  drawer.innerHTML = '';

  if (!currentPresentationTask) {
    btn.style.display = 'none';
    return;
  }

  let allNotes = [];
  try {
    allNotes = (typeof notes !== 'undefined' && Array.isArray(notes))
      ? notes
      : JSON.parse(localStorage.getItem('asista_notes') || '[]');
  } catch (e) { allNotes = []; }

  const linked = allNotes.filter(n =>
    n.taskId === currentPresentationTask.id ||
    (currentFolderId && n.folderId === currentFolderId && !n.taskId)
  );

  if (linked.length === 0) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = 'inline-flex';
  btn.textContent = '📝 Nota (' + linked.length + ')';
  btn.onclick = (e) => {
    e.stopPropagation();
    if (drawer.style.display === 'block') {
      drawer.style.display = 'none';
      return;
    }
    drawer.innerHTML = '';
    linked.slice(0, 3).forEach(n => {
      const box = document.createElement('div');
      box.className = 'pres-note-item';
      const h = document.createElement('strong');
      h.textContent = n.title || 'Nota';
      const p = document.createElement('p');
      p.textContent = (n.content || '').slice(0, 500);
      box.append(h, p);
      drawer.appendChild(box);
    });
    drawer.style.display = 'block';
  };
}

function updateQuickStartButton() {
  const box = document.getElementById('quickStartContainer');
  const btn = document.getElementById('quickStartPlayBtn');
  const titleEl = document.getElementById('quickStartTitle');
  const subEl = document.getElementById('quickStartSub');
  if (!box || !btn || !titleEl || !subEl) return;

  let candidate = null;
  let candidateFolder = null;
  for (const f of (folders || [])) {
    if (f.isDefaultRewards) continue;
    const t = (f.tasks || []).find(x => Array.isArray(x.steps) && x.steps.length > 0);
    if (t) {
      candidate = t;
      candidateFolder = f;
      if (t.priority === 'alta') break;
    }
  }

  if (!candidate) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'flex';
  titleEl.textContent = 'Empezar ahora: ' + candidate.name;
  subEl.textContent = candidateFolder.name + ' · ' + candidate.steps.length + ' pasos' + (candidate.totalTime ? ' · ' + Math.round(candidate.totalTime / 60) + ' min' : '');
  btn.onclick = () => {
    openFolder(candidateFolder.id);
    startPresentation(candidate);
  };
}

// Llamar updateQuickStartButton cada vez que se renderizan carpetas
const _origRenderFoldersForQS = renderFolders;
renderFolders = function() {
  _origRenderFoldersForQS.apply(this, arguments);
  updateQuickStartButton();
};
setTimeout(updateQuickStartButton, 500);

function exportScheduleToICS() {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Efectiva//TimeBlocking//ES',
    'CALSCALE:GREGORIAN'
  ];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  let count = 0;

  // Reglas hora_programada
  (automationRules || []).forEach(r => {
    if (r.activa === false || r.evento !== 'hora_programada' || !r.condicion?.hora) return;
    const [hh, mm] = String(r.condicion.hora).split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) return;
    const start = `${dateStr}T${pad(hh)}${pad(mm)}00`;
    const endMin = hh * 60 + mm + 30;
    const end = `${dateStr}T${pad(Math.floor(endMin / 60) % 24)}${pad(endMin % 60)}00`;
    const summary = r.parametros_accion?.nombre || 'Bloque Efectiva';
    lines.push('BEGIN:VEVENT', 'UID:' + r.id + '@efectiva', 'DTSTART:' + start, 'DTEND:' + end, 'SUMMARY:' + summary, 'END:VEVENT');
    count++;
  });

  // Tareas con scheduledTimestamp o dueDate
  (folders || []).forEach(f => {
    (f.tasks || []).forEach(t => {
      if (t.scheduledTimestamp) {
        const d = new Date(t.scheduledTimestamp);
        const ds = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        const durMin = t.totalTime ? Math.round(t.totalTime / 60) : 30;
        const dEnd = new Date(d.getTime() + durMin * 60000);
        const de = `${dEnd.getFullYear()}${pad(dEnd.getMonth() + 1)}${pad(dEnd.getDate())}T${pad(dEnd.getHours())}${pad(dEnd.getMinutes())}00`;
        lines.push('BEGIN:VEVENT', 'UID:' + t.id + '@efectiva', 'DTSTART:' + ds, 'DTEND:' + de, 'SUMMARY:' + t.name, 'END:VEVENT');
        count++;
      }
    });
  });

  lines.push('END:VCALENDAR');
  if (count === 0) return false;
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'efectiva-agenda.ics';
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
window.exportScheduleToICS = exportScheduleToICS;

// ============================================================================
//  PUENTE DE ESTADO PARA SUPABASE EDGE FUNCTION (AGENTE IA EN LA NUBE v26)
// ============================================================================
window.EfectivaStateBridge = {
  exportFullState() {
    let agentMemory = [];
    try {
      const raw = localStorage.getItem('efectivaAgentMemoryV1');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) agentMemory = parsed;
    } catch (_) {}

    const nowObj = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const localNow = `${nowObj.getFullYear()}-${pad2(nowObj.getMonth() + 1)}-${pad2(nowObj.getDate())} ${pad2(nowObj.getHours())}:${pad2(nowObj.getMinutes())}:${pad2(nowObj.getSeconds())}`;
    let timezone = 'local';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch (_) {}

    const activePresentation = (typeof presentationOpen !== 'undefined' && presentationOpen && typeof currentPresentationTask !== 'undefined' && currentPresentationTask)
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

    return {
      folders: Array.isArray(folders) ? folders : [],
      trash: Array.isArray(trash) ? trash : [],
      notes: Array.isArray(notes) ? notes : [],
      userTemplates: Array.isArray(userTemplates) ? userTemplates : [],
      automationRules: Array.isArray(automationRules) ? automationRules : [],
      agentMemory,
      finance: (window.EfectivaFinance && typeof window.EfectivaFinance.exportState === 'function') ? window.EfectivaFinance.exportState() : null,
      tables: (window.EfectivaTables && typeof window.EfectivaTables.exportState === 'function') ? window.EfectivaTables.exportState() : [],
      userStats: userStats || { xp_total: 0, nivel: 1, racha_dias_consecutivos: 1 },
      currentFolderId: (typeof currentFolderId !== 'undefined') ? currentFolderId : null,
      activePresentation,
      timezone,
      localNow
    };
  },

  applyFullState(nextState) {
    if (!nextState || typeof nextState !== 'object') return;
    if (Array.isArray(nextState.folders)) {
      folders = nextState.folders;
    }
    if (Array.isArray(nextState.trash)) {
      trash = nextState.trash;
    }
    try {
      localStorage.setItem('foldersDataV4', JSON.stringify({ folders, trash }));
    } catch (_) {}

    if (Array.isArray(nextState.notes)) {
      notes = nextState.notes;
      saveNotes();
    }
    if (Array.isArray(nextState.userTemplates)) {
      userTemplates = nextState.userTemplates;
      saveUserTemplates();
    }
    if (Array.isArray(nextState.automationRules)) {
      automationRules = nextState.automationRules;
      saveAutomationRules();
    }
    if (Array.isArray(nextState.agentMemory)) {
      try { localStorage.setItem('efectivaAgentMemoryV1', JSON.stringify(nextState.agentMemory)); } catch (_) {}
    }
    if (nextState.finance && window.EfectivaFinance && typeof window.EfectivaFinance.hydrateFromCloud === 'function') {
      window.EfectivaFinance.hydrateFromCloud(nextState.finance);
    }
    if (Array.isArray(nextState.tables) && window.EfectivaTables && typeof window.EfectivaTables.hydrateFromCloud === 'function') {
      window.EfectivaTables.hydrateFromCloud(nextState.tables);
    }
    if (nextState.userStats && typeof nextState.userStats === 'object') {
      userStats = Object.assign(userStats, nextState.userStats);
      saveUserStats();
    }

    try { if (typeof renderFolders === 'function') renderFolders(); } catch (_) {}
    try { if (typeof currentFolderId !== 'undefined' && currentFolderId && typeof renderTasks === 'function') renderTasks(); } catch (_) {}
    try { if (typeof renderNotes === 'function') renderNotes(); } catch (_) {}
    try { if (typeof renderUserTemplatesPanel === 'function') renderUserTemplatesPanel(); } catch (_) {}
    try { if (typeof renderTrash === 'function') renderTrash(); } catch (_) {}
  }
};

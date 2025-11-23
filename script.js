const KEYS = { PROMPTS: 'p_v42', FOLDERS: 'f_v42', TAGS: 't_v42', COLORS: 'c_v42', THEME: 'th_v42', FILE_HANDLE: 'h_v42', LAST_MODIFIED: 'lm_v42', FAV_FOLDERS: 'ff_v96' };
const PALETTE = ['#fca5a5', '#fdba74', '#fde047', '#86efac', '#67e8f9', '#93c5fd', '#c4b5fd', '#f0abfc', '#fda4af', '#cbd5e1', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'];
const TRASH_NAME = 'Papelera';

let app = {
    prompts: [], folders: ['General'], tags: [], colors: {},
    view: 'all', currentFolder: null,
    filters: { tags: [] },
    sort: { type: 'date', dir: 'desc' },
    folderSort: { type: 'name', dir: 'asc' },
    favoriteFolders: [],
    editId: null, editFolder: null,
    multiSelectMode: false,
    fileHandle: null,
    lastModified: 0, 
    saveTimeout: null,
    driveSaveTimeout: null,
    isLoadingFromDrive: false
};

/* --- Google Drive Integration (client-side) ---
   IMPORTANT: To enable Drive sync you must set `DRIVE_CLIENT_ID` below
   with a Google OAuth 2.0 Client ID (Web application). The redirect URI
   must match what you configure in Google Cloud Console (for local
   testing use http://localhost origins). This implementation uses the
   Google Identity Services token client and Drive REST endpoints.
*/
const DRIVE_CLIENT_ID = '886613181396-gnsc1ss5bo9k2mn0c0prs9duidkjtpcm.apps.googleusercontent.com' /* <-- PASTE YOUR GOOGLE OAUTH CLIENT ID HERE */;
const DRIVE_FILE_NAME = 'prompt_manager_db.json';
let driveTokenClient = null;
let driveAccessToken = localStorage.getItem('drive_access_token') || null;
let driveFileId = localStorage.getItem('drive_file_id') || null;

function initDrive() {
    try {
        if (!window.google || !google.accounts || !google.accounts.oauth2) return;
        driveTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: DRIVE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: (resp) => {
                if (resp && resp.access_token) {
                    driveAccessToken = resp.access_token;
                    try { localStorage.setItem('drive_access_token', driveAccessToken); } catch(e){}
                    document.getElementById('db-status-menu').textContent = `DB Conectada: Drive`;
                    document.getElementById('db-status-menu').style.color = 'var(--accent)';
                    showToast('Conectado a Google Drive');
                    updateSyncStatus('Conectado (Drive)', 'var(--accent)');
                                // After connecting, fetch remote metadata and offer a safe choice
                                (async () => {
                                    try {
                                        const remote = await findDriveFile();
                                        if (remote && remote.id) {
                                            // fetch remote content to obtain counts
                                            try {
                                                const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${remote.id}?alt=media`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
                                                if (contentRes && contentRes.ok) {
                                                    const json = await contentRes.json();
                                                    const remoteCount = Array.isArray(json.prompts) ? json.prompts.length : 0;
                                                    const localCount = Array.isArray(app.prompts) ? app.prompts.length : 0;
                                                    const choice = await openDriveSyncModal(remoteCount, localCount);
                                                    if (choice === 'load') {
                                                        await loadFromDrive(true);
                                                    } else if (choice === 'merge') {
                                                        const merged = mergeRemoteLocal(json);
                                                        app.prompts = merged.prompts;
                                                        app.folders = merged.folders;
                                                        app.tags = merged.tags;
                                                        app.colors = merged.colors;
                                                        app.favoriteFolders = merged.favoriteFolders;
                                                        saveData(true);
                                                        showToast(`Fusionado: +${merged.added} prompts añadidos`);
                                                    } else {
                                                        showToast('Se mantuvieron los datos locales');
                                                    }
                                                } else {
                                                    showToast('Conexión Drive establecida. No se pudo leer la copia remota.');
                                                }
                                            } catch (e) {
                                                console.warn('No se pudo leer contenido remoto', e);
                                            }
                                        } else {
                                            showToast('Conexión Drive establecida. No se encontró copia remota.');
                                        }
                                    } catch(e) {
                                        // ignore errors here
                                    }
                                })();
                }
            }
        });
    } catch (e) {
        console.warn('initDrive failed', e);
    }
}

// Color popover for editing tag colors
let _colorPopoverEl = null;
function openColorPopover(tag, anchorEl) {
    closeColorPopover();
    _colorPopoverEl = document.createElement('div');
    _colorPopoverEl.id = 'color-popover';
    _colorPopoverEl.className = 'color-popover';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = (app.colors && app.colors[tag]) ? app.colors[tag] : rgbToHex(getColor(tag));
    colorInput.title = `Color para ${tag}`;
    colorInput.className = 'color-input';

    // When user picks a color, apply immediately and close popover
    const onChange = (e) => {
        const v = e.target.value;
        if (!app.colors) app.colors = {};
        app.colors[tag] = v;
        // Update all visible swatches and tags
        saveData();
        closeColorPopover();
        showToast(`Color de "${tag}" actualizado`);
    };

    colorInput.addEventListener('input', onChange);

    _colorPopoverEl.appendChild(colorInput);
    document.body.appendChild(_colorPopoverEl);

    // Positioning: place to the right of anchorEl
    const rect = anchorEl.getBoundingClientRect();
    const popRect = _colorPopoverEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 220, rect.right + 8);
    const top = Math.max(8, rect.top - 8);
    _colorPopoverEl.style.left = `${left}px`;
    _colorPopoverEl.style.top = `${top}px`;

    // Close on outside click or Escape
    setTimeout(() => {
        document.addEventListener('click', _colorPopoverOutsideHandler);
        document.addEventListener('keydown', _colorPopoverKeyHandler);
    }, 0);
    colorInput.focus();
}

function closeColorPopover() {
    if (!_colorPopoverEl) return;
    document.removeEventListener('click', _colorPopoverOutsideHandler);
    document.removeEventListener('keydown', _colorPopoverKeyHandler);
    try { _colorPopoverEl.remove(); } catch(e){}
    _colorPopoverEl = null;
}

function _colorPopoverOutsideHandler(e) {
    if (!_colorPopoverEl) return;
    if (!_colorPopoverEl.contains(e.target)) closeColorPopover();
}

function _colorPopoverKeyHandler(e) {
    if (e.key === 'Escape') closeColorPopover();
}

// Helper: convert rgb/known color to hex (best-effort). If input already hex, return it.
function rgbToHex(color) {
    try {
        if (!color) return '#888888';
        color = color.trim();
        if (color.startsWith('#')) return color;
        // Create a temporary element to compute color
        const d = document.createElement('div'); d.style.color = color; document.body.appendChild(d);
        const cs = getComputedStyle(d).color;
        d.remove();
        const m = cs.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) return '#888888';
        const r = parseInt(m[1],10), g = parseInt(m[2],10), b = parseInt(m[3],10);
        return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
    } catch(e) { return '#888888'; }
}

async function connectDrive() {
    if (!DRIVE_CLIENT_ID) { await showAlert('Falta DRIVE_CLIENT_ID en el código. Añade tu Client ID en script.js', 'Drive Client ID'); return; }
    if (!driveTokenClient) initDrive();
    if (!driveTokenClient) { await showAlert('Google Identity Services no está disponible. Comprueba CSP y conexión a internet.', 'Google Identity'); return; }
    driveTokenClient.requestAccessToken({ prompt: 'consent' });
}

async function findDriveFile() {
    if (!driveAccessToken) throw new Error('No access token');
    const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return (data.files && data.files[0]) || null;
}

async function saveToDrive() {
    if (!driveAccessToken) { showToast('No conectado a Drive'); return; }
    // Do not attempt to save while we are loading from Drive to avoid overwriting
    if (app.isLoadingFromDrive) return;
    try {
        const payload = JSON.stringify({ prompts: app.prompts, folders: app.folders, tags: app.tags, colors: app.colors, favoriteFolders: app.favoriteFolders }, null, 2);
        const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json' };
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";
        let multipartRequestBody = delimiter
            + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            + JSON.stringify(metadata)
            + delimiter
            + 'Content-Type: application/json\r\n\r\n'
            + payload
            + close_delim;

        let file = null;
        try { file = await findDriveFile(); } catch(e) { /* ignore */ }

        // If a remote file exists, fetch it to compare before overwriting
        if (file && file.id) {
            try {
                const existingRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
                if (existingRes && existingRes.ok) {
                    try {
                        const existingJson = await existingRes.json();
                        const remoteCount = Array.isArray(existingJson.prompts) ? existingJson.prompts.length : 0;
                        const localCount = Array.isArray(app.prompts) ? app.prompts.length : 0;
                        // If remote has data and local appears empty or much smaller, show modal to choose
                        if (remoteCount > 0 && (localCount === 0 || (localCount > 0 && localCount < Math.floor(remoteCount / 2)))) {
                            const action = await openDriveOverwriteModal(remoteCount, localCount);
                            if (action === 'cancel') {
                                showToast('Cancelado: no se sobrescribió Drive');
                                return;
                            }
                            if (action === 'merge') {
                                const merged = mergeRemoteLocal(existingJson);
                                app.prompts = merged.prompts;
                                app.folders = merged.folders;
                                app.tags = merged.tags;
                                app.colors = merged.colors;
                                app.favoriteFolders = merged.favoriteFolders;
                                saveData(true);
                                // Recompute payload from merged state
                                const mergedPayload = JSON.stringify({ prompts: app.prompts, folders: app.folders, tags: app.tags, colors: app.colors, favoriteFolders: app.favoriteFolders }, null, 2);
                                // rebuild multipart body with mergedPayload
                                const multipartRequestBodyMerged = delimiter
                                    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
                                    + JSON.stringify(metadata)
                                    + delimiter
                                    + 'Content-Type: application/json\r\n\r\n'
                                    + mergedPayload
                                    + close_delim;
                                // swap payload for upload
                                multipartRequestBody = multipartRequestBodyMerged;
                            }
                            // if action === 'overwrite' we proceed with current payload (local)
                        }
                    } catch(e) { /* ignore parse errors */ }
                }
            } catch(e) { /* ignore fetch errors */ }
        }

        let url, method;
        if (file && file.id) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=multipart`;
            method = 'PATCH';
        } else {
            url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            method = 'POST';
        }

        const res = await fetch(url, { method, headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipartRequestBody });
        if (!res.ok) throw new Error(await res.text());
        const newFile = await res.json();
        driveFileId = newFile.id;
        try { localStorage.setItem('drive_file_id', driveFileId); } catch(e){}
        document.getElementById('db-status-menu').textContent = `DB Conectada: ${DRIVE_FILE_NAME}`;
        showToast('Guardado en Google Drive');
        updateSyncStatus('Guardado en Drive', 'var(--accent)');
    } catch (e) {
        console.error('saveToDrive error', e);
        showToast('Error al guardar en Drive');
    }
}

async function loadFromDrive(skipConfirm = false) {
    if (!driveAccessToken) { showToast('No conectado a Drive'); return; }
    try {
        let file = null;
        if (driveFileId) {
            const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,modifiedTime`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
            if (metaRes.ok) file = await metaRes.json(); else { driveFileId = null; try { localStorage.removeItem('drive_file_id'); } catch(e){} }
        }
        if (!file) file = await findDriveFile();
        if (!file) { showToast('No se encontró archivo en Drive'); return; }
        const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
        if (!contentRes.ok) throw new Error(await contentRes.text());
        const json = await contentRes.json();
        const val = validateImportData(json);
        if (!val.ok) { await showAlert('El archivo en Drive no contiene datos válidos.', 'Archivo inválido'); return; }
        if (skipConfirm || await showConfirm('Cargar datos desde Drive y sobrescribir los locales?', 'Cargar desde Drive')) {
            try {
                app.isLoadingFromDrive = true;
                app.prompts = json.prompts;
                app.folders = json.folders;
                app.tags = json.tags || [];
                app.colors = json.colors || {};
                app.favoriteFolders = json.favoriteFolders || [];
                saveData(true);
                showToast('Cargado desde Google Drive');
                updateSyncStatus('Cargado desde Drive', 'var(--accent)');
            } finally {
                app.isLoadingFromDrive = false;
            }
        }
    } catch (e) {
        console.error('loadFromDrive error', e);
        showToast('Error cargando desde Drive');
    }
}

async function disconnectDrive() {
    try {
        if (driveAccessToken) {
            await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(driveAccessToken), { method: 'POST', headers: { 'Content-type': 'application/x-www-form-urlencoded' } });
        }
    } catch (e) { /* ignore */ }
    driveAccessToken = null; driveTokenClient = null; driveFileId = null;
    try { localStorage.removeItem('drive_access_token'); localStorage.removeItem('drive_file_id'); } catch(e){}
    document.getElementById('db-status-menu').textContent = 'Modo: localhost (Navegador)';
    document.getElementById('db-status-menu').style.color = 'var(--text-muted)';
    showToast('Drive desconectado');
    updateSyncStatus('Inactiva');
}

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

window.onload = () => {
    if(localStorage.getItem(KEYS.THEME) === 'light') document.body.classList.add('light-mode');
    
    loadData(true); 

    runTrashCleanup();
    renderApp();
    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.addEventListener('input', debounce(() => renderPrompts(), 200));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });
    setupTagAutocomplete();
    initUIBindings();
    initDrive();
    
    setInterval(checkFileForChanges, 5000); 
};

function initUIBindings() {
    const safe = (id, fn) => { try { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); } catch(e){} };

    // Sidebar & mobile
    safe('sidebar-overlay', toggleSidebar);
    safe('btn-close-sidebar-mobile', toggleSidebar);
    safe('menu-btn', toggleSidebar);

    // Navigation
    safe('nav-all', () => { setView('all'); closeSidebarMobile(); });
    safe('nav-favorites', () => { setView('favorites'); closeSidebarMobile(); });

    // Folder controls
    safe('btn-open-folder-sort', openFolderSortMenu);
    safe('btn-new-folder', () => openFolderModal('create'));
    safe('btn-apply-folder-sort', applyFolderSort);
    safe('btn-save-folder', saveFolder);

    // Tags
    safe('multi-tag-btn', toggleMultiSelect);
    safe('btn-new-tag', openTagModalCreate);
    safe('btn-open-tag-manager', openTagManager);
    safe('btn-cancel-new-tag', closeAllModals);
    safe('btn-create-new-tag', saveNewTag);

    // Search / UI toggles
    safe('btn-mobile-search-close', toggleMobileSearch);
    safe('btn-toggle-filter-panel', () => toggleUI('filter-panel'));
    safe('btn-clear-filters', clearFilters);
    safe('clear-filters-btn', clearFilters);
    safe('btn-toggle-theme', toggleTheme);
    safe('btn-toggle-sort-menu', () => toggleUI('sort-menu'));

    // Sort items
    const sortMap = [ ['sort-type-date', () => setSort('type', 'date')], ['sort-type-folder', () => setSort('type', 'folder')], ['sort-type-tag', () => setSort('type', 'tag')], ['sort-dir-asc', () => setSort('dir', 'asc')], ['sort-dir-desc', () => setSort('dir', 'desc')] ];
    sortMap.forEach(([id, fn]) => { try { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); } catch(e){} });

    // Export / DB
    safe('btn-toggle-export-menu', () => toggleUI('export-menu'));
    safe('btn-load-db', loadDatabaseFile);
    safe('btn-save-db', saveDatabaseFile);
    safe('btn-export-json', () => exportData('json'));
    safe('btn-export-txt', () => exportData('txt'));
    safe('btn-export-csv', () => exportData('csv'));
    // Drive integration (connect / sync / disconnect)
    safe('btn-connect-drive', connectDrive);
    safe('btn-drive-sync', saveToDrive);
    safe('btn-drive-disconnect', disconnectDrive);

    // Help / New prompt
    safe('btn-open-help', openHelpPage);
    safe('btn-new-prompt', () => openPromptModal());
    safe('btn-save-prompt', savePrompt);

    // Modal close buttons (common)
    document.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', closeAllModals));

    // Import file input
    try { const imp = document.getElementById('import-file'); if (imp) imp.addEventListener('change', importData); } catch(e){}
}

window.onresize = () => {
    if(window.innerWidth > 768) {
        document.body.style.overflow = '';
        document.getElementById('sidebar-overlay').classList.remove('show');
        document.getElementById('app-sidebar').classList.remove('open');
        const sw = document.getElementById('search-bar-container');
        if(sw) sw.classList.remove('active-mobile');
        const btnClose = document.getElementById('btn-mobile-search-close');
        if(btnClose) btnClose.style.display = 'none';
    }
};

/* --- LÓGICA DE SINCRONIZACIÓN Y ACCESO A ARCHIVOS --- */

async function applyFileHandle(handle) {
    app.fileHandle = handle;
    const file = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);

    app.prompts = data.prompts;
    app.folders = data.folders;
    app.tags = data.tags || [];
    app.colors = data.colors || {};
    app.favoriteFolders = data.favoriteFolders || []; 
    app.lastModified = file.lastModified; 
    
    // Do NOT attempt to serialize FileHandle into localStorage. Browsers do not
    // provide a stable serializable representation across sessions and the
    // original code relied on non-standard helpers. Store only lastModified.
    try { localStorage.setItem(KEYS.LAST_MODIFIED, String(file.lastModified)); } catch (e) { /* ignore */ }

    saveData(true); 
    document.getElementById('db-status-menu').textContent = `DB Conectada: ${file.name}`;
    document.getElementById('db-status-menu').style.color = 'var(--accent)';
    showToast(`Base de datos cargada: ${file.name}`);
}

async function checkFileForChanges() {
    if (!app.fileHandle) return;

    try {
        const permission = await app.fileHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') return; 

        const file = await app.fileHandle.getFile();
        if (file.lastModified > app.lastModified) {
            if (await showConfirm(`El archivo "${file.name}" ha sido modificado externamente (por otro navegador/programa). ¿Quieres recargarlo ahora y perder los cambios locales no guardados?`, 'Archivo actualizado')) {
                await applyFileHandle(app.fileHandle);
                showToast(`Sincronización automática: ${file.name} actualizado.`);
            } else {
                document.getElementById('db-status-menu').textContent = `DB Pendiente de Sincronizar`;
                document.getElementById('db-status-menu').style.color = 'var(--warning)'; 
            }
        } else {
             document.getElementById('db-status-menu').textContent = `DB Conectada: ${file.name}`;
             document.getElementById('db-status-menu').style.color = 'var(--accent)';
        }
    } catch (err) {
        console.warn("Fallo al chequear cambios:", err);
        document.getElementById('db-status-menu').textContent = `⚠ DB Desconectada / Archivo perdido`;
        document.getElementById('db-status-menu').style.color = 'var(--danger)';
    }
}

async function loadDatabaseFile(isAutoLoad = false) {
    // Auto-load of a previously used FileHandle is intentionally disabled.
    // Serializing/restoring FileHandles across sessions is unreliable and
    // non-standard. Manual open is required by the user for file access.
    if (isAutoLoad) return;

    // If connected to Drive offer to load from Drive first
    try {
        if (driveAccessToken && await showConfirm('Se detectó conexión con Google Drive. ¿Deseas cargar la base de datos desde Drive en lugar de un archivo local?', 'Carga desde Drive')) {
            await loadFromDrive();
            return;
        }
    } catch(e){}

    // Modo Carga Manual
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
            multiple: false
        });
        await applyFileHandle(handle);
    } catch (err) {
        console.error(err);
        // Fallback to the hidden file input when showOpenFilePicker isn't available
        const importEl = document.getElementById('import-file');
        if (importEl) importEl.click();
    }
}

async function saveDatabaseFile() {
    if (!app.fileHandle) {
        try {
            if ('showSaveFilePicker' in window) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'prompt_manager_db.json',
                    types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }]
                });
                app.fileHandle = handle;
            } else {
                // No FileSystem API: fallback to client-side download
                exportData('json');
                return;
            }
        } catch (err) { return; }
    }
    
    try {
        const writable = await app.fileHandle.createWritable();
        const data = { prompts: app.prompts, folders: app.folders, tags: app.tags, colors: app.colors, favoriteFolders: app.favoriteFolders };
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        
        const file = await app.fileHandle.getFile();
        app.lastModified = file.lastModified;
        try { localStorage.setItem(KEYS.LAST_MODIFIED, String(app.lastModified)); } catch(e){}
        
        document.getElementById('db-status-menu').textContent = `DB Conectada: ${file.name}`;
        showToast('Guardado en disco físico');
    } catch (err) {
        console.error(err);
        exportData('json'); 
    }
}

function loadData(isInitialLoad = false) {
    try {
        app.prompts = JSON.parse(localStorage.getItem(KEYS.PROMPTS)) || [];
        app.folders = JSON.parse(localStorage.getItem(KEYS.FOLDERS)) || ['General', 'Marketing', 'SEO', 'Código'];
        app.tags = JSON.parse(localStorage.getItem(KEYS.TAGS)) || [];
        app.colors = JSON.parse(localStorage.getItem(KEYS.COLORS)) || {};
        app.favoriteFolders = JSON.parse(localStorage.getItem(KEYS.FAV_FOLDERS)) || []; 
        app.lastModified = parseInt(localStorage.getItem(KEYS.LAST_MODIFIED)) || 0;

        if(!app.folders.includes('General')) app.folders.unshift('General');
        if(!app.folders.includes(TRASH_NAME)) app.folders.push(TRASH_NAME);
        cleanupTags(); app.tags.sort();

        // Do not attempt to auto-restore a serialized FileHandle — skip auto-load.
        const statusEl = document.getElementById('db-status-menu');
        if (statusEl) {
            statusEl.textContent = `Modo: localhost (Navegador)`;
            statusEl.style.color = 'var(--text-muted)';
        }
        
    } catch(e) { console.error(e); }
}

function saveData(skipFile = false) {
    localStorage.setItem(KEYS.PROMPTS, JSON.stringify(app.prompts));
    localStorage.setItem(KEYS.FOLDERS, JSON.stringify(app.folders));
    localStorage.setItem(KEYS.TAGS, JSON.stringify(app.tags));
    localStorage.setItem(KEYS.COLORS, JSON.stringify(app.colors));
    localStorage.setItem(KEYS.FAV_FOLDERS, JSON.stringify(app.favoriteFolders));
    renderApp();

    if (app.fileHandle && !skipFile) {
        if (app.saveTimeout) clearTimeout(app.saveTimeout);
        app.saveTimeout = setTimeout(() => { saveDatabaseFile(); }, 2000);
    }

    // Automatic Drive sync: if connected and not currently loading from Drive, schedule a save
    try {
        if (driveAccessToken && !app.isLoadingFromDrive) {
            if (app.driveSaveTimeout) clearTimeout(app.driveSaveTimeout);
            app.driveSaveTimeout = setTimeout(() => { try { saveToDrive(); } catch(e){} }, 1500);
        }
    } catch(e){}
}

function duplicatePrompt(id) {
    const original = app.prompts.find(p => p.id === id);
    if (original) {
        const newPrompt = {
            ...original,
            id: Date.now(),
            title: `COPIA: ${original.title}`,
            fav: false,
            deletedAt: null
        };
        app.prompts.unshift(newPrompt);
        saveData();
        showToast('Prompt duplicado');
    }
}

function toggleFolderFav(folderName) {
    // Accept encoded names coming from UI: decode safely
    const name = typeof folderName === 'string' ? decodeURIComponent(folderName) : folderName;
    const index = app.favoriteFolders.indexOf(name);
    if (index > -1) {
        app.favoriteFolders.splice(index, 1);
        showToast(`Carpeta "${name}" eliminada de Favoritos`);
    } else {
        app.favoriteFolders.push(name);
        showToast(`Carpeta "${name}" añadida a Favoritos`);
    }
    saveData();
}

function openFolderSortMenu() {
    closeAllModals();
    document.getElementById('f-sort-type').value = app.folderSort.type;
    document.getElementById('f-sort-dir').value = app.folderSort.dir;
    document.getElementById('folder-sort-modal').classList.add('open');
}

function applyFolderSort() {
    app.folderSort.type = document.getElementById('f-sort-type').value;
    app.folderSort.dir = document.getElementById('f-sort-dir').value;
    saveData(true); 
    closeAllModals();
}

function countPromptsInFolder(folderName) {
    return app.prompts.filter(p => p.cat === folderName).length;
}


function cleanupTags() { const usedTags = new Set(); app.prompts.forEach(p => { if (p.tags) p.tags.forEach(t => usedTags.add(t)); }); app.tags = app.tags.filter(t => usedTags.has(t)); app.filters.tags = app.filters.tags.filter(t => app.tags.includes(t)); }
function renderApp() { renderSidebar(); renderPrompts(); document.querySelectorAll('.menu-item').forEach(a => a.classList.remove('active')); const tEl = document.getElementById(`sort-type-${app.sort.type}`); if(tEl) tEl.classList.add('active'); const dEl = document.getElementById(`sort-dir-${app.sort.dir}`); if(dEl) dEl.classList.add('active'); }
function toggleMobileSearch() { const wrapper = document.getElementById('search-bar-container'); const btnClose = document.getElementById('btn-mobile-search-close'); const input = document.getElementById('search-input'); const isActive = wrapper.classList.toggle('active-mobile'); btnClose.style.display = isActive ? 'flex' : 'none'; if(isActive) input.focus(); }
function toggleSidebar() { const sb = document.getElementById('app-sidebar'); const ov = document.getElementById('sidebar-overlay'); sb.classList.toggle('open'); ov.classList.toggle('show'); document.body.style.overflow = sb.classList.contains('open') ? 'hidden' : ''; }
function closeSidebarMobile() { if(window.innerWidth <= 768) { document.getElementById('app-sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('show'); document.body.style.overflow = ''; } }
function renderSidebar() { 
    const isGlobal = app.view === 'all' && app.filters.tags.length === 0; 
    document.getElementById('nav-all').className = `folder-item ${isGlobal ? 'active' : ''}`; 
    document.getElementById('nav-favorites').className = `folder-item ${app.view === 'favorites' ? 'active' : ''}`; 
    const msBtn = document.getElementById('multi-tag-btn'); 
    if(msBtn) msBtn.className = `icon-btn-small ${app.multiSelectMode ? 'active' : ''}`; 

    const fList = document.getElementById('folder-list'); fList.innerHTML = ''; 
    const favFList = document.getElementById('favorite-folder-list'); favFList.innerHTML = '';
    const favHeader = document.getElementById('fav-folder-header');
    const favSeparator = document.getElementById('fav-folder-separator');

    // 1. Renderizar Carpetas Favoritas (solo las activas)
    const activeFavFolders = app.favoriteFolders.filter(f => app.folders.includes(f));
    if (activeFavFolders.length > 0) {
        favHeader.style.display = 'flex';
        favSeparator.style.display = 'block';
        activeFavFolders.forEach(f => {
            const isActive = (app.view === 'folder' && app.currentFolder === f && app.filters.tags.length === 0);
            const el = createFolderElement(f, isActive, true);
            favFList.appendChild(el);
        });
    } else {
        favHeader.style.display = 'none';
        favSeparator.style.display = 'none';
    }


    // 2. Preparar Carpetas Regulares (incluye General y excluye Papelera)
    let regularFolders = app.folders.filter(f => f !== TRASH_NAME && f !== 'General');
    
    // 3. Ordenar Carpetas Regulares (incluidas las que ya están en favoritos)
    if (app.folderSort.type === 'name') {
        regularFolders.sort((a, b) => {
            const comparison = a.localeCompare(b);
            return app.folderSort.dir === 'asc' ? comparison : -comparison;
        });
    } else if (app.folderSort.type === 'count') {
        regularFolders.sort((a, b) => {
            const countA = countPromptsInFolder(a);
            const countB = countPromptsInFolder(b);
            const comparison = countA - countB;
            if (comparison === 0) return a.localeCompare(b);
            return app.folderSort.dir === 'asc' ? comparison : -comparison;
        });
    }

    // 4. Renderizar Carpeta General (siempre la primera del listado principal)
    const generalActive = (app.view === 'folder' && app.currentFolder === 'General' && app.filters.tags.length === 0); 
    const gEl = createFolderElement('General', generalActive, app.favoriteFolders.includes('General'));
    fList.appendChild(gEl); 

    // 5. Renderizar Carpetas Regulares y Favoritas (todas)
    regularFolders.forEach(f => { 
        const isActive = (app.view === 'folder' && app.currentFolder === f && app.filters.tags.length === 0); 
        const isFavorite = app.favoriteFolders.includes(f); 
        const el = createFolderElement(f, isActive, isFavorite);
        fList.appendChild(el); 
    }); 

    // 6. Renderizar Papelera
    if(app.folders.includes(TRASH_NAME)) { 
        const tActive = (app.view === 'folder' && app.currentFolder === TRASH_NAME); 
        const tEl = createFolderElement(TRASH_NAME, tActive, false);
        fList.appendChild(tEl); 
    } 

    const tList = document.getElementById('tag-list'); tList.innerHTML = ''; 
    app.tags.forEach(t => { 
        const isSelected = app.filters.tags.includes(t); 
        const el = document.createElement('div'); el.className = `folder-item ${isSelected ? 'selected' : ''}`; 
        el.onclick = (e) => { toggleTagFilter(t, e); closeSidebarMobile(); };

        // Left side: color dot + name
        const left = document.createElement('div'); left.className = 'folder-left';
        const dot = document.createElement('div'); dot.className = 'tag-dot';
        dot.style.background = app.colors[t] || getColor(t);
        const nameSpan = document.createElement('span'); nameSpan.className = 'folder-name'; nameSpan.textContent = t;
        left.appendChild(dot); left.appendChild(nameSpan);

        // Right side: color swatch button to edit tag color
        const swatchBtn = document.createElement('button');
        swatchBtn.className = 'tag-color-swatch';
        swatchBtn.title = `Cambiar color de etiqueta "${t}"`;
        swatchBtn.setAttribute('aria-label', `Cambiar color de etiqueta ${t}`);
        swatchBtn.style.background = app.colors[t] || getColor(t);
        swatchBtn.addEventListener('click', (ev) => { ev.stopPropagation(); openColorPopover(t, swatchBtn); });

        el.appendChild(left);
        el.appendChild(swatchBtn);
        tList.appendChild(el);
    }); 
    document.getElementById('clear-filters-btn').style.display = (app.filters.tags.length > 0 || document.getElementById('search-input').value || document.getElementById('filter-date-start').value) ? 'block' : 'none'; 
}

// V9.6/V9.7/V9.8: Función helper para crear el elemento de carpeta (con botones de acción)
function createFolderElement(f, isActive, isFavorite) {
    const el = document.createElement('div');
    const safeName = escapeHtml(f);
    const encName = encodeURIComponent(f);
    const isSpecial = f === TRASH_NAME; // General ahora puede ser favorita

    el.className = `folder-item ${isActive ? 'active' : ''}`;
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag-over'); };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = e => movePromptToFolder(e, f);
    el.onclick = e => { if (!e.target.closest('button')) { setView('folder', f); closeSidebarMobile(); } };

    let iconSvg, actionsHtml = '';
    
    // Iconos de carpeta según el tipo
    if (f === TRASH_NAME) {
        iconSvg = `<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
    } else {
        iconSvg = `<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    }

    // Acciones de carpeta (excepto Papelera)
    if (!isSpecial) {
        // Build actions using DOM to avoid inline JS with user data.
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'folder-actions';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.alignItems = 'center';

        const favBtn = document.createElement('button');
        favBtn.className = 'icon-btn-small';
        favBtn.style.marginRight = '2px';
        favBtn.title = isFavorite ? 'Quitar de Favoritos' : 'Añadir a Favoritos';
        favBtn.innerHTML = isFavorite
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:var(--warning);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        favBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFolderFav(encodeURIComponent(f)); });

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn-small btn-edit';
        editBtn.style.marginRight = '2px';
        editBtn.title = 'Renombrar';
        editBtn.innerHTML = `<svg class="icon-flip" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); openFolderRenameSafe(encName); });

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn-small btn-delete';
        delBtn.title = 'Mover a Papelera';
        delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteFolder(encName); });

        actionsDiv.appendChild(favBtn);
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);

        el.innerHTML = `<div class="folder-left">${iconSvg}<span class="folder-name">${safeName}</span></div>`;
        el.appendChild(actionsDiv);
    } else {
        el.innerHTML = `<div class="folder-left">${iconSvg}<span class="folder-name">${safeName}</span></div>`;
    }

    return el;
}

async function deleteFolder(encodedName) {
    const name = decodeURIComponent(encodedName);
    if (name === 'General' || name === TRASH_NAME) return;
    const ok = await showConfirm(`¿Eliminar carpeta "${name}"? Prompts a Papelera.`, 'Eliminar Carpeta');
    if (!ok) return;
    app.prompts.forEach(p => { if (p.cat === name) { p.cat = TRASH_NAME; p.deletedAt = Date.now(); } });
    app.folders = app.folders.filter(f => f !== name);
    app.favoriteFolders = app.favoriteFolders.filter(f => f !== name);
    if (app.currentFolder === name) { app.view = 'all'; app.currentFolder = null; }
    saveData();
    showToast('Carpeta eliminada');
}


function setView(type, folder=null) { app.view = type; app.currentFolder = folder; if(type === 'folder') app.filters.tags = []; renderApp(); }
function toggleMultiSelect() { app.multiSelectMode = !app.multiSelectMode; if(!app.multiSelectMode) app.filters.tags = []; renderSidebar(); renderPrompts(); }
function toggleTagFilter(t, e) { const isAdditive = app.multiSelectMode || (e && (e.ctrlKey || e.metaKey)); if(isAdditive) { const i = app.filters.tags.indexOf(t); if(i > -1) app.filters.tags.splice(i, 1); else app.filters.tags.push(t); } else { if(app.filters.tags.length===1 && app.filters.tags[0]===t) app.filters.tags=[]; else app.filters.tags=[t]; } if(app.filters.tags.length > 0) { app.view='all'; app.currentFolder=null; } renderApp(); }
function clearFilters() { app.filters.tags=[]; document.getElementById('search-input').value=''; document.getElementById('filter-date-start').value=''; document.getElementById('filter-date-end').value=''; app.view='all'; renderApp(); }
function setSort(k, v) { app.sort[k]=v; renderApp(); }
function toggleFav(id) { const p=app.prompts.find(x=>x.id===id); if(p) { p.fav=!p.fav; saveData(); } }
async function deletePrompt(id) {
    const p = app.prompts.find(x => x.id === id);
    if (!p) return false;
    if (p.cat === TRASH_NAME) {
        const ok = await showConfirm('¿Eliminar permanentemente?', 'Eliminar');
        if (ok) {
            app.prompts = app.prompts.filter(x => x.id !== id);
            cleanupTags();
            saveData();
            showToast('Eliminado');
        }
        return ok;
    } else {
        const ok = await showConfirm('¿Mover a papelera?', 'Mover a Papelera');
        if (ok) {
            p.cat = TRASH_NAME;
            p.deletedAt = Date.now();
            saveData();
            showToast('A la papelera');
        }
        return ok;
    }
}
function movePromptToFolder(e, c) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const id=+e.dataTransfer.getData('id'); const p=app.prompts.find(x=>x.id===id); if(p && p.cat !== c) { p.cat=c; saveData(); showToast(`Movido a ${c}`); } }
function copyPromptById(id) { const p=app.prompts.find(x=>x.id===id); if(p && p.content) navigator.clipboard.writeText(p.content).then(()=>showToast('Prompt Copiado')); }
function showToast(m) { const c=document.getElementById('toast-container'); const t=document.createElement('div'); t.className='toast'; t.textContent=m; c.appendChild(t); setTimeout(()=>t.remove(), 3000); }
function getColor(t) { if(app.colors[t]) return app.colors[t]; let h=0; for(let i=0;i<t.length;i++) h=t.charCodeAt(i)+((h<<5)-h); return PALETTE[Math.abs(h%PALETTE.length)]; }
function toggleTheme() { document.body.classList.toggle('light-mode'); localStorage.setItem(KEYS.THEME, document.body.classList.contains('light-mode')?'light':'dark'); }
function toggleUI(id) { const el=document.getElementById(id); const v=el.classList.contains('show'); document.querySelectorAll('.floating-menu').forEach(x=>x.classList.remove('show')); if(!v) el.classList.add('show'); }
document.addEventListener('click', (e) => { if(!e.target.closest('.relative-wrapper') && !e.target.closest('.floating-menu')) { document.querySelectorAll('.floating-menu').forEach(x => x.classList.remove('show')); } });
function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('open')); }
function openViewModal(id) { 
    closeAllModals(); 
    const p = app.prompts.find(x => x.id === id); 
    if (!p) return; 
    document.getElementById('v-title').textContent = p.title || 'Sin Título'; 
    document.getElementById('v-description').textContent = p.description || 'Sin descripción.'; 
    document.getElementById('v-content').textContent = p.content || ''; 
    document.getElementById('v-btn-duplicate').onclick = () => { duplicatePrompt(p.id); closeAllModals(); };
    document.getElementById('v-btn-copy').onclick = () => copyPromptById(p.id); 
    document.getElementById('v-btn-edit').onclick = () => openPromptModal('edit', p.id); 
    const btnDel = document.getElementById('v-btn-delete'); 
    if(btnDel) { btnDel.onclick = async () => { if(await deletePrompt(p.id)) closeAllModals(); }; } 
    document.getElementById('view-modal').classList.add('open'); 
}
function openFolderRenameSafe(encodedName) { const name = decodeURIComponent(encodedName); openFolderModal('rename', name); }
function openPromptModal(mode, id) { closeAllModals(); const sel = document.getElementById('m-category'); sel.innerHTML = ''; app.folders.forEach(f => { if(f !== TRASH_NAME) sel.add(new Option(f, f)); }); if(mode === 'edit') { const p = app.prompts.find(x=>x.id===id); app.editId = id; document.getElementById('m-title').value = p.title || ''; document.getElementById('m-description').value = p.description || ''; document.getElementById('m-content').value = p.content || ''; document.getElementById('m-tags').value = (p.tags||[]).join(', '); sel.value = (p.cat === TRASH_NAME) ? 'General' : p.cat; } else { app.editId = null; document.getElementById('m-title').value = ''; document.getElementById('m-description').value = ''; document.getElementById('m-content').value = ''; document.getElementById('m-tags').value = ''; sel.value = (app.view==='folder'&&app.currentFolder&&app.currentFolder!==TRASH_NAME)?app.currentFolder:'General'; } document.getElementById('prompt-modal').classList.add('open'); setTimeout(()=>document.getElementById('m-title').focus(), 50); }
function savePrompt() { const title = document.getElementById('m-title').value.trim(); const desc = document.getElementById('m-description').value.trim(); const content = document.getElementById('m-content').value.trim(); const cat = document.getElementById('m-category').value; const tags = document.getElementById('m-tags').value.split(',').map(t=>t.trim()).filter(t=>t); if(!content) return; tags.forEach(t => { if(!app.tags.includes(t)) app.tags.push(t); }); app.tags.sort(); const finalTitle = title || (content.length > 50 ? content.substring(0, 50)+'...' : content); if(app.editId) { const p = app.prompts.find(x=>x.id===app.editId); p.title = finalTitle; p.description = desc; p.content = content; p.cat = cat; p.tags = tags; p.deletedAt = null; } else { app.prompts.unshift({ id: Date.now(), title: finalTitle, description: desc, content, cat, tags, fav: false }); } app.view='folder'; app.currentFolder=cat; clearFilters(); cleanupTags(); saveData(); closeAllModals(); showToast('Guardado'); }
function openFolderModal(mode, name) { closeAllModals(); document.getElementById('f-title').textContent = mode==='create'?'Nueva Carpeta':'Renombrar'; document.getElementById('f-name').value = name||''; app.editFolder = name; document.getElementById('folder-modal').classList.add('open'); setTimeout(()=>document.getElementById('f-name').focus(), 50); }
async function saveFolder() { 
    const name = document.getElementById('f-name').value.trim(); 
    if(!name || (app.folders.includes(name) && name !== app.editFolder)) { await showAlert('Nombre inválido', 'Guardar Carpeta'); return; }
    if (name === TRASH_NAME) { await showAlert('Nombre inválido (reservado para la Papelera)', 'Guardar Carpeta'); return; }
    if(app.editFolder) { 
        const o = app.editFolder; 
        app.folders[app.folders.indexOf(o)] = name; 
        app.prompts.forEach(p => { if(p.cat === o) p.cat = name }); 
        app.favoriteFolders = app.favoriteFolders.map(f => f === o ? name : f); 
        if(app.currentFolder === o) app.currentFolder = name; 
    } else { 
        app.folders.push(name); 
    }
    saveData(); closeAllModals(); 
}
function openTagModalCreate() { closeAllModals(); document.getElementById('quick-tag-name').value=''; document.getElementById('tag-create-modal').classList.add('open'); setTimeout(()=>document.getElementById('quick-tag-name').focus(), 50); }
function saveNewTag() { const n=document.getElementById('quick-tag-name').value.trim(); if(n&&!app.tags.includes(n)){app.tags.push(n);app.tags.sort();saveData();} closeAllModals(); }
function openTagManager() { closeAllModals(); renderTagManager(); document.getElementById('tag-modal').classList.add('open'); }
function renderTagManager() { 
    const c = document.getElementById('tag-list-manager');
    c.innerHTML = '';
    app.tags.forEach(t => {
        const r = document.createElement('div');
        r.className = 'tag-manager-row';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '10px';
        left.style.width = '100%';

        const pid = 'pal-' + encodeURIComponent(t).replace(/%/g, '_');

        const colorBtn = document.createElement('div');
        colorBtn.className = 'color-btn';
        colorBtn.style.background = getColor(t);
        colorBtn.style.cursor = 'pointer';
        colorBtn.addEventListener('click', () => togglePalette(pid));

        const palette = document.createElement('div');
        palette.id = pid;
        palette.className = 'color-palette';
        palette.style.display = 'none';
        palette.style.gridTemplateColumns = 'repeat(5, 1fr)';
        PALETTE.forEach(col => {
            const item = document.createElement('div');
            item.className = 'palette-item';
            item.style.background = col;
            item.addEventListener('click', () => setColor(t, col));
            palette.appendChild(item);
        });

        const input = document.createElement('input');
        input.className = 'input-line';
        input.style.padding = '5px';
        input.value = t;
        input.addEventListener('change', function() { renameTag(t, this.value); });

        left.appendChild(colorBtn);
        left.appendChild(palette);
        left.appendChild(input);

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn-small';
        delBtn.style.color = 'var(--danger)';
        delBtn.title = 'Eliminar Etiqueta';
        delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        delBtn.addEventListener('click', () => delTag(t));

        r.appendChild(left);
        r.appendChild(delBtn);
        c.appendChild(r);
    });
}
function renameTag(o,n){n=n.trim();if(n&&!app.tags.includes(n)){app.tags[app.tags.indexOf(o)]=n;app.prompts.forEach(p=>p.tags=p.tags?.map(t=>t===o?n:t));if(app.colors[o]){app.colors[n]=app.colors[o];delete app.colors[o];}saveData();openTagManager();}}
async function delTag(t){
    if (!await showConfirm(`¿Eliminar etiqueta "${t}"?`, 'Eliminar etiqueta')) return;
    app.tags=app.tags.filter(x=>x!==t);
    app.prompts.forEach(p=>p.tags=p.tags?.filter(x=>x!==t));
    app.filters.tags=app.filters.tags.filter(x=>x!==t);
    saveData();
    openTagManager();
}
function togglePalette(id){
    document.querySelectorAll('.color-palette').forEach(p => { if (p.id !== id) p.style.display = 'none'; });
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'grid' : 'none';
}
function setColor(t,c){app.colors[t]=c;saveData();openTagManager();}
function exportData(f){
    if(!app.prompts.length) return showToast('Vacío');
    const download = (content, type, filename) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 200);
    };

    if (f === 'json') {
        const data = {
            prompts: app.prompts,
            folders: app.folders,
            tags: app.tags,
            colors: app.colors,
            favoriteFolders: app.favoriteFolders
        };
        download(JSON.stringify(data, null, 2), 'application/json', 'backup.json');
        return;
    }

    if (f === 'csv') {
        const header = 'ID,Título,Descripción,Prompt,Carpeta\n';
        const rows = app.prompts.map(p => {
            const qt = (str) => `"${(str||'').replace(/"/g,'""')}"`;
            return `${p.id},${qt(p.title)},${qt(p.description)},${qt(p.content)},${qt(p.cat)}`;
        }).join('\n');
        download(header + rows, 'text/csv', 'prompts.csv');
        return;
    }

    if (f === 'txt') {
        const txt = app.prompts.map(p => `[${p.cat}] ${p.title}\nDesc: ${p.description}\n---\n${p.content}`).join('\n\n================\n\n');
        download(txt, 'text/plain', 'prompts.txt');
        return;
    }
}
// Renderiza las tarjetas de prompts en el grid principal
function renderPrompts() {
    const container = document.getElementById('prompts-grid');
    if (!container) return;
    container.innerHTML = '';

    // Aplicar filtros
    let list = app.prompts.slice();

    // Filtrar por vista
    if (app.view === 'favorites') {
        list = list.filter(p => p.fav);
    } else if (app.view === 'folder' && app.currentFolder) {
        list = list.filter(p => p.cat === app.currentFolder);
    }

    // Excluir elementos en la Papelera de la vista 'Todos' o 'Favoritos'
    // Solo mostrar la Papelera cuando la vista activa sea la carpeta Papelera
    if (!(app.view === 'folder' && app.currentFolder === TRASH_NAME)) {
        list = list.filter(p => p.cat !== TRASH_NAME);
    }

    // Filtrar por tags (AND behaviour: show items that include ANY selected tag)
    if (app.filters.tags && app.filters.tags.length) {
        list = list.filter(p => (p.tags || []).some(t => app.filters.tags.includes(t)));
    }

    // Filtro de búsqueda
    const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
    if (q) {
        list = list.filter(p => ((p.title || '') + ' ' + (p.description || '') + ' ' + (p.content || '')).toLowerCase().includes(q));
    }

    // Filtro de fechas (si existen timestamps en el objeto)
    const start = document.getElementById('filter-date-start')?.value;
    const end = document.getElementById('filter-date-end')?.value;
    if ((start || end) && list.length) {
        const sTs = start ? new Date(start).getTime() : null;
        const eTs = end ? new Date(end).getTime() + 24*60*60*1000 - 1 : null;
        list = list.filter(p => {
            const ts = p.createdAt || p.id || 0;
            return (sTs ? ts >= sTs : true) && (eTs ? ts <= eTs : true);
        });
    }

    // Ordenamiento
    if (app.sort.type === 'date') {
        list.sort((a, b) => (b.id || 0) - (a.id || 0));
    } else if (app.sort.type === 'folder') {
        list.sort((a, b) => (a.cat || '').localeCompare(b.cat || ''));
    } else if (app.sort.type === 'tag') {
        list.sort((a, b) => ((a.tags && a.tags[0]) || '').localeCompare((b.tags && b.tags[0]) || ''));
    }
    if (app.sort.dir === 'asc') list.reverse();

    // Contador
    const countEl = document.getElementById('prompt-count');
    if (countEl) countEl.textContent = `${list.length} prompts`;

    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state-wrapper';
        empty.innerHTML = `<div class="empty-icon">⚪</div><div>No hay prompts que coincidan.</div>`;
        container.appendChild(empty);
        return;
    }

    list.forEach(p => {
        const card = document.createElement('div');
        card.className = 'prompt-card';
        card.draggable = true;
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('id', String(p.id)); });
        card.addEventListener('click', () => openViewModal(p.id));

        // Top: title + fav
        const top = document.createElement('div'); top.className = 'card-top';
        const left = document.createElement('div');
        const title = document.createElement('div'); title.className = 'card-title-display'; title.textContent = p.title || '';
        const desc = document.createElement('div'); desc.className = 'card-desc-display'; desc.textContent = p.description || '';
        left.appendChild(title); left.appendChild(desc);

        const right = document.createElement('div');
        const favBtn = document.createElement('button'); favBtn.className = 'fav-btn';
        if (p.fav) favBtn.classList.add('active');
        favBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        favBtn.title = 'Favorito';
        favBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(p.id); renderPrompts(); });
        right.appendChild(favBtn);

        top.appendChild(left); top.appendChild(right);

        const content = document.createElement('div'); content.className = 'card-content-display'; content.textContent = p.content || '';

        // Footer: tags + actions
        const foot = document.createElement('div'); foot.className = 'card-foot';
        const stats = document.createElement('div'); stats.className = 'card-stats';
        const folderSpan = document.createElement('span'); folderSpan.style.fontWeight = '600'; folderSpan.style.color = 'var(--text-muted)'; folderSpan.textContent = p.cat || 'General';
        stats.appendChild(folderSpan);

        const actions = document.createElement('div'); actions.className = 'card-actions-group';

        const dup = document.createElement('button'); dup.className = 'btn-card'; dup.title = 'Duplicar'; dup.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        dup.addEventListener('click', (e) => { e.stopPropagation(); duplicatePrompt(p.id); renderPrompts(); });

        const copy = document.createElement('button'); copy.className = 'btn-card'; copy.title = 'Copiar'; copy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"></path></svg>';
        copy.addEventListener('click', (e) => { e.stopPropagation(); copyPromptById(p.id); });

        const edit = document.createElement('button'); edit.className = 'btn-card'; edit.title = 'Editar'; edit.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        edit.addEventListener('click', (e) => { e.stopPropagation(); openPromptModal('edit', p.id); });

        const del = document.createElement('button'); del.className = 'btn-card btn-delete'; del.title = 'Eliminar'; del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        del.addEventListener('click', async (e) => { e.stopPropagation(); if (await deletePrompt(p.id)) renderPrompts(); });

        actions.appendChild(dup); actions.appendChild(copy); actions.appendChild(edit); actions.appendChild(del);

        // Tags
        const tagContainer = document.createElement('div'); tagContainer.className = 'tags-container';
        (p.tags || []).forEach(t => {
                const sp = document.createElement('span'); sp.className = 'tag'; sp.textContent = t; sp.style.background = (app.colors && app.colors[t]) ? app.colors[t] : getColor(t); tagContainer.appendChild(sp);
        });

        foot.appendChild(stats);
        foot.appendChild(actions);

        card.appendChild(top);
        card.appendChild(content);
        card.appendChild(tagContainer);
        card.appendChild(foot);

        container.appendChild(card);
    });
}


function validateImportData(d) {
    const errors = [];
    if (!d || typeof d !== 'object') { errors.push('Archivo no es un objeto JSON válido'); return { ok: false, errors }; }
    if (!Array.isArray(d.prompts)) errors.push('Falta propiedad "prompts" como arreglo');
    if (!Array.isArray(d.folders)) errors.push('Falta propiedad "folders" como arreglo');
    if (!Array.isArray(d.tags)) errors.push('Falta propiedad "tags" como arreglo');
    if (d.colors && typeof d.colors !== 'object') errors.push('La propiedad "colors" debe ser un objeto');

    if (Array.isArray(d.prompts)) {
        d.prompts.forEach((p, i) => {
            if (typeof p !== 'object') errors.push(`Prompt[${i}] no es un objeto`);
            else {
                if (!('id' in p)) errors.push(`Prompt[${i}] falta 'id'`);
                if (!('content' in p)) errors.push(`Prompt[${i}] falta 'content'`);
                if (p.tags && !Array.isArray(p.tags)) errors.push(`Prompt[${i}] la propiedad 'tags' debe ser un arreglo`);
            }
        });
    }

    return { ok: errors.length === 0, errors };
}

// Generic confirm modal helper
function showConfirm(message, title = 'Confirmar') {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        if (!modal) return resolve(window.confirm(message));
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const ok = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');

        // Save previously focused element to restore later
        const prevFocus = document.activeElement;

        titleEl.textContent = title;
        msgEl.textContent = message;

        // Make modal accessible
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        modal.classList.add('open');
        modal.style.display = 'block';

        // Focus management & tab trap
        const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
        let firstFocusable = ok || focusable[0];
        let lastFocusable = focusable[focusable.length - 1] || ok;

        const keyHandler = (e) => {
            if (e.key === 'Tab') {
                if (focusable.length === 0) { e.preventDefault(); return; }
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) { e.preventDefault(); lastFocusable.focus(); }
                } else {
                    if (document.activeElement === lastFocusable) { e.preventDefault(); firstFocusable.focus(); }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault(); cleanup(false);
            }
        };

        const cleanup = (val) => {
            modal.classList.remove('open');
            modal.style.display = '';
            modal.removeAttribute('role');
            modal.removeAttribute('aria-modal');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            modal.querySelectorAll('.btn-close-modal').forEach(b => b.removeEventListener('click', onCancel));
            document.removeEventListener('keydown', keyHandler);
            try { if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus(); } catch(e){}
            resolve(val);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', onCancel));

        // Attach key handler and set initial focus
        document.addEventListener('keydown', keyHandler);
        try { (firstFocusable || ok).focus(); } catch(e){}
    });
}

// Simple alert modal (reuses confirm modal but shows only OK)
function showAlert(message, title = 'Aviso') {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        if (!modal) { alert((title ? title + '\n\n' : '') + message); return resolve(); }
        const ok = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');

        // Save previous focus
        const prevFocus = document.activeElement;

        titleEl.textContent = title;
        msgEl.textContent = message;

        // hide cancel while showing alert
        const prevCancelDisplay = cancel.style.display || '';
        cancel.style.display = 'none';

        // Make modal accessible
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-modal', 'true');

        modal.classList.add('open');
        modal.style.display = 'block';

        const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
        const firstFocusable = ok || focusable[0];
        const lastFocusable = focusable[focusable.length - 1] || ok;

        const keyHandler = (e) => {
            if (e.key === 'Tab') {
                if (focusable.length === 0) { e.preventDefault(); return; }
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) { e.preventDefault(); lastFocusable.focus(); }
                } else {
                    if (document.activeElement === lastFocusable) { e.preventDefault(); firstFocusable.focus(); }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault(); cleanup();
            }
        };

        const cleanup = () => {
            modal.classList.remove('open');
            modal.style.display = '';
            cancel.style.display = prevCancelDisplay;
            modal.removeAttribute('role');
            modal.removeAttribute('aria-modal');
            ok.removeEventListener('click', onOk);
            modal.querySelectorAll('.btn-close-modal').forEach(b => b.removeEventListener('click', onOk));
            document.removeEventListener('keydown', keyHandler);
            try { if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus(); } catch(e){}
            resolve();
        };

        const onOk = () => cleanup();
        ok.addEventListener('click', onOk, { once: true });
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', onOk, { once: true }));
        document.addEventListener('keydown', keyHandler);
        try { (firstFocusable || ok).focus(); } catch(e){}
    });
}

function updateSyncStatus(text, color) {
    try {
        const el = document.getElementById('sync-status');
        if (!el) return;
        el.textContent = `Sincronización: ${text}`;
        if (color) el.style.borderColor = color; else el.style.borderColor = '';
    } catch (e) {}
}

// Replace runTrashCleanup with async modal confirmation
async function runTrashCleanup() {
    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expired = app.prompts.filter(p => p.cat === TRASH_NAME && p.deletedAt && (now - p.deletedAt > SIXTY_DAYS_MS));
    if (expired.length > 0) {
        const ok = await showConfirm(`Limpieza: ${expired.length} elementos caducados en la papelera. ¿Eliminar?`, 'Limpieza Papelera');
        if (ok) {
            app.prompts = app.prompts.filter(p => !expired.includes(p));
            cleanupTags();
            saveData();
            showToast(`${expired.length} eliminados.`);
        }
    }
}

// --- Drive modal helpers and merge logic ---
function openDriveSyncModal(remoteCount, localCount) {
    return new Promise(resolve => {
        const modal = document.getElementById('drive-sync-modal');
        if (!modal) return resolve('keep');
        document.getElementById('drive-remote-count').textContent = String(remoteCount);
        document.getElementById('drive-local-count').textContent = String(localCount);
        modal.classList.add('open');
        modal.style.display = 'block';

        const cleanup = (action) => {
            modal.classList.remove('open');
            modal.style.display = '';
            resolve(action);
        };

        const btnLoad = document.getElementById('btn-drive-load');
        const btnMerge = document.getElementById('btn-drive-merge');
        const btnKeep = document.getElementById('btn-drive-keep');

        const onClose = () => cleanup('keep');

        btnLoad.addEventListener('click', () => cleanup('load'), { once: true });
        btnMerge.addEventListener('click', () => cleanup('merge'), { once: true });
        btnKeep.addEventListener('click', () => cleanup('keep'), { once: true });
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', onClose, { once: true }));
    });
}

function openDriveOverwriteModal(remoteCount, localCount) {
    return new Promise(resolve => {
        const modal = document.getElementById('drive-overwrite-modal');
        if (!modal) return resolve('cancel');
        document.getElementById('drive-overwrite-remote-count').textContent = String(remoteCount);
        document.getElementById('drive-overwrite-local-count').textContent = String(localCount);
        modal.classList.add('open');
        modal.style.display = 'block';

        const cleanup = (action) => {
            modal.classList.remove('open');
            modal.style.display = '';
            resolve(action);
        };

        const btnOverwrite = document.getElementById('btn-overwrite');
        const btnMerge = document.getElementById('btn-overwrite-merge');
        const btnCancel = document.getElementById('btn-overwrite-cancel');

        btnOverwrite.addEventListener('click', () => cleanup('overwrite'), { once: true });
        btnMerge.addEventListener('click', () => cleanup('merge'), { once: true });
        btnCancel.addEventListener('click', () => cleanup('cancel'), { once: true });
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', () => cleanup('cancel'), { once: true }));
    });
}

function mergeRemoteLocal(remoteJson) {
    const result = { prompts: [], folders: [], tags: [], colors: {}, favoriteFolders: [], added: 0 };
    const localMap = new Map();
    (app.prompts || []).forEach(p => localMap.set(String(p.id), p));
    // start from local
    result.prompts = (app.prompts || []).slice();
    // add remote prompts that are not present locally (by id)
    (remoteJson.prompts || []).forEach(rp => {
        if (!localMap.has(String(rp.id))) {
            result.prompts.push(rp);
            result.added++;
        }
    });
    // merge folders, tags, colors, favoriteFolders
    const folderSet = new Set(app.folders || []);
    (remoteJson.folders || []).forEach(f => folderSet.add(f));
    result.folders = Array.from(folderSet);
    const tagSet = new Set(app.tags || []);
    (remoteJson.tags || []).forEach(t => tagSet.add(t));
    result.tags = Array.from(tagSet).sort();
    result.colors = Object.assign({}, app.colors || {}, remoteJson.colors || {});
    const favSet = new Set(app.favoriteFolders || []);
    (remoteJson.favoriteFolders || []).forEach(f => favSet.add(f));
    result.favoriteFolders = Array.from(favSet);
    if (!result.folders.includes('General')) result.folders.unshift('General');
    if (!result.folders.includes(TRASH_NAME)) result.folders.push(TRASH_NAME);
    return result;
}

async function importData(){
    const f = document.getElementById('import-file')?.files?.[0];
    if (!f) { showToast('No se seleccionó archivo'); return; }
    const r = new FileReader();
    r.onload = async e => {
        try {
            const d = JSON.parse(e.target.result);
            const v = validateImportData(d);
            if (!v.ok) {
                await showAlert('Archivo inválido:\n' + v.errors.join('\n'), 'Importar archivo');
                return;
            }

            // Confirm overwrite
            if (!await showConfirm('Importar datos y sobrescribir la base actual?', 'Importar datos')) return;

            app.prompts = d.prompts || [];
            app.folders = d.folders || ['General'];
            app.tags = d.tags || [];
            app.colors = d.colors || {};
            if (!app.folders.includes('General')) app.folders.unshift('General');
            if (!app.folders.includes(TRASH_NAME)) app.folders.push(TRASH_NAME);
            cleanupTags(); app.tags.sort(); saveData(); showToast('Importado correctamente');
        } catch (x) {
            await showAlert('Error procesando el archivo: ' + (x.message || x), 'Importar archivo');
        }
    };
    r.readAsText(f);
}
function openHelpPage() { const helpContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Ayuda</title><style>body{font-family:sans-serif;padding:20px;line-height:1.6;max-width:800px;margin:0 auto;background:#131316;color:#f4f4f5}h1{color:#3b82f6}h2{border-bottom:1px solid #333;padding-bottom:10px}</style></head><body><h1>Ayuda</h1><p>Bienvenido a Prompt Manager Pro.</p><h2>Básico</h2><ul><li><strong>Crear:</strong> Botón azul "+ Nuevo".</li><li><strong>Editar:</strong> Clic en el icono lápiz de una tarjeta.</li></ul><h2>Importar/Exportar</h2><p>Usa los iconos de la barra superior para guardar tus datos (JSON recom.) o restaurarlos.</p></body></html>`; const blob = new Blob([helpContent], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); }
function setupTagAutocomplete() { const input = document.getElementById('m-tags'); const box = document.getElementById('tag-suggestions'); if (!input || !box) return; input.addEventListener('input', function(e) { const val = this.value; const cursorPos = this.selectionStart; const textBefore = val.slice(0, cursorPos); const lastComma = textBefore.lastIndexOf(','); const currentTerm = textBefore.slice(lastComma + 1).trim().toLowerCase(); if (currentTerm.length < 1) { box.classList.remove('show'); return; } const matches = app.tags.filter(t => t.toLowerCase().includes(currentTerm) && t.toLowerCase() !== currentTerm ); if (matches.length === 0) { box.classList.remove('show'); return; } box.innerHTML = ''; matches.forEach(tag => { const div = document.createElement('div'); div.className = 'suggestion-item'; div.innerHTML = `<span class="suggestion-dot" style="background:${getColor(tag)}"></span>${escapeHtml(tag)}`; div.onclick = () => { const textAfter = val.slice(cursorPos); const prefix = textBefore.slice(0, lastComma + 1); const newTextBefore = (lastComma === -1) ? tag + ', ' : textBefore.slice(0, lastComma + 1) + ' ' + tag + ', '; input.value = newTextBefore + textAfter; box.classList.remove('show'); input.focus(); }; box.appendChild(div); }); box.classList.add('show'); }); document.addEventListener('click', (e) => { if (!e.target.closest('.autocomplete-wrapper')) { box.classList.remove('show'); } }); }
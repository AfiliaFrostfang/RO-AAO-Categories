// ==UserScript==
// @name         Afilia Toolbox
// @namespace    https://afiliafrostfang.de/
// @version      1.5.2
// @description  Categorizes Rescue Operator AAOs and adds categorized AAO selection to the vehicle dispatch window.
// @author       AfiliaFrostfang
// @match        https://game.rescue-operator.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
       Configuration
       ========================================================= */

    const DB_NAME = 'AfiliaAAOCategoriesV2';
    const DB_VERSION = 1;
    const STORE_NAME = 'settings';
    const SCRIPT_NAME = 'Afilia Toolbox';
    const SCRIPT_VERSION = '1.5.2';
    const UPDATE_MANIFEST_URL =
        'https://afiliafrostfang.github.io/RO-AAO-Categories/version.json';
    const PROJECT_URL =
        'https://github.com/AfiliaFrostfang/RO-AAO-Categories';

    const SETTINGS_PANEL_ID = 'afilia-aao-category-panel';
    const DISPATCH_PANEL_ID = 'afilia-aao-dispatch-panel';
    const UPDATE_NOTICE_ID = 'afilia-aao-update-notice';

    const DEFAULT_CATEGORIES = [
        {
            id: 'fire',
            name: 'Brandbekämpfung',
            collapsed: false
        },
        {
            id: 'technical',
            name: 'Technische Hilfe',
            collapsed: false
        },
        {
            id: 'medical',
            name: 'Rettungsdienst',
            collapsed: false
        }
    ];

    /* =========================================================
       Runtime state
       ========================================================= */

    let db = null;

    let categories = [];
    let assignments = {};

    const aaoCatalog = new Map();
    const selectedAAOs = new Set();
    const originalAAORows = new Map();

    let observer = null;
    let scanTimer = null;

    let lastDispatchContainer = null;
    let lastSettingsContainer = null;

    let dispatchSearchValue = '';
    let draggedCategoryID = null;

    /* =========================================================
       IndexedDB
       ========================================================= */

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = event => {
                const database = event.target.result;

                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    function dbGet(key) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                STORE_NAME,
                'readonly'
            );

            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    function dbSet(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                STORE_NAME,
                'readwrite'
            );

            const store = transaction.objectStore(STORE_NAME);

            store.put(value, key);

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };
        });
    }

    /* =========================================================
       Utility
       ========================================================= */

    function normalizeName(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    function getAAOKey(name) {
        return normalizeName(name);
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function createID(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;
    }

    function compareVersions(left, right) {
        const leftParts = String(left)
            .split('.')
            .map(part => Number.parseInt(part, 10) || 0);

        const rightParts = String(right)
            .split('.')
            .map(part => Number.parseInt(part, 10) || 0);

        const length = Math.max(
            leftParts.length,
            rightParts.length
        );

        for (let index = 0; index < length; index += 1) {
            const difference =
                (leftParts[index] || 0) -
                (rightParts[index] || 0);

            if (difference !== 0) {
                return difference;
            }
        }

        return 0;
    }

    function isHTTPURL(value) {
        try {
            const url = new URL(value);

            return url.protocol === 'http:' ||
                url.protocol === 'https:';
        } catch {
            return false;
        }
    }

    function showUpdateNotice(manifest) {
        if (
            document.getElementById(
                UPDATE_NOTICE_ID
            )
        ) {
            return;
        }

        const version =
            String(manifest.version).trim();

        const releaseURL =
            isHTTPURL(manifest.url)
                ? manifest.url
                : PROJECT_URL;

        const notice =
            document.createElement('div');

        notice.id = UPDATE_NOTICE_ID;
        notice.className = 'afilia-update-notice';

        notice.innerHTML = `
            <div class="afilia-update-notice-content">
                <strong>Update verfügbar</strong>
                <span>
                    ${escapeHTML(SCRIPT_NAME)} ${escapeHTML(version)} ist verfügbar.
                </span>
            </div>

            <a
                class="afilia-update-notice-link"
                href="${escapeHTML(releaseURL)}"
                target="_blank"
                rel="noopener noreferrer"
            >
                Update öffnen
            </a>

            <button
                type="button"
                class="afilia-update-notice-close"
                title="Update-Hinweis schließen"
            >
                ×
            </button>
        `;

        notice.querySelector(
            '.afilia-update-notice-close'
        ).addEventListener(
            'click',
            () => notice.remove()
        );

        document.body.appendChild(notice);
    }

    async function checkForUpdates() {
        try {
            const response = await fetch(
                UPDATE_MANIFEST_URL,
                {
                    cache: 'no-store'
                }
            );

            if (!response.ok) {
                return;
            }

            const manifest = await response.json();

            if (
                !manifest ||
                typeof manifest.version !== 'string' ||
                compareVersions(
                    manifest.version,
                    SCRIPT_VERSION
                ) <= 0
            ) {
                return;
            }

            showUpdateNotice(manifest);
        } catch (error) {
            console.debug(
                '[Afilia Toolbox] Update check skipped:',
                error
            );
        }
    }

    function findCategory(categoryID) {
        return categories.find(
            category => category.id === categoryID
        );
    }

    async function moveCategoryBefore(
        categoryID,
        targetCategoryID
    ) {
        const sourceIndex = categories.findIndex(
            category => category.id === categoryID
        );

        const targetIndex = categories.findIndex(
            category => category.id === targetCategoryID
        );

        if (
            sourceIndex < 0 ||
            targetIndex < 0 ||
            sourceIndex === targetIndex
        ) {
            return;
        }

        const [category] = categories.splice(
            sourceIndex,
            1
        );

        const adjustedTargetIndex =
            sourceIndex < targetIndex
                ? targetIndex - 1
                : targetIndex;

        categories.splice(
            adjustedTargetIndex,
            0,
            category
        );

        await saveCategories();

        renderSettingsPanel();
        renderDispatchPanel();
    }

    function getCategoryForAAO(key) {
        const categoryID = assignments[key];

        if (!categoryID) {
            return null;
        }

        return findCategory(categoryID) || null;
    }

    /* =========================================================
       Load / save
       ========================================================= */

    async function loadData() {
        categories = await dbGet('categories');

        if (!Array.isArray(categories) || categories.length === 0) {
            categories = DEFAULT_CATEGORIES.map(category => ({
                ...category
            }));

            await dbSet('categories', categories);
        }

        assignments = await dbGet('assignments') || {};
    }

    async function saveCategories() {
        await dbSet('categories', categories);
    }

    async function saveAssignments() {
        await dbSet('assignments', assignments);
    }

    /* =========================================================
       AAO discovery
       ========================================================= */

    function getAAOContainers() {
        return Array.from(
            document.querySelectorAll(
                '[data-slot="sortable-content"]'
            )
        );
    }

    function isSettingsAAOContainer(container) {
        if (!container) {
            return false;
        }

        return !!container.querySelector(
            '[data-slot="sortable-item-handle"][title="AAO verschieben"]'
        );
    }

    function findSettingsAAOContainer() {
        return getAAOContainers().find(
            isSettingsAAOContainer
        ) || null;
    }

    function findDispatchDialog() {
        const dialogs = Array.from(
            document.querySelectorAll(
                '[role="dialog"][data-slot="sheet-content"]'
            )
        );

        return dialogs.find(dialog => {
            const search = dialog.querySelector(
                'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
            );

            if (!search) {
                return false;
            }

            return Array.from(
                dialog.querySelectorAll('h2')
            ).some(h2 => {
                return h2.textContent.trim() ===
                    'Fahrzeuge alarmieren';
            });
        }) || null;
    }

    function findDispatchList(dialog) {
        if (!dialog) {
            return null;
        }

        const searchInput = dialog.querySelector(
            'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
        );

        if (!searchInput) {
            return null;
        }

        const candidates = Array.from(
            dialog.querySelectorAll('div.space-y-2')
        );

        for (const candidate of candidates) {
            const cards = getDispatchCards(candidate);

            if (cards.length > 0) {
                return candidate;
            }
        }

        return null;
    }

    function isDispatchAAOModeEnabled(dialog) {
        if (!dialog) {
            return false;
        }

        if (dialog.querySelector('[data-drag-vehicle-id]')) {
            return false;
        }

        const modeControl = Array.from(
            dialog.querySelectorAll(
                'button, [role="button"], [role="switch"], input[type="checkbox"]'
            )
        ).find(control => {
            const label = (
                control.getAttribute('aria-label') ||
                control.getAttribute('title') ||
                control.textContent
            )
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

            return label === 'aao modus' ||
                label === 'aao mode' ||
                label.includes('aao-modus');
        });

        if (!modeControl) {
            return true;
        }

        const state = modeControl.getAttribute('data-state');
        const pressed = modeControl.getAttribute('aria-pressed');
        const checked = modeControl.getAttribute('aria-checked');

        return state !== 'off' &&
            state !== 'unchecked' &&
            pressed !== 'false' &&
            checked !== 'false' &&
            (!('checked' in modeControl) || modeControl.checked);
    }

    function removeDispatchPanel(dialog, list) {
        const panel = dialog && dialog.querySelector(
            `#${DISPATCH_PANEL_ID}`
        );

        if (panel) {
            panel.remove();
        }

        if (list) {
            list.style.display = '';
        }

        selectedAAOs.clear();
    }

    function getDispatchCards(container) {
        if (!container) {
            return [];
        }

        return Array.from(container.children).filter(child => {
            return child.matches('[data-slot="card"]') ||
                !!child.querySelector(
                    'div.font-semibold.text-sm.text-gray-900'
                );
        });
    }

    function discoverAAOs() {
        let changed = false;

        /* -----------------------------------------------------
           Settings AAOs
           ----------------------------------------------------- */

        const settingsContainer =
            findSettingsAAOContainer();

        if (settingsContainer) {
            const seenSettingsKeys = new Set();

            const rows = Array.from(
                settingsContainer.querySelectorAll(
                    ':scope > [data-slot="sortable-item"]'
                )
            );

            for (const row of rows) {
                const nameElement = row.querySelector(
                    'span.font-semibold'
                );

                if (!nameElement) {
                    continue;
                }

                const name = nameElement.textContent.trim();

                if (!name) {
                    continue;
                }

                const key = getAAOKey(name);
                seenSettingsKeys.add(key);

                const summaryElement = row.querySelector(
                    'span.font-mono'
                );

                const summary = summaryElement
                    ? summaryElement.textContent.trim()
                    : '';

                const existing = aaoCatalog.get(key);

                aaoCatalog.set(key, {
                    key,
                    name,
                    summary,
                    source: 'settings',
                    row
                });

                originalAAORows.set(key, row);

                if (
                    !existing ||
                    existing.name !== name ||
                    existing.summary !== summary
                ) {
                    changed = true;
                }
            }

            for (const [key, aao] of aaoCatalog) {
                if (
                    aao.source === 'settings' &&
                    !seenSettingsKeys.has(key)
                ) {
                    aaoCatalog.delete(key);
                    originalAAORows.delete(key);
                    selectedAAOs.delete(key);

                    if (assignments[key]) {
                        delete assignments[key];

                        saveAssignments()
                            .catch(console.error);
                    }

                    changed = true;
                }
            }
        }

        /* -----------------------------------------------------
           Dispatch AAOs
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            const list =
                findDispatchList(dispatchDialog);

            if (list) {
                const cards =
                    getDispatchCards(list);

                for (const card of cards) {
                    const nameElement =
                        card.querySelector(
                            'div.font-semibold.text-sm.text-gray-900'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    const name =
                        nameElement.textContent.trim();

                    if (!name) {
                        continue;
                    }

                    const key = getAAOKey(name);

                    const summaryElement =
                        card.querySelector(
                            'div.text-xs.text-gray-500.font-mono'
                        );

                    const summary =
                        summaryElement
                            ? summaryElement.textContent.trim()
                            : '';

                    const existing =
                        aaoCatalog.get(key);

                    aaoCatalog.set(key, {
                        key,
                        name,
                        summary,
                        source: 'dispatch',
                        row: card
                    });

                    originalAAORows.set(key, card);

                    if (
                        !existing ||
                        existing.name !== name ||
                        existing.summary !== summary
                    ) {
                        changed = true;
                    }
                }
            }
        }

        return changed;
    }

    /* =========================================================
       Dispatch selection
       ========================================================= */

    function isAAOSelected(key) {
        return selectedAAOs.has(key);
    }

    function setSelectedVisual(element, selected) {
        if (!element) {
            return;
        }

        const icon =
            element.querySelector('.afilia-aao-icon');

        const iconElement =
            element.querySelector('.afilia-aao-icon i');

        const name =
            element.querySelector('.afilia-aao-name');

        if (selected) {
            element.classList.add(
                'afilia-aao-selected'
            );

            element.setAttribute(
                'aria-pressed',
                'true'
            );

            element.style.borderColor =
                '#ef4444';

            element.style.backgroundColor =
                '#fef2f2';

            element.style.boxShadow =
                '0 1px 2px rgba(239,68,68,0.12), 0 8px 20px -6px rgba(239,68,68,0.25)';

            if (icon) {
                icon.style.backgroundColor =
                    '#fee2e2';
            }

            if (iconElement) {
                iconElement.style.color =
                    '#ef4444';
            }

            if (name) {
                name.style.color =
                    '#dc2626';
            }
        } else {
            element.classList.remove(
                'afilia-aao-selected'
            );

            element.setAttribute(
                'aria-pressed',
                'false'
            );

            element.style.borderColor =
                '#e5e7eb';

            element.style.backgroundColor =
                '#ffffff';

            element.style.boxShadow =
                '0 1px 2px rgba(16,24,40,0.04), 0 8px 20px -6px rgba(16,24,40,0.16)';

            if (icon) {
                icon.style.backgroundColor =
                    '#eff6ff';
            }

            if (iconElement) {
                iconElement.style.color =
                    '#3b82f6';
            }

            if (name) {
                name.style.color =
                    '#111827';
            }
        }
    }

    /* =========================================================
       Trigger native AAO
       ========================================================= */

    function triggerOriginalAAO(key) {
        let original =
            originalAAORows.get(key);

        /* -----------------------------------------------------
           Try current dispatch dialog first
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            const list =
                findDispatchList(dispatchDialog);

            if (list) {
                const cards =
                    getDispatchCards(list);

                for (const card of cards) {
                    const nameElement =
                        card.querySelector(
                            'div.font-semibold.text-sm.text-gray-900'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    const name =
                        nameElement.textContent.trim();

                    if (getAAOKey(name) === key) {
                        original = card;

                        originalAAORows.set(
                            key,
                            card
                        );

                        break;
                    }
                }
            }
        }

        /* -----------------------------------------------------
           Fall back to settings AAO
           ----------------------------------------------------- */

        if (
            !original ||
            !original.isConnected
        ) {
            const settingsContainer =
                findSettingsAAOContainer();

            if (settingsContainer) {
                const rows = Array.from(
                    settingsContainer.querySelectorAll(
                        ':scope > [data-slot="sortable-item"]'
                    )
                );

                for (const row of rows) {
                    const nameElement =
                        row.querySelector(
                            'span.font-semibold'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    if (
                        getAAOKey(
                            nameElement.textContent.trim()
                        ) === key
                    ) {
                        original = row;

                        originalAAORows.set(
                            key,
                            row
                        );

                        break;
                    }
                }
            }
        }

        /* -----------------------------------------------------
           Click native AAO
           ----------------------------------------------------- */

        if (
            original &&
            typeof original.click === 'function'
        ) {
            original.click();

            return true;
        }

        console.warn(
            '[Afilia Toolbox] Could not find original AAO:',
            key
        );

        return false;
    }

    function toggleAAOSelection(key) {
        const currentlySelected =
            selectedAAOs.has(key);

        if (currentlySelected) {
            selectedAAOs.delete(key);
        } else {
            selectedAAOs.add(key);
        }

        updateAllDispatchItems();

        triggerOriginalAAO(key);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 50);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 150);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 300);
    }

    /* =========================================================
       Dispatch category UI
       ========================================================= */

    function getAAOsForCategory(categoryID) {
        return Array.from(
            aaoCatalog.values()
        )
            .filter(aao => {
                return assignments[aao.key] ===
                    categoryID;
            })
            .sort((a, b) => {
                return a.name.localeCompare(
                    b.name,
                    'de',
                    {
                        sensitivity: 'base'
                    }
                );
            });
    }

    function getUncategorizedAAOs() {
        return Array.from(
            aaoCatalog.values()
        )
            .filter(aao => {
                return !getCategoryForAAO(
                    aao.key
                );
            })
            .sort((a, b) => {
                return a.name.localeCompare(
                    b.name,
                    'de',
                    {
                        sensitivity: 'base'
                    }
                );
            });
    }

    function createDispatchAAOElement(aao) {
        const selected =
            isAAOSelected(aao.key);

        const element =
            document.createElement('div');

        element.className =
            'afilia-aao-dispatch-item flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all';

        element.setAttribute(
            'data-afilia-aao-key',
            aao.key
        );

        element.setAttribute(
            'role',
            'button'
        );

        element.setAttribute(
            'tabindex',
            '0'
        );

        element.setAttribute(
            'aria-pressed',
            selected ? 'true' : 'false'
        );

        element.title =
            `AAO auswählen: ${aao.name}`;

        element.innerHTML = `
            <div
                class="afilia-aao-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style="background:${selected ? '#fee2e2' : '#eff6ff'}"
            >
                <i
                    class="fa-solid text-sm fa-shuffle"
                    style="color:${selected ? '#ef4444' : '#3b82f6'}"
                ></i>
            </div>

            <div class="flex-1 min-w-0">
                <div
                    class="afilia-aao-name font-semibold text-sm"
                    style="color:${selected ? '#dc2626' : '#111827'}"
                >
                    ${escapeHTML(aao.name)}
                </div>

                <div
                    class="text-xs text-gray-500 font-mono truncate"
                >
                    ${escapeHTML(aao.summary)}
                </div>
            </div>
        `;

        element.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                toggleAAOSelection(
                    aao.key
                );
            }
        );

        element.addEventListener(
            'keydown',
            event => {
                if (
                    event.key === 'Enter' ||
                    event.key === ' '
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    toggleAAOSelection(
                        aao.key
                    );
                }
            }
        );

        setSelectedVisual(
            element,
            selected
        );

        return element;
    }

    function renderDispatchPanel() {
        const dialog =
            findDispatchDialog();

        if (!dialog) {
            return;
        }

        const list =
            findDispatchList(dialog);

        if (!list) {
            return;
        }

        let panel =
            dialog.querySelector(
                `#${DISPATCH_PANEL_ID}`
            );

        if (!panel) {
            panel =
                document.createElement('div');

            panel.id =
                DISPATCH_PANEL_ID;

            panel.className =
                'afilia-dispatch-panel';

            list.parentElement.insertBefore(
                panel,
                list
            );
        }

        list.style.display = 'none';

        panel.innerHTML = '';

        const search =
            dispatchSearchValue
                .trim()
                .toLowerCase();

        const originalCatalog =
            Array.from(
                aaoCatalog.values()
            );

        /* -----------------------------------------------------
           Categorized AAOs
           ----------------------------------------------------- */

        for (const category of categories) {
            const items =
                getAAOsForCategory(
                    category.id
                ).filter(aao => {
                    if (!search) {
                        return true;
                    }

                    return (
                        aao.name
                            .toLowerCase()
                            .includes(search) ||
                        aao.summary
                            .toLowerCase()
                            .includes(search)
                    );
                });

            if (items.length === 0) {
                continue;
            }

            const wrapper =
                document.createElement('div');

            wrapper.className =
                'afilia-dispatch-category';

            const header =
                document.createElement('button');

            header.type = 'button';

            header.className =
                'afilia-dispatch-category-header';

            header.innerHTML = `
                <span class="afilia-dispatch-category-arrow">
                    ${category.collapsed ? '▶' : '▼'}
                </span>

                <span class="afilia-dispatch-category-name">
                    ${escapeHTML(category.name)}
                </span>

                <span class="afilia-dispatch-category-count">
                    ${items.length}
                </span>
            `;

            const content =
                document.createElement('div');

            content.className =
                'afilia-dispatch-category-content';

            if (category.collapsed) {
                content.style.display =
                    'none';
            }

            for (const aao of items) {
                content.appendChild(
                    createDispatchAAOElement(
                        aao
                    )
                );
            }

            header.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    category.collapsed =
                        !category.collapsed;

                    saveCategories()
                        .catch(console.error);

                    renderDispatchPanel();
                }
            );

            wrapper.appendChild(header);
            wrapper.appendChild(content);

            panel.appendChild(wrapper);
        }

        /* -----------------------------------------------------
           Uncategorized
           ----------------------------------------------------- */

        const uncategorized =
            originalCatalog
                .filter(aao => {
                    return !getCategoryForAAO(
                        aao.key
                    );
                })
                .filter(aao => {
                    if (!search) {
                        return true;
                    }

                    return (
                        aao.name
                            .toLowerCase()
                            .includes(search) ||
                        aao.summary
                            .toLowerCase()
                            .includes(search)
                    );
                })
                .sort((a, b) => {
                    return a.name.localeCompare(
                        b.name,
                        'de',
                        {
                            sensitivity: 'base'
                        }
                    );
                });

        if (uncategorized.length > 0) {
            const wrapper =
                document.createElement('div');

            wrapper.className =
                'afilia-dispatch-category';

            const header =
                document.createElement('div');

            header.className =
                'afilia-dispatch-category-header afilia-dispatch-uncategorized';

            header.innerHTML = `
                <span class="afilia-dispatch-category-arrow">
                    ▼
                </span>

                <span class="afilia-dispatch-category-name">
                    Nicht zugeordnet
                </span>

                <span class="afilia-dispatch-category-count">
                    ${uncategorized.length}
                </span>
            `;

            const content =
                document.createElement('div');

            content.className =
                'afilia-dispatch-category-content';

            for (const aao of uncategorized) {
                content.appendChild(
                    createDispatchAAOElement(
                        aao
                    )
                );
            }

            wrapper.appendChild(header);
            wrapper.appendChild(content);

            panel.appendChild(wrapper);
        }

        updateAllDispatchItems();
    }

    function updateAllDispatchItems() {
        const panel =
            document.querySelector(
                `#${DISPATCH_PANEL_ID}`
            );

        if (!panel) {
            return;
        }

        panel.querySelectorAll(
            '[data-afilia-aao-key]'
        ).forEach(element => {
            const key =
                element.getAttribute(
                    'data-afilia-aao-key'
                );

            if (!key) {
                return;
            }

            setSelectedVisual(
                element,
                selectedAAOs.has(key)
            );
        });
    }

    /* =========================================================
       Settings UI
       ========================================================= */

    function createSettingsPanel() {
        const panel =
            document.createElement('div');

        panel.id =
            SETTINGS_PANEL_ID;

        return panel;
    }

    function renderSettingsPanel() {
        const container =
            findSettingsAAOContainer();

        if (!container) {
            return;
        }

        let panel =
            document.querySelector(
                `#${SETTINGS_PANEL_ID}`
            );

        if (!panel) {
            panel =
                createSettingsPanel();

            container.parentElement.insertBefore(
                panel,
                container
            );
        }

        container.style.display =
            'none';

        panel.innerHTML = '';

        const header =
            document.createElement('div');

        header.className =
            'afilia-settings-header';

        header.innerHTML = `
            <div>
                <div class="afilia-settings-title">
                    AAO Kategorien
                </div>

                <div class="afilia-settings-subtitle">
                    Ordne jede AAO einer Kategorie zu.
                </div>
            </div>

            <button
                type="button"
                class="afilia-add-category"
            >
                + Kategorie
            </button>
        `;

        panel.appendChild(header);

        header.querySelector(
            '.afilia-add-category'
        ).addEventListener(
            'click',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                const name =
                    prompt(
                        'Name der neuen Kategorie:'
                    );

                if (
                    !name ||
                    !name.trim()
                ) {
                    return;
                }

                categories.push({
                    id: createID(
                        'category'
                    ),
                    name: name.trim(),
                    collapsed: false
                });

                await saveCategories();

                renderSettingsPanel();
                renderDispatchPanel();
            }
        );

        /* -----------------------------------------------------
           Categories
           ----------------------------------------------------- */

        for (const category of categories) {
            const section =
                document.createElement('div');

            section.className =
                'afilia-settings-category';

            section.dataset.categoryID =
                category.id;

            const categoryHeader =
                document.createElement('div');

            categoryHeader.className =
                'afilia-settings-category-header';

            categoryHeader.innerHTML = `
                <span
                    class="afilia-category-drag-handle"
                    draggable="true"
                    title="Kategorie verschieben"
                    aria-label="Kategorie verschieben"
                >
                    ⋮⋮
                </span>

                <button
                    type="button"
                    class="afilia-category-collapse"
                >
                    ${category.collapsed ? '▶' : '▼'}
                </button>

                <span class="afilia-category-name">
                    ${escapeHTML(category.name)}
                </span>

                <span class="afilia-category-actions">
                    <button
                        type="button"
                        class="afilia-category-rename"
                        title="Kategorie umbenennen"
                    >
                        ✎
                    </button>

                    <button
                        type="button"
                        class="afilia-category-delete"
                        title="Kategorie löschen"
                    >
                        ×
                    </button>
                </span>
            `;

            section.appendChild(
                categoryHeader
            );

            const dragHandle =
                categoryHeader.querySelector(
                    '.afilia-category-drag-handle'
                );

            dragHandle.addEventListener(
                'dragstart',
                event => {
                    draggedCategoryID = category.id;
                    section.classList.add(
                        'afilia-category-dragging'
                    );

                    event.dataTransfer.effectAllowed =
                        'move';
                    event.dataTransfer.setData(
                        'text/plain',
                        category.id
                    );
                }
            );

            dragHandle.addEventListener(
                'dragend',
                () => {
                    draggedCategoryID = null;

                    document.querySelectorAll(
                        '.afilia-category-dragging, .afilia-category-drop-target'
                    ).forEach(element => {
                        element.classList.remove(
                            'afilia-category-dragging',
                            'afilia-category-drop-target'
                        );
                    });
                }
            );

            section.addEventListener(
                'dragover',
                event => {
                    if (
                        !draggedCategoryID ||
                        draggedCategoryID === category.id
                    ) {
                        return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect =
                        'move';

                    section.classList.add(
                        'afilia-category-drop-target'
                    );
                }
            );

            section.addEventListener(
                'dragleave',
                event => {
                    if (
                        event.relatedTarget &&
                        section.contains(
                            event.relatedTarget
                        )
                    ) {
                        return;
                    }

                    section.classList.remove(
                        'afilia-category-drop-target'
                    );
                }
            );

            section.addEventListener(
                'drop',
                async event => {
                    event.preventDefault();

                    const sourceCategoryID =
                        event.dataTransfer.getData(
                            'text/plain'
                        ) || draggedCategoryID;

                    section.classList.remove(
                        'afilia-category-drop-target'
                    );

                    if (
                        !sourceCategoryID ||
                        sourceCategoryID === category.id
                    ) {
                        return;
                    }

                    await moveCategoryBefore(
                        sourceCategoryID,
                        category.id
                    );
                }
            );

            const content =
                document.createElement('div');

            content.className =
                'afilia-settings-category-content';

            if (category.collapsed) {
                content.style.display =
                    'none';
            }

            const aaos =
                Array.from(
                    aaoCatalog.values()
                )
                    .filter(aao => {
                        return assignments[
                            aao.key
                        ] === category.id;
                    })
                    .sort((a, b) => {
                        return a.name.localeCompare(
                            b.name,
                            'de',
                            {
                                sensitivity:
                                    'base'
                            }
                        );
                    });

            for (const aao of aaos) {
                content.appendChild(
                    createSettingsAAORow(
                        aao
                    )
                );
            }

            /* -------------------------------------------------
               Collapse
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-collapse'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    category.collapsed =
                        !category.collapsed;

                    await saveCategories();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            /* -------------------------------------------------
               Rename
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-rename'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const newName =
                        prompt(
                            'Neuer Kategoriename:',
                            category.name
                        );

                    if (
                        !newName ||
                        !newName.trim()
                    ) {
                        return;
                    }

                    category.name =
                        newName.trim();

                    await saveCategories();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            /* -------------------------------------------------
               Delete
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-delete'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const usedBy =
                        Object.values(
                            assignments
                        ).filter(
                            id =>
                                id ===
                                category.id
                        ).length;

                    const message =
                        usedBy > 0
                            ? `Die Kategorie "${category.name}" enthält ${usedBy} AAO(s).\n\nDiese AAOs werden anschließend nicht zugeordnet sein.\n\nKategorie löschen?`
                            : `Kategorie "${category.name}" löschen?`;

                    if (!confirm(message)) {
                        return;
                    }

                    for (
                        const key of
                        Object.keys(
                            assignments
                        )
                    ) {
                        if (
                            assignments[key] ===
                            category.id
                        ) {
                            delete assignments[
                                key
                            ];
                        }
                    }

                    categories =
                        categories.filter(
                            item =>
                                item.id !==
                                category.id
                        );

                    await saveCategories();
                    await saveAssignments();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            section.appendChild(content);
            panel.appendChild(section);
        }

        /* -----------------------------------------------------
           Uncategorized
           ----------------------------------------------------- */

        const uncategorized =
            getUncategorizedAAOs();

        if (uncategorized.length > 0) {
            const section =
                document.createElement('div');

            section.className =
                'afilia-settings-category afilia-uncategorized';

            const headerElement =
                document.createElement('div');

            headerElement.className =
                'afilia-settings-category-header';

            headerElement.innerHTML = `
                <div>
                    <div class="afilia-category-name">
                        Nicht zugeordnet
                    </div>

                    <div class="afilia-settings-subtitle">
                        ${uncategorized.length} AAO(s)
                    </div>
                </div>
            `;

            section.appendChild(
                headerElement
            );

            const content =
                document.createElement('div');

            content.className =
                'afilia-settings-category-content';

            for (const aao of uncategorized) {
                content.appendChild(
                    createSettingsAAORow(
                        aao
                    )
                );
            }

            section.appendChild(content);

            panel.appendChild(section);
        }
    }

    function createSettingsAAORow(aao) {
        const row =
            document.createElement('div');

        row.className =
            'afilia-settings-aao-row';

        const currentCategory =
            getCategoryForAAO(
                aao.key
            );

        row.innerHTML = `
            <div class="afilia-settings-aao-info">
                <div class="afilia-settings-aao-name">
                    ${escapeHTML(aao.name)}
                </div>

                <div class="afilia-settings-aao-summary">
                    ${escapeHTML(aao.summary)}
                </div>
            </div>

            <select class="afilia-settings-aao-select">
                <option value="">
                    Nicht zugeordnet
                </option>

                ${categories.map(category => `
                    <option
                        value="${escapeHTML(category.id)}"
                        ${
                            currentCategory &&
                            currentCategory.id ===
                                category.id
                                ? 'selected'
                                : ''
                        }
                    >
                        ${escapeHTML(
                            category.name
                        )}
                    </option>
                `).join('')}
            </select>

            <button
                type="button"
                class="afilia-settings-edit"
                title="AAO bearbeiten"
            >
                ✎
            </button>

            <button
                type="button"
                class="afilia-settings-delete"
                title="AAO löschen"
            >
                ×
            </button>
        `;

        const select =
            row.querySelector(
                '.afilia-settings-aao-select'
            );

        select.addEventListener(
            'change',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                const value =
                    select.value;

                if (value) {
                    assignments[
                        aao.key
                    ] = value;
                } else {
                    delete assignments[
                        aao.key
                    ];
                }

                await saveAssignments();

                renderSettingsPanel();
                renderDispatchPanel();
            }
        );

        row.querySelector(
            '.afilia-settings-edit'
        ).addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                const original =
                    originalAAORows.get(
                        aao.key
                    );

                if (!original) {
                    return;
                }

                const editButton =
                    Array.from(
                        original.querySelectorAll(
                            'button'
                        )
                    ).find(button => {
                        const svg =
                            button.querySelector(
                                'svg'
                            );

                        return (
                            svg &&
                            (
                                svg.classList.contains(
                                    'lucide-pencil'
                                ) ||
                                svg
                                    .getAttribute(
                                        'class'
                                    )
                                    ?.includes(
                                        'pencil'
                                    )
                            )
                        );
                    });

                if (editButton) {
                    editButton.click();
                }
            }
        );

        row.querySelector(
            '.afilia-settings-delete'
        ).addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                const original =
                    originalAAORows.get(
                        aao.key
                    );

                if (!original) {
                    return;
                }

                const deleteButton =
                    Array.from(
                        original.querySelectorAll(
                            'button'
                        )
                    ).find(button => {
                        const svg =
                            button.querySelector(
                                'svg'
                            );

                        const svgClass =
                            svg?.getAttribute(
                                'class'
                            ) || '';

                        return (
                            svgClass.includes('trash') ||
                            /löschen|loeschen|delete/i.test(
                                button.textContent || ''
                            ) ||
                            /löschen|loeschen|delete/i.test(
                                button.getAttribute(
                                    'title'
                                ) || ''
                            )
                        );
                    });

                if (deleteButton) {
                    deleteButton.click();
                }
            }
        );

        return row;
    }

    /* =========================================================
       Search synchronization
       ========================================================= */

    function hookDispatchSearch(dialog) {
        const input =
            dialog?.querySelector(
                'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
            );

        if (!input) {
            return;
        }

        if (
            input.dataset.afiliaSearchHooked ===
            'true'
        ) {
            return;
        }

        input.dataset.afiliaSearchHooked =
            'true';

        input.addEventListener(
            'input',
            () => {
                dispatchSearchValue =
                    input.value || '';

                renderDispatchPanel();
            }
        );
    }

    /* =========================================================
       CSS
       ========================================================= */

    function injectStyles() {
        if (
            document.getElementById(
                'afilia-aao-category-styles'
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            'afilia-aao-category-styles';

        style.textContent = `
            .afilia-update-notice {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 12px;
                max-width: min(560px, calc(100vw - 32px));
                padding: 12px 14px;
                border: 1px solid #fecaca;
                border-radius: 10px;
                background: #fff7f7;
                box-shadow: 0 8px 24px rgba(17, 24, 39, 0.16);
                color: #7f1d1d;
                font-size: 13px;
            }

            .afilia-update-notice-content {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }

            .afilia-update-notice-link {
                flex-shrink: 0;
                padding: 7px 10px;
                border-radius: 7px;
                background: #dc2626;
                color: white;
                font-weight: 600;
                text-decoration: none;
            }

            .afilia-update-notice-link:hover {
                background: #b91c1c;
            }

            .afilia-update-notice-close {
                flex-shrink: 0;
                width: 28px;
                height: 28px;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: #991b1b;
                cursor: pointer;
                font-size: 20px;
                line-height: 1;
            }

            .afilia-update-notice-close:hover {
                background: #fee2e2;
            }

            /* =====================================================
               Settings
               ===================================================== */

            #${SETTINGS_PANEL_ID} {
                position: relative;
                z-index: 10;
                width: 100%;
                margin-bottom: 12px;
            }

            .afilia-settings-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 14px;
                margin-bottom: 10px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                background: #ffffff;
            }

            .afilia-settings-title {
                font-size: 18px;
                font-weight: 700;
                color: #111827;
            }

            .afilia-settings-subtitle {
                margin-top: 2px;
                font-size: 12px;
                color: #6b7280;
            }

            .afilia-add-category {
                border: 0;
                border-radius: 8px;
                padding: 8px 12px;
                background: #ef4444;
                color: white;
                font-weight: 600;
                cursor: pointer;
            }

            .afilia-add-category:hover {
                background: #dc2626;
            }

            .afilia-settings-category {
                margin-bottom: 10px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                overflow: hidden;
                background: white;
            }

            .afilia-settings-category-header {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 46px;
                padding: 8px 12px;
                background: #f9fafb;
                border-bottom: 1px solid #e5e7eb;
            }

            .afilia-category-collapse {
                width: 28px;
                height: 28px;
                border: 0;
                background: transparent;
                cursor: pointer;
                color: #6b7280;
            }

            .afilia-category-drag-handle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 28px;
                color: #9ca3af;
                cursor: grab;
                font-size: 16px;
                letter-spacing: 0;
                user-select: none;
            }

            .afilia-category-drag-handle:hover {
                color: #4b5563;
            }

            .afilia-category-drag-handle:active {
                cursor: grabbing;
            }

            .afilia-category-dragging {
                opacity: 0.55;
            }

            .afilia-category-drop-target {
                border-color: #ef4444;
                box-shadow: 0 0 0 2px #fee2e2;
            }

            .afilia-category-name {
                flex: 1;
                font-weight: 700;
                color: #111827;
            }

            .afilia-category-actions {
                display: flex;
                gap: 4px;
            }

            .afilia-category-actions button {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 7px;
                background: transparent;
                cursor: pointer;
                color: #6b7280;
            }

            .afilia-category-actions button:hover {
                background: #e5e7eb;
                color: #111827;
            }

            .afilia-category-actions button:disabled {
                opacity: 0.35;
                cursor: default;
            }

            .afilia-category-actions button:disabled:hover {
                background: transparent;
                color: #6b7280;
            }

            .afilia-category-delete:hover {
                color: #dc2626 !important;
                background: #fee2e2 !important;
            }

            .afilia-settings-category-content {
                padding: 8px;
            }

            .afilia-settings-aao-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 9px 10px;
                border-radius: 9px;
            }

            .afilia-settings-aao-row:hover {
                background: #f9fafb;
            }

            .afilia-settings-aao-info {
                flex: 1;
                min-width: 0;
            }

            .afilia-settings-aao-name {
                font-size: 14px;
                font-weight: 600;
                color: #111827;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-settings-aao-summary {
                margin-top: 2px;
                font-size: 11px;
                font-family: monospace;
                color: #6b7280;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-settings-aao-select {
                min-width: 170px;
                max-width: 230px;
                height: 34px;
                padding: 0 8px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: white;
                color: #111827;
                cursor: pointer;
            }

            .afilia-settings-edit {
                width: 34px;
                height: 34px;
                flex-shrink: 0;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: white;
                cursor: pointer;
            }

            .afilia-settings-edit:hover {
                background: #f3f4f6;
            }

            .afilia-settings-delete {
                width: 34px;
                height: 34px;
                flex-shrink: 0;
                border: 1px solid #fecaca;
                border-radius: 8px;
                background: white;
                color: #dc2626;
                cursor: pointer;
            }

            .afilia-settings-delete:hover {
                background: #fee2e2;
            }

            /* =====================================================
               Dispatch
               ===================================================== */

            #${DISPATCH_PANEL_ID} {
                width: 100%;
                padding-bottom: 6px;
            }

            .afilia-dispatch-category {
                margin-bottom: 8px;
            }

            .afilia-dispatch-category-header {
                width: 100%;
                min-height: 42px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                background: #f9fafb;
                color: #111827;
                cursor: pointer;
                text-align: left;
            }

            .afilia-dispatch-category-header:hover {
                background: #f3f4f6;
            }

            .afilia-dispatch-category-arrow {
                width: 18px;
                flex-shrink: 0;
                color: #6b7280;
                font-size: 11px;
            }

            .afilia-dispatch-category-name {
                flex: 1;
                font-weight: 700;
                font-size: 14px;
            }

            .afilia-dispatch-category-count {
                min-width: 24px;
                padding: 2px 7px;
                border-radius: 999px;
                background: #e5e7eb;
                color: #4b5563;
                font-size: 11px;
                font-weight: 700;
                text-align: center;
            }

            .afilia-dispatch-category-content {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding-top: 8px;
            }

            .afilia-dispatch-category-content
            > [data-afilia-aao-key] {
                min-height: 60px;
            }

            .afilia-dispatch-category-content
            > [data-afilia-aao-key]:hover {
                border-color: #fca5a5 !important;
            }

            .afilia-dispatch-uncategorized {
                cursor: default;
            }

            .afilia-dispatch-uncategorized:hover {
                background: #f9fafb;
            }

            .afilia-aao-selected {
                border-color: #ef4444 !important;
                background-color: #fef2f2 !important;
            }

            .afilia-aao-dispatch-item {
                user-select: none;
                -webkit-user-select: none;
            }

            .afilia-aao-dispatch-item:focus-visible {
                outline: 2px solid #ef4444;
                outline-offset: 2px;
            }

            .afilia-aao-dispatch-item:hover {
                transform: translateY(-1px);
            }

            /* =====================================================
               Mobile
               ===================================================== */

            @media (max-width: 640px) {
                .afilia-settings-aao-row {
                    flex-wrap: wrap;
                }

                .afilia-settings-aao-info {
                    width: 100%;
                    flex-basis: 100%;
                }

                .afilia-settings-aao-select {
                    flex: 1;
                    min-width: 0;
                    max-width: none;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Main scanning
       ========================================================= */

    function scan() {
        const catalogChanged =
            discoverAAOs();

        /* -----------------------------------------------------
           Settings
           ----------------------------------------------------- */

        const settingsContainer =
            findSettingsAAOContainer();

        if (settingsContainer) {
            if (
                settingsContainer !==
                    lastSettingsContainer ||
                !document.querySelector(
                    `#${SETTINGS_PANEL_ID}`
                ) ||
                catalogChanged
            ) {
                lastSettingsContainer =
                    settingsContainer;

                renderSettingsPanel();
            }
        } else {
            lastSettingsContainer = null;
        }

        /* -----------------------------------------------------
           Dispatch
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            hookDispatchSearch(
                dispatchDialog
            );

            const list =
                findDispatchList(
                    dispatchDialog
                );

            if (list) {
                if (!isDispatchAAOModeEnabled(dispatchDialog)) {
                    removeDispatchPanel(
                        dispatchDialog,
                        list
                    );

                    lastDispatchContainer =
                        dispatchDialog;
                } else if (
                    dispatchDialog !==
                        lastDispatchContainer ||
                    !document.querySelector(
                        `#${DISPATCH_PANEL_ID}`
                    ) ||
                    catalogChanged
                ) {
                    lastDispatchContainer =
                        dispatchDialog;

                    renderDispatchPanel();
                } else {
                    updateAllDispatchItems();
                }
            }
        } else {
            if (lastDispatchContainer) {
                selectedAAOs.clear();
            }

            lastDispatchContainer = null;
        }
    }

    function scheduleScan() {
        if (scanTimer) {
            clearTimeout(scanTimer);
        }

        scanTimer = setTimeout(() => {
            scanTimer = null;

            try {
                scan();
            } catch (error) {
                console.error(
                    '[Afilia Toolbox] Scan failed:',
                    error
                );
            }
        }, 100);
    }

    /* =========================================================
       MutationObserver
       ========================================================= */

    function startObserver() {
        if (observer) {
            observer.disconnect();
        }

        observer =
            new MutationObserver(
                mutations => {
                    let relevant = false;

                    for (
                        const mutation of mutations
                    ) {
                        if (
                            mutation.type ===
                                'childList' ||
                            mutation.type ===
                                'attributes'
                        ) {
                            relevant = true;
                            break;
                        }
                    }

                    if (relevant) {
                        scheduleScan();
                    }
                }
            );

        observer.observe(
            document.body,
            {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'data-state'
                ]
            }
        );
    }

    /* =========================================================
       Initialization
       ========================================================= */

    async function initialize() {
        try {
            db =
                await openDatabase();

            await loadData();

            injectStyles();

            discoverAAOs();

            scan();

            startObserver();

            checkForUpdates();

            console.info(
                '[Afilia Toolbox] initialized.'
            );
        } catch (error) {
            console.error(
                '[Afilia Toolbox] initialization failed:',
                error
            );
        }
    }

    initialize();
})();

// ==UserScript==
// @name         Afilia AAO Categories
// @namespace    https://github.com/AfiliaFrostfang
// @version      1.3.1
// @description  Categorize Rescue Operator AAOs in Game Settings and the Vehicle Dispatch Window.
// @author       AfiliaFrostfang
// @license      AGPL-3.0-or-later
// @match        https://game.rescue-operator.com/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const DB_NAME = 'AfiliaAAOCategoriesV2';
    const DB_VERSION = 1;
    const STORE_NAME = 'settings';

    const KEYS = {
        CATEGORIES: 'categories',
        ASSIGNMENTS: 'assignments'
    };

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

    const STYLE_ID = 'afilias-aao-categories-style';
    const SETTINGS_PANEL_ID = 'afilias-aao-categories-panel';
    const DISPATCH_PANEL_ID = 'afilias-aao-dispatch-categories-panel';

    let dbPromise = null;
    let scanTimer = null;
    let scanRunning = false;
    let observer = null;
    let observerPauseUntil = 0;

    const selectedAAOs = new Set();

    let selectionChangeInProgress = false;

    // =========================================================
    // Logging
    // =========================================================

    function log(...args) {
        console.log('[Afilia AAO Categories]', ...args);
    }

    // =========================================================
    // Helpers
    // =========================================================

    function normalizeText(value) {
        return String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getAAOKey(name) {
        return normalizeText(name).toLowerCase();
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function randomId(prefix = 'cat') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function pauseObserver(ms = 100) {
        observerPauseUntil = Math.max(
            observerPauseUntil,
            Date.now() + ms
        );
    }

    // =========================================================
    // IndexedDB
    // =========================================================

    function openDB() {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(
                DB_NAME,
                DB_VERSION
            );

            request.onupgradeneeded = () => {
                const database = request.result;

                if (
                    !database.objectStoreNames.contains(
                        STORE_NAME
                    )
                ) {
                    database.createObjectStore(
                        STORE_NAME
                    );
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });

        return dbPromise;
    }

    async function dbGet(key) {
        const database = await openDB();

        return new Promise((resolve, reject) => {
            const transaction =
                database.transaction(
                    STORE_NAME,
                    'readonly'
                );

            const store =
                transaction.objectStore(
                    STORE_NAME
                );

            const request =
                store.get(key);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async function dbPut(key, value) {
        const database = await openDB();

        return new Promise((resolve, reject) => {
            const transaction =
                database.transaction(
                    STORE_NAME,
                    'readwrite'
                );

            const store =
                transaction.objectStore(
                    STORE_NAME
                );

            const request =
                store.put(value, key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async function loadCategories() {
        let categories =
            await dbGet(KEYS.CATEGORIES);

        if (
            !Array.isArray(categories) ||
            categories.length === 0
        ) {
            categories =
                structuredClone(
                    DEFAULT_CATEGORIES
                );

            await dbPut(
                KEYS.CATEGORIES,
                categories
            );
        }

        return categories;
    }

    async function saveCategories(categories) {
        await dbPut(
            KEYS.CATEGORIES,
            categories
        );
    }

    async function loadAssignments() {
        const assignments =
            await dbGet(
                KEYS.ASSIGNMENTS
            );

        if (
            assignments &&
            typeof assignments === 'object' &&
            !Array.isArray(assignments)
        ) {
            return assignments;
        }

        return {};
    }

    async function saveAssignments(assignments) {
        await dbPut(
            KEYS.ASSIGNMENTS,
            assignments
        );
    }

    // =========================================================
    // Styles
    // =========================================================

    function injectStyles() {
        if (
            document.getElementById(
                STYLE_ID
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id = STYLE_ID;

        style.textContent = `
            #${SETTINGS_PANEL_ID},
            #${DISPATCH_PANEL_ID} {
                width: 100%;
                box-sizing: border-box;
                position: relative;
                z-index: 10;
                font-family: inherit;
            }

            #${SETTINGS_PANEL_ID} {
                margin-bottom: 12px;
            }

            #${DISPATCH_PANEL_ID} {
                margin-top: 8px;
                margin-bottom: 8px;
            }

            .afilias-aao-category {
                width: 100%;
                box-sizing: border-box;
                border: 1px solid rgba(229, 231, 235, 0.95);
                border-radius: 12px;
                background: #fff;
                overflow: hidden;
                box-shadow:
                    0 1px 2px rgba(16, 24, 40, 0.04),
                    0 8px 20px -6px rgba(16, 24, 40, 0.10);
            }

            .afilias-aao-category + .afilias-aao-category {
                margin-top: 8px;
            }

            .afilias-aao-category-header {
                display: flex;
                align-items: center;
                gap: 6px;
                width: 100%;
                min-height: 42px;
                padding: 5px 8px;
                box-sizing: border-box;
                background: #fff;
                color: #111827;
            }

            .afilias-aao-category-toggle {
                appearance: none;
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                min-width: 0;
                min-height: 32px;
                padding: 4px 2px;
                border: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                text-align: left;
                font: inherit;
                border-radius: 7px;
            }

            .afilias-aao-category-toggle:hover {
                background: #f9fafb;
            }

            .afilias-aao-chevron {
                width: 18px;
                text-align: center;
                color: #6b7280;
                font-size: 12px;
                flex: 0 0 18px;
            }

            .afilias-aao-category-name {
                flex: 1;
                min-width: 0;
                font-size: 14px;
                font-weight: 700;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilias-aao-category-count {
                color: #6b7280;
                font-size: 12px;
                font-family:
                    ui-monospace,
                    SFMono-Regular,
                    Menlo,
                    Monaco,
                    Consolas,
                    monospace;
            }

            .afilias-aao-category-body {
                padding: 0 8px 8px;
            }

            .afilias-aao-item {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                min-height: 44px;
                padding: 8px 10px;
                margin-top: 4px;
                box-sizing: border-box;
                border: 1px solid rgba(229, 231, 235, 0.95);
                border-radius: 10px;
                background: #fff;
                color: #111827;
                cursor: pointer;
                text-align: left;
                font: inherit;
                transition:
                    background 120ms ease,
                    border-color 120ms ease,
                    box-shadow 120ms ease,
                    transform 120ms ease,
                    color 120ms ease;
            }

            .afilias-aao-item:hover {
                background: #f9fafb;
                border-color: #d1d5db;
                box-shadow:
                    0 2px 8px rgba(16, 24, 40, 0.08);
            }

            .afilias-aao-item:active {
                transform: translateY(1px);
            }

            /*
             * Selected AAO
             *
             * This deliberately resembles the game's red
             * selected state.
             */
            .afilias-aao-dispatch-item.is-selected {
                border-color: #ef4444;
                background: #fef2f2;
                box-shadow:
                    0 0 0 1px rgba(239, 68, 68, 0.10),
                    0 4px 12px rgba(239, 68, 68, 0.10);
            }

            .afilias-aao-dispatch-item.is-selected
            .afilias-aao-item-icon {
                background: #fee2e2;
                color: #ef4444;
            }

            .afilias-aao-dispatch-item.is-selected
            .afilias-aao-item-name {
                color: #b91c1c;
            }

            .afilias-aao-dispatch-item.is-selected
            .afilias-aao-item-summary {
                color: #dc2626;
            }

            .afilias-aao-item-icon {
                width: 32px;
                height: 32px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 32px;
                background: #eff6ff;
                color: #3b82f6;
                font-size: 13px;
            }

            .afilias-aao-item-text {
                min-width: 0;
                flex: 1;
            }

            .afilias-aao-item-name {
                font-size: 13px;
                line-height: 18px;
                font-weight: 600;
                color: #111827;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilias-aao-item-summary {
                margin-top: 1px;
                font-size: 11px;
                line-height: 16px;
                color: #6b7280;
                font-family:
                    ui-monospace,
                    SFMono-Regular,
                    Menlo,
                    Monaco,
                    Consolas,
                    monospace;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilias-aao-settings-toolbar {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
            }

            .afilias-aao-settings-title {
                font-size: 18px;
                font-weight: 700;
                margin-right: auto;
                color: #111827;
            }

            .afilias-aao-action-button {
                appearance: none;
                border: 1px solid #d1d5db;
                background: #fff;
                color: #374151;
                border-radius: 8px;
                padding: 7px 10px;
                font: inherit;
                font-size: 13px;
                cursor: pointer;
            }

            .afilias-aao-action-button:hover {
                background: #f9fafb;
                border-color: #9ca3af;
            }

            .afilias-aao-action-button.primary {
                background: #dc2626;
                color: #fff;
                border-color: #dc2626;
            }

            .afilias-aao-action-button.primary:hover {
                background: #b91c1c;
                border-color: #b91c1c;
            }

            .afilias-aao-empty {
                padding: 14px;
                color: #6b7280;
                font-size: 13px;
                text-align: center;
                border: 1px dashed #d1d5db;
                border-radius: 10px;
                background: #fafafa;
            }

            .afilias-aao-settings-assignment {
                margin-left: auto;
                flex: 0 0 auto;
                max-width: 190px;
            }

            .afilias-aao-settings-assignment select {
                width: 100%;
                box-sizing: border-box;
                border: 1px solid #d1d5db;
                border-radius: 7px;
                background: #fff;
                padding: 5px 7px;
                color: #374151;
                font: inherit;
                font-size: 12px;
            }

            .afilias-aao-settings-row {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                box-sizing: border-box;
            }

            .afilias-aao-settings-row
            .afilias-aao-item-text {
                flex: 1;
            }

            .afilias-aao-settings-actions {
                display: flex;
                gap: 4px;
                flex: 0 0 auto;
            }

            .afilias-aao-small-button {
                width: 30px;
                height: 30px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid #e5e7eb;
                border-radius: 7px;
                background: #fff;
                color: #6b7280;
                cursor: pointer;
                font: inherit;
            }

            .afilias-aao-small-button:hover {
                background: #f9fafb;
                color: #111827;
            }

            .afilias-aao-small-button.danger:hover {
                color: #dc2626;
                border-color: #fecaca;
                background: #fef2f2;
            }

            @media (max-width: 640px) {
                .afilias-aao-settings-assignment {
                    max-width: 145px;
                }

                .afilias-aao-settings-title {
                    width: 100%;
                    margin-right: 0;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // =========================================================
    // Game Settings
    // =========================================================

    function getElementText(element, selector) {
        const target =
            element.querySelector(selector);

        return normalizeText(
            target?.textContent || ''
        );
    }

    function extractAAOFromSettingsRow(row) {
        const name =
            getElementText(
                row,
                'span.font-semibold'
            );

        if (!name) {
            return null;
        }

        const summary =
            getElementText(
                row,
                'span.font-mono'
            );

        return {
            row,
            name,
            summary,
            key: getAAOKey(name)
        };
    }

    function findSettingsAAOContainer() {
        const candidates =
            Array.from(
                document.querySelectorAll(
                    '[data-slot="sortable-content"]'
                )
            );

        return candidates.find(
            container =>
                container.querySelector(
                    '[data-slot="sortable-item-handle"][title="AAO verschieben"]'
                )
        ) || null;
    }

    function findSettingsRows(container) {
        if (!container) {
            return [];
        }

        return Array.from(
            container.querySelectorAll(
                ':scope > [data-slot="sortable-item"]'
            )
        )
            .map(
                extractAAOFromSettingsRow
            )
            .filter(Boolean);
    }

    // =========================================================
    // Dispatch Window
    // =========================================================

    function findDispatchSheet() {
        const sheets =
            Array.from(
                document.querySelectorAll(
                    '[data-slot="sheet-content"]'
                )
            );

        return sheets.find(
            sheet =>
                sheet.querySelector(
                    'input[placeholder="AAO suchen..."]'
                )
        ) || null;
    }

    function findDispatchSearchInput(sheet) {
        return sheet?.querySelector(
            'input[placeholder="AAO suchen..."]'
        ) || null;
    }

    function getDispatchRows(list) {
        if (!list) {
            return [];
        }

        return Array.from(
            list.children
        )
            .filter(
                element =>
                    element instanceof HTMLElement
            )
            .map(row => {
                const name =
                    getElementText(
                        row,
                        '.font-semibold.text-sm.text-gray-900'
                    );

                if (!name) {
                    return null;
                }

                const summary =
                    getElementText(
                        row,
                        '.text-xs.text-gray-500.font-mono'
                    );

                return {
                    row,
                    name,
                    summary,
                    key: getAAOKey(name)
                };
            })
            .filter(Boolean);
    }

    function findDispatchList(sheet) {
        const searchInput =
            findDispatchSearchInput(
                sheet
            );

        if (!searchInput) {
            return null;
        }

        const scrollContainer =
            searchInput.closest(
                '.flex-1.overflow-y-auto.min-h-0'
            );

        if (scrollContainer) {
            const list =
                scrollContainer.querySelector(
                    ':scope > .space-y-2'
                );

            if (
                list &&
                getDispatchRows(list).length > 0
            ) {
                return list;
            }
        }

        const candidates =
            Array.from(
                sheet.querySelectorAll(
                    '.space-y-2'
                )
            );

        return candidates.find(
            candidate =>
                getDispatchRows(
                    candidate
                ).length > 0
        ) || null;
    }

    // =========================================================
    // Category UI
    // =========================================================

    function createCategoryHeader(
        category,
        count,
        onClick,
        options = {}
    ) {
        const header =
            document.createElement('div');

        header.className =
            'afilias-aao-category-header';

        const toggle =
            document.createElement('button');

        toggle.type = 'button';

        toggle.className =
            'afilias-aao-category-toggle';

        toggle.title =
            category.collapsed
                ? 'Kategorie öffnen'
                : 'Kategorie einklappen';

        toggle.setAttribute(
            'aria-expanded',
            String(!category.collapsed)
        );

        toggle.innerHTML = `
            <span class="afilias-aao-chevron">
                ${category.collapsed ? '▶' : '▼'}
            </span>

            <span class="afilias-aao-category-name">
                ${escapeHtml(category.name)}
            </span>

            <span class="afilias-aao-category-count">
                ${count}
            </span>
        `;

        toggle.addEventListener(
            'click',
            onClick
        );

        header.appendChild(
            toggle
        );

        if (options.management) {
            const actions =
                document.createElement('div');

            actions.className =
                'afilias-aao-settings-actions';

            const edit =
                document.createElement('button');

            edit.type = 'button';

            edit.className =
                'afilias-aao-small-button';

            edit.title =
                'Kategorie umbenennen';

            edit.textContent = '✎';

            edit.addEventListener(
                'click',
                event => {
                    event.stopPropagation();
                    options.onRename?.();
                }
            );

            const remove =
                document.createElement('button');

            remove.type = 'button';

            remove.className =
                'afilias-aao-small-button danger';

            remove.title =
                'Kategorie löschen';

            remove.textContent = '×';

            remove.addEventListener(
                'click',
                event => {
                    event.stopPropagation();
                    options.onDelete?.();
                }
            );

            actions.appendChild(edit);
            actions.appendChild(remove);

            header.appendChild(actions);
        }

        return header;
    }

    function createCategoryElement(
        category,
        count,
        onToggle,
        options = {}
    ) {
        const wrapper =
            document.createElement('section');

        wrapper.className =
            'afilias-aao-category';

        const header =
            createCategoryHeader(
                category,
                count,
                onToggle,
                options
            );

        wrapper.appendChild(
            header
        );

        if (!category.collapsed) {
            const body =
                document.createElement('div');

            body.className =
                'afilias-aao-category-body';

            wrapper.appendChild(
                body
            );

            options.populateBody?.(
                body
            );
        }

        return wrapper;
    }

    // =========================================================
    // Settings Panel
    // =========================================================

    function buildSettingsPanel(
        container,
        rows,
        categories,
        assignments
    ) {
        let panel =
            document.getElementById(
                SETTINGS_PANEL_ID
            );

        if (!panel) {
            panel =
                document.createElement('div');

            panel.id =
                SETTINGS_PANEL_ID;

            const parent =
                container.parentElement;

            if (!parent) {
                return;
            }

            parent.insertBefore(
                panel,
                container
            );
        }

        panel.replaceChildren();

        const toolbar =
            document.createElement('div');

        toolbar.className =
            'afilias-aao-settings-toolbar';

        const title =
            document.createElement('div');

        title.className =
            'afilias-aao-settings-title';

        title.textContent =
            'AAO Kategorien';

        toolbar.appendChild(
            title
        );

        const addButton =
            document.createElement('button');

        addButton.type = 'button';

        addButton.className =
            'afilias-aao-action-button primary';

        addButton.textContent =
            '+ Kategorie';

        addButton.addEventListener(
            'click',
            async () => {
                const name =
                    prompt(
                        'Name der neuen Kategorie:'
                    );

                if (
                    !name ||
                    !normalizeText(name)
                ) {
                    return;
                }

                const cleanName =
                    normalizeText(name);

                if (
                    categories.some(
                        category =>
                            category.name.toLowerCase() ===
                            cleanName.toLowerCase()
                    )
                ) {
                    alert(
                        'Eine Kategorie mit diesem Namen existiert bereits.'
                    );
                    return;
                }

                categories.push({
                    id: randomId(),
                    name: cleanName,
                    collapsed: false
                });

                await saveCategories(
                    categories
                );

                scheduleScan(0);
            }
        );

        toolbar.appendChild(
            addButton
        );

        panel.appendChild(
            toolbar
        );

        for (const category of categories) {
            const categoryRows =
                rows.filter(
                    row =>
                        assignments[row.key] ===
                        category.id
                );

            const section =
                createCategoryElement(
                    category,
                    categoryRows.length,
                    async () => {
                        category.collapsed =
                            !category.collapsed;

                        await saveCategories(
                            categories
                        );

                        scheduleScan(0);
                    },
                    {
                        management: true,

                        onRename:
                            async () => {
                                const name =
                                    prompt(
                                        'Neuer Name der Kategorie:',
                                        category.name
                                    );

                                if (
                                    !name ||
                                    !normalizeText(name)
                                ) {
                                    return;
                                }

                                const cleanName =
                                    normalizeText(name);

                                if (
                                    categories.some(
                                        other =>
                                            other.id !==
                                                category.id &&
                                            other.name.toLowerCase() ===
                                                cleanName.toLowerCase()
                                    )
                                ) {
                                    alert(
                                        'Eine Kategorie mit diesem Namen existiert bereits.'
                                    );
                                    return;
                                }

                                category.name =
                                    cleanName;

                                await saveCategories(
                                    categories
                                );

                                scheduleScan(0);
                            },

                        onDelete:
                            async () => {
                                if (
                                    !confirm(
                                        `Kategorie „${category.name}“ wirklich löschen? ` +
                                        `Die AAOs werden nicht gelöscht.`
                                    )
                                ) {
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

                                categories.splice(
                                    categories.indexOf(
                                        category
                                    ),
                                    1
                                );

                                await saveAssignments(
                                    assignments
                                );

                                await saveCategories(
                                    categories
                                );

                                scheduleScan(0);
                            },

                        populateBody:
                            body => {
                                for (
                                    const row of
                                    categoryRows
                                ) {
                                    body.appendChild(
                                        createSettingsAAORow(
                                            row,
                                            categories,
                                            assignments
                                        )
                                    );
                                }
                            }
                    }
                );

            panel.appendChild(
                section
            );
        }

        const unassignedRows =
            rows.filter(
                row =>
                    !assignments[row.key] ||
                    !categories.some(
                        category =>
                            category.id ===
                            assignments[row.key]
                    )
            );

        const unassignedCategory = {
            id: '__unassigned__',
            name: 'Nicht zugeordnet',
            collapsed: false
        };

        const unassignedSection =
            createCategoryElement(
                unassignedCategory,
                unassignedRows.length,
                () => {
                    unassignedCategory.collapsed =
                        !unassignedCategory.collapsed;

                    scheduleScan(0);
                },
                {
                    populateBody:
                        body => {
                            if (
                                unassignedRows.length ===
                                0
                            ) {
                                const empty =
                                    document.createElement(
                                        'div'
                                    );

                                empty.className =
                                    'afilias-aao-empty';

                                empty.textContent =
                                    'Alle AAOs sind zugeordnet.';

                                body.appendChild(
                                    empty
                                );
                            } else {
                                for (
                                    const row of
                                    unassignedRows
                                ) {
                                    body.appendChild(
                                        createSettingsAAORow(
                                            row,
                                            categories,
                                            assignments
                                        )
                                    );
                                }
                            }
                        }
                }
            );

        panel.appendChild(
            unassignedSection
        );

        container.style.display =
            'none';
    }

    // =========================================================
    // Settings AAO Row
    // =========================================================

    function createSettingsAAORow(
        row,
        categories,
        assignments
    ) {
        const wrapper =
            document.createElement('div');

        wrapper.className =
            'afilias-aao-item';

        const icon =
            document.createElement('div');

        icon.className =
            'afilias-aao-item-icon';

        icon.innerHTML =
            '<i class="fa-solid fa-shuffle"></i>';

        const text =
            document.createElement('div');

        text.className =
            'afilias-aao-item-text';

        const name =
            document.createElement('div');

        name.className =
            'afilias-aao-item-name';

        name.textContent =
            row.name;

        const summary =
            document.createElement('div');

        summary.className =
            'afilias-aao-item-summary';

        summary.textContent =
            row.summary;

        text.appendChild(name);

        if (row.summary) {
            text.appendChild(summary);
        }

        const assignment =
            document.createElement('div');

        assignment.className =
            'afilias-aao-settings-assignment';

        const select =
            document.createElement('select');

        select.title =
            `Kategorie für ${row.name}`;

        select.innerHTML =
            '<option value="">Nicht zugeordnet</option>' +
            categories
                .map(
                    category =>
                        `<option value="${escapeHtml(category.id)}">` +
                        `${escapeHtml(category.name)}` +
                        `</option>`
                )
                .join('');

        select.value =
            assignments[row.key] || '';

        select.addEventListener(
            'click',
            event => {
                event.stopPropagation();
            }
        );

        select.addEventListener(
            'change',
            async event => {
                event.stopPropagation();

                const value =
                    event.target.value;

                if (value) {
                    assignments[row.key] =
                        value;
                } else {
                    delete assignments[
                        row.key
                    ];
                }

                await saveAssignments(
                    assignments
                );

                scheduleScan(0);
            }
        );

        assignment.appendChild(
            select
        );

        const actions =
            document.createElement('div');

        actions.className =
            'afilias-aao-settings-actions';

        const editButton =
            document.createElement('button');

        editButton.type = 'button';

        editButton.className =
            'afilias-aao-small-button';

        editButton.title =
            'AAO bearbeiten';

        editButton.textContent =
            '✎';

        editButton.addEventListener(
            'click',
            event => {
                event.stopPropagation();

                const pencilIcon =
                    row.row.querySelector(
                        'svg.lucide-pencil, svg[class*="lucide-pencil"]'
                    );

                const original =
                    pencilIcon?.closest(
                        'button'
                    ) ||
                    Array.from(
                        row.row.querySelectorAll(
                            'button'
                        )
                    ).find(
                        button =>
                            !button.matches(
                                '[data-slot="sortable-item-handle"]'
                            ) &&
                            !button.matches(
                                '[data-slot="alert-dialog-trigger"]'
                            )
                    );

                original?.click();
            }
        );

        const deleteButton =
            document.createElement('button');

        deleteButton.type = 'button';

        deleteButton.className =
            'afilias-aao-small-button danger';

        deleteButton.title =
            'AAO löschen';

        deleteButton.textContent =
            '×';

        deleteButton.addEventListener(
            'click',
            event => {
                event.stopPropagation();

                const original =
                    row.row.querySelector(
                        'button[data-slot="alert-dialog-trigger"]'
                    );

                original?.click();
            }
        );

        actions.appendChild(
            editButton
        );

        actions.appendChild(
            deleteButton
        );

        const rowContent =
            document.createElement('div');

        rowContent.className =
            'afilias-aao-settings-row';

        rowContent.appendChild(icon);
        rowContent.appendChild(text);
        rowContent.appendChild(assignment);
        rowContent.appendChild(actions);

        wrapper.appendChild(
            rowContent
        );

        return wrapper;
    }

    // =========================================================
    // Dispatch Panel
    // =========================================================

    function buildDispatchPanel(
        sheet,
        list,
        rows,
        categories,
        assignments
    ) {
        if (!sheet || !list) {
            return;
        }

        let panel =
            sheet.querySelector(
                `#${DISPATCH_PANEL_ID}`
            );

        if (!panel) {
            panel =
                document.createElement('div');

            panel.id =
                DISPATCH_PANEL_ID;

            list.parentElement?.insertBefore(
                panel,
                list
            );
        }

        const searchInput =
            findDispatchSearchInput(
                sheet
            );

        const searchTerm =
            normalizeText(
                searchInput?.value || ''
            ).toLowerCase();

        /*
         * Before rebuilding our UI, synchronize our selection
         * state with the game's actual DOM where possible.
         */
        synchronizeSelectionFromGame(
            rows
        );

        panel.replaceChildren();

        const matchingRows =
            searchTerm
                ? rows.filter(
                    row =>
                        `${row.name} ${row.summary}`
                            .toLowerCase()
                            .includes(searchTerm)
                )
                : rows;

        for (const category of categories) {
            const categoryRows =
                matchingRows.filter(
                    row =>
                        assignments[row.key] ===
                        category.id
                );

            if (
                categoryRows.length === 0
            ) {
                continue;
            }

            const section =
                createCategoryElement(
                    category,
                    categoryRows.length,
                    async () => {
                        category.collapsed =
                            !category.collapsed;

                        await saveCategories(
                            categories
                        );

                        scheduleScan(0);
                    },
                    {
                        populateBody:
                            body => {
                                for (
                                    const row of
                                    categoryRows
                                ) {
                                    body.appendChild(
                                        createDispatchAAORow(
                                            row
                                        )
                                    );
                                }
                            }
                    }
                );

            panel.appendChild(
                section
            );
        }

        const unassignedRows =
            matchingRows.filter(
                row =>
                    !assignments[row.key] ||
                    !categories.some(
                        category =>
                            category.id ===
                            assignments[row.key]
                    )
            );

        if (
            unassignedRows.length > 0
        ) {
            const category = {
                id: '__unassigned_dispatch__',
                name: 'Nicht zugeordnet',
                collapsed: true
            };

            const section =
                createCategoryElement(
                    category,
                    unassignedRows.length,
                    () => {
                        category.collapsed =
                            !category.collapsed;

                        scheduleScan(0);
                    },
                    {
                        populateBody:
                            body => {
                                for (
                                    const row of
                                    unassignedRows
                                ) {
                                    body.appendChild(
                                        createDispatchAAORow(
                                            row
                                        )
                                    );
                                }
                            }
                    }
                );

            panel.appendChild(
                section
            );
        }

        if (
            panel.children.length === 0
        ) {
            const empty =
                document.createElement('div');

            empty.className =
                'afilias-aao-empty';

            empty.textContent =
                searchTerm
                    ? 'Keine AAOs entsprechen der Suche.'
                    : 'Keine AAOs gefunden.';

            panel.appendChild(
                empty
            );
        }

        list.style.display =
            'none';
    }

    // =========================================================
    // Selection Detection
    // =========================================================

    function isOriginalAAOSelected(row) {
        if (!row?.row) {
            return false;
        }

        const element =
            row.row;

        const className =
            typeof element.className === 'string'
                ? element.className
                : '';

        const ariaPressed =
            element.getAttribute(
                'aria-pressed'
            );

        const dataState =
            element.getAttribute(
                'data-state'
            );

        if (
            ariaPressed === 'true' ||
            dataState === 'selected' ||
            dataState === 'active'
        ) {
            return true;
        }

        if (
            className.includes('border-red') ||
            className.includes('bg-red') ||
            className.includes('text-red') ||
            className.includes('ring-red')
        ) {
            return true;
        }

        return false;
    }

    function synchronizeSelectionFromGame(rows) {
        if (
            selectionChangeInProgress
        ) {
            return;
        }


        for (const row of rows) {
            if (
                isOriginalAAOSelected(row)
            ) {
                selectedAAOs.add(
                    row.key
                );
            } else if (
                selectedAAOs.has(row.key)
            ) {

            }
        }
    }

    function clearSelectionsIfGameHasReset(rows) {
        if (
            selectionChangeInProgress
        ) {
            return;
        }

        if (!rows.length) {
            return;
        }

        const anySelected =
            rows.some(
                isOriginalAAOSelected
            );


        if (!anySelected) {
            selectedAAOs.clear();
        }
    }

    // =========================================================
    // Dispatch AAO Row
    // =========================================================

    function createDispatchAAORow(row) {
        const button =
            document.createElement('button');

        button.type = 'button';

        button.className =
            'afilias-aao-item afilias-aao-dispatch-item';


        if (
            selectedAAOs.has(row.key)
        ) {
            button.classList.add(
                'is-selected'
            );
        }

        const icon =
            document.createElement('div');

        icon.className =
            'afilias-aao-item-icon';

        icon.innerHTML =
            '<i class="fa-solid fa-shuffle"></i>';

        const text =
            document.createElement('div');

        text.className =
            'afilias-aao-item-text';

        const name =
            document.createElement('div');

        name.className =
            'afilias-aao-item-name';

        name.textContent =
            row.name;

        const summary =
            document.createElement('div');

        summary.className =
            'afilias-aao-item-summary';

        summary.textContent =
            row.summary;

        text.appendChild(name);

        if (row.summary) {
            text.appendChild(summary);
        }

        button.appendChild(icon);
        button.appendChild(text);

        button.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                /*
                 * Toggle our visual state immediately.
                 */
                const wasSelected =
                    selectedAAOs.has(
                        row.key
                    );

                if (wasSelected) {
                    selectedAAOs.delete(
                        row.key
                    );
                } else {
                    selectedAAOs.add(
                        row.key
                    );
                }

                button.classList.toggle(
                    'is-selected',
                    !wasSelected
                );


                selectionChangeInProgress =
                    true;

                pauseObserver(150);

                try {
                    row.row.click();
                } catch (error) {
                    console.error(
                        '[Afilia AAO Categories] Failed to click original AAO:',
                        error
                    );
                }


                setTimeout(
                    () => {
                        selectionChangeInProgress =
                            false;

                        scheduleScan(50);
                    },
                    100
                );
            }
        );

        return button;
    }

    // =========================================================
    // Search
    // =========================================================

    function wireDispatchSearch(
        sheet
    ) {
        const searchInput =
            findDispatchSearchInput(
                sheet
            );

        if (
            !searchInput ||
            searchInput.dataset
                .afiliasAAOWired === '1'
        ) {
            return;
        }

        searchInput.dataset
            .afiliasAAOWired = '1';

        searchInput.addEventListener(
            'input',
            () => {
                scheduleScan(0);
            }
        );
    }

    // =========================================================
    // Main Scan
    // =========================================================

    async function scan() {
        if (scanRunning) {
            return;
        }

        scanRunning = true;

        try {
            injectStyles();

            const [
                categories,
                assignments
            ] = await Promise.all([
                loadCategories(),
                loadAssignments()
            ]);

            // -------------------------------------------------
            // Game Settings
            // -------------------------------------------------

            const settingsContainer =
                findSettingsAAOContainer();

            if (
                settingsContainer
            ) {
                const rows =
                    findSettingsRows(
                        settingsContainer
                    );

                if (
                    rows.length > 0
                ) {
                    buildSettingsPanel(
                        settingsContainer,
                        rows,
                        categories,
                        assignments
                    );
                }
            }

            // -------------------------------------------------
            // Dispatch
            // -------------------------------------------------

            const sheet =
                findDispatchSheet();

            if (sheet) {
                const list =
                    findDispatchList(
                        sheet
                    );

                if (list) {
                    const rows =
                        getDispatchRows(
                            list
                        );

                    if (
                        rows.length > 0
                    ) {
                        buildDispatchPanel(
                            sheet,
                            list,
                            rows,
                            categories,
                            assignments
                        );
                    }

                    wireDispatchSearch(
                        sheet
                    );
                }
            }
        } catch (error) {
            console.error(
                '[Afilia AAO Categories] scan failed:',
                error
            );
        } finally {
            scanRunning = false;
        }
    }

    // =========================================================
    // Scheduler
    // =========================================================

    function scheduleScan(
        delay = 80
    ) {
        clearTimeout(
            scanTimer
        );

        scanTimer =
            setTimeout(
                () => {
                    scanTimer = null;
                    scan();
                },
                delay
            );
    }

    // =========================================================
    // Mutation Observer
    // =========================================================

    function startObserver() {
        if (observer) {
            return;
        }

        observer =
            new MutationObserver(
                mutations => {
                    if (
                        Date.now() <
                        observerPauseUntil
                    ) {
                        return;
                    }

                    let relevant =
                        false;

                    for (
                        const mutation of
                        mutations
                    ) {
                        if (
                            mutation.type ===
                            'childList'
                        ) {
                            relevant =
                                true;
                            break;
                        }

                        if (
                            mutation.type ===
                                'attributes' &&
                            [
                                'style',
                                'class',
                                'data-state',
                                'value'
                            ].includes(
                                mutation.attributeName
                            )
                        ) {
                            relevant =
                                true;
                            break;
                        }
                    }

                    if (
                        relevant
                    ) {
                        scheduleScan(
                            100
                        );
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
                    'style',
                    'class',
                    'data-state',
                    'value'
                ]
            }
        );
    }

    // =========================================================
    // Initialization
    // =========================================================

    async function init() {
        try {
            await loadCategories();
            await loadAssignments();

            injectStyles();
            startObserver();

            scheduleScan(0);

            log(
                'initialized'
            );
        } catch (error) {
            console.error(
                '[Afilia AAO Categories] initialization failed:',
                error
            );
        }
    }

    init();
})();

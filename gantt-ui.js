        // ===== グリッド インライン編集 =====
        (function() {
            let _ie = { taskId: null, field: null };

            // ポップアップを取得（初回のみ作成）
            function getPopup() {
                let p = document.getElementById('inline-edit-popup');
                if (p) return p;
                p = document.createElement('div');
                p.id = 'inline-edit-popup';
                p.innerHTML = `
                    <div id="inline-edit-header">
                        <span id="inline-edit-field-label"></span>
                        <button id="inline-edit-close-btn" title="閉じる">×</button>
                    </div>
                    <div class="inline-edit-section" id="inline-edit-text-section">
                        <input type="text" id="inline-edit-text-input" />
                    </div>
                    <div class="inline-edit-section" id="inline-edit-ms-section">
                        <input type="text" id="inline-edit-ms-search" placeholder="検索..." />
                        <div id="inline-edit-ms-options"></div>
                        <div id="inline-edit-free-row" style="display:none; margin-top:6px; border-top:1px solid #eee; padding-top:6px;">
                            <div style="font-size:11px; color:#666; margin-bottom:3px;">自由入力（入力した場合はリスト選択より優先）</div>
                            <input type="text" id="inline-edit-free-text" placeholder="タスク名を自由入力..." style="width:100%; box-sizing:border-box; padding:5px 8px; border:1px solid #aaa; border-radius:4px; font-size:13px;" />
                        </div>
                    </div>
                    <div class="inline-edit-section" id="inline-edit-date-section">
                        <input type="date" id="inline-edit-date-input" />
                    </div>
                    <div id="inline-edit-buttons">
                        <button id="inline-edit-save-btn">保存</button>
                        <button id="inline-edit-cancel-btn">キャンセル</button>
                    </div>`;
                document.body.appendChild(p);

                p.querySelector('#inline-edit-close-btn').addEventListener('click', closeIE);
                p.querySelector('#inline-edit-cancel-btn').addEventListener('click', closeIE);
                p.querySelector('#inline-edit-save-btn').addEventListener('click', saveIE);
                p.querySelector('#inline-edit-text-input').addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') saveIE();
                    if (e.key === 'Escape') closeIE();
                });
                p.querySelector('#inline-edit-date-input').addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') saveIE();
                    if (e.key === 'Escape') closeIE();
                });
                p.querySelector('#inline-edit-ms-search').addEventListener('input', function() {
                    const q = this.value.toLowerCase();
                    p.querySelectorAll('.inline-ms-option').forEach(function(opt) {
                        opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
                    });
                });
                return p;
            }

            function positionPopup(popup, cellEl) {
                // DOM要素または事前取得済みのDOMRectどちらも受け付ける
                const rect = (typeof cellEl.getBoundingClientRect === 'function') ? cellEl.getBoundingClientRect() : cellEl;
                // visibility:hidden で画面外に配置してサイズを計測（フラッシュ防止）
                popup.style.visibility = 'hidden';
                popup.style.top = '0px';
                popup.style.left = '0px';
                popup.classList.add('visible');
                const pw = popup.offsetWidth, ph = popup.offsetHeight;
                popup.classList.remove('visible');
                popup.style.visibility = '';
                const margin = 8;
                let top = rect.bottom + 4;
                let left = rect.left;
                if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
                if (top + ph > window.innerHeight - margin) top = rect.top - ph - 4;
                popup.style.top = Math.max(margin, top) + 'px';
                popup.style.left = Math.max(margin, left) + 'px';
            }

            function closeIE() {
                const p = document.getElementById('inline-edit-popup');
                if (p) p.classList.remove('visible');
                _ie = { taskId: null, field: null };
            }

            function showTextSection(value) {
                const p = getPopup();
                p.querySelector('#inline-edit-text-section').style.display = 'block';
                p.querySelector('#inline-edit-ms-section').style.display = 'none';
                p.querySelector('#inline-edit-date-section').style.display = 'none';
                const inp = p.querySelector('#inline-edit-text-input');
                inp.value = value;
                setTimeout(function() { inp.select(); }, 50);
            }

            function showMsSection(options, selectedValues, mainSelected) {
                const p = getPopup();
                p.querySelector('#inline-edit-text-section').style.display = 'none';
                p.querySelector('#inline-edit-ms-section').style.display = 'block';
                p.querySelector('#inline-edit-date-section').style.display = 'none';
                p.querySelector('#inline-edit-ms-search').value = '';
                const container = p.querySelector('#inline-edit-ms-options');
                container.innerHTML = '';
                const showRadio = mainSelected !== undefined;
                options.forEach(function(opt) {
                    if (opt.isGroup) {
                        const g = document.createElement('div');
                        g.className = 'inline-ms-group';
                        g.textContent = opt.label;
                        container.appendChild(g);
                    } else {
                        const lbl = document.createElement('label');
                        lbl.className = 'inline-ms-option';
                        if (showRadio) {
                            const rb = document.createElement('input');
                            rb.type = 'radio';
                            rb.name = 'ie_main_owner_radio';
                            rb.value = opt.value;
                            rb.checked = opt.value === mainSelected;
                            rb.title = 'メイン担当に設定';
                            rb.style.cursor = 'pointer';
                            lbl.appendChild(rb);
                        }
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.value = opt.value;
                        cb.checked = selectedValues.includes(opt.value);
                        lbl.appendChild(cb);
                        lbl.appendChild(document.createTextNode(' ' + opt.label));
                        container.appendChild(lbl);
                    }
                });
            }

            function showDateSection(dateObj) {
                const p = getPopup();
                p.querySelector('#inline-edit-text-section').style.display = 'none';
                p.querySelector('#inline-edit-ms-section').style.display = 'none';
                p.querySelector('#inline-edit-date-section').style.display = 'block';
                if (!dateObj) return;
                const d = new Date(dateObj);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                p.querySelector('#inline-edit-date-input').value = y + '-' + m + '-' + day;
            }

            function buildTaskNameOpts(parentName) {
                const out = [];
                const filtered = parentName
                    ? taskNameOptions.filter(function(g) { return g.label === parentName; })
                    : taskNameOptions;
                const src = filtered.length > 0 ? filtered : taskNameOptions;
                src.forEach(function(g) {
                    if (src.length < taskNameOptions.length) {
                        // フィルタ中はグループ見出しを省略
                    } else {
                        out.push({ isGroup: true, label: g.label });
                    }
                    g.options.forEach(function(n) { out.push({ value: n, label: n }); });
                });
                return out;
            }

            function buildOwnerOpts(majorItem) {
                const out = [];
                const entries = Object.entries(ownerMaster);
                const filtered = majorItem
                    ? entries.filter(function(e) { return e[0] === majorItem; })
                    : entries;
                const src = filtered.length > 0 ? filtered : entries;
                src.forEach(function([dept, owners]) {
                    if (src.length < entries.length) {
                        // フィルタ中はグループ見出しを省略
                    } else {
                        out.push({ isGroup: true, label: dept });
                    }
                    owners.forEach(function(o) { out.push({ value: o, label: o }); });
                });
                return out;
            }

            function buildLocationOpts() {
                const out = [];
                LOCATION_GROUPS.forEach(function(g) {
                    out.push({ isGroup: true, label: g });
                    LOCATION_NUMBERS.forEach(function(n) { out.push({ value: g + '-' + n, label: g + '-' + n }); });
                });
                return out;
            }

            async function showIE(taskId, field, cellEl) {
                const task = gantt.getTask(taskId);
                if (!task || task.$virtual) return;
                _ie = { taskId, field };

                // await より前に座標を確定させる（await 後はスクロール等で位置がズレる場合がある）
                const cellRect = cellEl.getBoundingClientRect();

                const labels = {
                    project_number: '工事番号', text: 'タスク名', machine: '機械',
                    unit: 'ユニット', owner: '担当', area_number: '場所',
                    start_date: '開始日', end_date: '終了日',
                    customer_name: '客先名', project_details: '工事名'
                };
                const popup = getPopup();
                popup.querySelector('#inline-edit-field-label').textContent = labels[field] || field;

                // タスク名以外では自由入力欄を隠す
                const _freeRow = popup.querySelector('#inline-edit-free-row');
                if (_freeRow) _freeRow.style.display = 'none';

                if (field === 'project_number' || field === 'machine' || field === 'unit' || field === 'customer_name' || field === 'project_details') {
                    showTextSection(task[field] || '');
                } else if (field === 'text') {
                    const sel = (task.text || '').split(/[,，]/).map(function(s) { return s.trim(); }).filter(Boolean);
                    showMsSection(buildTaskNameOpts(task.parent_name || ''), sel);
                    // 自由入力欄を表示し、既存値がリストにない場合はプリセット
                    const freeRow = popup.querySelector('#inline-edit-free-row');
                    const freeText = popup.querySelector('#inline-edit-free-text');
                    if (freeRow && freeText) {
                        freeRow.style.display = '';
                        const allOpts = buildTaskNameOpts(task.parent_name || '');
                        const allValues = allOpts.filter(function(o) { return !o.isGroup; }).map(function(o) { return o.value; });
                        const hasUnknown = sel.some(function(s) { return !allValues.includes(s); });
                        freeText.value = hasUnknown ? sel.filter(function(s) { return !allValues.includes(s); }).join(',') : '';
                    }
                } else if (field === 'owner') {
                    showMsSection(buildOwnerOpts(task.major_item || ''), getNormalizedOwners(task.owner || ''), task.main_owner || '');
                } else if (field === 'area_number') {
                    // task_locations から正確なデータを取得
                    const realId = task.original_id || taskId;
                    const { data: locData } = await supabaseClient.from('task_locations')
                        .select('area_group, area_number').eq('task_id', realId);
                    const sel = (locData || []).map(function(l) { return l.area_group + '-' + l.area_number; });
                    showMsSection(buildLocationOpts(), sel);
                } else if (field === 'start_date') {
                    showDateSection(task.start_date);
                } else if (field === 'end_date') {
                    const d = gantt.calculateEndDate(task.start_date, task.duration);
                    d.setDate(d.getDate() - 1);
                    showDateSection(d);
                }

                positionPopup(popup, cellRect);
                popup.classList.add('visible');
            }

            async function saveIE() {
                const { taskId, field } = _ie;
                if (!taskId || !field) return;
                const task = gantt.getTask(taskId);
                if (!task) return;

                if (field === 'project_number' || field === 'machine' || field === 'unit' || field === 'customer_name' || field === 'project_details') {
                    task[field] = document.getElementById('inline-edit-text-input').value.trim();

                } else if (field === 'text') {
                    const freeVal = (document.getElementById('inline-edit-free-text')?.value || '').trim();
                    if (freeVal) {
                        task.text = freeVal;
                    } else {
                        const checked = Array.from(document.querySelectorAll('#inline-edit-ms-options input[type=checkbox]:checked')).map(function(cb) { return cb.value; });
                        task.text = checked.join(',');
                    }

                } else if (field === 'owner') {
                    const checked = Array.from(document.querySelectorAll('#inline-edit-ms-options input[type=checkbox]:checked')).map(function(cb) { return cb.value; });
                    task.owner = checked.join(',');
                    const mainRadio = document.querySelector('#inline-edit-ms-options input[name="ie_main_owner_radio"]:checked');
                    task.main_owner = mainRadio ? mainRadio.value : '';

                } else if (field === 'area_number') {
                    const checked = Array.from(document.querySelectorAll('#inline-edit-ms-options input[type=checkbox]:checked')).map(function(cb) { return cb.value; });
                    const locs = checked.map(function(v) {
                        const parts = v.split('-');
                        return { group: parts[0], num: parts[1] };
                    });
                    task.area_group = locs.length > 0 ? locs[0].group : '';
                    task.area_number = locs.map(function(l) { return l.num; }).join(',');
                    task._selected_locations = locs.map(function(l) { return { group: l.group, num: l.num }; });
                    // task_locations テーブルを直接更新
                    const realId = task.original_id || taskId;
                    await supabaseClient.from('task_locations').delete().eq('task_id', realId);
                    if (locs.length > 0) {
                        await supabaseClient.from('task_locations').insert(
                            locs.map(function(l) { return { task_id: realId, area_group: l.group, area_number: l.num }; })
                        );
                    }

                } else if (field === 'start_date') {
                    const val = document.getElementById('inline-edit-date-input').value;
                    if (val) {
                        const [y, m, d] = val.split('-').map(Number);
                        const newStart = new Date(y, m - 1, d); // ローカル時刻で生成
                        const oldEnd = gantt.calculateEndDate(task.start_date, task.duration);
                        task.duration = Math.max(1, Math.round(gantt.calculateDuration(newStart, oldEnd)));
                        task.start_date = newStart;
                    }

                } else if (field === 'end_date') {
                    const val = document.getElementById('inline-edit-date-input').value;
                    if (val) {
                        const [y, m, d] = val.split('-').map(Number);
                        // ローカル時刻でstart_dateを正規化してカレンダー日数で算出
                        const startNorm = new Date(task.start_date);
                        startNorm.setHours(0, 0, 0, 0);
                        const endInclusive = new Date(y, m - 1, d);
                        const newDur = Math.round((endInclusive - startNorm) / (1000 * 60 * 60 * 24)) + 1;
                        task.duration = Math.max(1, newDur);
                        // end_dateはduration変更のみのため直接Supabaseに保存
                        const realId = task.original_id || taskId;
                        await supabaseClient.from('tasks').update({ duration: task.duration }).eq('id', realId);
                        // 変更履歴を記録
                        if (typeof window.logChange === 'function') {
                            window.logChange(task.project_number || '', task.machine || '', task.unit || '', task.text || '', '終了日を変更しました');
                        }
                        closeIE();
                        await fetchTasks();
                        return;
                    }
                }

                closeIE();
                gantt.updateTask(taskId);
            }

            // グリッドセルクリック → ガントチャートの横スクロール調整
            gantt.attachEvent("onTaskClick", function(id, e) {
                const cell = e.target.closest('.gantt_cell');
                if (!cell) return true; // バークリック：デフォルト動作
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'BUTTON' ||
                    e.target.classList.contains('gantt_tree_icon') ||
                    e.target.classList.contains('zoom-btn')) return true;

                // グリッドセルクリック → タスク開始日へ横スクロール
                const task = gantt.getTask(id);
                if (task && !task.$virtual) {
                    const pos = gantt.posFromDate(new Date(task.start_date));
                    gantt.scrollTo(Math.max(0, pos - 200), null);
                }
                return true;
            });

            // グリッドセルダブルクリック → インライン編集 / バーダブルクリック → 全項目編集画面
            gantt.attachEvent("onTaskDblClick", function(id, e) {
                const task = gantt.getTask(id);
                if (!task) return false;

                // 設計工程表の出張タスクは編集不可
                if (task.$design_trip) return false;

                const cell = e.target.closest('.gantt_cell');
                if (!cell) {
                    // バーダブルクリック：ライトボックスを表示（デフォルト動作）
                    return true;
                }
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'BUTTON' ||
                    e.target.classList.contains('gantt_tree_icon') ||
                    e.target.classList.contains('zoom-btn')) return true;

                if (task.$virtual) return false;

                const row = cell.parentElement;
                const cells = Array.from(row.children).filter(function(c) { return c.classList.contains('gantt_cell'); });
                const idx = cells.indexOf(cell);
                const cols = gantt.config.columns;
                if (idx < 0 || idx >= cols.length) return false;

                const colName = cols[idx].name;
                const editableFields = ['project_number', 'text', 'machine', 'unit', 'owner', 'area_number', 'start_date', 'end_date', 'customer_name', 'project_details'];
                if (!editableFields.includes(colName)) return false;

                showIE(id, colName, cell);
                return false; // デフォルト（ライトボックス）をキャンセル
            });

            // ポップアップ外クリックで閉じる
            document.addEventListener('click', function(e) {
                const p = document.getElementById('inline-edit-popup');
                if (p && p.classList.contains('visible') && !p.contains(e.target) && !e.target.closest('.gantt_cell')) {
                    closeIE();
                }
            });

            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeIE();
            });

        })();
        // ===== インライン編集 ここまで =====

        // ===== 右クリックコンテキストメニュー =====
        (function() {
            let _ctxTaskId = null;

            // ===== 複数行選択 =====
            let _selectedIds = new Set();   // 選択中のタスクID
            window._ganttSelectedIds = _selectedIds; // grid_row_class テンプレートから参照
            let _lastClickedId = null;      // Shift範囲選択の起点

            // 選択変更をガントに通知（テンプレート経由でクラスが付くため再描画のみ）
            function applySelectionHighlight() {
                gantt.render();
            }

            // 表示中のタスクIDを順番通りに返す
            function getVisibleTaskIds() {
                const ids = [];
                gantt.eachTask(function(task) {
                    try {
                        if (!task.$virtual && gantt.isTaskVisible(task.id)) ids.push(String(task.id));
                    } catch(e) {}
                });
                return ids;
            }

            // 選択をクリア
            function clearSelection() {
                if (_selectedIds.size === 0) return;
                _selectedIds.clear();
                _lastClickedId = null;
                applySelectionHighlight();
            }

            // Ctrl/Shift クリックによる行選択
            gantt.attachEvent('onTaskClick', function(id, e) {
                const cell = e.target.closest('.gantt_cell');
                if (!cell) return true;
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'BUTTON' ||
                    e.target.classList.contains('gantt_tree_icon') ||
                    e.target.classList.contains('zoom-btn')) return true;

                const task = gantt.getTask(id);
                if (!task || task.$virtual) return true;

                const sid = String(id);

                if (e.ctrlKey || e.metaKey) {
                    // Ctrl: トグル
                    if (_selectedIds.has(sid)) {
                        _selectedIds.delete(sid);
                    } else {
                        _selectedIds.add(sid);
                    }
                    _lastClickedId = sid;
                    applySelectionHighlight();
                    return true; // スクロール等のデフォルト動作は継続
                } else if (e.shiftKey && _lastClickedId) {
                    // Shift: 範囲選択
                    const visIds = getVisibleTaskIds();
                    const a = visIds.indexOf(_lastClickedId);
                    const b = visIds.indexOf(sid);
                    if (a >= 0 && b >= 0) {
                        const lo = Math.min(a, b), hi = Math.max(a, b);
                        for (let i = lo; i <= hi; i++) _selectedIds.add(visIds[i]);
                    }
                    applySelectionHighlight();
                    return true;
                } else {
                    // 通常クリック: 選択解除
                    clearSelection();
                    _lastClickedId = sid;
                    return true;
                }
            });

            // メニュー要素を取得（初回のみ作成）
            function getMenu() {
                let m = document.getElementById('grid-context-menu');
                if (m) return m;
                m = document.createElement('div');
                m.id = 'grid-context-menu';
                m.innerHTML = `
                    <div class="ctx-menu-item" id="ctx-copy-btn">
                        <span>📋</span> <span id="ctx-copy-label">行をコピー（下に追加）</span>
                    </div>
                    <hr class="ctx-menu-separator">
                    <div class="ctx-menu-item ctx-delete" id="ctx-delete-btn">
                        <span>🗑️</span> <span id="ctx-delete-label">行を削除</span>
                    </div>`;
                document.body.appendChild(m);
                document.getElementById('ctx-copy-btn').addEventListener('click', handleCopy);
                document.getElementById('ctx-delete-btn').addEventListener('click', handleDelete);
                return m;
            }

            function showMenu(x, y, targetId) {
                const m = getMenu();
                // 選択中IDセットにターゲットが含まれていなければ単独選択
                if (!_selectedIds.has(String(targetId))) {
                    clearSelection();
                    _selectedIds.add(String(targetId));
                    _lastClickedId = String(targetId);
                    applySelectionHighlight();
                }
                const count = _selectedIds.size;
                const suffix = count > 1 ? '（' + count + '行）' : '';
                document.getElementById('ctx-copy-label').textContent = '行をコピー' + suffix;
                document.getElementById('ctx-delete-label').textContent = '行を削除' + suffix;

                m.classList.add('visible');
                const margin = 8;
                let left = x, top = y + 2;
                if (left + m.offsetWidth > window.innerWidth - margin) left = window.innerWidth - m.offsetWidth - margin;
                if (top + m.offsetHeight > window.innerHeight - margin) top = y - m.offsetHeight - 2;
                m.style.left = Math.max(margin, left) + 'px';
                m.style.top  = Math.max(margin, top)  + 'px';
            }

            function hideMenu() {
                const m = document.getElementById('grid-context-menu');
                if (m) m.classList.remove('visible');
                _ctxTaskId = null;
            }

            // コピーする項目の定義
            const COPY_FIELDS = [
                { key: 'project_number',  label: '工事番号' },
                { key: 'text',            label: 'タスク名' },
                { key: 'major_item',      label: '部署' },
                { key: 'machine',         label: '機械' },
                { key: 'unit',            label: 'ユニット' },
                { key: 'owner',           label: '担当' },
                { key: 'area_number',     label: '場所' },
                { key: 'start_date',      label: '開始日' },
                { key: 'duration',        label: '終了日/期間' },
            ];
            const COPY_PREF_KEY = 'gantt_copy_fields_pref';

            function loadCopyPrefs() {
                try {
                    const raw = localStorage.getItem(COPY_PREF_KEY);
                    if (raw) return JSON.parse(raw);
                } catch(e) {}
                // デフォルト：全項目ON
                const def = {};
                COPY_FIELDS.forEach(function(f) { def[f.key] = true; });
                return def;
            }

            function saveCopyPrefs(prefs) {
                try { localStorage.setItem(COPY_PREF_KEY, JSON.stringify(prefs)); } catch(e) {}
            }

            // コピー処理（項目選択モーダルを経由）
            function handleCopy() {
                const targetIds = _selectedIds.size > 0
                    ? Array.from(_selectedIds)
                    : (_ctxTaskId ? [String(_ctxTaskId)] : []);
                hideMenu();
                if (targetIds.length === 0) return;
                const tasks = targetIds.map(function(id) { return gantt.getTask(id); })
                    .filter(function(t) { return t && !t.$virtual; });
                if (tasks.length === 0) return;

                // 単行コピーの場合は後方互換のため task を 1 件だけ使う
                const task = tasks[0];
                const taskId = String(task.id);

                const prefs = loadCopyPrefs();

                // チェックボックスリストを生成
                const list = document.getElementById('copy-fields-list');
                list.innerHTML = '';
                COPY_FIELDS.forEach(function(f) {
                    const lbl = document.createElement('label');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.name = 'copy_field';
                    cb.value = f.key;
                    cb.checked = prefs[f.key] !== false;
                    lbl.appendChild(cb);
                    lbl.appendChild(document.createTextNode(f.label));
                    list.appendChild(lbl);
                });

                const overlay = document.getElementById('copy-fields-overlay');
                overlay.classList.add('visible');

                function doExecute() {
                    // 現在のチェック状態を保存
                    const newPrefs = {};
                    COPY_FIELDS.forEach(function(f) { newPrefs[f.key] = false; });
                    list.querySelectorAll('input[name=copy_field]:checked').forEach(function(cb) {
                        newPrefs[cb.value] = true;
                    });
                    saveCopyPrefs(newPrefs);
                    cleanup();
                    // 複数行の場合は全件をまとめて処理
                    executeCopyMulti(tasks, newPrefs);
                }
                function doCancel() { cleanup(); }
                function cleanup() {
                    overlay.classList.remove('visible');
                    document.getElementById('copy-fields-ok-btn').removeEventListener('click', doExecute);
                    document.getElementById('copy-fields-cancel-btn').removeEventListener('click', doCancel);
                }
                document.getElementById('copy-fields-ok-btn').addEventListener('click', doExecute);
                document.getElementById('copy-fields-cancel-btn').addEventListener('click', doCancel);
            }

            function buildCopyPayload(task, prefs) {
                const copyField = function(key, val) { return prefs[key] ? (val || '') : ''; };
                const copyDate  = function(key, d)   { return prefs[key] ? dateToDb(d) : dateToDb(task.start_date); };
                const copyDur   = function(key, dur) { return prefs[key] ? dur : 1; };
                return {
                    project_number:   copyField('project_number',  task.project_number),
                    customer_name:    task.customer_name   || '',
                    project_details:  task.project_details || '',
                    text:             copyField('text',       task.text),
                    major_item:       copyField('major_item', task.major_item),
                    machine:          copyField('machine',    task.machine),
                    unit:             copyField('unit',       task.unit),
                    owner:            copyField('owner',      task.owner),
                    main_owner:       prefs['owner']       ? (task.main_owner  || '') : '',
                    area_group:       prefs['area_number'] ? (task.area_group  || '') : '',
                    area_number:      prefs['area_number'] ? (task.area_number || '') : '',
                    start_date:       copyDate('start_date', task.start_date),
                    duration:         copyDur('duration',    task.duration),
                    parent:           task.parent_name     || '',
                    is_business_trip: task.is_business_trip || false
                };
            }

            async function executeCopyMulti(tasks, prefs) {
                const payloads = tasks.map(function(t) { return buildCopyPayload(t, prefs); });

                const { data, error } = await supabaseClient
                    .from('tasks')
                    .insert(payloads)
                    .select();

                if (error) {
                    alert('コピーに失敗しました: ' + error.message);
                    return;
                }

                // task_locations のコピー（場所ONの場合のみ）
                if (prefs['area_number'] && data && data.length > 0) {
                    const locInserts = [];
                    for (let i = 0; i < tasks.length; i++) {
                        const origId = tasks[i].original_id || String(tasks[i].id);
                        const { data: locData } = await supabaseClient
                            .from('task_locations')
                            .select('area_group, area_number')
                            .eq('task_id', origId);
                        if (locData && locData.length > 0 && data[i]) {
                            locData.forEach(function(l) {
                                locInserts.push({ task_id: data[i].id, area_group: l.area_group, area_number: l.area_number });
                            });
                        }
                    }
                    if (locInserts.length > 0) {
                        await supabaseClient.from('task_locations').insert(locInserts);
                    }
                }

                // 変更履歴を記録
                if (typeof window.logChange === 'function') {
                    await Promise.all(tasks.map(function(t) {
                        return window.logChange(t.project_number || '', t.machine || '', t.unit || '', t.text || '', 'タスクをコピーしました');
                    }));
                }

                clearSelection();
                await fetchTasks();
            }

            // 削除処理（確認ダイアログあり）
            function handleDelete() {
                const targetIds = _selectedIds.size > 0
                    ? Array.from(_selectedIds)
                    : (_ctxTaskId ? [String(_ctxTaskId)] : []);
                hideMenu();
                if (targetIds.length === 0) return;
                const tasks = targetIds.map(function(id) { return gantt.getTask(id); })
                    .filter(function(t) { return t && !t.$virtual; });
                if (tasks.length === 0) return;

                let msg;
                if (tasks.length === 1) {
                    const t = tasks[0];
                    const label = [t.project_number, t.text, t.machine].filter(Boolean).join(' / ');
                    msg = '「' + label + '」を削除しますか？\nこの操作は元に戻せません。';
                } else {
                    msg = tasks.length + '行を一括削除しますか？\nこの操作は元に戻せません。';
                }
                document.getElementById('delete-confirm-msg').textContent = msg;

                const overlay = document.getElementById('delete-confirm-overlay');
                overlay.classList.add('visible');

                function doDelete() {
                    cleanup();
                    tasks.forEach(function(t) { gantt.deleteTask(t.id); });
                    clearSelection();
                }
                function doCancel() { cleanup(); }
                function cleanup() {
                    overlay.classList.remove('visible');
                    document.getElementById('delete-confirm-ok-btn').removeEventListener('click', doDelete);
                    document.getElementById('delete-confirm-cancel-btn').removeEventListener('click', doCancel);
                }
                document.getElementById('delete-confirm-ok-btn').addEventListener('click', doDelete);
                document.getElementById('delete-confirm-cancel-btn').addEventListener('click', doCancel);
            }

            // グリッド右クリックイベント
            document.getElementById('gantt_here').addEventListener('contextmenu', function(e) {
                if (!_isEditor) return; // 編集権限がない場合は無視
                const cell = e.target.closest('.gantt_cell');
                if (!cell) { hideMenu(); return; }

                const taskId = gantt.locate(e);
                if (!taskId) { hideMenu(); return; }
                const task = gantt.getTask(taskId);
                if (!task || task.$virtual) { hideMenu(); return; }
                // 設計工程表の出張タスクは右クリックメニュー禁止
                if (task.$design_trip) { hideMenu(); return; }

                e.preventDefault();
                _ctxTaskId = taskId;
                // メニューを作成してから位置決め（offsetWidthのため先に visible にする）
                const m = getMenu();
                m.style.left = '-9999px';
                m.style.top  = '-9999px';
                m.classList.add('visible');
                showMenu(e.clientX, e.clientY, taskId);
            });

            // メニュー外クリックで閉じる
            document.addEventListener('click', function(e) {
                const m = document.getElementById('grid-context-menu');
                if (m && m.classList.contains('visible') && !m.contains(e.target)) {
                    hideMenu();
                }
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') hideMenu();
            });

        })();
        // ===== 右クリックコンテキストメニュー ここまで =====

        // ===== 削除確認ダイアログ z-index 修正 =====
        // DHTMLX Gantt の確認ダイアログが lightbox より下に表示される問題を修正
        (function() {
            const CONFIRM_Z = 200000;
            const POPUP_PATTERN = /gantt_popup|gantt_modal|gantt_confirm|dhtmlx_modal|dhtmlx_popup/i;

            function fixZIndex(node) {
                if (node.nodeType !== 1) return;
                const cls = (typeof node.className === 'string') ? node.className : '';
                if (POPUP_PATTERN.test(cls)) {
                    node.style.setProperty('z-index', String(CONFIRM_Z), 'important');
                }
                node.querySelectorAll('*').forEach(function(el) {
                    const c = (typeof el.className === 'string') ? el.className : '';
                    if (POPUP_PATTERN.test(c)) {
                        el.style.setProperty('z-index', String(CONFIRM_Z), 'important');
                    }
                });
            }

            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(fixZIndex);
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        })();
        // ===== 削除確認ダイアログ z-index 修正 ここまで =====

        // ===== 完了済工番 =====
        let currentKanryoTab = 'kanri';

        function openKanryoModal(tab) {
            currentKanryoTab = tab || 'kanri';
            const btn = document.getElementById('kanryo-btn');
            const rect = btn.getBoundingClientRect();
            const modal = document.getElementById('kanryo-modal');
            const modalWidth = 620;
            let left = rect.left;
            if (left + modalWidth > window.innerWidth - 8) {
                left = window.innerWidth - modalWidth - 8;
            }
            const modalHeightApprox = window.innerHeight * 0.6;
            let top = rect.bottom + 4;
            if (top + modalHeightApprox > window.innerHeight - 8) {
                top = rect.top - modalHeightApprox - 4;
            }
            modal.style.top = top + 'px';
            modal.style.left = left + 'px';
            document.getElementById('kanryo-modal-overlay').classList.add('visible');
            renderKanryoTab(currentKanryoTab);
        }

        function closeKanryoModal(e) {
            if (e && e.target !== document.getElementById('kanryo-modal-overlay') && e.target !== document.getElementById('kanryo-close-btn')) return;
            document.getElementById('kanryo-modal-overlay').classList.remove('visible');
        }

        function switchKanryoTab(tab) {
            currentKanryoTab = tab;
            document.querySelectorAll('.kanryo-tab').forEach(t => t.classList.remove('active'));
            document.getElementById('kanryo-tab-' + tab).classList.add('active');
            renderKanryoTab(tab);
        }

        function renderKanryoTab(tab) {
            const body = document.getElementById('kanryo-modal-body');
            if (tab === 'kanri') {
                renderKanryoKanri(body);
            } else {
                renderKanryoIchiran(body);
            }
        }

        function renderKanryoKanri(body) {
            // allTasks から完了済でないユニークな工事番号を収集
            const completedNums = new Set(completedProjects.map(cp => cp.project_number));
            const projectMap = {};
            (window.allTasks || []).forEach(t => {
                const pNum = (t.project_number || '').trim();
                if (!pNum || completedNums.has(pNum)) return;
                if (!projectMap[pNum]) {
                    projectMap[pNum] = { customer_name: t.customer_name || '', project_details: t.project_details || '' };
                } else {
                    if (!projectMap[pNum].customer_name && t.customer_name) projectMap[pNum].customer_name = t.customer_name;
                    if (!projectMap[pNum].project_details && t.project_details) projectMap[pNum].project_details = t.project_details;
                }
            });
            const projects = Object.keys(projectMap).sort();
            if (projects.length === 0) {
                body.innerHTML = '<div style="padding:20px;color:#999;text-align:center;">工程表に表示中の工事番号はありません</div>';
                return;
            }
            let html = '<table class="kanryo-table"><thead><tr><th>工事番号</th><th>客先名</th><th>工事名</th><th></th></tr></thead><tbody>';
            projects.forEach(pNum => {
                const info = projectMap[pNum];
                html += `<tr>
                    <td>${pNum}</td>
                    <td>${info.customer_name}</td>
                    <td>${info.project_details}</td>
                    <td><button class="kanryo-move-btn" onclick="moveToCompleted('${pNum}')">完了済へ移動</button></td>
                </tr>`;
            });
            html += '</tbody></table>';
            body.innerHTML = html;
        }

        function renderKanryoIchiran(body) {
            if (completedProjects.length === 0) {
                body.innerHTML = '<div style="padding:20px;color:#999;text-align:center;">完了済の工事番号はありません</div>';
                return;
            }
            let html = '<table class="kanryo-table"><thead><tr><th>工事番号</th><th>客先名</th><th>工事名</th><th>完了日</th><th></th></tr></thead><tbody>';
            completedProjects.slice().sort((a, b) => a.project_number.localeCompare(b.project_number, 'ja')).forEach(cp => {
                html += `<tr>
                    <td>${cp.project_number}</td>
                    <td>${cp.customer_name || ''}</td>
                    <td>${cp.project_details || ''}</td>
                    <td>${cp.completed_date || ''}</td>
                    <td><button class="kanryo-restore-btn" onclick="restoreFromCompleted('${cp.project_number}')">戻す</button></td>
                </tr>`;
            });
            html += '</tbody></table>';
            body.innerHTML = html;
        }

        async function moveToCompleted(pNum) {
            if (!confirm(`「${pNum}」を完了済工番に移動しますか？\nガントチャートと工事一覧から非表示になります。`)) return;
            const projectMap = {};
            (window.allTasks || []).forEach(t => {
                const p = (t.project_number || '').trim();
                if (p !== pNum) return;
                if (!projectMap[p]) projectMap[p] = { customer_name: t.customer_name || '', project_details: t.project_details || '' };
                else {
                    if (!projectMap[p].customer_name && t.customer_name) projectMap[p].customer_name = t.customer_name;
                    if (!projectMap[p].project_details && t.project_details) projectMap[p].project_details = t.project_details;
                }
            });
            const info = projectMap[pNum] || {};
            const newEntry = {
                project_number: pNum,
                customer_name: info.customer_name || '',
                project_details: info.project_details || '',
                completed_date: new Date().toLocaleDateString('ja-JP')
            };
            const { error } = await supabaseClient.from('completed_projects').insert(newEntry);
            if (error) { alert('保存に失敗しました: ' + error.message); return; }
            completedProjects.push(newEntry);
            gantt.render();
            updateProjectList(window.allTasks || []);
            renderKanryoKanri(document.getElementById('kanryo-modal-body'));
        }

        async function restoreFromCompleted(pNum) {
            if (!confirm(`「${pNum}」を工程表に戻しますか？`)) return;
            const { error } = await supabaseClient.from('completed_projects').delete().eq('project_number', pNum);
            if (error) { alert('削除に失敗しました: ' + error.message); return; }
            completedProjects = completedProjects.filter(cp => cp.project_number !== pNum);
            gantt.render();
            updateProjectList(window.allTasks || []);
            renderKanryoIchiran(document.getElementById('kanryo-modal-body'));
        }
        // ===== 完了済工番 ここまで =====

        // ===== ヘルプモード =====
        var HELP_TIPS = [
            { id: 'new_project_btn',       title: '新規受注',         text: '新しい工事番号を登録します\n（要ログイン）' },
            { id: 'reset_filter_btn',      title: '表示リセット',     text: '部署フィルタ・担当者フィルタ・工事番号フィルタを\nすべて解除して全表示に戻します' },
            { id: 'kanryo-btn',            title: '完了済み',         text: '完了済み工番の一覧を表示\n過去の工事を参照できます\n（要ログイン）' },
            { id: 'mark-legend',           title: 'マーク凡例',       text: '🚚 部品送り開始日\n● 外観検査\n▲ 客先立会\n◆ 出荷確認会議\n★ 工場出荷\nガントチャート上に表示されるマークの意味' },
            { id: 'help_btn',              title: '使い方ガイド',     text: 'このヘルプを表示します\nもう一度クリックで閉じます', closeOnClick: true },
            { id: 'auth_btn',              title: 'ログイン',         text: '編集者としてログイン\nログイン後は追加・編集・削除が可能になります' },
            { id: 'sort_process_btn',      title: '工程別表示',       text: '部署の工程順にタスクを並べて表示\nデフォルトの表示モードです' },
            { id: 'sort_machine_btn',      title: '機械別表示',       text: '機械番号ごとにタスクをまとめて表示\n機械単位の進捗確認に便利です' },
            { id: 'zoom_days_btn',         title: '日単位',           text: '1日単位でガントチャートを表示\n詳細なスケジュールの確認に' },
            { id: 'zoom_weeks_btn',        title: '週単位',           text: '1週単位で広い範囲を一覧表示\n全体スケジュールの把握に' },
            { id: 'scroll_today_btn',      title: '今日へ移動',       text: 'ガントチャートを今日の日付へスクロール' },
            { id: 'search-filter-toggle',  title: '検索フィルター',   text: '機械番号・タスク名・担当者で絞り込み\nクリックで検索パネルを開閉\n⚠️担当未定ボタンで未割当タスクを一覧表示' },
            { id: 'major-filter-select',   title: '部署別フィルタ',   text: '選択した部署のタスクだけを表示\nバーの色も部署ごとに色分けされます' },
            { id: 'resource-dept-select',  title: '部署別リソース',   text: '選択した部署の担当者ごとの\nリソース状況を下部パネルに表示' },
            { id: 'location_resource_btn', title: '組立場所',         text: '組立エリアの場所別リソースを表示\nE1/E2などのエリアで確認できます' },
            { id: 'sort_business_trip_btn',title: '出張予定',         text: '出張タスクの一覧と\n担当者ごとのスケジュールを表示' },
            { id: 'sync_log_btn',          title: '更新履歴',         text: '過去1ヶ月間のタスク追加・変更・削除の\n履歴を一覧表示します\n誰が・いつ・どのタスクを変更したかを確認できます' },
        ];

        function openHelp() {
            var helpBtn = document.getElementById('help_btn');
            if (helpBtn.classList.contains('help-active')) return;
            helpBtn.classList.add('help-active');
            var container = document.getElementById('help_tips_container');
            container.innerHTML = '<div id="help_overlay_bg"></div>';
            document.getElementById('help_overlay_bg').addEventListener('click', closeHelp);
            container.classList.add('open');

            HELP_TIPS.forEach(function(tipDef) {
                var el = document.getElementById(tipDef.id);
                if (!el) return;
                var rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                var cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return;
                addHelpItem(container, tipDef, rect);
            });

            // 工事一覧サイドバー
            var sidebarEl = document.querySelector('.sidebar');
            if (sidebarEl) {
                var sr = sidebarEl.getBoundingClientRect();
                if (sr.width > 0 && sr.height > 0) {
                    addHelpItem(container, { title: '工事一覧', text: 'クリックで工事を選択・フィルタ\n工事番号と状態が一覧表示されます\n▼ボタンで2000番台などに絞り込み可' }, sr);
                }
            }

            // タイムラインエリア
            var timelineEl = document.querySelector('.gantt_task');
            if (timelineEl) {
                var tr = timelineEl.getBoundingClientRect();
                if (tr.width > 0 && tr.height > 0) {
                    addHelpItem(container, { title: 'ガントチャート（タイムライン）', text: 'バーの色 → 部署ごとに色分け\nバーの長さ → タスクの期間\nマーク → 各種イベントの目印（凡例参照）' }, tr);
                }
            }

            // グリッド列エリア
            var gridEl = document.querySelector('.gantt_grid');
            if (gridEl) {
                var gridR = gridEl.getBoundingClientRect();
                if (gridR.width > 0 && gridR.height > 0) {
                    addHelpItem(container, { title: 'グリッド（左側の表）', text: 'セルをクリック\n　→ タスク開始日へ自動スクロール\n担当者未定のタスク → 赤字で表示\n完了済みのタスク → グレーで表示' }, gridR);
                }
            }

            // 🔍ボタン（詳細工程表リンク）— グリッド内の最初の1件を代表として表示
            var detailBtn = document.querySelector('.gantt_grid .zoom-btn');
            if (detailBtn) {
                var dbr = detailBtn.getBoundingClientRect();
                if (dbr.width > 0 && dbr.height > 0) {
                    addHelpItem(container, { title: '🔍 詳細工程表を開く', text: '見出し行（長納期品手配・出図＆部品手配）に\n表示されるボタン\nクリックで詳細工程表を別タブで開きます' }, dbr);
                }
            }
        }

        function addHelpItem(container, tip, rect) {
            var hl = document.createElement('div');
            hl.className = 'help-highlight';
            hl.style.top    = rect.top  + 'px';
            hl.style.left   = rect.left + 'px';
            hl.style.width  = (rect.right - rect.left) + 'px';
            hl.style.height = (rect.bottom - rect.top) + 'px';
            if (tip.closeOnClick) {
                hl.style.cursor = 'pointer';
                hl.addEventListener('click', closeHelp);
            }
            container.appendChild(hl);

            var tipDiv = document.createElement('div');
            tipDiv.className = 'help-tip';
            tipDiv.innerHTML = '<div class="help-tip-title">' + (tip.title || '') + '</div>' + tip.text.replace(/\n/g, '<br>');
            container.appendChild(tipDiv);

            requestAnimationFrame(function() {
                var vw = window.innerWidth;
                var vh = window.innerHeight;
                var tw = tipDiv.offsetWidth;
                var th = tipDiv.offsetHeight;
                var top  = rect.bottom + 8;
                var left = rect.left;
                if (left + tw > vw - 8) left = vw - tw - 8;
                if (left < 4) left = 4;
                if (top + th > vh - 8) {
                    top = rect.top - th - 8;
                    if (top < 4) top = 4;
                    tipDiv.classList.add('tip-above');
                }
                tipDiv.style.top  = top  + 'px';
                tipDiv.style.left = left + 'px';
            });

            hl.addEventListener('mouseenter', function() { tipDiv.classList.add('tip-visible'); });
            hl.addEventListener('mouseleave', function() { tipDiv.classList.remove('tip-visible'); });
        }

        function closeHelp() {
            document.getElementById('help_btn').classList.remove('help-active');
            var container = document.getElementById('help_tips_container');
            container.classList.remove('open');
            container.innerHTML = '';
        }
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeHelp(); });
        // ===== ヘルプモード ここまで =====

        // ===== バー内テキストのスティッキースクロール =====
        // グリッド右端を getBoundingClientRect() で実測し、
        // テキスト左端がグリッドに隠れた分だけ translateX でずらす。
        // gantt-resource.js と同じ実装で統一。
        function updateStickyBarText(scrollLeft) {
            const sl = scrollLeft !== undefined ? scrollLeft : (gantt.getScrollState().x || 0);
            const gridEl = document.querySelector('.gantt_grid');
            if (!gridEl) return;
            const boundary = gridEl.getBoundingClientRect().right;

            const bars = document.querySelectorAll('.gantt_task_line');
            if (!bars.length) return;
            const barH = bars[0].offsetHeight || 24;

            bars.forEach(function(bar) {
                const textEl = bar.querySelector('.task-name-text');
                if (!textEl) return;
                const barLeft  = parseFloat(bar.style.left)  || 0;
                const barWidth = parseFloat(bar.style.width) || 0;

                // 縦：バー高さの中央に配置
                const textH = textEl.offsetHeight || 15;
                const vertTop = Math.max(0, Math.round((barH - textH) / 2));
                textEl.style.top = vertTop + 'px';

                // バーが完全に左へ消えたらリセット
                if (sl >= barLeft + barWidth) {
                    textEl.style.transform = '';
                    return;
                }

                // transform をリセットして自然な位置のテキスト左端を実測
                textEl.style.transform = '';
                const textLeft = textEl.getBoundingClientRect().left;

                // テキスト左端が境界線にぶつかった分だけずらす
                const offset = Math.max(0, boundary - textLeft);
                if (offset > 0) textEl.style.transform = 'translateX(' + offset + 'px)';
            });
        }
        window.updateStickyBarText = updateStickyBarText;
        // ===== バー内テキストのスティッキースクロール ここまで =====


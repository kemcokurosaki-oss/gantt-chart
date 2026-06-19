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

            function showMsSection(options, selectedValues, mainSelected, showSearch) {
                const p = getPopup();
                p.querySelector('#inline-edit-text-section').style.display = 'none';
                p.querySelector('#inline-edit-ms-section').style.display = 'block';
                p.querySelector('#inline-edit-date-section').style.display = 'none';
                const searchEl = p.querySelector('#inline-edit-ms-search');
                if (searchEl) {
                    searchEl.value = '';
                    searchEl.style.display = showSearch === false ? 'none' : '';
                }
                const container = p.querySelector('#inline-edit-ms-options');
                container.innerHTML = '';
                const showMainToggle = mainSelected !== undefined;
                options.forEach(function(opt) {
                    if (opt.isGroup) {
                        const g = document.createElement('div');
                        g.className = 'inline-ms-group';
                        g.textContent = opt.label;
                        container.appendChild(g);
                    } else {
                        const row = document.createElement(showMainToggle ? 'div' : 'label');
                        row.className = 'inline-ms-option';
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.value = opt.value;
                        cb.checked = selectedValues.includes(opt.value);
                        if (showMainToggle) {
                            const mainCb = document.createElement('input');
                            mainCb.type = 'checkbox';
                            mainCb.name = 'ie_main_owner_checkbox';
                            mainCb.value = opt.value;
                            mainCb.checked = String(opt.value) === String(mainSelected || '');
                            mainCb.className = 'owner-main-switch-input';
                            mainCb.title = 'メイン担当（一覧で青字・複数人時のみ）';
                            mainCb.setAttribute('aria-label', 'メイン担当');
                            const swWrap = document.createElement('span');
                            swWrap.className = 'owner-main-switch';
                            swWrap.appendChild(mainCb);
                            const swUi = document.createElement('span');
                            swUi.className = 'owner-main-switch-ui';
                            swUi.setAttribute('aria-hidden', 'true');
                            const swTrack = document.createElement('span');
                            swTrack.className = 'owner-main-switch-track';
                            const swThumb = document.createElement('span');
                            swThumb.className = 'owner-main-switch-thumb';
                            swTrack.appendChild(swThumb);
                            swUi.appendChild(swTrack);
                            swWrap.appendChild(swUi);
                            const mainWrap = document.createElement('span');
                            mainWrap.className = 'owner-main-switch-wrap';
                            mainWrap.title = 'メイン担当（一覧で青字・複数人時のみ）';
                            mainWrap.appendChild(swWrap);
                            mainCb.addEventListener('change', function() {
                                if (mainCb.checked) {
                                    container.querySelectorAll('input[name="ie_main_owner_checkbox"]').forEach(function(o) {
                                        if (o !== mainCb) o.checked = false;
                                    });
                                    cb.checked = true;
                                }
                            });
                            cb.addEventListener('change', function() {
                                if (!cb.checked && mainCb.checked) mainCb.checked = false;
                            });
                            row.appendChild(mainWrap);
                            const ownerLbl = document.createElement('label');
                            ownerLbl.className = 'inline-ms-owner-check-wrap';
                            ownerLbl.appendChild(cb);
                            ownerLbl.appendChild(document.createTextNode(' ' + opt.label));
                            row.appendChild(ownerLbl);
                        } else {
                            row.appendChild(cb);
                            row.appendChild(document.createTextNode(' ' + opt.label));
                        }
                        container.appendChild(row);
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

            /** タスクの場所をインライン用チェックボックス値（"E1-0" 形式）の配列に変換 */
            function locationCheckboxValuesFromTask(task) {
                if (!task) return [];
                const out = [];
                const g = String(task.area_group || "").trim();
                const parts = String(task.area_number || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
                parts.forEach(function(p) {
                    if (p.indexOf("-") >= 0) out.push(p);
                    else if (g) out.push(g + "-" + p);
                });
                return out;
            }

            async function showIE(taskId, field, cellEl) {
                const task = gantt.getTask(taskId);
                if (!task || task.$virtual) return;
                _ie = { taskId, field };

                // await より前に座標を確定させる（await 後はスクロール等で位置がズレる場合がある）
                const cellRect = (cellEl && typeof cellEl.getBoundingClientRect === 'function')
                    ? cellEl.getBoundingClientRect()
                    : cellEl;
                if (!cellRect) return;

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
                    showMsSection(buildOwnerOpts(task.major_item || ''), getNormalizedOwners(task.owner || ''), task.main_owner || '', false);
                } else if (field === 'area_number') {
                    showMsSection(buildLocationOpts(), locationCheckboxValuesFromTask(task), undefined, false);
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
                if (!_isEditor) return;
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
                    const ownerVals = Array.from(document.querySelectorAll('#inline-edit-ms-options .inline-ms-owner-check-wrap input[type=checkbox]')).filter(function(el) { return el.checked; }).map(function(cb) { return cb.value; });
                    task.owner = ownerVals.join(',');
                    const mainEl = document.querySelector('#inline-edit-ms-options input[name="ie_main_owner_checkbox"]:checked');
                    let main = mainEl ? mainEl.value : '';
                    if (main && !ownerVals.includes(main)) main = '';
                    task.main_owner = main;

                } else if (field === 'area_number') {
                    const checkedVals = Array.from(document.querySelectorAll('#inline-edit-ms-options input[type=checkbox]:checked')).map(function(cb) { return cb.value; });
                    const pairs = checkedVals.map(function(val) {
                        const i = val.lastIndexOf('-');
                        return { area_group: val.slice(0, i), area_number: val.slice(i + 1) };
                    });
                    const realId = task.original_id || taskId;
                    const oldTask = (window.allTasks || []).find(function(t) { return String(t.id) === String(realId); });
                    const oldKey = oldTask ? locationCheckboxValuesFromTask(oldTask).slice().sort().join(",") : "";
                    const newKey = checkedVals.slice().sort().join(",");
                    if (typeof window.persistTaskLocations !== "function") {
                        closeIE();
                        return;
                    }
                    const ok = await window.persistTaskLocations(realId, pairs);
                    if (!ok) {
                        closeIE();
                        return;
                    }
                    closeIE();
                    await fetchTasks();
                    return;

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
                        const startNorm = new Date(task.start_date);
                        startNorm.setHours(0, 0, 0, 0);
                        const endInclusive = new Date(y, m - 1, d);
                        const newDur = Math.round((endInclusive - startNorm) / (1000 * 60 * 60 * 24)) + 1;
                        task.duration = Math.max(1, newDur);
                        task.end_date = gantt.calculateEndDate(task.start_date, task.duration);
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

                if (task._is_split_parent) {
                    // グリッドセルのダブルクリックのみ処理、バーは無視
                    const cell = e.target.closest('.gantt_cell');
                    if (!cell) return false; // バークリックは無視

                    const row = cell.parentElement;
                    const cells = Array.from(row.children).filter(function(c) { return c.classList.contains('gantt_cell'); });
                    const idx = cells.indexOf(cell);
                    const cols = gantt.config.columns;
                    if (idx < 0 || idx >= cols.length) return false;
                    const colName = cols[idx].name;

                    // 担当者・開始日・終了日はバーのダブルクリックで編集（グリッドからは無効）
                    if (colName === 'owner' || colName === 'start_date' || colName === 'end_date') {
                        return false;
                    }
                    // 共通フィールドは通常インライン編集
                    const commonFields = ['project_number', 'text', 'machine', 'unit', 'area_number', 'customer_name', 'project_details'];
                    if (commonFields.includes(colName)) {
                        showIE(id, colName, cell);
                    }
                    return false;
                }

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
                if (p && p.classList.contains('visible') && !p.contains(e.target) && !e.target.closest('.gantt_cell') &&
                    !e.target.closest('.resource-cell-bar') && !e.target.closest('#resource-bar-field-menu')) {
                    closeIE();
                }
            });

            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeIE();
            });

            /** リソースタイムラインのバーなどからインライン編集を開く（cellEl は getBoundingClientRect を持てば可） */
            window.openInlineEditForTask = showIE;

            // split_parent のセグメント一覧ポップアップ
            function openSegListPopup(taskId, anchorEl) {
                var task = gantt.getTask(taskId);
                if (!task || !task._segs) return;

                var popup = document.getElementById('seg-list-popup');
                if (!popup) {
                    popup = document.createElement('div');
                    popup.id = 'seg-list-popup';
                    popup.style.cssText =
                        'position:fixed;z-index:9998;background:#fff;border:1px solid #ccc;' +
                        'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2);padding:10px;' +
                        'min-width:280px;font-size:13px;font-family:\'Noto Sans JP\',sans-serif;';
                    document.body.appendChild(popup);
                }

                // コンテンツ再構築
                popup.innerHTML = '<div style="font-weight:bold;margin-bottom:8px;font-size:14px;display:flex;justify-content:space-between;align-items:center;">' +
                    '<span>セグメント一覧</span>' +
                    '<button id="seg-list-close" style="background:none;border:none;font-size:16px;cursor:pointer;line-height:1;">×</button>' +
                    '</div>';

                task._segs.forEach(function(seg, idx) {
                    var endDate = new Date(seg.start.getTime() + seg.dur * 86400000 - 86400000);
                    var fmt = function(d) {
                        return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate();
                    };
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee;';
                    row.innerHTML =
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:bold;color:#333;">' + (seg.owner || '（担当未設定）') + '</div>' +
                        '<div style="color:#666;font-size:12px;">' + fmt(seg.start) + ' 〜 ' + fmt(endDate) + '（' + seg.dur + '日）</div>' +
                        '</div>' +
                        '<button class="seg-list-edit-btn" data-idx="' + idx + '" ' +
                        'style="padding:3px 10px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">編集</button>';
                    popup.appendChild(row);
                });

                // 編集ボタンのイベント
                popup.querySelectorAll('.seg-list-edit-btn').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var segIdx = parseInt(btn.getAttribute('data-idx'), 10);
                        popup.style.display = 'none';
                        // gantt-events.js の openSegEditPopup を呼ぶ
                        if (typeof openSegEditPopup === 'function') {
                            var cseg = document.querySelector('.cseg[data-task-id="' + taskId + '"][data-seg-index="' + segIdx + '"]');
                            openSegEditPopup(String(taskId), segIdx, cseg || anchorEl);
                        }
                    });
                });

                document.getElementById('seg-list-close').addEventListener('click', function() {
                    popup.style.display = 'none';
                });

                // 位置決め
                var rect = (typeof anchorEl.getBoundingClientRect === 'function') ? anchorEl.getBoundingClientRect() : { left: 100, bottom: 100, top: 80 };
                var left = rect.left;
                var top = rect.bottom + 4;
                if (left + 300 > window.innerWidth - 8) left = window.innerWidth - 300 - 8;
                if (top + 200 > window.innerHeight - 8) top = rect.top - 200 - 4;
                popup.style.left = Math.max(8, left) + 'px';
                popup.style.top = Math.max(8, top) + 'px';
                popup.style.display = 'block';
            }

            // セグメント一覧ポップアップを外クリックで閉じる
            document.addEventListener('click', function(e) {
                var popup = document.getElementById('seg-list-popup');
                if (popup && popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('.gantt_cell')) {
                    popup.style.display = 'none';
                }
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
                    <div class="ctx-menu-item" id="ctx-split-add-btn">
                        <span>👥</span> <span>担当者を分割して追加</span>
                    </div>
                    <hr class="ctx-menu-separator">
                    <div class="ctx-menu-item ctx-delete" id="ctx-delete-btn">
                        <span>🗑️</span> <span id="ctx-delete-label">行を削除</span>
                    </div>`;
                document.body.appendChild(m);
                document.getElementById('ctx-copy-btn').addEventListener('click', handleCopy);
                document.getElementById('ctx-split-add-btn').addEventListener('click', handleSplitAdd);
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
                const startStr = copyDate('start_date', task.start_date);
                const durVal   = copyDur('duration',    task.duration);
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
                    start_date:       startStr,
                    duration:         durVal,
                    end_date:         inclusiveEndDateToDb(gantt.date.str_to_date("%Y-%m-%d")(startStr), durVal),
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

                clearSelection();
                await fetchTasks();
            }

            // 分割追加処理
            function handleSplitAdd() {
                const taskId = _ctxTaskId;
                hideMenu();
                if (!taskId) return;
                const task = gantt.getTask(taskId);
                if (!task || task.$virtual) return;

                // ダイアログを表示
                openSplitAddDialog(task);
            }

            function openSplitAddDialog(task) {
                var dlg = document.getElementById('split-add-dialog-overlay');
                if (!dlg) {
                    dlg = document.createElement('div');
                    dlg.id = 'split-add-dialog-overlay';
                    dlg.style.cssText =
                        'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);' +
                        'display:flex;align-items:center;justify-content:center;';
                    dlg.innerHTML =
                        '<div style="background:#fff;border-radius:8px;padding:20px;min-width:320px;max-width:400px;' +
                        'box-shadow:0 8px 32px rgba(0,0,0,0.3);font-family:\'Noto Sans JP\',sans-serif;font-size:13px;">' +
                        '<div style="font-weight:bold;font-size:15px;margin-bottom:14px;">担当者を分割して追加</div>' +
                        '<table style="border-collapse:collapse;width:100%;">' +
                        '<tr><td style="padding:5px 0;font-weight:bold;width:70px;">担当者</td>' +
                        '<td><input id="split-add-owner" list="split-add-owner-list" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #ccc;border-radius:4px;">' +
                        '<datalist id="split-add-owner-list"></datalist></td></tr>' +
                        '<tr><td style="padding:5px 0;font-weight:bold;">開始日</td>' +
                        '<td><input type="date" id="split-add-start" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #ccc;border-radius:4px;"></td></tr>' +
                        '<tr><td style="padding:5px 0;font-weight:bold;">終了日</td>' +
                        '<td><input type="date" id="split-add-end" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #ccc;border-radius:4px;"></td></tr>' +
                        '<tr><td style="padding:5px 0;font-weight:bold;">部署</td>' +
                        '<td><select id="split-add-major" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #ccc;border-radius:4px;">' +
                        '<option value="">（同じ部署）</option>' +
                        '<option value="設計">設計</option><option value="製管">製管</option>' +
                        '<option value="組立">組立</option><option value="電装">電装</option>' +
                        '<option value="操業">操業</option><option value="電技">電技</option>' +
                        '<option value="明石">明石</option><option value="営業">営業</option>' +
                        '</td></tr>' +
                        '</table>' +
                        '<div id="split-add-error" style="color:#e74c3c;font-size:12px;min-height:18px;margin-top:6px;"></div>' +
                        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
                        '<button id="split-add-cancel-btn" style="padding:5px 14px;cursor:pointer;">キャンセル</button>' +
                        '<button id="split-add-ok-btn" style="padding:5px 14px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">追加</button>' +
                        '</div></div>';
                    document.body.appendChild(dlg);

                    document.getElementById('split-add-cancel-btn').addEventListener('click', function() {
                        dlg.style.display = 'none';
                    });
                    document.getElementById('split-add-ok-btn').addEventListener('click', function() {
                        executeSplitAdd();
                    });
                    dlg.addEventListener('click', function(e) {
                        if (e.target === dlg) dlg.style.display = 'none';
                    });
                }

                // 担当者候補（ownerMasterがあれば使用）
                var majorItem = task.major_item || '';
                var datalist = document.getElementById('split-add-owner-list');
                datalist.innerHTML = '';
                if (typeof ownerMaster !== 'undefined' && ownerMaster[majorItem]) {
                    ownerMaster[majorItem].forEach(function(o) {
                        var opt = document.createElement('option');
                        opt.value = o;
                        datalist.appendChild(opt);
                    });
                }

                // 初期値セット（元タスクの終了日の翌日をデフォルト開始日に）
                var defStart = new Date(task.start_date);
                defStart.setDate(defStart.getDate() + (task.duration || 1));
                var defEnd = new Date(defStart);
                defEnd.setDate(defEnd.getDate()); // 1日間
                var toYMD = function(d) {
                    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
                };
                document.getElementById('split-add-owner').value = '';
                document.getElementById('split-add-start').value = toYMD(defStart);
                document.getElementById('split-add-end').value = toYMD(defEnd);
                document.getElementById('split-add-major').value = '';
                document.getElementById('split-add-error').textContent = '';
                dlg.style.display = 'flex';
                dlg._targetTask = task;
                setTimeout(function() { document.getElementById('split-add-owner').focus(); }, 50);
            }

            async function executeSplitAdd() {
                var dlg = document.getElementById('split-add-dialog-overlay');
                if (!dlg || !dlg._targetTask) return;
                var task = dlg._targetTask;
                var errEl = document.getElementById('split-add-error');

                var owner    = document.getElementById('split-add-owner').value.trim();
                var startVal = document.getElementById('split-add-start').value;
                var endVal   = document.getElementById('split-add-end').value;
                var majorVal = document.getElementById('split-add-major').value || task.major_item || '';

                if (!startVal || !endVal) { errEl.textContent = '開始日・終了日を入力してください'; return; }
                var sm = startVal.split('-').map(Number);
                var em = endVal.split('-').map(Number);
                var newStart = new Date(sm[0], sm[1]-1, sm[2]);
                var endDate  = new Date(em[0], em[1]-1, em[2]);
                if (endDate < newStart) { errEl.textContent = '終了日は開始日以降にしてください'; return; }
                var newDur = Math.max(1, Math.round((endDate - newStart) / 86400000) + 1);

                errEl.textContent = '';
                document.getElementById('split-add-ok-btn').disabled = true;

                try {
                    var realId = task.original_id || task.id;
                    var toYMD = function(d) {
                        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
                    };

                    // 既存タスクの split_group_id を確認（なければ新規発行）
                    var existingTask = (window.allTasks || []).find(function(t) { return String(t.id) === String(realId); });
                    var groupId = existingTask && existingTask.split_group_id;

                    if (!groupId) {
                        // 新規 split_group_id を発行（'sg_' + タスクID + タイムスタンプ）
                        groupId = 'sg_' + String(realId) + '_' + Date.now();
                        // 既存タスクに split_group_id を設定
                        var { error: updateErr } = await supabaseClient.from('tasks')
                            .update({ split_group_id: groupId })
                            .eq('id', realId);
                        if (updateErr) { errEl.textContent = '保存に失敗しました: ' + updateErr.message; document.getElementById('split-add-ok-btn').disabled = false; return; }
                    }

                    // 新しいセグメントタスクをDBに挿入
                    var newTask = Object.assign({
                        text:           task.text           || '',
                        start_date:     startVal,
                        duration:       newDur,
                        end_date:       toYMD(new Date(newStart.getTime() + (newDur - 1) * 86400000)),
                        owner:          owner,
                        project_number: task.project_number || '',
                        customer_name:  task.customer_name  || '',
                        project_details:task.project_details|| '',
                        machine:        task.machine        || '',
                        unit:           task.unit           || '',
                        major_item:     majorVal,
                        parent:         task.parent_name    || '',
                        split_group_id: groupId,
                        sort_order:     (existingTask && existingTask.sort_order != null) ? Number(existingTask.sort_order) + 0.5 : null,
                        is_business_trip: task.is_business_trip || false
                    }, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {});

                    var { error: insErr } = await supabaseClient.from('tasks').insert([newTask]);
                    if (insErr) { errEl.textContent = '保存に失敗しました: ' + insErr.message; document.getElementById('split-add-ok-btn').disabled = false; return; }

                    dlg.style.display = 'none';
                    await fetchTasks();
                } catch(e) {
                    errEl.textContent = 'エラー: ' + e.message;
                    document.getElementById('split-add-ok-btn').disabled = false;
                }
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
            try {
                await supabaseClient.from('change_log').insert({
                    source: '全体工程表',
                    changed_by: (window._getCurrentEditorName && window._getCurrentEditorName()) || '',
                    project_number: pNum,
                    machine: '',
                    unit: '',
                    task_text: '',
                    description: '完了済みに移動'
                });
            } catch(e) { console.warn('完了済み移動の履歴保存エラー:', e); }
            gantt.render();
            updateProjectList(window.allTasks || []);
            if (typeof updateResourceVisibility === 'function') updateResourceVisibility();
            renderKanryoKanri(document.getElementById('kanryo-modal-body'));
        }

        async function restoreFromCompleted(pNum) {
            if (!confirm(`「${pNum}」を工程表に戻しますか？`)) return;
            const { error } = await supabaseClient.from('completed_projects').delete().eq('project_number', pNum);
            if (error) { alert('削除に失敗しました: ' + error.message); return; }
            completedProjects = completedProjects.filter(cp => cp.project_number !== pNum);
            try {
                await supabaseClient.from('change_log').insert({
                    source: '全体工程表',
                    changed_by: (window._getCurrentEditorName && window._getCurrentEditorName()) || '',
                    project_number: pNum,
                    machine: '',
                    unit: '',
                    task_text: '',
                    description: '完了済みから復元'
                });
            } catch(e) { console.warn('完了済み復元の履歴保存エラー:', e); }
            gantt.render();
            updateProjectList(window.allTasks || []);
            if (typeof updateResourceVisibility === 'function') updateResourceVisibility();
            renderKanryoIchiran(document.getElementById('kanryo-modal-body'));
        }
        // ===== 完了済工番 ここまで =====

        // ===== ヘルプモード =====
        var HELP_TIPS = [
            { id: 'new_project_btn',       title: '新規受注',         text: '新しい工事番号を登録します\n（要ログイン）', noBullets: true },
            { id: 'reset_filter_btn',      title: '表示リセット',     text: 'ページを再読み込みし、すべての表示条件を<br>初期状態に戻します', noBullets: true },
            { id: 'kanryo-btn',            title: '完了済み',         text: '完了済み工番の一覧を表示\n過去の工事を参照できます\n（要ログイン）', noBullets: true },
            { id: 'mark-legend',           title: 'マーク凡例',       text: '<span>🚚</span> 部品送り開始日<br><span class="help-tip-mark-shape help-tip-mark-shape--circle">●</span> 外観検査<br><span class="help-tip-mark-shape help-tip-mark-shape--tri">▲</span> 客先立会<br><span class="help-tip-mark-shape help-tip-mark-shape--dia">◆</span> 出荷確認会議<br><span class="help-tip-mark-shape help-tip-mark-shape--star">★</span> 工場出荷', noBullets: true },
            { id: 'help_btn',              title: '使い方ガイド',     text: '各所の説明吹き出しを表示します\n背景の暗い部分をクリックで閉じます', closeOnClick: true, noBullets: true },
            { id: 'auth_btn',              title: 'ログイン',         text: '編集者としてログイン\nログイン後は追加・編集・削除が可能になります', noBullets: true },
            { id: 'sort_process_btn',      title: '工程別表示',       text: '部署の工程順にタスクを並べて表示\nデフォルトの表示モードです', noBullets: true },
            { id: 'sort_machine_btn',      title: '機械別表示',       text: '機械番号ごとにタスクをまとめて表示\n機械単位の進捗確認に便利です', noBullets: true },
            { id: 'zoom_days_btn',         title: '日単位',           text: '1日単位でガントチャートを表示\n詳細なスケジュールの確認に', noBullets: true },
            { id: 'zoom_weeks_btn',        title: '週単位',           text: '1週単位で広い範囲を一覧表示\n全体スケジュールの把握に', noBullets: true },
            { id: 'scroll_today_btn',      title: '今日へ移動',       text: 'ガントチャートを今日の日付へスクロール' },
            { id: 'dept_link_design',      title: '設計・工程表',     text: '設計部門の工程表サイトを別タブで開きます\nログインはリンク先で行います' },
            { id: 'dept_link_assembly',    title: '組立・工程表',     text: '組立部門の工程表サイトを別タブで開きます\nログインはリンク先で行います（組立部員のみログイン可）' },
            { id: 'dept_link_operations',  title: '操業・工程表',     text: '操業部門の工程表は準備中です\n公開・有効化後にここから開けるようになります' },
            { id: 'search-filter-toggle',  title: '検索フィルター',   text: '機械名・タスク名・担当者で絞り込み\nクリックで検索パネルを開閉\n⚠️担当未定ボタンで未割当タスクを一覧表示' },
            { id: 'major-filter-btn',      title: '部署別フィルタ',   text: 'チェックで複数部署を指定できます\n該当部署のタスクだけガントに表示\nバー色は部署ごとの色分けのまま\n右上に「○○を表示中」と表示されます\n「全部署（リセット）」で解除' },
            { id: 'resource-dept-select',  title: '部署別リソース',   text: '選択した部署の担当者ごとのリソース状況を<br>下部パネルに表示<br>(ガント本体の絞り込みは「部署別フィルタ」)', noBullets: true },
            { id: 'location_resource_btn', title: '組立場所',         text: '組立エリアの場所別リソースを表示\nE1/E2などのエリアで確認できます', noBullets: true },
            { id: 'sort_business_trip_btn',title: '出張予定',         text: '出張タスクのみの表示に切り替え<br>(「工程表へ戻る」で通常の工程表へ)', noBullets: true },
            { id: 'sync_log_btn',          title: '更新履歴',         text: '過去1ヶ月間のタスク追加・変更・削除の\n履歴を一覧表示します\n誰が・いつ・どのタスクを変更したかを確認できます', noBullets: true },
        ];

        function openHelp() {
            var helpBtn = document.getElementById('help_btn');
            if (helpBtn.classList.contains('help-active')) return;
            helpBtn.classList.add('help-active');
            var guideBtn = document.getElementById('guide_btn');
            guideBtn.style.display = '';
            requestAnimationFrame(function() {
                var syncBtn = document.getElementById('sync_log_btn');
                if (syncBtn) {
                    var r = syncBtn.getBoundingClientRect();
                    guideBtn.style.top  = (r.top + r.height / 2) + 'px';
                    guideBtn.style.left = (r.left - guideBtn.offsetWidth - 12) + 'px';
                }
            });
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
                    addHelpItem(container, {
                        title: '工事一覧',
                        text: '工番をクリック → その工事だけ表示\n「工事一覧」ボタン → 表示リセットと同じ\n▶→「すべて／2000番台／その他／営業担当」で一覧を絞り込み\n工番にマウスを載せると客先名・工事名・営業担当の吹き出し\n出張だけの工番→工番を緑で表示',
                        wide: 'sidebar'
                    }, sr);
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
                    addHelpItem(container, { title: 'グリッド（左側の表）', text: 'セルをクリック → タスク開始日へ自動スクロール\n▶→詳細工程を表示\n担当者未定のタスク → 赤で表示\n完了済みのタスク → グレーで表示', wide: true }, gridR);
                }
            }

            // 🔍ボタン（詳細工程表／仕様書フォルダ）— グリッド内の最初の1件を代表として表示
            var detailBtn = document.querySelector('.gantt_grid .zoom-btn');
            if (detailBtn) {
                var dbr = detailBtn.getBoundingClientRect();
                if (dbr.width > 0 && dbr.height > 0) {
                    addHelpItem(container, {
                        title: '🔍 詳細工程表・関連リンク',
                        text: '受注→社内製作仕様書\n長納期品手配→設計工程表(長納期品ページ)\n出図＆部品手配→設計工程表(図面ページ)',
                        wide: 'detail'
                    }, dbr);
                }
            }
        }

        /** 吹き出し本文：改行で複数行のときは各行先頭に「・」を付ける（noBullets のときは付けない） */
        function formatHelpTipText(raw, noBullets) {
            if (raw == null || raw === '') return '';
            if (noBullets) {
                return String(raw).split(/\n/).map(function(l) { return l.replace(/^\s+|\s+$/g, ''); }).filter(function(l) { return l.length > 0; }).join('<br>');
            }
            var lines = String(raw).split(/\n/).map(function(l) { return l.replace(/^\s+|\s+$/g, ''); }).filter(function(l) { return l.length > 0; });
            if (lines.length <= 1) return lines[0] || '';
            return lines.map(function(l) { return '・' + l; }).join('<br>');
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
            if (tip.wide === true) tipDiv.classList.add('help-tip--wide');
            if (tip.wide === 'detail') tipDiv.classList.add('help-tip--detail-mapping');
            if (tip.wide === 'sidebar') tipDiv.classList.add('help-tip--sidebar-list');
            tipDiv.innerHTML = '<div class="help-tip-title">' + (tip.title || '') + '</div>' + formatHelpTipText(tip.text, tip.noBullets);
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
            document.getElementById('guide_btn').style.display = 'none';
            var container = document.getElementById('help_tips_container');
            container.classList.remove('open');
            container.innerHTML = '';
        }
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeHelp(); });
        // ===== ヘルプモード ここまで =====


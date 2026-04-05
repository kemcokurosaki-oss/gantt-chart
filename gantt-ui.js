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
                    start_date: '開始日', end_date: '終了日'
                };
                const popup = getPopup();
                popup.querySelector('#inline-edit-field-label').textContent = labels[field] || field;

                // タスク名以外では自由入力欄を隠す
                const _freeRow = popup.querySelector('#inline-edit-free-row');
                if (_freeRow) _freeRow.style.display = 'none';

                if (field === 'project_number' || field === 'machine' || field === 'unit') {
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

                if (field === 'project_number' || field === 'machine' || field === 'unit') {
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
                        const newStart = new Date(val);
                        const oldEnd = gantt.calculateEndDate(task.start_date, task.duration);
                        task.duration = gantt.calculateDuration(newStart, oldEnd);
                        task.start_date = newStart;
                    }

                } else if (field === 'end_date') {
                    const val = document.getElementById('inline-edit-date-input').value;
                    if (val) {
                        // 表示は inclusive end（最終日）なので+1日して exclusive end に変換
                        const newEnd = new Date(val);
                        newEnd.setDate(newEnd.getDate() + 1);
                        const newDur = gantt.calculateDuration(task.start_date, newEnd);
                        task.duration = Math.max(1, newDur);
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
                const cell = e.target.closest('.gantt_cell');
                if (!cell) {
                    // バーダブルクリック：ライトボックスを表示（デフォルト動作）
                    return true;
                }
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'BUTTON' ||
                    e.target.classList.contains('gantt_tree_icon') ||
                    e.target.classList.contains('zoom-btn')) return true;

                const row = cell.parentElement;
                const cells = Array.from(row.children).filter(function(c) { return c.classList.contains('gantt_cell'); });
                const idx = cells.indexOf(cell);
                const cols = gantt.config.columns;
                if (idx < 0 || idx >= cols.length) return false;

                const colName = cols[idx].name;
                const editableFields = ['project_number', 'text', 'machine', 'unit', 'owner', 'area_number', 'start_date', 'end_date'];
                if (!editableFields.includes(colName)) return false;

                const task = gantt.getTask(id);
                if (!task || task.$virtual) return false;

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
            { id: 'help_btn',              title: 'ヘルプ',           text: 'このヘルプを表示します\nもう一度クリックで閉じます' },
            { id: 'auth_btn',              title: 'ログイン',         text: '編集者としてログイン\nログイン後は追加・編集・削除が可能になります' },
            { id: 'sort_process_btn',      title: '工程別表示',       text: '部署の工程順にタスクを並べて表示\nデフォルトの表示モードです' },
            { id: 'sort_machine_btn',      title: '機械別表示',       text: '機械番号ごとにタスクをまとめて表示\n機械単位の進捗確認に便利です' },
            { id: 'zoom_days_btn',         title: '日単位',           text: '1日単位でガントチャートを表示\n詳細なスケジュールの確認に' },
            { id: 'zoom_weeks_btn',        title: '週単位',           text: '1週単位で広い範囲を一覧表示\n全体スケジュールの把握に' },
            { id: 'scroll_today_btn',      title: '今日へ移動',       text: 'ガントチャートを今日の日付へスクロール' },
            { id: 'search-filter-toggle',  title: '検索フィルター',   text: '機械番号やタスク名で絞り込み\nクリックで検索パネルを開閉' },
            { id: 'major-filter-select',   title: '部署別フィルタ',   text: '選択した部署のタスクだけを表示\nバーの色も部署ごとに色分けされます' },
            { id: 'resource-dept-select',  title: '部署別リソース',   text: '選択した部署の担当者ごとの\nリソース状況を下部パネルに表示' },
            { id: 'location_resource_btn', title: '組立場所',         text: '組立エリアの場所別リソースを表示\nE1/E2などのエリアで確認できます' },
            { id: 'sort_business_trip_btn',title: '出張予定',         text: '出張タスクの一覧と\n担当者ごとのスケジュールを表示' },
        ];

        function openHelp() {
            var helpBtn = document.getElementById('help_btn');
            if (helpBtn.classList.contains('help-active')) { closeHelp(); return; }
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

            // ガントチャートエリア
            var ganttEl = document.getElementById('gantt_here');
            if (ganttEl) {
                var gr = ganttEl.getBoundingClientRect();
                if (gr.width > 0 && gr.height > 0) {
                    addHelpItem(container, { title: 'ガントチャート', text: 'タスクバーをクリック → 詳細編集\nバーをドラッグ → 日程変更\nダブルクリック → 担当者・詳細編集\nバーの色 → 部署ごとに色分け' }, gr);
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


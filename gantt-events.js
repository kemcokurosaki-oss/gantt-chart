        gantt.attachEvent("onLightboxChange", function(id, name, value) {
            if (name === "major_item") {
                const task = gantt.getTask(id);
                if (task) task.major_item = value;
            }
        });
        gantt.locale.labels.section_project_number = "工事番号";
        gantt.locale.labels.section_parent_name = "見出し名";
        gantt.locale.labels.section_major_item = "部署";
        gantt.locale.labels.section_machine = "機械";
        gantt.locale.labels.section_unit = "ユニット";
        gantt.locale.labels.section_description = "タスク名";
        gantt.locale.labels.section_owner = "担当";
        gantt.locale.labels.section_time = "期間";

        // 見出し行（プロジェクト型）も同じ項目を表示
        gantt.config.lightbox.project_sections = gantt.config.lightbox.sections;

        // Layout: 上段のみのシンプルな構成
        var layoutRows = [
            {
                cols: [
                    { view: "grid", id: "grid", width: 600, scrollX: "scrollHor", scrollY: "scrollVer" },
                    { resizer: true, width: 1 },
                    { view: "timeline", id: "timeline", scrollX: "scrollHor", scrollY: "scrollVer" },
                    { view: "scrollbar", scroll: "y", id: "scrollVer" }
                ]
            },
            { view: "scrollbar", scroll: "x", id: "scrollHor", height: 20 }
        ];
        gantt.config.layout = { css: "gantt_container", rows: layoutRows };

        // カレンダー設定の統一（上段・下段で同じ期間）
        gantt.attachEvent("onBeforeGanttRender", function(){
            gantt.config.start_date = new Date(GANTT_START_DATE.getTime());
            gantt.config.end_date = new Date(GANTT_END_DATE.getTime());
            gantt.config.fit_tasks = false;
        });

        // 列設定の共通化：上段・下段に同じ配列を適用し列幅のズレを根絶
        var SHARED_COLUMNS = [
            { name: "detail", label: "", width: COLUMN_WIDTHS[0], align: "left", template: function(obj) {
                // リンク設定済みの見出し行のみ表示
                const isDesignDetail = obj.$virtual && (obj.text === "長納期品手配" || obj.text === "出図＆部品手配");
                const isSpecFolder = obj.$virtual
                    && obj.text === "受注"
                    && typeof window.hasSpecFolderLink === "function"
                    && window.hasSpecFolderLink(obj.project_number);
                if (isDesignDetail || isSpecFolder) {
                    return `<button class='zoom-btn' style='padding: 2px 5px; font-size: 12px; cursor: pointer;' onclick='openDetail("${obj.id}")'>🔍</button>`;
                }
                return "";
            }},
            { name: "project_number", label: "工番", width: COLUMN_WIDTHS[1], align: "left", template: function(obj) {
                return obj.project_number || "";
            }},
            { name: "checkbox", label: "", width: COLUMN_WIDTHS[2], align: "left", template: function(obj) {
                if (obj.$virtual) return "";
                const rowKey = obj.original_id || obj.id;
                const isChecked = taskCheckboxes[rowKey] ? "checked" : "";
                return `<input type='checkbox' ${isChecked} ${_isEditor ? '' : 'disabled'} onchange='toggleTaskCheckbox("${obj.id}", this.checked)'>`;
            }},
            { name: "text", label: "タスク名", width: COLUMN_WIDTHS[3], tree: true, template: function(obj) {
                return obj.text;
            }},
            { name: "machine", label: "機械", width: COLUMN_WIDTHS[4], align: "left", template: function(obj) {
                if (obj.$virtual) return "";
                return obj.machine || "";
            }},
            { name: "unit", label: "ユニ", width: COLUMN_WIDTHS[5], align: "left", template: function(obj) {
                if (obj.$virtual) return "";
                return obj.unit || "";
            }},
            { name: "owner", label: "担当", width: COLUMN_WIDTHS[6], align: "left", template: function(obj) {
                if (obj.$virtual) return "";
                if (!obj.owner || obj.owner.trim() === "") {
                    return "<span class='unassigned-warning'>⚠️</span>";
                }
                const owners = obj.owner.split(/[,，]/).map(function(s) { return s.trim(); }).filter(Boolean);
                if (owners.length > 1 && obj.main_owner && obj.main_owner.trim()) {
                    const main = obj.main_owner.trim();
                    const mainIdx = owners.findIndex(function(o) { return o === main; });
                    var ordered = mainIdx >= 0
                        ? [owners[mainIdx]].concat(owners.filter(function(_, i) { return i !== mainIdx; }))
                        : owners.slice();
                    return ordered.map(function(o) { return o === main ? "<span style='color: blue;'>" + o + "</span>" : o; }).join(', ');
                }
                return obj.owner;
            }},
            { name: "area_number", label: "場所", width: COLUMN_WIDTHS[7], align: "center", template: function(obj) {
                if (obj.$virtual) return "";
                if (obj.area_group && obj.area_number) {
                    return obj.area_group + "-" + obj.area_number;
                }
                return obj.area_group || obj.area_number || "";
            }},
            { name: "start_date", label: "開始日", width: COLUMN_WIDTHS[8], align: "center", template: function(t) {
                return dateToDisplay(t.start_date);
            }},
            { name: "end_date", label: "終了日", width: COLUMN_WIDTHS[9], align: "center", template: function(t) {
                const d = gantt.calculateEndDate(t.start_date, t.duration);
                d.setDate(d.getDate() - 1);
                return dateToDisplay(d);
            }},
            { name: "add", label: "", width: COLUMN_WIDTHS[10], align: "left" }
        ];
        gantt.config.columns = SHARED_COLUMNS;
        gantt.config.grid_elastic_columns = false;
        gantt.config.indent = 6;
        gantt.config.grid_width = 600;
        gantt.config.grid_resize = false;
        gantt.config.drag_resize = true;
        gantt.config.row_height = 27;
        gantt.config.bar_height = 21; // バーを太く (18 -> 21)
        gantt.config.scale_height = 60;
        gantt.config.min_column_width = 22;
        gantt.config.open_tree_initially = false;
        gantt.config.order_branch = true;
        gantt.config.order_branch_free = true;

        // ===== 列幅ドラッグリサイズ（ユニ・担当・場所のみ） =====
        (function() {
            var COL_WIDTHS_KEY = 'gantt_col_widths_v1';

            // リサイズ対象列：name / COLUMN_WIDTHS の添字
            var RESIZABLE = [
                { name: 'unit',        minIdx: 5 },
                { name: 'owner',       minIdx: 6 },
                { name: 'area_number', minIdx: 7 }
            ];

            function loadWidths() {
                try { return JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) || '{}'); }
                catch(e) { return {}; }
            }

            function saveWidth(name, w) {
                try {
                    var d = loadWidths();
                    d[name] = w;
                    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(d));
                } catch(e) {}
            }

            function syncGridWidth() {
                var total = SHARED_COLUMNS.reduce(function(s, c) { return s + (c.width || 0); }, 0);
                gantt.config.grid_width = total;
            }

            // 保存済み幅を SHARED_COLUMNS へ適用（ページ読み込み時に1回）
            function applyStoredWidths() {
                var stored = loadWidths();
                RESIZABLE.forEach(function(r) {
                    var w = stored[r.name];
                    if (!w) return;
                    var col = SHARED_COLUMNS.find(function(c) { return c.name === r.name; });
                    if (!col) return;
                    col.width = Math.max(w, COLUMN_WIDTHS[r.minIdx]);
                });
                syncGridWidth();
            }

            // Canvas measureText で列の全タスク最大コンテンツ幅を計測
            function calcMaxWidth(name) {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                var sampleCell = document.querySelector('#gantt_here .gantt_cell');
                ctx.font = sampleCell
                    ? window.getComputedStyle(sampleCell).font
                    : '13px sans-serif';

                var maxW = 0;
                try {
                    gantt.eachTask(function(task) {
                        var text = '';
                        if (name === 'unit') {
                            text = task.unit || '';
                        } else if (name === 'owner') {
                            text = task.owner || '';
                            if (text) {
                                var owners = text.split(/[,，]/).map(function(s) { return s.trim(); }).filter(Boolean);
                                text = owners.join(', ');
                            }
                        } else if (name === 'area_number') {
                            text = (task.area_group && task.area_number)
                                ? task.area_group + '-' + task.area_number
                                : (task.area_group || task.area_number || '');
                        }
                        if (!text) return;
                        var w = ctx.measureText(text).width;
                        if (w > maxW) maxW = w;
                    });
                } catch(e) {}
                return Math.ceil(maxW) + 20; // 左右パディング
            }

            // ドラッグ状態
            var dragging = null;
            var rafPending = false;

            // ヘッダーセルにリサイズハンドルを注入
            function injectHandles() {
                if (typeof currentDisplayMode !== 'undefined' && currentDisplayMode === 'business_trip') return;

                var allCells = document.querySelectorAll('#gantt_here .gantt_grid_head_cell');
                RESIZABLE.forEach(function(r) {
                    var colIdx = SHARED_COLUMNS.findIndex(function(c) { return c.name === r.name; });
                    if (colIdx < 0) return;
                    var cell = allCells[colIdx];
                    if (!cell || cell.querySelector('.col-resize-handle')) return;

                    cell.style.position = 'relative';
                    cell.style.overflow = 'visible';

                    var handle = document.createElement('div');
                    handle.className = 'col-resize-handle';
                    handle.dataset.colName = r.name;
                    handle.style.cssText = 'position:absolute;right:-3px;top:0;width:6px;height:100%;cursor:col-resize;z-index:10;background:transparent;user-select:none;';

                    handle.addEventListener('mouseenter', function() {
                        handle.style.background = 'rgba(66,133,244,0.35)';
                    });
                    handle.addEventListener('mouseleave', function() {
                        if (!dragging) handle.style.background = 'transparent';
                    });

                    handle.addEventListener('mousedown', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var col = SHARED_COLUMNS.find(function(c) { return c.name === r.name; });
                        dragging = {
                            name:       r.name,
                            minW:       COLUMN_WIDTHS[r.minIdx],
                            maxW:       Math.max(calcMaxWidth(r.name), COLUMN_WIDTHS[r.minIdx]),
                            startX:     e.clientX,
                            startWidth: col.width,
                            col:        col
                        };
                        document.body.style.cursor = 'col-resize';
                    });

                    cell.appendChild(handle);
                });
            }

            window.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                var delta = e.clientX - dragging.startX;
                var newW = Math.max(dragging.minW, Math.min(dragging.maxW, dragging.startWidth + delta));
                dragging.col.width = newW;
                syncGridWidth();

                if (!rafPending) {
                    rafPending = true;
                    requestAnimationFrame(function() {
                        rafPending = false;
                        if (!dragging) return;
                        try {
                            var ss = gantt.getScrollState();
                            gantt.render();
                            gantt.scrollTo(ss.x, ss.y);
                        } catch(e) {}
                    });
                }
            });

            window.addEventListener('mouseup', function() {
                if (!dragging) return;
                saveWidth(dragging.name, dragging.col.width);
                document.body.style.cursor = '';
                dragging = null;
                try {
                    var ss = gantt.getScrollState();
                    gantt.render();
                    gantt.scrollTo(ss.x, ss.y);
                } catch(e) {}
            });

            // gantt.init() より前（この IIFE は init の前に実行される）に
            // 保存済み幅を適用することで、レイアウト初期化時点から正しい grid_width になる
            applyStoredWidths();

            // render のたびにハンドルを再注入（DOM が作り直されるため）
            gantt.attachEvent("onGanttRender", function() {
                setTimeout(injectHandles, 0);
            });
        })();
        // ===== 列幅ドラッグリサイズ ここまで =====

        // ドラッグによる並べ替え順序の保存
        gantt.attachEvent("onRowDragEnd", async function(id, target) {
            // fetchTasks が展開状態を記憶・復元するようになったため、
            // ここでの重複した記憶処理は不要ですが、念のため fetchTasks を呼ぶだけで十分です。
            
            // 全タスクの現在の表示順序を取得して保存
            const tasks = [];
            const count = gantt.getTaskCount();
            const processedOriginalIds = new Set();
            for (let i = 0; i < count; i++) {
                const task = gantt.getTaskByIndex(i);
                if (task && !task.$virtual) {
                    const originalId = task.original_id || task.id;
                    if (processedOriginalIds.has(originalId)) continue;
                    processedOriginalIds.add(originalId);

                    const sortData = { id: originalId };
                    if (currentDisplayMode === 'machine') {
                        sortData.sort_order_machine = i;
                    } else {
                        sortData.sort_order = i;
                    }
                    tasks.push(sortData);
                }
            }

            // Supabaseの各タスクの順序を一括更新
            const promises = tasks.map(t => {
                const updatePayload = {};
                if (currentDisplayMode === 'machine') {
                    updatePayload.sort_order_machine = t.sort_order_machine;
                } else {
                    updatePayload.sort_order = t.sort_order;
                }
                return supabaseClient
                    .from('tasks')
                    .update(updatePayload)
                    .eq('id', t.id);
            });

            try {
                await Promise.all(promises);
                if (typeof window.markLocalTaskMutation === 'function') {
                    tasks.forEach(t => window.markLocalTaskMutation(t.id));
                }
                console.log("Sort order saved successfully");

                // 常に最新のSupabaseデータを反映するため、データを再取得して allTasks と画面を更新
                await fetchTasks();
            } catch (error) {
                console.error("Error saving sort order:", error);
                alert("並び順の保存に失敗しました。");
            }
        });

        // 新規タスク作成時の保存処理
        gantt.attachEvent("onAfterTaskAdd", async function(id, item) {
            // 工事番号から客先名・工事名を自動補完（allTasks → completedProjects の順に検索）
            const _pn = (item.project_number || "").toString().trim();
            const _projectRef = (window.allTasks || []).find(t =>
                t.project_number === _pn && (t.customer_name || t.project_details)
            ) || (completedProjects || []).find(t =>
                (t.project_number || "").toString().trim() === _pn && (t.customer_name || t.project_details)
            );
            const newTaskData = {
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                end_date: inclusiveEndDateToDb(item.start_date, item.duration),
                owner: item.owner || "",
                project_number: item.project_number || "",
                customer_name: (_projectRef && _projectRef.customer_name) || item.customer_name || "",
                project_details: (_projectRef && _projectRef.project_details) || item.project_details || "",
                machine: item.machine || "",
                unit: item.unit || "",
                major_item: item.major_item || "",
                parent: item.parent_name || "", // 見出し名をparentカラムに保存
                // 組立場所のカラムを追加
                area_group: item.area_group || "",
                area_number: item.area_number || "",
                // 出張予定フラグ
                is_business_trip: currentDisplayMode === 'business_trip' ? true : (item.is_business_trip || false)
            };

            // デバッグログの追加
            console.log("Sending to Supabase (Insert):", newTaskData);

            const { data, error } = await supabaseClient
                .from('tasks')
                .insert([newTaskData])
                .select();

            if (error) {
                console.error("Add error:", error);
                alert("新規タスクの保存に失敗しました。");
                gantt.deleteTask(id); // 保存失敗時はガントから削除
            } else if (data && data[0]) {
                // Supabaseから発行された本当のIDに書き換える
                const newId = data[0].id;
                // changeTaskId は tempId がすでに消えている場合にエラーになることがあるため try-catch で保護
                // エラーでも fetchTasks は必ず実行して画面を最新状態にする
                try {
                    gantt.changeTaskId(id, newId);
                } catch (e) {
                    console.warn("changeTaskId skipped:", e);
                }
                if (typeof window.markLocalTaskMutation === 'function') window.markLocalTaskMutation(newId);
                console.log("New task added with ID:", newId);

                if (typeof window.persistTaskLocations === "function") {
                    await window.persistTaskLocations(newId, item.locations);
                }

                // 変更履歴を記録
                if (typeof window.logChange === 'function') {
                    window.logChange(item.project_number || '', item.machine || '', item.unit || '', item.text || '', 'タスクを追加しました');
                }

                // 画面を最新状態に更新（changeTaskId の成否にかかわらず必ず実行）
                await fetchTasks();
            }
        });

        // マイルストーンタスクのリサイズ（期間変更）を防ぐ
        let _dragOldState = null;
        gantt.attachEvent("onBeforeTaskDrag", function(id, mode, e) {
            const task = gantt.getTask(id);
            // 見出し行（仮想タスク）は期間リサイズ不可
            if (task.$virtual && mode === gantt.config.drag_mode.resize) return false;
            // 設計工程表の出張タスクはドラッグ禁止
            if (task.$design_trip) return false;
            const milestones = ["外観検査", "客先立会", "出荷確認会議", "工場出荷"];
            if (milestones.includes(task.text) && mode === gantt.config.drag_mode.resize) {
                return false; // リサイズ操作をキャンセル
            }
            // ドラッグ開始時の旧状態を保存
            _dragOldState = {
                start_date: dateToDb(task.start_date),
                duration: task.duration
            };
            return true;
        });

        // ドラッグ終了時に履歴を記録
        gantt.attachEvent("onAfterTaskDrag", async function(id, mode, e) {
            if (!_dragOldState) return;
            const task = gantt.getTask(id);
            if (!task || task.$virtual) { _dragOldState = null; return; }
            const newStartDb = dateToDb(task.start_date);
            const changes = [];
            const startChanged = _dragOldState.start_date !== newStartDb;
            const durChanged   = Number(_dragOldState.duration) !== Number(task.duration);
            if (startChanged && durChanged) changes.push('開始日・終了日を変更');
            else if (startChanged) changes.push('開始日を変更');
            else if (durChanged)   changes.push('終了日を変更');
            _dragOldState = null;
            if (changes.length > 0 && typeof window.logChange === 'function') {
                window.logChange(task.project_number || '', task.machine || '', task.unit || '', task.text || '', changes.join('・'));
            }
        });

        // 編集内容をデータベースに保存
        gantt.attachEvent("onAfterTaskUpdate", async function(id, item) {
            if (item.$virtual) return; // 見出し行は仮想的なものなので保存対象外

            const realId = item.original_id || id;

            // 変更前のデータを取得（fetchTasks前なのでallTasksはまだ旧データ）
            const oldTask = (window.allTasks || []).find(t => String(t.id) === String(realId));

            // 工事番号から客先名・工事名を自動補完（allTasks → completedProjects の順に検索）
            const _pn = (item.project_number || "").toString().trim();
            const _projectRef = (window.allTasks || []).find(t =>
                t.project_number === _pn && (t.customer_name || t.project_details)
            ) || (completedProjects || []).find(t =>
                (t.project_number || "").toString().trim() === _pn && (t.customer_name || t.project_details)
            );
            const updateData = {
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                end_date: inclusiveEndDateToDb(item.start_date, item.duration),
                owner: item.owner,
                project_number: item.project_number,
                customer_name: (_projectRef && _projectRef.customer_name) || item.customer_name || "",
                project_details: (_projectRef && _projectRef.project_details) || item.project_details || "",
                machine: item.machine,
                unit: item.unit,
                major_item: item.major_item, // 色分け項目を保存
                parent: item.parent_name, // 見出し名をparentカラムに保存
                // 組立場所のカラムを追加
                area_group: item.area_group || "",
                area_number: item.area_number || "",
                // 出張予定フラグ（出張予定モード時は強制的にtrue、それ以外は既存値を維持）
                is_business_trip: currentDisplayMode === 'business_trip' ? true : (item.is_business_trip || false),
                main_owner: item.main_owner || ""
                // is_new_task: false // データベースにカラムがない可能性があるため一時的にコメットアウト
            };

            // デバッグログの追加
            console.log("Sending to Supabase (Update):", updateData, "Real ID:", realId);

            // 1. タスク本体の更新
            const { error: taskError } = await supabaseClient
                .from('tasks')
                .update(updateData)
                .eq('id', realId);

            if (taskError) {
                console.error("Update error:", taskError);
                alert("保存に失敗しました。");
                return;
            }
            if (typeof window.markLocalTaskMutation === 'function') window.markLocalTaskMutation(realId);

            // 変更履歴を記録
            if (oldTask && typeof window.logChange === 'function') {
                const newStartDb = dateToDb(item.start_date);
                const oldStartDb = (oldTask.start_date instanceof Date)
                    ? dateToDb(oldTask.start_date)
                    : (oldTask.start_date || '').substring(0, 10);
                const changes = [];
                if ((oldTask.text || '') !== (item.text || '')) changes.push('タスク名を変更');
                const startChanged = oldStartDb !== newStartDb;
                const durChanged = Number(oldTask.duration) !== Number(item.duration);
                if (startChanged && durChanged) changes.push('開始日・終了日を変更');
                else if (startChanged) changes.push('開始日を変更');
                else if (durChanged) changes.push('終了日を変更');
                const ownerStrChanged = (oldTask.owner || '') !== (item.owner || '');
                const mainOwnerChanged = String(oldTask.main_owner || '').trim() !== String(item.main_owner || '').trim();
                if (ownerStrChanged || mainOwnerChanged) changes.push('担当者を変更');
                if ((oldTask.machine || '') !== (item.machine || '')) changes.push('機械を変更');
                if ((oldTask.unit || '') !== (item.unit || '')) changes.push('ユニットを変更');
                if (String(oldTask.major_item || '') !== String(item.major_item || '')) changes.push('部署を変更');
                if (String(oldTask.parent_name || '') !== String(item.parent_name || '')) changes.push('見出しを変更');
                const oldAg = String(oldTask.area_group || '').trim();
                const oldAn = String(oldTask.area_number || '').trim();
                const newAg = String(item.area_group || '').trim();
                const newAn = String(item.area_number || '').trim();
                if (oldAg !== newAg || oldAn !== newAn) changes.push('場所を変更');
                if (changes.length > 0) {
                    window.logChange(item.project_number, item.machine, item.unit, item.text, changes.join('・'));
                }
            }

            // 成功したらデータを再取得して allTasks と画面を更新
            await fetchTasks();
        });

        // 保存ボタンが押された瞬間に実行されるイベント
        gantt.attachEvent("onLightboxSave", function(id, item) {
            // 新規タスク判定を同期的に取得（非同期処理が始まる前に確定させる）
            // _is_new_task フラグで判定（IDのallTasks比較はDHTMLXのtemp IDと既存IDが衝突するため不使用）
            const _taskObj = gantt.isTaskExists(id) ? gantt.getTask(id) : null;
            const isNewTask = !!(_taskObj && _taskObj._is_new_task);

            (async () => {
                try {
                    if (!isNewTask && typeof window.persistTaskLocations === "function") {
                        // 既存タスク: 組立場所を保存してから updateTask → onAfterTaskUpdate が Supabase 更新・fetchTasks を担う
                        const ok = await window.persistTaskLocations(id, item.locations);
                        if (!ok) return;
                    }

                    if (!isNewTask) {
                        gantt.updateTask(id);
                    }
                    // 新規タスクは onAfterTaskAdd が Supabase 保存・changeTaskId・fetchTasks をすべて担う
                    // ここで fetchTasks を呼ぶと gantt.parse がテンポラリIDを消し changeTaskId が失敗するため呼ばない
                    if (!isNewTask) {
                        await fetchTasks();
                    }
                } catch (e) {
                    console.error("Lightbox save error:", e);
                }
            })();
            
            // ③ 最後に必ず true を返してライトボックスを閉じる
            return true;
        });

        // タスクの削除をデータベースに反映
        gantt.attachEvent("onAfterTaskDelete", async function(id, item) {
            if (item.$virtual) return; // 仮想的な見出し行は削除対象外

            const realId = item.original_id || id;
            if (typeof window.markLocalTaskMutation === 'function') window.markLocalTaskMutation(realId);
            const { error: rpcErr } = await supabaseClient.rpc('delete_task_with_change_log_source', {
                p_task_id: String(realId),
                p_source: '全体工程表',
                p_user: (window._getCurrentEditorName && window._getCurrentEditorName()) || ''
            });

            let error = rpcErr;
            if (rpcErr) {
                console.error('Delete RPC error:', rpcErr);
                const { error: delErr } = await supabaseClient
                    .from('tasks')
                    .delete()
                    .eq('id', realId);
                error = delErr;
            }

            if (error) {
                console.error("Delete error:", error);
                alert("削除に失敗しました。" + (rpcErr ? " change_log_task_delete_trigger.sql（RPC 含む）を Supabase で実行済みか確認してください。" : ""));
            } else {
                /* RPC 成功時は change_log は DB トリガーのみ（gantt の item で組立判定がズレると logChange と二重になるため） */
                if (rpcErr && typeof window.logChange === 'function') {
                    const trigAssembly = typeof window.isAssemblyTaskRowForChangeLog === 'function'
                        && window.isAssemblyTaskRowForChangeLog(item);
                    if (!trigAssembly) {
                        await window.logChange(
                            item.project_number || '',
                            item.machine || '',
                            item.unit || '',
                            item.text || '',
                            'タスクを削除しました'
                        );
                    } else {
                        await window.logChange(
                            item.project_number || '',
                            item.machine || '',
                            item.unit || '',
                            item.text || '',
                            'タスクを削除しました',
                            '全体工程表'
                        );
                    }
                }
                await fetchTasks();
            }
        });

        // ＋ボタンの挙動をカスタマイズ（親の情報を引き継ぐ）
        gantt.attachEvent("onTaskCreated", function(task){
            // 新規タスクであることをフラグで記録（onLightboxSaveで新規/既存を確実に判別するため）
            task._is_new_task = true;
            if (task.parent) {
                const parentTask = gantt.getTask(task.parent);
                // 親が仮想行（見出し行）の場合、その情報を引き継ぐ
                if (parentTask.$virtual) {
                    task.project_number = parentTask.project_number;
                    task.parent_name = parentTask.text; // きれいな名前を引き継ぐ
                    task.customer_name = parentTask.customer_name;
                    task.project_details = parentTask.project_details;
                } else {
                    // 親が仮想行でない（通常の子タスク）の場合、その子タスクと同じ情報を引き継ぐ
                    task.project_number = parentTask.project_number;
                    task.parent_name = parentTask.parent_name || parentTask.parent;
                    task.customer_name = parentTask.customer_name;
                    task.project_details = parentTask.project_details;
                }
            }
            // 出張予定モードでは開始日を今日の日付に固定
            if (currentDisplayMode === 'business_trip') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                task.start_date = today;
                task.duration = 1;
            }
            return true;
        });

        gantt.templates.grid_row_class = function(start, end, task){
            let css = "";

            if (task.$virtual) {
                // 見出し行：子タスクがすべてチェック済みならグレーアウト（機械別は子がクローンIDのため original_id で参照）
                const children = gantt.getChildren(task.id);
                if (children.length > 0 && children.every(cid => {
                    const c = gantt.getTask(cid);
                    const key = (c && c.original_id) || cid;
                    return taskCheckboxes[key];
                })) {
                    css += " task-checked";
                }
            } else {
                // チェックボックスの状態を確認（機械別クローン行は DB の id で taskCheckboxes を参照）
                if (taskCheckboxes[task.original_id || task.id]) {
                    css += " task-checked";
                }
            }

            // 工事番号の切り替わり（新しい工事番号の最初の行）を判定
            const index = gantt.getGlobalTaskIndex(task.id);
            if (index > 0) {
                const prevTask = gantt.getTaskByIndex(index - 1);
                if (prevTask && prevTask.project_number !== task.project_number) {
                    css += " project-border-top";
                }
            }

            if(task.$virtual) {
                css += " gantt_group_row hide_add_button";
            } else if (!task.owner || task.owner.trim() === "") {
                css += " unassigned-row";
            }

            // 複数行選択ハイライト
            if (window._ganttSelectedIds && window._ganttSelectedIds.has(String(task.id))) {
                css += " row-selected";
            }

            return css;
        };

        gantt.templates.task_row_class = function(start, end, task){
            let css = "";
            
            // グリッド側と同じロジックでガントチャート側にも線を引く
            const index = gantt.getGlobalTaskIndex(task.id);
            if (index > 0) {
                const prevTask = gantt.getTaskByIndex(index - 1);
                if (prevTask && prevTask.project_number !== task.project_number) {
                    css += " project-border-top";
                }
            }
            return css;
        };

        // 今日のマーカー
        function updateTodayMarker() {
            gantt.deleteMarker("today_marker");
            gantt.addMarker({ 
                id: "today_marker",
                start_date: new Date(), 
                css: "today-line", 
                text: ""
            });
        }
        updateTodayMarker();
        gantt.render();
        
        // 初期ズームレベルに応じたクラス付与
        (function() {
            const container = document.getElementById("gantt_here");
            if (container) {
                // デフォルトが days のため
                container.classList.add("zoom-days");
            }
        })();

        // 業務別カラー
        gantt.templates.task_text = function(start, end, task) {
            const projectNumber = (task.project_number || "").toString();
            const is2000s = projectNumber.startsWith('2');

            let taskName = "";
            if (task.$virtual) {
                // 見出し行
                taskName = is2000s ? task.text : projectNumber;
            } else if (currentDisplayMode === 'business_trip') {
                // 出張予定モード：担当者を表示
                taskName = task.owner || "";
            } else if (is2000s) {
                // 2000番台：機械名とユニット名を表示
                const machine = task.machine || "";
                const unit = task.unit || "";
                taskName = (machine && unit) ? `${machine} - ${unit}` : (machine || unit || task.text);
            } else {
                // それ以外：タスク名を表示
                taskName = task.text;
            }

            return taskName || "";
        };

        gantt.templates.task_class = function(start, end, task) {
            // 設計・組立工程表の出張タスクは読み取り専用、部署で色分け
            if (task.$design_trip) {
                const tripColor = task.major_item === '組立' ? 'task-yellow' : 'task-blue';
                return tripColor + ' design-trip-readonly';
            }

            const projectNumber = (task.project_number || "").toString();
            const is2000s = projectNumber.startsWith('2');
            let css = is2000s ? "task-2000s " : "";

            // 2000番台以外の見出し行に特定のクラスを付与
            if (task.$virtual && !is2000s) {
                css += "header-non-2000s ";
            }
            
            // 2000番台の見出し行に特定のクラスを付与
            if (task.$virtual && is2000s && currentDisplayMode === 'machine') {
                css += "header-2000s ";
            }

            if (task.text === "神戸送り開始日") return css + "hidden_bar";
            if (task.text === "外観検査") return css + "milestone-circle";
            if (task.text === "出荷確認会議") return css + "milestone-diamond";
            if (task.text === "工場出荷") return css + "milestone-star";
            if (task.text === "客先立会") return css + "milestone-square";

            // 大項目フィルタ（部署別フィルタ）と部署別リソースの両方が有効な時のみ担当者ごとの色を適用
            if (currentMajorFilters.size > 0 && currentResourceDeptFilter && currentMajorFilters.has(currentResourceDeptFilter)) {
                // フィルタ対象の部署と一致する場合のみ担当者ごとの色を適用
                if (task.major_item === currentResourceDeptFilter) {
                    const ownerColor = getOwnerColorClass(task.owner, task.major_item);
                    if (ownerColor) return css + ownerColor;
                }
            }

            switch (task.major_item) {
                case '設計': css += "task-blue"; break;
                case '製管':
                case '品証': css += "task-green"; break;
                case '組立': css += "task-yellow"; break;
                case '電装': css += "task-purple"; break;
                case '操業': css += "task-red"; break;
                case '電技': css += "task-teal"; break;
                case '明石': css += "task-brown"; break;
                case '営業': css += "task-orange"; break;
                default: break;
            }
            return css;
        };
        
        const isWeekendOrHoliday = (date) => {
            if (date.getDay() === 0 || date.getDay() === 6) return true;
            const ds = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
            return holidaySet.has(ds);
        };

        gantt.templates.scale_cell_class = (date) => {
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            const isMonthEnd = nextDay.getDate() === 1;
            const isDays = (gantt.ext.zoom.getCurrentLevel() || "days") === "days";
            const day = date.getDay();
            const dayClass = isDays ? (day === 6 ? " scale_saturday" : day === 0 ? " scale_sunday" : "") : "";
            return (isDays && isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEnd ? " month-end-cell" : "") + dayClass;
        };

        gantt.templates.timeline_cell_class = (task, date) => {
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            const isMonthEnd = nextDay.getDate() === 1;
            const isDays = (gantt.ext.zoom.getCurrentLevel() || "days") === "days";
            return (isDays && isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEnd ? " month-end-cell" : "");
        };

        const isMonthEndDate = (date) => {
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            return nextDay.getDate() === 1;
        };

        const zoomConfig = {
            levels: [
                { name: "days", scale_height: 60, min_column_width: 22, scales: [
                    { unit: "month", step: 1, format: "%Y/%n", css: () => "month-end-cell" },
                    { unit: "day", step: 1, format: "%j", css: (date) => { const ds = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); const isHol = holidaySet.has(ds) && date.getDay()!==0; return (isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEndDate(date) ? " month-end-cell" : "") + (date.getDay() === 0 ? " scale_sunday" : isHol ? " scale_holiday" : date.getDay() === 6 ? " scale_saturday" : ""); } },
                    { unit: "day", step: 1, format: (date) => dayNames[date.getDay()], css: (date) => { const ds = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); const isHol = holidaySet.has(ds) && date.getDay()!==0; return (isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEndDate(date) ? " month-end-cell" : "") + (date.getDay() === 0 ? " scale_sunday" : isHol ? " scale_holiday" : date.getDay() === 6 ? " scale_saturday" : ""); } }
                ]},
                { name: "weeks", scale_height: 60, min_column_width: 22, scales: [
                    { unit: "month", step: 1, format: "%Y/%n" },
                    { unit: "week", step: 1, format: (date) => {
                        const dateToStr = gantt.date.date_to_str("%j");
                        return dateToStr(date);
                    }}
                ]}
            ]
        };
        gantt.ext.zoom.init(zoomConfig);

        // 工事番号入力欄のイベントリスナー
        // フィルター機能は削除し、新規追加時の入力のみに使用する
        /*
        document.getElementById('project_number').addEventListener('input', function(e) {
            currentProjectFilter = e.target.value.trim();
            gantt.render();
        });
        */

        let _displayFilterCacheKey = "";
        let _taskVisibleCache = Object.create(null);
        let _virtualVisibleCache = Object.create(null);
        function _invalidateDisplayFilterCache() {
            _displayFilterCacheKey = "";
            _taskVisibleCache = Object.create(null);
            _virtualVisibleCache = Object.create(null);
        }
        function _ensureDisplayFilterCache() {
            const completedKey = completedProjects
                .map(cp => (cp.project_number || "").toString().trim())
                .sort()
                .join(",");
            const cacheKey = [
                gantt.getTaskCount(),
                currentFilter || "",
                currentProjectGroupFilter || "all",
                Array.from(currentMajorFilters).sort().join(","),
                currentOwnerFilter || "",
                currentMachineFilter || "",
                currentTaskFilter || "",
                isUnassignedOnly ? "1" : "0",
                completedKey
            ].join("|");
            if (cacheKey === _displayFilterCacheKey) return;

            const nextTaskVisible = Object.create(null);
            const nextVirtualVisible = Object.create(null);

            gantt.eachTask(function(task) {
                if (task.$virtual) return;
                const visible = isTaskVisible(task);
                nextTaskVisible[task.id] = visible;
                if (!visible) return;
                if (task.parent != null && task.parent !== "") {
                    nextVirtualVisible[task.parent] = true;
                }
            });

            _displayFilterCacheKey = cacheKey;
            _taskVisibleCache = nextTaskVisible;
            _virtualVisibleCache = nextVirtualVisible;
        }
        gantt.attachEvent("onClear", _invalidateDisplayFilterCache);
        gantt.attachEvent("onParse", _invalidateDisplayFilterCache);
        gantt.attachEvent("onAfterTaskAdd", _invalidateDisplayFilterCache);
        gantt.attachEvent("onAfterTaskDelete", _invalidateDisplayFilterCache);
        gantt.attachEvent("onAfterTaskUpdate", _invalidateDisplayFilterCache);

        // 個別のタスクがフィルタ条件に合致するか判定する関数
        function isTaskVisible(task) {
            // 1. is_detailed が true のタスクは常に非表示
            var isDetailed = String(task.is_detailed).toLowerCase();
            if (task.is_detailed === true || isDetailed === "true" || isDetailed === "t" || isDetailed === "1") {
                return false;
            }

            // 1b. 完了済工番フィルター
            const taskPNum = (task.project_number || task.project_no || '').trim();
            if (completedProjects.some(cp => cp.project_number === taskPNum)) return false;

            // 2. 工事番号フィルター (AND条件)
            // 左側リスト選択 (currentFilter) のみ有効（入力欄フィルターは削除）
            if (currentFilter) {
                var taskProjectNumber = task.project_number || task.project_no;
                if (!taskProjectNumber || taskProjectNumber !== currentFilter) return false;
            }

            // 2b. 工事番号グループフィルター (AND条件)
            if (currentProjectGroupFilter && currentProjectGroupFilter !== 'all') {
                const pNum = (task.project_number || task.project_no || '').toString();
                if (currentProjectGroupFilter === '2000' && !/^2/.test(pNum)) return false;
                if (currentProjectGroupFilter === 'other' && /^2/.test(pNum)) return false;
            }

            // 3. 部署フィルター (AND条件)
            if (currentMajorFilters.size > 0) {
                if (!currentMajorFilters.has(task.major_item)) return false;
            }

            // 4. 担当者フィルター (AND条件)
            if (currentOwnerFilter) {
                if (!task.owner || !task.owner.includes(currentOwnerFilter)) return false;
            }

            // 5. 機械フィルター (AND条件)
            if (currentMachineFilter) {
                if (!task.machine || !task.machine.includes(currentMachineFilter)) return false;
            }

            // 5.5 タスク名フィルター（子タスクのみ）
            if (currentTaskFilter) {
                if (task.$virtual) return true; // 見出し行は後で子タスクチェック
                if (!task.text || !task.text.includes(currentTaskFilter)) return false;
            }

            // 6. 未割当フィルター (AND条件)
            if (isUnassignedOnly) {
                if (task.owner && task.owner.trim() !== "") return false;
            }

            return true;
        }

        gantt.attachEvent("onBeforeTaskDisplay", function(id, task) {
            _ensureDisplayFilterCache();
            // 仮想親行（工事番号行）の場合は、その配下に「表示対象となるタスク」が1つでもあるかチェック
            if (task.$virtual) {
                return !!_virtualVisibleCache[id];
            }

            // 通常のタスク（子タスク）の表示判定
            return !!_taskVisibleCache[id];
        });

        // ========== 神戸送り開始日マーク（ドラッグ可能・Supabase永続化） ==========
        let _markDragState = null;

        function renderPartsMarks() {
            document.querySelectorAll('.parts-delivery-mark').forEach(function(el) { el.remove(); });
            const container = document.querySelector('.gantt_data_area');
            if (!container) return;
            const markSize = 20;

            gantt.eachTask(function(task) {
                if (task.text !== "神戸送り開始日") return;
                try { if (!gantt.isTaskVisible(task.id)) return; } catch(e) { return; }
                if (!task.start_date) return;

                const pos = gantt.getTaskPosition(task, task.start_date, task.end_date);
                const markLeft = pos.left - markSize / 2;
                const markTop  = pos.top + pos.height / 2 - markSize / 2;

                const el = document.createElement("div");
                el.className = "parts-delivery-mark";
                el.innerHTML = "🚚";
                el.setAttribute("data-task-id", String(task.id));
                el.style.left = markLeft + "px";
                el.style.top  = markTop  + "px";

                // ダブルクリックで編集ライトボックスを開く
                el.addEventListener("dblclick", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (_markDragState) {
                        _markDragState.el.classList.remove("parts-delivery-mark--dragging");
                        _markDragState = null;
                    }
                    if (_isEditor) {
                        gantt.showLightbox(String(task.id));
                    }
                });

                el.addEventListener("mousedown", function(e) {
                    if (!_isEditor) return;
                    // ダブルクリックの2回目mousedownを無視
                    if (e.detail >= 2) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    _markDragState = {
                        taskId:    String(task.id),
                        startX:    e.clientX,
                        startLeft: markLeft,
                        markSize:  markSize,
                        el:        el,
                        dragged:   false
                    };
                    el.classList.add("parts-delivery-mark--dragging");
                });

                container.appendChild(el);
            });
        }

        // ガント再描画のたびにマークを再配置
        gantt.attachEvent("onGanttRender", function() {
            renderPartsMarks();
        });

        // ドラッグ移動
        document.addEventListener("mousemove", function(e) {
            if (!_markDragState) return;
            e.stopPropagation();
            e.preventDefault();
            const dx = e.clientX - _markDragState.startX;
            if (Math.abs(dx) > 3) _markDragState.dragged = true;
            _markDragState.el.style.left = (_markDragState.startLeft + dx) + "px";
        });

        // ドラッグ終了：実際にドラッグした場合のみ日付を計算してSupabaseに保存
        document.addEventListener("mouseup", async function(e) {
            if (!_markDragState) return;
            e.stopPropagation();
            const wasDragged = _markDragState.dragged;
            const state = _markDragState;
            state.el.classList.remove("parts-delivery-mark--dragging");
            _markDragState = null;
            if (!wasDragged) {
                renderPartsMarks();
                return;
            }
            const elLeft = parseFloat(state.el.style.left);
            const markCenter = elLeft + state.markSize / 2;
            const newDate = gantt.dateFromPos(markCenter);
            if (newDate) {
                const dateStr = newDate.getFullYear() + '-' +
                    String(newDate.getMonth() + 1).padStart(2, '0') + '-' +
                    String(newDate.getDate()).padStart(2, '0');
                // タスクオブジェクトを更新
                const task = gantt.getTask(state.taskId);
                if (task) {
                    task.start_date = newDate;
                    gantt.updateTask(state.taskId);
                }
                // Supabaseに保存（end_date はグリッドと同じ包含終了日）
                const dur = task.duration != null ? Number(task.duration) : 1;
                await supabaseClient.from('tasks')
                    .update({
                        start_date: dateStr,
                        end_date: inclusiveEndDateToDb(gantt.date.str_to_date("%Y-%m-%d")(dateStr), dur)
                    })
                    .eq('id', state.taskId);
                if (typeof window.markLocalTaskMutation === 'function') window.markLocalTaskMutation(state.taskId);
            }
            renderPartsMarks();
        });
        // ========== 神戸送り開始日マーク ここまで ==========

        gantt.config.readonly = true; // デフォルトは読み取り専用、ログイン後に解除
        gantt.init("gantt_here");

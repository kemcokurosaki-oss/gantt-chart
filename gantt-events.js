        // + ボタンが押された行のタスクIDを記録（挿入位置の計算に使用）
        var _pendingInsertAfterId = null;
        document.addEventListener("mousedown", function(e) {
            var btn = e.target.classList && e.target.classList.contains("gantt_add")
                ? e.target
                : (e.target.closest ? e.target.closest(".gantt_add") : null);
            if (!btn) { return; }
            var row = btn.closest ? btn.closest("[task_id]") : null;
            _pendingInsertAfterId = row ? row.getAttribute("task_id") : null;
        }, true);

        gantt.attachEvent("onLightboxChange", function(id, name, value) {
            if (name === "major_item") {
                const task = gantt.getTask(id);
                if (task) task.major_item = value;
            }
        });

        // 出張予定モードのライトボックス保存時に客先名・工事名をキャプチャする
        // （DHTMLX の map_to タイミング問題により item に反映されないケースへの対策）
        let _tripLightboxCapture = null;
        gantt.attachEvent("onBeforeLightboxSave", function(id, task) {
            _tripLightboxCapture = null;
            if (currentDisplayMode !== 'business_trip') return true;

            // DOM ルックアップで値を取得（最も確実な方法）
            let cnValue = null, pdValue = null;
            const larea = document.querySelector('.gantt_cal_larea');
            if (larea) {
                function _findSectionInput(labelText) {
                    const chs = Array.from(larea.children);
                    for (let i = 0; i < chs.length; i++) {
                        if (chs[i].classList.contains('gantt_cal_lsection') &&
                            chs[i].textContent.trim() === labelText) {
                            const next = chs[i + 1];
                            return next ? (next.querySelector('textarea') || next.querySelector('input[type=text]')) : null;
                        }
                    }
                    return null;
                }
                const cnEl = _findSectionInput('客先名');
                const pdEl = _findSectionInput('工事名');
                if (cnEl !== null) cnValue = cnEl.value.trim();
                if (pdEl !== null) pdValue = pdEl.value.trim();
            }

            // DOM ルックアップ失敗時は task パラメータから取得
            // （onBeforeLightboxSave 発火前に DHTMLX が map_to を適用済みのため task は最新値を持つ）
            if (cnValue === null) cnValue = task.customer_name !== undefined ? task.customer_name : null;
            if (pdValue === null) pdValue = task.project_details !== undefined ? task.project_details : null;

            _tripLightboxCapture = {
                id: String(id),
                customer_name:  cnValue,
                project_details: pdValue
            };
            return true;
        });
        gantt.locale.labels.section_project_number = "工事番号";
        gantt.locale.labels.section_customer_name = "客先名";
        gantt.locale.labels.section_project_details = "工事名";
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
                // リンク設定済みの見出し行 or 受注説明会タスクのみ表示
                const isDesignDetail = obj.$virtual && (obj.text === "長納期品手配" || obj.text === "出図＆部品手配");
                const hasLink = typeof window.hasSpecFolderLink === "function" && window.hasSpecFolderLink(obj.project_number);
                const isSpecFolder = hasLink && (
                    (obj.$virtual && obj.text === "受注") ||
                    (!obj.$virtual && obj.text === "受注説明会")
                );
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
        gantt.config.grid_width = 621;
        gantt.config.grid_resize = false;
        gantt.config.drag_resize = true;
        gantt.config.row_height = 27;
        gantt.config.bar_height = 21; // バーを太く (18 -> 21)
        gantt.config.scale_height = 60;
        gantt.config.min_column_width = 22;
        gantt.config.open_tree_initially = false;
        gantt.config.order_branch = true;
        gantt.config.order_branch_free = true;
        gantt.config.smart_rendering = true; // 表示範囲外の行をスキップしてドラッグを軽くする

        // ===== 列幅ドラッグリサイズ（担当・場所のみ） =====
        (function() {
            var COL_WIDTHS_KEY = 'gantt_col_widths_v1';

            // リサイズ対象列：name / COLUMN_WIDTHS の添字 / 元のデフォルト最小幅
            var RESIZABLE = [
                { name: 'owner',       minIdx: 6, minW: COLUMN_WIDTHS[6] },
                { name: 'area_number', minIdx: 7, minW: COLUMN_WIDTHS[7] }
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
                if (typeof currentDisplayMode !== 'undefined' && currentDisplayMode === 'business_trip') {
                    var total = gantt.config.columns.reduce(function(s, c) { return s + (c.width || 0); }, 0);
                    gantt.config.grid_width = total;
                    GRID_WIDTH = total;
                    return;
                }
                var total = SHARED_COLUMNS.reduce(function(s, c) { return s + (c.width || 0); }, 0);
                gantt.config.grid_width = total;
                GRID_WIDTH = total;
                // リサイズ対象列のみ COLUMN_WIDTHS を同期（下段リソースの列幅追従用）
                RESIZABLE.forEach(function(r) {
                    var col = SHARED_COLUMNS.find(function(c) { return c.name === r.name; });
                    if (col) COLUMN_WIDTHS[r.minIdx] = col.width;
                });
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
                        } else if (name === 'customer_name') {
                            text = task.customer_name || '';
                        } else if (name === 'project_details') {
                            text = task.project_details || '';
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

            // 出張予定モードの初回表示幅キャッシュ（モード切替ごとにリセット）
            var _tripDefaultWidths = {};

            // ヘッダーセルにリサイズハンドルを注入
            function injectHandles() {
                if (typeof currentDisplayMode !== 'undefined' && currentDisplayMode === 'business_trip') {
                    _injectTripHandles();
                    return;
                }
                _tripDefaultWidths = {};

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
                            minW:       r.minW,
                            maxW:       Math.max(calcMaxWidth(r.name), r.minW),
                            startX:     e.clientX,
                            startWidth: col.width,
                            col:        col
                        };
                        document.body.style.cursor = 'col-resize';
                    });

                    // ダブルクリックでコンテンツ幅に自動フィット
                    handle.addEventListener('dblclick', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var col = SHARED_COLUMNS.find(function(c) { return c.name === r.name; });
                        if (!col) return;
                        var fitW = Math.max(calcMaxWidth(r.name), r.minW);
                        col.width = fitW;
                        syncGridWidth();
                        saveWidth(r.name, fitW);
                        try {
                            var ss = gantt.getScrollState();
                            gantt.render();
                            gantt.scrollTo(ss.x, ss.y);
                        } catch(e2) {}
                        if (typeof updateResourceVisibility === 'function') updateResourceVisibility();
                    });

                    cell.appendChild(handle);
                });
            }

            // 出張予定モード用リサイズハンドル注入（客先名・工事名・担当の3列）
            function _injectTripHandles() {
                var TRIP_RESIZABLE_NAMES = ['customer_name', 'project_details', 'owner'];
                var cols = gantt.config.columns;
                var allCells = document.querySelectorAll('#gantt_here .gantt_grid_head_cell');
                TRIP_RESIZABLE_NAMES.forEach(function(colName) {
                    var colIdx = cols.findIndex(function(c) { return c.name === colName; });
                    if (colIdx < 0) return;
                    var cell = allCells[colIdx];
                    if (!cell || cell.querySelector('.col-resize-handle')) return;

                    // 出張予定モードに切り替えた最初の render 時の実表示幅を下限として記録
                    if (!_tripDefaultWidths[colName]) {
                        _tripDefaultWidths[colName] = cell.offsetWidth || cols[colIdx].width;
                    }
                    var minW = _tripDefaultWidths[colName];

                    cell.style.position = 'relative';
                    cell.style.overflow = 'visible';
                    var handle = document.createElement('div');
                    handle.className = 'col-resize-handle';
                    handle.dataset.colName = colName;
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
                        var col = gantt.config.columns.find(function(c) { return c.name === colName; });
                        dragging = {
                            name:       colName,
                            minW:       minW,
                            maxW:       Math.max(calcMaxWidth(colName), minW),
                            startX:     e.clientX,
                            startWidth: col.width,
                            col:        col,
                            isTrip:     true
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
                            var aw = (document.querySelector('.gantt_grid') || {}).offsetWidth || GRID_WIDTH;
                            GRID_WIDTH = aw;
                            if (typeof window.applyResourceGridWidthCSS === 'function') window.applyResourceGridWidthCSS(aw);
                        } catch(e) {}
                    });
                }
            });

            window.addEventListener('mouseup', function() {
                if (!dragging) return;
                if (!dragging.isTrip) saveWidth(dragging.name, dragging.col.width);
                document.body.style.cursor = '';
                dragging = null;
                try {
                    var ss = gantt.getScrollState();
                    gantt.render();
                    gantt.scrollTo(ss.x, ss.y);
                    var aw = (document.querySelector('.gantt_grid') || {}).offsetWidth || GRID_WIDTH;
                    GRID_WIDTH = aw;
                    if (typeof window.applyResourceGridWidthCSS === 'function') window.applyResourceGridWidthCSS(aw);
                } catch(e) {}
                if (typeof updateResourceVisibility === 'function') updateResourceVisibility();
            });

            // render のたびにハンドルを再注入（DOM が作り直されるため）
            gantt.attachEvent("onGanttRender", function() {
                setTimeout(injectHandles, 0);
            });
        })();
        // ===== 列幅ドラッグリサイズ ここまで =====

        // 行ドラッグ中はonGanttRenderの重い処理をスキップするためフラグ管理
        gantt.attachEvent("onBeforeRowDragMove", function() { _rowDragging = true; return true; });

        // ドラッグによる並べ替え順序の保存（バックグラウンド・UIブロックなし）
        gantt.attachEvent("onRowDragEnd", function(id, target) {
            _rowDragging = false;
            // 全タスクの現在の表示順序を取得
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

            // window.allTasks のメモリ内 sort_order を即時更新（再描画不要）
            const isMachine = currentDisplayMode === 'machine';
            tasks.forEach(function(t) {
                const existing = (window.allTasks || []).find(function(a) { return String(a.id) === String(t.id); });
                if (existing) {
                    if (isMachine) {
                        existing.sort_order_machine = t.sort_order_machine;
                    } else {
                        existing.sort_order = t.sort_order;
                    }
                }
            });

            // Supabaseへの保存はバックグラウンドで実行（fetchTasks不要・再描画なし）
            const promises = tasks.map(function(t) {
                const updatePayload = {};
                if (isMachine) {
                    updatePayload.sort_order_machine = t.sort_order_machine;
                } else {
                    updatePayload.sort_order = t.sort_order;
                }
                Object.assign(updatePayload, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {});
                return supabaseClient
                    .from('tasks')
                    .update(updatePayload)
                    .eq('id', t.id);
            });

            const saveStatus = document.getElementById('save-status');
            if (saveStatus) { saveStatus.textContent = '並替え保存中...'; saveStatus.style.color = '#999'; }

            // ドラッグ終了後にマークを再配置（フラグ解除済みのため描画される）
            renderPartsMarks();
            renderFactoryShipmentStars();

            Promise.all(promises).then(function() {
                if (typeof window.markLocalTaskMutation === 'function') {
                    tasks.forEach(function(t) { window.markLocalTaskMutation(t.id); });
                }
                if (saveStatus) { saveStatus.textContent = ''; }
            }).catch(function(error) {
                console.error("Error saving sort order:", error);
                if (saveStatus) { saveStatus.textContent = '並替え保存失敗'; saveStatus.style.color = '#e74c3c'; }
            });
        });

        // 新規タスク作成時の保存処理
        gantt.attachEvent("onAfterTaskAdd", async function(id, item) {
            showLoading();
            // 工事番号から客先名・工事名を自動補完（allTasks → completedProjects の順に検索）
            const _pn = (item.project_number || "").toString().trim();
            const _projectRef = (window.allTasks || []).find(t =>
                t.project_number === _pn && (t.customer_name || t.project_details)
            ) || (completedProjects || []).find(t =>
                (t.project_number || "").toString().trim() === _pn && (t.customer_name || t.project_details)
            );
            const newTaskData = Object.assign({
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                end_date: inclusiveEndDateToDb(item.start_date, item.duration),
                owner: item.owner || "",
                project_number: item.project_number || "",
                customer_name: item.customer_name || (_projectRef && _projectRef.customer_name) || "",
                project_details: item.project_details || (_projectRef && _projectRef.project_details) || "",
                machine: item.machine || "",
                unit: item.unit || "",
                major_item: item.major_item || "",
                parent: item.parent_name || "", // 見出し名をparentカラムに保存
                // 組立場所のカラムを追加
                area_group: item.area_group || "",
                area_number: item.area_number || "",
                // 出張予定フラグ
                is_business_trip: currentDisplayMode === 'business_trip' ? true : (item.is_business_trip || false)
            }, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {});
            // 出張予定モードで追加した行は組立／設計工程表からも参照できるよう task_type を付与
            // （通常モードでは task_type を触らず、既存値を保持する）
            if (currentDisplayMode === 'business_trip') {
                newTaskData.task_type = 'business_trip';
            }

            // + を押した行の直下に挿入（sort_order を計算して設定）
            if (item._insertAfterId) {
                const allT = window.allTasks || [];
                const srcTask = allT.find(t => String(t.id) === String(item._insertAfterId));
                if (srcTask && srcTask.sort_order != null) {
                    const srcOrder = Number(srcTask.sort_order);
                    // srcOrder より大きい sort_order を持つタスクを +1 シフト（design_trip タスクは tasks テーブル外なので除外）
                    const toShift = allT.filter(t => t.sort_order != null && Number(t.sort_order) > srcOrder && !t.$design_trip);
                    if (toShift.length > 0) {
                        await Promise.all(toShift.map(t =>
                            supabaseClient.from('tasks')
                                .update({ sort_order: Number(t.sort_order) + 1 })
                                .eq('id', t.id)
                        ));
                    }
                    newTaskData.sort_order = srcOrder + 1;
                }
            }

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
                hideLoading();
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

                // 画面を最新状態に更新（changeTaskId の成否にかかわらず必ず実行）
                await fetchTasks();
                hideLoading();
            }
        });

        // マイルストーンタスクのリサイズ（期間変更）を防ぐ
        let _dragOldState = null;
        /** 期間リサイズ中のみ true（終了日プレビュー用） */
        let _resizeFeedbackActive = false;
        let _resizeHintEl = null;
        let _resizeGuideEl = null;
        let _resizeActiveLineEl = null;
        let _factoryStarsDragRaf = null;
        /** 期間リサイズで掴んだ端: "start" | "end" | null（mousedown のハンドルから決定） */
        let _resizeActiveEdge = null;

        function _getGanttResizeHintEl() {
            if (_resizeHintEl) return _resizeHintEl;
            _resizeHintEl = document.createElement("div");
            _resizeHintEl.id = "gantt-resize-hint";
            _resizeHintEl.className = "gantt-resize-hint";
            _resizeHintEl.setAttribute("aria-live", "polite");
            document.body.appendChild(_resizeHintEl);
            return _resizeHintEl;
        }

        function _inclusiveEndDateForDisplay(start, duration) {
            const dur = Math.max(1, parseInt(duration, 10) || 1);
            let s = start;
            if (!(s instanceof Date)) {
                s = gantt.date.str_to_date("%Y-%m-%d")(String(s).substring(0, 10));
            }
            const d = gantt.calculateEndDate(s, dur);
            d.setDate(d.getDate() - 1);
            return d;
        }

        /** ドラッグ開始時点（original）と比較し、左ハンドル＝開始日変更 / 右ハンドル＝終了日（包含）変更 */
        function _resizeEdgeFromOriginal(task, original) {
            if (original && original.start_date != null && task && task.start_date != null) {
                const o0 = original.start_date instanceof Date
                    ? original.start_date
                    : gantt.date.str_to_date("%Y-%m-%d")(String(original.start_date).substring(0, 10));
                const t0 = task.start_date instanceof Date
                    ? task.start_date
                    : gantt.date.str_to_date("%Y-%m-%d")(String(task.start_date).substring(0, 10));
                if (o0.getTime() !== t0.getTime()) return "start";
                return "end";
            }
            if (_dragOldState && task && task.start_date != null) {
                if (_dragOldState.start_date !== dateToDb(task.start_date)) return "start";
                return "end";
            }
            return "end";
        }

        function hideGanttResizeFeedback() {
            _resizeFeedbackActive = false;
            if (_factoryStarsDragRaf) {
                cancelAnimationFrame(_factoryStarsDragRaf);
                _factoryStarsDragRaf = null;
            }
            if (_resizeHintEl) {
                _resizeHintEl.style.display = "none";
                _resizeHintEl.textContent = "";
            }
            if (_resizeGuideEl && _resizeGuideEl.parentNode) {
                _resizeGuideEl.parentNode.removeChild(_resizeGuideEl);
            }
            _resizeGuideEl = null;
            if (_resizeActiveLineEl) {
                _resizeActiveLineEl.classList.remove("gantt-task-resize-active");
                _resizeActiveLineEl = null;
            }
            _resizeActiveEdge = null;
            const gh = document.getElementById("gantt_here");
            if (gh) gh.classList.remove("gantt-resize-in-progress");
        }

        function updateGanttResizeFeedback(id, task, mode, dragEvent, original) {
            if (!_resizeFeedbackActive || mode !== gantt.config.drag_mode.resize || !task) return;

            const gh = document.getElementById("gantt_here");
            if (gh) gh.classList.add("gantt-resize-in-progress");

            const lineEl = (typeof gantt.getTaskNode === "function" && gantt.getTaskNode(id))
                || document.querySelector('#gantt_here .gantt_task_line[task_id="' + id + '"]')
                || document.querySelector('#gantt_here .gantt_task_line[data-task-id="' + id + '"]');
            if (lineEl && lineEl !== _resizeActiveLineEl) {
                if (_resizeActiveLineEl) _resizeActiveLineEl.classList.remove("gantt-task-resize-active");
                _resizeActiveLineEl = lineEl;
                _resizeActiveLineEl.classList.add("gantt-task-resize-active");
            }

            const dur = Math.max(1, parseInt(task.duration, 10) || 1);
            const edge = _resizeActiveEdge || _resizeEdgeFromOriginal(task, original);
            const endIncl = _inclusiveEndDateForDisplay(task.start_date, dur);
            let startDisp = task.start_date;
            if (startDisp && !(startDisp instanceof Date)) {
                startDisp = gantt.date.str_to_date("%Y-%m-%d")(String(startDisp).substring(0, 10));
            }
            const hint = _getGanttResizeHintEl();
            hint.textContent = edge === "start"
                ? dateToDisplay(startDisp)
                : dateToDisplay(endIncl);
            hint.style.display = "block";

            const pad = 6;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const offX = 14;
            const offY = 12;
            hint.style.visibility = "hidden";
            const tw = hint.offsetWidth || 1;
            const th = hint.offsetHeight || 24;
            hint.style.visibility = "";

            let left;
            let top;
            if (dragEvent && typeof dragEvent.clientX === "number" && typeof dragEvent.clientY === "number") {
                const cx = dragEvent.clientX;
                const cy = dragEvent.clientY;
                if (edge === "start") {
                    left = cx - tw - offX;
                    top = cy - th - offY;
                    if (left < pad) {
                        left = cx + offX;
                    }
                } else {
                    left = cx + offX;
                    top = cy - th - offY;
                    if (left + tw + pad > vw) {
                        left = cx - tw - offX;
                    }
                }
                if (top < pad) {
                    top = cy + offY;
                }
                if (left < pad) {
                    left = pad;
                }
                if (left + tw + pad > vw) {
                    left = vw - tw - pad;
                }
                if (top + th + pad > vh) {
                    top = vh - th - pad;
                }
            } else {
                const rowForHint = lineEl || _resizeActiveLineEl;
                if (rowForHint) {
                    const rowRect = rowForHint.getBoundingClientRect();
                    top = rowRect.top - pad - th;
                    if (top < pad) {
                        top = rowRect.bottom + pad;
                    }
                    left = rowRect.left + rowRect.width / 2 - tw / 2;
                } else {
                    left = pad;
                    top = pad;
                }
                left = Math.max(pad, Math.min(left, vw - tw - pad));
                top = Math.max(pad, Math.min(top, vh - th - pad));
            }
            hint.style.left = left + "px";
            hint.style.top = top + "px";

            const dataArea = document.querySelector(".gantt_data_area");
            if (dataArea) {
                if (!_resizeGuideEl) {
                    _resizeGuideEl = document.createElement("div");
                    _resizeGuideEl.className = "gantt-resize-guide";
                    dataArea.appendChild(_resizeGuideEl);
                }
                let pos;
                try {
                    pos = gantt.getTaskPosition(id, task.start_date, gantt.calculateEndDate(task.start_date, task.duration));
                } catch (err) {
                    try {
                        pos = gantt.getTaskPosition(task, task.start_date, gantt.calculateEndDate(task.start_date, task.duration));
                    } catch (err2) {
                        pos = null;
                    }
                }
                if (pos && pos.width >= 0) {
                    const x = edge === "start" ? pos.left : (pos.left + pos.width - 1);
                    const fullH = dataArea.clientHeight || pos.height || 400;
                    _resizeGuideEl.style.display = "block";
                    _resizeGuideEl.style.left = x + "px";
                    _resizeGuideEl.style.top = "0";
                    _resizeGuideEl.style.height = fullH + "px";
                }
            }

            if (task.text === "工場出荷" && typeof renderFactoryShipmentStars === "function") {
                if (!_factoryStarsDragRaf) {
                    _factoryStarsDragRaf = requestAnimationFrame(function() {
                        _factoryStarsDragRaf = null;
                        renderFactoryShipmentStars();
                    });
                }
            }
        }

        gantt.attachEvent("onBeforeTaskDrag", function(id, mode, e) {
            const task = gantt.getTask(id);
            _resizeFeedbackActive = false;
            _resizeActiveEdge = null;
            // 見出し行（仮想タスク）は期間リサイズ不可
            if (task.$virtual && mode === gantt.config.drag_mode.resize) return false;
            // 工場出荷は複数日出荷に対応するため期間リサイズを許可する
            const milestones = ["外観検査", "客先立会", "出荷確認会議"];
            if (milestones.includes(task.text) && mode === gantt.config.drag_mode.resize) {
                return false; // リサイズ操作をキャンセル
            }
            // ドラッグ開始時の旧状態を保存
            _dragOldState = {
                start_date: dateToDb(task.start_date),
                duration: task.duration
            };
            if (mode === gantt.config.drag_mode.resize) {
                _resizeFeedbackActive = true;
                if (e && e.target && typeof e.target.closest === "function") {
                    const h = e.target.closest(".gantt_task_drag");
                    if (h) {
                        const bind = h.getAttribute("data-bind-property");
                        if (bind === "start_date" || h.classList.contains("task_left")) {
                            _resizeActiveEdge = "start";
                        } else if (bind === "end_date" || bind === "duration" || h.classList.contains("task_right")) {
                            _resizeActiveEdge = "end";
                        }
                    }
                }
            }
            return true;
        });

        gantt.attachEvent("onTaskDrag", function(id, mode, task, original, e) {
            if (!_resizeFeedbackActive || mode !== gantt.config.drag_mode.resize) return;
            const t = gantt.getTask(id);
            if (!t || t.$virtual) return;
            updateGanttResizeFeedback(id, t, mode, e, original);
        });

        // ドラッグ終了時に履歴を記録
        gantt.attachEvent("onAfterTaskDrag", async function(id, mode, e) {
            hideGanttResizeFeedback();
            if (typeof renderFactoryShipmentStars === "function") renderFactoryShipmentStars();

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
        });

        // 保存失敗モーダル表示
        function _showSaveStatus(state, detail) {
            if (state === 'error') {
                const msg = document.getElementById('save-error-modal-msg');
                if (msg) msg.textContent = (detail || '') + ' の保存に失敗しました。';
                const overlay = document.getElementById('save-error-modal-overlay');
                if (overlay) overlay.classList.add('visible');
            }
        }

        // 編集内容をデータベースに保存（バックグラウンド・UIブロックなし）
        gantt.attachEvent("onAfterTaskUpdate", function(id, item) {
            if (item.$virtual) return; // 見出し行は仮想的なものなので保存対象外
            if (item.$design_trip) return; // 設計・組立工程表由来の出張タスクは読み取り専用

            const realId = item.original_id || id;

            // 変更前のデータを取得（allTasks はまだ旧データ）
            const oldTask = (window.allTasks || []).find(t => String(t.id) === String(realId));

            // onBeforeLightboxSave でキャプチャした値があればそれを優先（map_to タイミング問題の対策）
            // ※ 同一保存で onAfterTaskUpdate が2回発火するため、ここではクリアしない
            // （_tripLightboxCapture は次の onBeforeLightboxSave で自動的にリセットされる）
            const _captured = (_tripLightboxCapture && _tripLightboxCapture.id === String(realId))
                ? _tripLightboxCapture : null;

            const updateData = Object.assign({
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                end_date: inclusiveEndDateToDb(item.start_date, item.duration),
                owner: item.owner,
                project_number: item.project_number,
                customer_name: (_captured && _captured.customer_name !== null)
                    ? _captured.customer_name
                    : (item.customer_name ?? ""),
                project_details: (_captured && _captured.project_details !== null)
                    ? _captured.project_details
                    : (item.project_details ?? ""),
                machine: item.machine,
                unit: item.unit,
                major_item: item.major_item,
                parent: item.parent_name,
                area_group: item.area_group || "",
                area_number: item.area_number || "",
                is_business_trip: currentDisplayMode === 'business_trip' ? true : (item.is_business_trip || false),
                main_owner: item.main_owner || ""
            }, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {});
            if (currentDisplayMode === 'business_trip') {
                updateData.task_type = 'business_trip';
            }

            console.log("Sending to Supabase (Update):", updateData, "Real ID:", realId);

            // window.allTasks をローカルで即時更新（次の編集での差分検出に使用）
            if (window.allTasks) {
                const _idx = window.allTasks.findIndex(t => String(t.id) === String(realId));
                if (_idx !== -1) {
                    window.allTasks[_idx] = Object.assign({}, window.allTasks[_idx], updateData, { parent_name: item.parent_name });
                }
            }

            _showSaveStatus('saving');

            // バックグラウンドで保存（fetchTasks不要・UIをブロックしない）
            supabaseClient.from('tasks').update(updateData).eq('id', realId)
                .then(function(_ref) {
                    var taskError = _ref.error;
                    if (taskError) {
                        console.error("Update error:", taskError);
                        // allTasks を元に戻す
                        if (oldTask && window.allTasks) {
                            const _ri = window.allTasks.findIndex(t => String(t.id) === String(realId));
                            if (_ri !== -1) window.allTasks[_ri] = oldTask;
                        }
                        // ガントチャートのタスクを元の値に戻す
                        if (oldTask && gantt.isTaskExists(id)) {
                            try {
                                Object.assign(gantt.getTask(id), {
                                    text: oldTask.text,
                                    start_date: oldTask.start_date instanceof Date ? oldTask.start_date : new Date(oldTask.start_date),
                                    duration: oldTask.duration,
                                    owner: oldTask.owner,
                                    project_number: oldTask.project_number,
                                    customer_name: oldTask.customer_name,
                                    project_details: oldTask.project_details,
                                    machine: oldTask.machine,
                                    unit: oldTask.unit,
                                    major_item: oldTask.major_item,
                                    area_group: oldTask.area_group,
                                    area_number: oldTask.area_number,
                                    is_business_trip: oldTask.is_business_trip,
                                    main_owner: oldTask.main_owner,
                                    parent_name: oldTask.parent_name
                                });
                                gantt.refreshTask(id);
                            } catch(e) {}
                        }
                        var _errDetail = [item.project_number, item.machine, item.text].filter(Boolean).join(' ');
                        _showSaveStatus('error', _errDetail);
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
                    }

                    _showSaveStatus('success');
                });
        });

        // 保存ボタンが押された瞬間に実行されるイベント
        gantt.attachEvent("onLightboxSave", function(id, item) {
            // 新規タスク判定を同期的に取得（非同期処理が始まる前に確定させる）
            // _is_new_task フラグで判定（IDのallTasks比較はDHTMLXのtemp IDと既存IDが衝突するため不使用）
            const _taskObj = gantt.isTaskExists(id) ? gantt.getTask(id) : null;
            if (_taskObj && _taskObj.$design_trip) return; // 設計・組立工程表由来の出張タスクは読み取り専用
            const isNewTask = !!(_taskObj && _taskObj._is_new_task);

            (async () => {
                try {
                    if (!isNewTask && typeof window.persistTaskLocations === "function") {
                        // 組立場所の保存中だけローディングを表示
                        showLoading();
                        const realIdForLoc = (_taskObj && _taskObj.original_id) || (item && item.original_id) || id;
                        const ok = await window.persistTaskLocations(realIdForLoc, item.locations);
                        hideLoading();
                        if (!ok) return;
                    }

                    if (!isNewTask) {
                        // onAfterTaskUpdate がバックグラウンドで Supabase に保存する（fetchTasks不要）
                        gantt.updateTask(id);
                    }
                    // 新規タスクは onAfterTaskAdd が Supabase 保存・changeTaskId・fetchTasks をすべて担う
                } catch (e) {
                    console.error("Lightbox save error:", e);
                    hideLoading();
                }
            })();

            // 最後に必ず true を返してライトボックスを閉じる
            return true;
        });

        // タスクの削除をデータベースに反映
        gantt.attachEvent("onAfterTaskDelete", async function(id, item) {
            if (item.$virtual) return; // 仮想的な見出し行は削除対象外
            showLoading();

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
                hideLoading();
            } else {
                await fetchTasks();
                hideLoading();
            }
        });

        // ＋ボタンの挙動をカスタマイズ（親の情報を引き継ぐ）
        gantt.attachEvent("onTaskCreated", function(task){
            // 新規タスクであることをフラグで記録（onLightboxSaveで新規/既存を確実に判別するため）
            task._is_new_task = true;
            // + を押した行の直下に挿入するための情報を記録
            task._insertAfterId = _pendingInsertAfterId;
            _pendingInsertAfterId = null;
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
            if (typeof gantt.deleteMarker === 'function') {
                gantt.deleteMarker("today_marker");
            }
            if (typeof gantt.addMarker === 'function') {
                gantt.addMarker({
                    id: "today_marker",
                    start_date: new Date(),
                    css: "today-line",
                    text: ""
                });
            }
        }

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
            // 出張タスク（$design_trip フラグ）は部署ごとの色を適用
            if (task.$design_trip) {
                const deptColorMap = {
                    '設計': 'task-blue', '製管': 'task-green', '品証': 'task-green',
                    '組立': 'task-yellow', '電装': 'task-purple', '操業': 'task-red',
                    '電技': 'task-teal', '明石': 'task-brown', '営業': 'task-orange'
                };
                return deptColorMap[task.major_item] || 'task-blue';
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
            if (task.text === "工場出荷") return css + "milestone-factory-ship";
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
            if (completedProjects.some(cp => cp.project_number === taskPNum)) {
                // 出張モードで期限内の出張タスクは完了済み工番でも表示する
                if (currentDisplayMode === 'business_trip'
                    && _isBusinessTripTaskRow(task)
                    && !_isTripTaskExpired(task)) {
                    // 通過（return false しない）
                } else {
                    return false;
                }
            }

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
        let _rowDragging = false;

        /** 工場出荷：duration 日数ぶん、各日の列の中央に ★ を重ね描画 */
        function renderFactoryShipmentStars() {
            document.querySelectorAll('.factory-shipment-star-mark').forEach(function(el) { el.remove(); });
            const container = document.querySelector('.gantt_data_area');
            if (!container) return;

            gantt.eachTask(function(task) {
                if (task.text !== "工場出荷") return;
                try { if (!gantt.isTaskVisible(task.id)) return; } catch (e) { return; }
                if (!task.start_date) return;

                let start = task.start_date;
                if (!(start instanceof Date)) {
                    start = gantt.date.str_to_date("%Y-%m-%d")(String(start).substring(0, 10));
                }
                const dur = Math.max(1, parseInt(task.duration, 10) || 1);

                for (let i = 0; i < dur; i++) {
                    const segStart = gantt.date.add(start, i, "day");
                    const segEnd = gantt.date.add(segStart, 1, "day");
                    let pos;
                    try {
                        pos = gantt.getTaskPosition(task.id, segStart, segEnd);
                    } catch (err) {
                        try {
                            pos = gantt.getTaskPosition(task, segStart, segEnd);
                        } catch (err2) {
                            continue;
                        }
                    }
                    if (!pos || pos.width < 0.5) continue;

                    const el = document.createElement("div");
                    el.className = "factory-shipment-star-mark";
                    el.setAttribute("aria-hidden", "true");
                    el.textContent = "\u2605";
                    el.style.left = (pos.left + pos.width / 2) + "px";
                    el.style.top = (pos.top + pos.height / 2) + "px";
                    container.appendChild(el);
                }
            });
        }

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

        // ガント再描画のたびにマークを再配置（行ドラッグ中はスキップして描画コスト削減）
        gantt.attachEvent("onGanttRender", function() {
            if (_rowDragging) return;
            renderPartsMarks();
            renderFactoryShipmentStars();
            if (typeof window._updateShanaiEmptyNotice === "function") window._updateShanaiEmptyNotice();
            if (typeof window._layoutGanttEmptyNoticeOverGrid === "function") window._layoutGanttEmptyNoticeOverGrid();
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
                renderFactoryShipmentStars();
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
                    .update(Object.assign({
                        start_date: dateStr,
                        end_date: inclusiveEndDateToDb(gantt.date.str_to_date("%Y-%m-%d")(dateStr), dur)
                    }, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {}))
                    .eq('id', state.taskId);
                if (typeof window.markLocalTaskMutation === 'function') window.markLocalTaskMutation(state.taskId);
            }
            renderPartsMarks();
            renderFactoryShipmentStars();
        });
        // ========== 神戸送り開始日マーク ここまで ==========

        gantt.config.readonly = true; // デフォルトは読み取り専用、ログイン後に解除
        if (typeof gantt.plugins === 'function') {
            gantt.plugins({ marker: true, grouplist: true, inline_editors: true, dnd: true });
        }
        gantt.init("gantt_here");
        updateTodayMarker();
        gantt.render();

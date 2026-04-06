        gantt.attachEvent("onLightboxChange", function(id, name, value) {
            if (name === "major_item") {
                const task = gantt.getTask(id);
                task.major_item = value;
                _refreshOwnerCheckboxes(value);
            }
        });

        // onLightboxReady で部署 select に直接 change リスナーを付ける（onLightboxChange が発火しない場合の保険）
        gantt.attachEvent("onLightboxReady", function() {
            setTimeout(function() {
                const lightbox = document.querySelector(".gantt_cal_light");
                if (!lightbox) return;
                // 部署プルダウンは majorItemOptions の値（"営業"等）を持つ select
                const selects = lightbox.querySelectorAll("select");
                let majorSelect = null;
                selects.forEach(function(sel) {
                    const vals = Array.from(sel.options).map(function(o) { return o.value; });
                    if (vals.includes("営業") || vals.includes("設計") || vals.includes("組立")) {
                        majorSelect = sel;
                    }
                });
                if (!majorSelect) return;
                majorSelect.addEventListener("change", function() {
                    _refreshOwnerCheckboxes(this.value);
                });
            }, 80);
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
                if (obj.$virtual && (obj.text === "長納期品手配" || obj.text === "出図＆部品手配")) {
                    return `<button class='zoom-btn' style='padding: 2px 5px; font-size: 12px; cursor: pointer;' onclick='openDetail("${obj.id}")'>🔍</button>`;
                }
                return "";
            }},
            { name: "project_number", label: "工番", width: COLUMN_WIDTHS[1], align: "left", template: function(obj) {
                return obj.project_number || "";
            }},
            { name: "checkbox", label: "", width: COLUMN_WIDTHS[2], align: "left", template: function(obj) {
                if (obj.$virtual) return "";
                const isChecked = taskCheckboxes[obj.id] ? "checked" : "";
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
                    return owners.map(function(o) { return o === main ? "<span style='color: blue;'>" + o + "</span>" : o; }).join(', ');
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
        gantt.config.indent = 6;
        gantt.config.grid_width = 600;
        gantt.config.grid_resize = false;
        gantt.config.drag_resize = true;
        gantt.config.row_height = 27;
        gantt.config.bar_height = 21; // バーを太く (18 -> 21)
        gantt.config.scale_height = 66;
        gantt.config.min_column_width = 22;
        gantt.config.open_tree_initially = false;
        gantt.config.order_branch = true;
        gantt.config.order_branch_free = true;

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
            const newTaskData = {
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                owner: item.owner || "",
                project_number: item.project_number || "",
                customer_name: item.customer_name || "",
                project_details: item.project_details || "",
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
                gantt.changeTaskId(id, newId);
                console.log("New task added with ID:", newId);

                // 組立場所の保存（もしあれば）
                if (item.locations && item.locations.length > 0) {
                    const locationRecords = item.locations.map(loc => ({
                        task_id: newId,
                        area_group: loc.area_group,
                        area_number: loc.area_number
                    }));
                    await supabaseClient.from('task_locations').insert(locationRecords);
                }

                // 変更履歴を記録
                if (typeof window.logChange === 'function') {
                    window.logChange(item.project_number || '', item.machine || '', item.unit || '', item.text || '', 'タスクを追加しました');
                }

                // 画面を最新状態に更新
                await fetchTasks();
            }
        });

        // マイルストーンタスクのリサイズ（期間変更）を防ぐ
        gantt.attachEvent("onBeforeTaskDrag", function(id, mode, e) {
            const task = gantt.getTask(id);
            const milestones = ["外観検査", "客先立会", "出荷確認会議", "工場出荷"];
            if (milestones.includes(task.text) && mode === gantt.config.drag_mode.resize) {
                return false; // リサイズ操作をキャンセル
            }
            return true;
        });

        // 編集内容をデータベースに保存
        gantt.attachEvent("onAfterTaskUpdate", async function(id, item) {
            if (item.$virtual) return; // 見出し行は仮想的なものなので保存対象外

            const realId = item.original_id || id;

            // 変更前のデータを取得（fetchTasks前なのでallTasksはまだ旧データ）
            const oldTask = (window.allTasks || []).find(t => String(t.id) === String(realId));

            const updateData = {
                text: item.text,
                start_date: dateToDb(item.start_date),
                duration: item.duration,
                owner: item.owner,
                project_number: item.project_number,
                customer_name: item.customer_name || "",
                project_details: item.project_details || "",
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
                // is_new_task: false // データベースにカラムがない可能性があるため一時的にコメントアウト
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

            // 変更履歴を記録
            if (oldTask && typeof window.logChange === 'function') {
                const newStartDb = dateToDb(item.start_date);
                const oldStartDb = (oldTask.start_date instanceof Date)
                    ? dateToDb(oldTask.start_date)
                    : (oldTask.start_date || '').substring(0, 10);
                const changes = [];
                if ((oldTask.text || '') !== (item.text || '')) changes.push('タスク名を変更しました');
                const startChanged = oldStartDb !== newStartDb;
                const durChanged = Number(oldTask.duration) !== Number(item.duration);
                if (startChanged && durChanged) changes.push('開始日・終了日を変更しました');
                else if (startChanged) changes.push('開始日を変更しました');
                else if (durChanged) changes.push('終了日を変更しました');
                if ((oldTask.owner || '') !== (item.owner || '')) changes.push('担当者を変更しました');
                if ((oldTask.machine || '') !== (item.machine || '')) changes.push('機械を変更しました');
                if ((oldTask.unit || '') !== (item.unit || '')) changes.push('ユニットを変更しました');
                if (changes.length > 0) {
                    window.logChange(item.project_number, item.machine, item.unit, item.text, changes.join('・'));
                }
            }

            // 成功したらデータを再取得して allTasks と画面を更新
            await fetchTasks();
        });

        // 保存ボタンが押された瞬間に実行されるイベント
        // ※ async を付与して Supabase への保存を待機可能にする
        gantt.attachEvent("onLightboxSave", function(id, item) {
            // async関数を即時実行して保存処理を行う
            (async () => {
                try {
                    // ① ライトボックスから最新のチェック状態を取得
                    const locSection = gantt.getLightboxSection("locations");
                    if (locSection && locSection.control) {
                        // カスタムコントロールの場合、gantt.form_blocks を経由して get_value を呼ぶ
                        gantt.form_blocks["location_selector"].get_value(locSection.control, item);
                    }

                    console.log("Saving locations for task:", id, item._selected_locations);

                    // ② Supabase への保存処理（組立場所）
                    // 既存データを削除
                    const { error: deleteError } = await supabaseClient
                        .from('task_locations')
                        .delete()
                        .eq('task_id', id);
                    
                    if (deleteError) {
                        console.error("Delete error for task_locations:", deleteError);
                    }

                    // 新規データを登録
                    const currentLocations = [];
                    if (item._selected_locations && item._selected_locations.length > 0) {
                        item._selected_locations.forEach(loc => {
                            currentLocations.push({
                                task_id: id,
                                area_group: loc.group,
                                area_number: loc.num
                            });
                        });
                    } else if (item.area_group && item.area_number) {
                        // フォールバック：_selected_locations がない場合は従来のカンマ区切りから生成
                        const nums = item.area_number.split(",");
                        nums.forEach(num => {
                            currentLocations.push({
                                task_id: id,
                                area_group: item.area_group,
                                area_number: num.trim()
                            });
                        });
                    }

                    if (currentLocations.length > 0) {
                        console.log("Inserting location records:", currentLocations);
                        const { error: insertError } = await supabaseClient
                            .from('task_locations')
                            .insert(currentLocations);
                        
                        if (insertError) {
                            console.error("Insert error for task_locations:", insertError);
                        }
                    }

                    // tasks テーブルを更新
                    const { error: taskUpdateError } = await supabaseClient
                        .from('tasks')
                        .update({ 
                            area_group: item.area_group || "", 
                            area_number: item.area_number || "" 
                        })
                        .eq('id', id);
                    
                    if (taskUpdateError) {
                        console.error("Task update error:", taskUpdateError);
                    }

                    console.log("Locations saved successfully");
                    
                    // データ保存後にガントチャートを更新して、内部データを最新にする
                    gantt.updateTask(id);
                    
                    // 画面を最新状態に更新
                    await fetchTasks();
                    
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
            const { error } = await supabaseClient
                .from('tasks')
                .delete()
                .eq('id', realId);

            if (error) {
                console.error("Delete error:", error);
                alert("削除に失敗しました。");
            } else {
                // 変更履歴を記録
                if (typeof window.logChange === 'function') {
                    window.logChange(item.project_number || '', item.machine || '', item.unit || '', item.text || '', 'タスクを削除しました');
                }
                // 成功したらデータを再取得して allTasks と画面を更新
                await fetchTasks();
            }
        });

        // ＋ボタンの挙動をカスタマイズ（親の情報を引き継ぐ）
        gantt.attachEvent("onTaskCreated", function(task){
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
            return true;
        });

        gantt.templates.grid_row_class = function(start, end, task){
            let css = "";

            if (task.$virtual) {
                // 見出し行：子タスクがすべてチェック済みならグレーアウト
                const children = gantt.getChildren(task.id);
                if (children.length > 0 && children.every(cid => taskCheckboxes[cid])) {
                    css += " task-checked";
                }
            } else {
                // チェックボックスの状態を確認
                if (taskCheckboxes[task.id]) {
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

            let html = `<span class="task-name-text">${taskName || ""}</span>`;
            return html;
        };

        gantt.templates.task_class = function(start, end, task) {
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
            if (currentMajorFilter && currentResourceDeptFilter && currentMajorFilter === currentResourceDeptFilter) {
                // フィルタ対象の部署と一致する場合のみ担当者ごとの色を適用
                if (task.major_item === currentMajorFilter) {
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
                { name: "days", scale_height: 66, min_column_width: 22, scales: [
                    { unit: "month", step: 1, format: "%Y/%n", css: () => "month-end-cell" },
                    { unit: "day", step: 1, format: "%j", css: (date) => { const ds = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); const isHol = holidaySet.has(ds) && date.getDay()!==0; return (isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEndDate(date) ? " month-end-cell" : "") + (date.getDay() === 0 ? " scale_sunday" : isHol ? " scale_holiday" : date.getDay() === 6 ? " scale_saturday" : ""); } },
                    { unit: "day", step: 1, format: (date) => dayNames[date.getDay()], css: (date) => { const ds = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); const isHol = holidaySet.has(ds) && date.getDay()!==0; return (isWeekendOrHoliday(date) ? "weekend" : "") + (isMonthEndDate(date) ? " month-end-cell" : "") + (date.getDay() === 0 ? " scale_sunday" : isHol ? " scale_holiday" : date.getDay() === 6 ? " scale_saturday" : ""); } }
                ]},
                { name: "weeks", scale_height: 66, min_column_width: 22, scales: [
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
                if (!taskProjectNumber || !taskProjectNumber.includes(currentFilter)) return false;
            }

            // 2b. 工事番号グループフィルター (AND条件)
            if (currentProjectGroupFilter && currentProjectGroupFilter !== 'all') {
                const pNum = (task.project_number || task.project_no || '').toString();
                if (currentProjectGroupFilter === '2000' && !/^2/.test(pNum)) return false;
                if (currentProjectGroupFilter === 'other' && /^2/.test(pNum)) return false;
            }

            // 3. 部署フィルター (AND条件)
            if (currentMajorFilter) {
                if (task.major_item !== currentMajorFilter) return false;
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
            // 仮想親行（工事番号行）の場合は、その配下に「表示対象となるタスク」が1つでもあるかチェック
            if (task.$virtual) {
                const children = gantt.getChildren(id);
                if (children.length > 0) {
                    // 子タスクのいずれかが表示対象なら親も表示
                    const hasVisibleChild = children.some(childId => {
                        const child = gantt.getTask(childId);
                        return isTaskVisible(child);
                    });
                    if (hasVisibleChild) return true;
                }
                // 子がいない、または表示対象の子がいない仮想親は常に非表示
                return false;
            }

            // 通常のタスク（子タスク）の表示判定
            return isTaskVisible(task);
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
            if (typeof updateStickyBarText === 'function') updateStickyBarText();
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
                // Supabaseに保存
                await supabaseClient.from('tasks')
                    .update({ start_date: dateStr })
                    .eq('id', state.taskId);
            }
            renderPartsMarks();
        });
        // ========== 神戸送り開始日マーク ここまで ==========

        gantt.config.readonly = true; // デフォルトは読み取り専用、ログイン後に解除
        gantt.init("gantt_here");

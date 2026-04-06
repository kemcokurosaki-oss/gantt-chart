        async function fetchTasks() {
            // スクロール位置を記憶
            const scrollPos = gantt.getScrollState();

            let data, locData;

            if (!_isEditor) {
                // 閲覧者: 公開スナップショットから読み込む
                const { data: snap, error: snapErr } = await supabaseClient
                    .from('app_settings')
                    .select('key, value')
                    .in('key', ['published_tasks', 'published_locs']);

                if (!snapErr && snap && snap.length > 0) {
                    const tasksEntry = snap.find(s => s.key === 'published_tasks');
                    const locsEntry  = snap.find(s => s.key === 'published_locs');
                    data    = tasksEntry ? JSON.parse(tasksEntry.value) : null;
                    locData = locsEntry  ? JSON.parse(locsEntry.value)  : [];
                }

                // スナップショットがまだない場合はライブデータにフォールバック
                if (!data) {
                    const sortColumn = currentDisplayMode === 'machine' ? 'sort_order_machine' : 'sort_order';
                    const { data: liveData, error } = await supabaseClient.from('tasks').select('*').order(sortColumn, { ascending: true });
                    if (error) return;
                    data = liveData;
                    const { data: liveLoc } = await supabaseClient.from('task_locations').select('*');
                    locData = liveLoc || [];
                }
            } else {
                // 編集者: ライブデータから読み込む
                const sortColumn = currentDisplayMode === 'machine' ? 'sort_order_machine' : 'sort_order';
                const { data: liveData, error } = await supabaseClient.from('tasks').select('*').order(sortColumn, { ascending: true });
                if (error) return;
                data = liveData;
                const { data: liveLoc } = await supabaseClient.from('task_locations').select('*');
                locData = liveLoc || [];
            }

            // task_locations データを取得してマッピング
            const locMap = {};
            if (locData) {
                locData.forEach(loc => {
                    if (!locMap[loc.task_id]) {
                        locMap[loc.task_id] = { area_group: loc.area_group, area_numbers: [] };
                    }
                    locMap[loc.task_id].area_number = loc.area_number; // 単一の値として保持（既存ロジックに合わせる）
                    if (!locMap[loc.task_id].area_numbers) locMap[loc.task_id].area_numbers = [];
                    locMap[loc.task_id].area_numbers.push(loc.area_number);
                });
            }

            const MILESTONE_TEXTS = ["外観検査", "客先立会", "出荷確認会議", "工場出荷"];

            const rawTasks = data.map(t => {
                let areaGroup = t.area_group;
                let areaNumber = t.area_number;

                if (locMap[t.id]) {
                    areaGroup = locMap[t.id].area_group;
                    areaNumber = locMap[t.id].area_numbers.join(",");
                }

                // マイルストーンタスクは常に1日に固定
                const isMilestone = MILESTONE_TEXTS.includes(t.text);

                return {
                    id: t.id, text: t.text, start_date: t.start_date,
                    duration: isMilestone ? 1 : t.duration, owner: t.owner, project_number: (t.project_number || "").toString().trim(),
                    machine: t.machine, unit: t.unit, major_item: t.major_item,
                    sort_order: t.sort_order,
                    sort_order_machine: t.sort_order_machine,
                    parent_name: (t.parent || "").toString().trim(),
                    customer_name: t.customer_name || "",
                    project_details: t.project_details || "",
                    is_detailed: t.is_detailed,
                    is_business_trip: t.is_business_trip,
                    area_group: areaGroup,
                    area_number: areaNumber,
                    main_owner: t.main_owner || "",
                    is_completed: t.is_completed || false,
                    bar_color: t.bar_color || ''
                    // is_new_task: t.is_new_task // データベースにカラムがない可能性があるため一時的にコメントアウト
                };
            });

            // チェックボックスの状態をDBから復元
            rawTasks.forEach(t => {
                taskCheckboxes[t.id] = t.is_completed || false;
                if (t.bar_color) locationBarColors[t.id] = t.bar_color;
            });

            window.allTasks = rawTasks;

            const parentOrder = ["受注", "基本設計＆計画承認", "長納期品手配", "出図＆部品手配", "電気設計＆電気品手配", "盤製作", "組立全体", "外観検査", "タスクリスト作成", "試運転", "客先立会", "出荷確認会議", "出荷準備", "出荷", "現地工事"];
            const tasksWithHierarchy = [];
            const parentsMap = {};

            const getPriority = (p) => {
                if (p.startsWith('2')) return 1;
                if (p.startsWith('3')) return 2;
                if (p.startsWith('4')) return 3;
                if (p.startsWith('D')) return 4;
                return 5;
            };
            const isPureNumeric = (s) => /^\d+$/.test(s);

            const projects = [...new Set(rawTasks.map(t => t.project_number))]
                .filter(Boolean)
                .sort((a, b) => {
                    const priA = getPriority(a);
                    const priB = getPriority(b);
                    if (priA !== priB) return priA - priB;
                    const numA = isPureNumeric(a);
                    const numB = isPureNumeric(b);
                    if (numA && !numB) return -1;
                    if (!numA && numB) return 1;
                    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                });

            if (currentDisplayMode === 'machine') {
                projects.forEach(pNum => {
                    if (currentFilter && pNum !== currentFilter) return;
                    if (currentProjectGroupFilter === '2000' && !/^2/.test(pNum)) return;
                    if (currentProjectGroupFilter === 'other' && /^2/.test(pNum)) return;
                    const projectTasks = rawTasks.filter(t => {
                        if (t.project_number !== pNum) return false;
                        const val = t.is_business_trip;
                        return !(val === true || val === 'true' || val === 'TRUE');
                    });
                    const machinesSet = new Set();
                    projectTasks.forEach(t => {
                        const mStr = t.machine || "設定なし";
                        mStr.split(",").forEach(m => {
                            const trimmed = m.trim();
                            if (trimmed) machinesSet.add(trimmed);
                            else machinesSet.add("設定なし");
                        });
                    });
                    const machines = Array.from(machinesSet).sort();
                    
                    machines.forEach(mName => {
                        const tasksInMachine = projectTasks.filter(t => {
                            const mStr = t.machine || "設定なし";
                            const mList = mStr.split(",").map(m => m.trim());
                            return mList.includes(mName) || (mName === "設定なし" && mList.includes(""));
                        });

                        if (tasksInMachine.length > 0) {
                            const parentKey = `p_${pNum}_m_${mName}`;
                            let minStart = null;
                            let maxEnd = null;
                            tasksInMachine.forEach(t => {
                                const start = new Date(t.start_date);
                                const end = gantt.calculateEndDate(start, t.duration);
                                if (!minStart || start < minStart) minStart = start;
                                if (!maxEnd || end > maxEnd) maxEnd = end;
                            });
                            
                            if (!parentsMap[parentKey]) {
                                
                                parentsMap[parentKey] = {
                                    id: parentKey,
                                    text: mName === "設定なし" ? pNum : `${pNum} - ${mName}`,
                                    project_number: pNum,
                                    machine: mName === "設定なし" ? "" : mName,
                                    major_item: "",
                                    customer_name: tasksInMachine[0].customer_name,
                                    project_details: tasksInMachine[0].project_details,
                                    start_date: minStart,
                                    end_date: maxEnd,
                                    open: false,
                                    type: "project",
                                    $virtual: true
                                };
                                tasksWithHierarchy.push(parentsMap[parentKey]);
                            }
                            tasksInMachine.forEach(t => { 
                                // タスクが複数の機械に属する場合、クローンを作成して異なる親を持たせる
                                const taskClone = { ...t };
                                taskClone.id = `${t.id}_${mName}`; // IDをユニークにする
                                taskClone.original_id = t.id; // 元のIDを保持
                                taskClone.parent = parentKey; 
                                tasksWithHierarchy.push(taskClone); 
                            });
                        }
                    });
                });
            } else if (currentDisplayMode === 'business_trip') {
                // 出張予定モード：見出し行を作らず、タスクをそのまま追加する
                projects.forEach(pNum => {
                    if (currentFilter && pNum !== currentFilter) return;
                    const projectTasks = rawTasks.filter(t => {
                        if (t.project_number !== pNum) return false;
                        const val = t.is_business_trip;
                        return val === true || val === 'true' || val === 'TRUE';
                    });

                    projectTasks.forEach(t => { 
                        t.parent = 0; // 親なし（ルート）
                        tasksWithHierarchy.push(t); 
                    });
                });
            } else {
                projects.forEach(pNum => {
                    if (currentFilter && pNum !== currentFilter) return;
                    const projectTasks = rawTasks.filter(t => {
                        if (t.project_number !== pNum) return false;
                        const val = t.is_business_trip;
                        return !(val === true || val === 'true' || val === 'TRUE');
                    });
                    
                    const assignedTaskIds = new Set();
                    const taskByParent = {};
                    parentOrder.forEach(pName => {
                        taskByParent[pName] = projectTasks.filter(t => t.parent_name === pName);
                    });

                    parentOrder.forEach(pName => {
                        const tasksInParent = taskByParent[pName];
                        if (tasksInParent.length > 0) {
                            const parentKey = `p_${pNum}_${pName}`;
                            let minStart = null;
                            let maxEnd = null;

                            if (pName === "基本設計＆計画承認") {
                                const orderTasks = taskByParent["受注"];
                                const drawingTasks = taskByParent["出図＆部品手配"];

                                if (orderTasks && orderTasks.length > 0 && drawingTasks && drawingTasks.length > 0) {
                                    const orderStart = new Date(orderTasks[0].start_date);
                                    minStart = gantt.calculateEndDate(orderStart, orderTasks[0].duration);
                                    maxEnd = new Date(drawingTasks[0].start_date);
                                    const diffTime = maxEnd.getTime() - minStart.getTime();
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    tasksInParent.forEach(t => {
                                        t.start_date = minStart;
                                        t.duration = diffDays > 0 ? diffDays : 1;
                                    });
                                }
                            }

                            if (!minStart || !maxEnd) {
                                tasksInParent.forEach(t => {
                                    assignedTaskIds.add(t.id);
                                    const start = new Date(t.start_date);
                                    const end = gantt.calculateEndDate(start, t.duration);
                                    if (!minStart || start < minStart) minStart = start;
                                    if (!maxEnd || end > maxEnd) maxEnd = end;
                                });
                            } else {
                                tasksInParent.forEach(t => assignedTaskIds.add(t.id));
                            }

                            // 親タスク（見出し行）の日付を子タスクの範囲に合わせる
                            if (parentsMap[parentKey]) {
                                parentsMap[parentKey].start_date = minStart;
                                parentsMap[parentKey].end_date = maxEnd;
                            }

                            if (!parentsMap[parentKey]) {
                                parentsMap[parentKey] = {
                                    id: parentKey,
                                    text: pName,
                                    project_number: pNum,
                                    machine: tasksInParent[0].machine,
                                    major_item: tasksInParent[0].major_item,
                                    customer_name: tasksInParent[0].customer_name,
                                    project_details: tasksInParent[0].project_details,
                                    start_date: minStart,
                                    end_date: maxEnd,
                                    open: false,
                                    type: "project",
                                    $virtual: true
                                };
                                tasksWithHierarchy.push(parentsMap[parentKey]);
                            }
                            tasksInParent.forEach(t => { t.parent = parentKey; tasksWithHierarchy.push(t); });
                        }
                    });

                    const unassignedTasks = projectTasks.filter(t => !assignedTaskIds.has(t.id));
                    if (unassignedTasks.length > 0) {
                        const parentKey = `p_${pNum}_other`;
                        let minStart = null;
                        let maxEnd = null;
                        unassignedTasks.forEach(t => {
                            const start = new Date(t.start_date);
                            const end = gantt.calculateEndDate(start, t.duration);
                            if (!minStart || start < minStart) minStart = start;
                            if (!maxEnd || end > maxEnd) maxEnd = end;
                        });
                        
                        if (!parentsMap[parentKey]) {
                            parentsMap[parentKey] = {
                                id: parentKey,
                                text: "",
                                project_number: pNum,
                                machine: unassignedTasks[0].machine,
                                major_item: "",
                                customer_name: unassignedTasks[0].customer_name,
                                project_details: unassignedTasks[0].project_details,
                                start_date: minStart,
                                end_date: maxEnd,
                                open: false,
                                type: "project",
                                $virtual: true
                            };
                            tasksWithHierarchy.push(parentsMap[parentKey]);
                        }
                        unassignedTasks.forEach(t => { 
                            t.parent = parentKey; 
                            tasksWithHierarchy.push(t); 
                        });
                    }
                });
            }

            updateProjectList(rawTasks);
            gantt.clearAll();
            console.log("Parsing tasks with hierarchy:", tasksWithHierarchy.length);
            gantt.parse({ data: tasksWithHierarchy });
            
            // 今日のマーカーを更新
            if (typeof updateTodayMarker === "function") {
                updateTodayMarker();
            }
            
            // 見出し行（仮想行）の展開／折りたたみ
            gantt.eachTask(function(task) {
                if (!task.$virtual) return;
                const id = String(task.id);
                const pNum = (task.project_number || "").toString();
                const tracked = _headerOpenStates[id]; // undefined=未記録, true=開, false=閉
                if (tracked === true) {
                    gantt.open(task.id);
                } else if (tracked === false) {
                    gantt.close(task.id);
                } else {
                    // 未記録（初回）：新規作成直後の工番は開く、それ以外は閉じる
                    if (_newlyCreatedProject && pNum === String(_newlyCreatedProject)) {
                        gantt.open(task.id);
                        _headerOpenStates[id] = true;
                    } else {
                        gantt.close(task.id);
                    }
                }
            });
            _newlyCreatedProject = null; // リセット
            _ganttFirstLoad = false;

            gantt.config.start_date = new Date(GANTT_START_DATE.getTime());
            gantt.config.end_date = new Date(GANTT_END_DATE.getTime());
            gantt.render();
            
            // スクロール位置を復元
            gantt.scrollTo(scrollPos.x, scrollPos.y);
            
            if (currentResourceOwnerFilter || currentResourceDeptFilter || currentLocationResourceMode) {
                updateResourceVisibility();
            }
        }

        function scrollToToday() {
            const pos = gantt.posFromDate(new Date());
            gantt.scrollTo(pos - 200, null);
        }

        // 詳細ボタンクリック時の処理
        window.openDetail = function(id) {
            const task = gantt.getTask(id);
            const projectNo = task.project_number;
            
            if (!projectNo) {
                alert("工事番号が見つかりません");
                return;
            }

            // 設計詳細画面への遷移条件
            // 1. 機械別表示の場合
            // 2. 工程別表示で、見出し名が「出図＆部品手配」または「長納期品手配」の場合
            const isDesignDetail = (currentDisplayMode === 'machine') || (task.text === "出図＆部品手配") || (task.text === "長納期品手配");

            if (isDesignDetail) {
                let url = `https://kemcokurosaki-oss.github.io/design-schedule/?project_no=${encodeURIComponent(projectNo)}`;
                if (task.text === "長納期品手配") {
                    url += `&task_type=long_lead_item`;
                } else if (task.text === "出図＆部品手配") {
                    url += `&task_type=drawing`;
                }
                window.open(url, '_blank');
            } else {
                alert("準備中");
            }
        };

        function resetFilter() { location.reload(); }

        window.toggleTaskCheckbox = function(id, checked) {
            if (!_isEditor) return;
            taskCheckboxes[id] = checked;
            // 子タスク行を即時更新
            const rowNode = gantt.getTaskRowNode(id);
            if (rowNode) {
                if (checked) rowNode.classList.add("task-checked");
                else rowNode.classList.remove("task-checked");
            }
            // 親行（見出し行）の状態を更新
            try {
                const task = gantt.getTask(id);
                if (task && task.parent) {
                    const children = gantt.getChildren(task.parent);
                    const allChecked = children.length > 0 && children.every(cid => taskCheckboxes[cid]);
                    const parentRow = gantt.getTaskRowNode(task.parent);
                    if (parentRow) {
                        if (allChecked) parentRow.classList.add("task-checked");
                        else parentRow.classList.remove("task-checked");
                    }
                }
            } catch(e) {}
            // Supabaseへの保存はバックグラウンドで実行
            supabaseClient.from('tasks').update({ is_completed: checked }).eq('id', id)
                .then(({ error }) => { if (error) console.error("チェックボックス保存エラー:", error); });
        };

        function setDisplayMode(mode) {
            currentDisplayMode = mode;
            document.getElementById('sort_process_btn').classList.toggle('active', mode === 'process');
            document.getElementById('sort_machine_btn').classList.toggle('active', mode === 'machine');
            
            const btBtn = document.getElementById('sort_business_trip_btn');
            if (mode === 'business_trip') {
                btBtn.classList.add('active');
                btBtn.innerText = "工程表へ戻る";
            } else {
                btBtn.classList.remove('active');
                btBtn.innerText = "出張予定";
            }
            
            // 列の更新
            updateGanttColumns();
            
            // データの再読み込みと再描画
            fetchTasks();
        }

        // 出張予定ボタンのクリックハンドラ
        function handleBusinessTripBtn() {
            if (currentDisplayMode === 'business_trip') {
                setDisplayMode('process'); // 工程表へ戻る（デフォルトの工程別表示）
            } else {
                setDisplayMode('business_trip');
            }
        }


        function updateGanttColumns() {
            const scrollState = gantt.getScrollState();
            if (currentDisplayMode === 'business_trip') {
                // 出張予定：工事番号、客先名、工事名、タスク名、担当者、開始日、終了日、＋
                gantt.config.columns = [
                    { name: "project_number", label: "工事番号", width: 80, align: "center", template: function(obj) {
                        return obj.project_number || "";
                    }},
                    { name: "customer_name", label: "客先名", width: 100, align: "center", template: function(obj) {
                        return obj.customer_name || "";
                    }},
                    { name: "project_details", label: "工事名", width: 150, align: "left", template: function(obj) {
                        return obj.project_details || "";
                    }},
                    { name: "text", label: "タスク名", width: 150, tree: currentDisplayMode !== 'business_trip', template: function(obj) {
                        return obj.text;
                    }},
                    { name: "owner", label: "担当者", width: 80, align: "left", template: function(obj) {
                        if (obj.$virtual) return "";
                        if (!obj.owner || obj.owner.trim() === "") {
                            return "<span class='unassigned-warning'>⚠️</span>";
                        }
                        return obj.owner;
                    }},
                    { name: "start_date", label: "開始日", width: 110, align: "center", template: function(t) {
                        return dateToDisplay(t.start_date);
                    }},
                    { name: "end_date", label: "終了日", width: 110, align: "center", template: function(t) {
                        const d = gantt.calculateEndDate(t.start_date, t.duration);
                        d.setDate(d.getDate() - 1);
                        return dateToDisplay(d);
                    }},
                    { name: "add", label: "", width: 44 }
                ];
            } else if (currentDisplayMode === 'machine') {
                // 機械別：詳細、工事番号、チェック、機械、ユニット、タスク名、担当、開始日、終了日
                gantt.config.columns = [
                    { name: "detail", label: "", width: COLUMN_WIDTHS[0], align: "center", template: function(obj) {
                        // リンク設定済みの見出し行のみ表示
                        if (obj.$virtual && (obj.text === "長納期品手配" || obj.text === "出図＆部品手配")) {
                            return `<button class='zoom-btn' style='padding: 2px 5px; font-size: 12px; cursor: pointer;' onclick='openDetail("${obj.id}")'>🔍</button>`;
                        }
                        return "";
                    }},
                    { name: "project_number", label: "工事番号", width: COLUMN_WIDTHS[1], align: "center", template: function(obj) {
                        return obj.project_number || "";
                    }},
                    { name: "checkbox", label: "", width: COLUMN_WIDTHS[2], align: "center", template: function(obj) {
                        if (obj.$virtual) return "";
                        const isChecked = taskCheckboxes[obj.id] ? "checked" : "";
                        return `<input type='checkbox' ${isChecked} ${_isEditor ? '' : 'disabled'} onchange='toggleTaskCheckbox("${obj.id}", this.checked)'>`;
                    }},
                    { name: "machine", label: "機械", width: COLUMN_WIDTHS[4], align: "center", template: function(obj) {
                        if (obj.$virtual) return "";
                        return obj.machine || "";
                    }},
                    { name: "unit", label: "ユニット", width: COLUMN_WIDTHS[5], align: "center", template: function(obj) {
                        if (obj.$virtual) return "";
                        return obj.unit || "";
                    }},
                    { name: "text", label: "タスク名", width: COLUMN_WIDTHS[3], tree: true, template: function(obj) {
                        return obj.text;
                    }},
                    { name: "owner", label: "担当", width: COLUMN_WIDTHS[6], align: "left", template: function(obj) {
                        if (obj.$virtual) return "";
                        if (!obj.owner || obj.owner.trim() === "") {
                            return "<span class='unassigned-warning'>⚠️</span>";
                        }
                        return obj.owner;
                    }},
                    { name: "start_date", label: "開始日", width: COLUMN_WIDTHS[8], align: "center", template: function(t) {
                        return dateToDisplay(t.start_date);
                    }},
                    { name: "end_date", label: "終了日", width: COLUMN_WIDTHS[9], align: "center", template: function(t) {
                        const d = gantt.calculateEndDate(t.start_date, t.duration);
                        d.setDate(d.getDate() - 1);
                        return dateToDisplay(d);
                    }},
                    { name: "add", label: "", width: COLUMN_WIDTHS[10] }
                ];
            } else {
                // 工程別（デフォルト）：詳細、工事番号、チェック、タスク名、機械、ユニット、担当、開始日、終了日
                gantt.config.columns = SHARED_COLUMNS;
            }
            gantt.render();
            gantt.scrollTo(scrollState.x, scrollState.y);
        }

        function toggleProjectGroupDropdown(e) {
            e.stopPropagation();
            const dd = document.getElementById('project-group-dropdown');
            const btn = document.getElementById('project-group-filter-btn');
            const visible = dd.classList.toggle('visible');
            if (visible) {
                const rect = btn.getBoundingClientRect();
                dd.style.top = rect.bottom + 'px';
                dd.style.left = rect.left + 'px';
            }
        }
        document.addEventListener('click', () => {
            document.getElementById('project-group-dropdown')?.classList.remove('visible');
        });

        function setProjectGroupFilter(type, el) {
            currentProjectGroupFilter = type;
            document.querySelectorAll('.project-group-dropdown-item').forEach(d => d.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('project-group-dropdown').classList.remove('visible');
            const btn = document.getElementById('project-group-filter-btn');
            btn.classList.toggle('filtered', type !== 'all');
            if (window.allTasks) updateProjectList(window.allTasks);
            const scrollState = gantt.getScrollState();
            gantt.render();
            gantt.scrollTo(scrollState.x, scrollState.y);
        }

        function updateProjectList(tasks) {
            const listEl = document.getElementById('project_list');
            const projectInfoMap = {};
            tasks.forEach(t => {
                if (!t.project_number) return;
                if (!projectInfoMap[t.project_number]) {
                    projectInfoMap[t.project_number] = { customer: t.customer_name || "", details: t.project_details || "" };
                } else {
                    if (!projectInfoMap[t.project_number].customer && t.customer_name) projectInfoMap[t.project_number].customer = t.customer_name;
                    if (!projectInfoMap[t.project_number].details && t.project_details) projectInfoMap[t.project_number].details = t.project_details;
                }
            });
            let projects = Object.keys(projectInfoMap).sort();

            // 完了済工番をサイドバーから除外
            const completedNums = new Set(completedProjects.map(cp => cp.project_number));
            projects = projects.filter(p => !completedNums.has(p));

            // グループフィルター適用
            if (currentProjectGroupFilter === '2000') {
                projects = projects.filter(p => /^2/.test(p));
            } else if (currentProjectGroupFilter === 'other') {
                projects = projects.filter(p => !/^2/.test(p));
            }
            listEl.innerHTML = "";
            let tooltip = document.getElementById('custom_project_tooltip') || document.createElement('div');
            tooltip.id = 'custom_project_tooltip'; tooltip.className = 'custom-tooltip'; document.body.appendChild(tooltip);
            projects.forEach(p => {
                const item = document.createElement('div');
                item.className = `project-item ${currentFilter === p ? 'active' : ''}`;
                item.innerText = p;
                const info = projectInfoMap[p];
                if (info.customer || info.details) {
                    item.onmouseenter = (e) => {
                        tooltip.innerText = `${info.customer}\n${info.details}`.trim();
                        tooltip.style.display = 'block';
                        
                        // ボタンの位置を取得
                        const rect = item.getBoundingClientRect();
                        let x = rect.right + 10; // ボタンの右側に10pxの隙間
                        let y = rect.top;        // 基本はボタンの上端に合わせる
                        
                        // 画面下端で見切れる場合の調整
                        const tooltipHeight = tooltip.offsetHeight;
                        const windowHeight = window.innerHeight;
                        
                        if (y + tooltipHeight > windowHeight) {
                            // 下に見切れる場合は、吹き出しの下端が画面下から10pxの位置に来るように上げる
                            y = windowHeight - tooltipHeight - 10;
                        }
                        
                        tooltip.style.left = x + 'px';
                        tooltip.style.top = y + 'px';
                    };
                    item.onmouseleave = () => tooltip.style.display = 'none';
                }
                item.onclick = () => filterByProject(p);
                listEl.appendChild(item);
            });
        }

        function filterByProject(p) { 
            const scrollState = gantt.getScrollState();
            currentFilter = (currentFilter === p) ? null : p; 
            
            // フィルタ変更時に再描画
            gantt.render();
            
            gantt.scrollTo(scrollState.x, scrollState.y);
            if (typeof updateProjectList === 'function') {
                updateProjectList(window.allTasks); 
            }
        }
        function filterByMajorItem(major, btn) { 
            const scrollState = gantt.getScrollState();
            currentMajorFilter = (currentMajorFilter === major) ? null : major; 
            
            // フィルタ変更時に再描画
            gantt.render();
            
            // フィルタステータスの更新
            const statusEl = document.getElementById('filter_status');
            if (statusEl) {
                statusEl.innerText = currentMajorFilter ? `${currentMajorFilter}を表示中` : "全工程を表示中";
            }

            document.querySelectorAll('.major-filter-btn').forEach(b => b.classList.toggle('active', b.innerText === major && currentMajorFilter)); 
            gantt.scrollTo(scrollState.x, scrollState.y);
        }
        function _expandAllVirtual() {
            gantt.eachTask(function(task) {
                if (task.$virtual) gantt.open(task.id);
            });
        }
        function _collapseAllVirtual() {
            gantt.eachTask(function(task) {
                if (task.$virtual) gantt.close(task.id);
            });
        }
        function _hasActiveSearchFilter() {
            return !!(currentOwnerFilter || currentMachineFilter || currentTaskFilter);
        }

        let _filterDebounceTimer = null;
        function _applyFilterDebounced(setFn, expandIfActive) {
            setFn();
            clearTimeout(_filterDebounceTimer);
            _filterDebounceTimer = setTimeout(function() {
                const scrollState = gantt.getScrollState();
                gantt.render();
                if (expandIfActive()) {
                    _expandAllVirtual();
                } else if (!_hasActiveSearchFilter()) {
                    _collapseAllVirtual();
                }
                gantt.scrollTo(scrollState.x, scrollState.y);
            }, 100);
        }

        async function filterByOwner(val) {
            _applyFilterDebounced(
                () => { currentOwnerFilter = (val || "").trim(); },
                () => !!currentOwnerFilter
            );
        }
        function filterByMachine(val) {
            _applyFilterDebounced(
                () => { currentMachineFilter = (val || "").trim(); },
                () => !!currentMachineFilter
            );
        }
        function filterByTaskName(val) {
            _applyFilterDebounced(
                () => { currentTaskFilter = (val || "").trim(); },
                () => !!currentTaskFilter
            );
        }

        function toggleSearchFilterPanel() {
            const popup = document.getElementById('search-filter-popup');
            const btn = document.getElementById('search-filter-toggle');
            const isVisible = popup.style.display !== 'none';
            if (isVisible) {
                popup.style.display = 'none';
                btn.classList.remove('active');
            } else {
                const rect = btn.getBoundingClientRect();
                let left = rect.left;
                const popupWidth = 220;
                if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;
                popup.style.left = left + 'px';
                popup.style.top = (rect.bottom + 4) + 'px';
                popup.style.display = 'block';
                btn.classList.add('active');
                const ownerInput = document.getElementById('owner_search');
                if (ownerInput) ownerInput.removeAttribute('readonly');
            }
        }

        // ポップアップ外クリックで閉じる
        document.addEventListener('click', function(e) {
            const popup = document.getElementById('search-filter-popup');
            const btn = document.getElementById('search-filter-toggle');
            if (popup && popup.style.display !== 'none' && !popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                popup.style.display = 'none';
                btn.classList.remove('active');
            }
        });

        function toggleUnassignedFilter() {
            const btn = document.getElementById("unassigned_filter_btn");
            isUnassignedOnly = !isUnassignedOnly;
            
            if (isUnassignedOnly) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
            
            gantt.render();
        }

        function toggleNewProjectForm() {
            const btn = document.getElementById('new_project_btn');
            const rect = btn.getBoundingClientRect();
            const modal = document.getElementById('new-project-modal');
            // ボタンの左下から4px下に表示（画面右端にはみ出す場合は左にずらす）
            let left = rect.left;
            const modalWidth = 280;
            if (left + modalWidth > window.innerWidth - 8) {
                left = window.innerWidth - modalWidth - 8;
            }
            modal.style.top = (rect.bottom + 4) + 'px';
            modal.style.left = left + 'px';
            document.getElementById('new-project-modal-overlay').classList.add('visible');
            document.getElementById('project_number').focus();
        }

        function closeNewProjectModal(e) {
            if (e && e.target !== document.getElementById('new-project-modal-overlay')) return;
            document.getElementById('new-project-modal-overlay').classList.remove('visible');
            document.getElementById('project_number').value = '';
            document.getElementById('customer_name_input').value = '';
            document.getElementById('project_details_input').value = '';
            document.getElementById('order_date').value = '';
            document.getElementById('shipping_date').value = '';
        }

        async function addProjectFromTemplate() {
            const projectNumber = document.getElementById('project_number').value.trim();
            const customerName = document.getElementById('customer_name_input').value.trim();
            const projectDetails = document.getElementById('project_details_input').value.trim();
            const orderDateValue = document.getElementById('order_date').value;
            const shippingDateValue = document.getElementById('shipping_date').value;

            if (!projectNumber) {
                alert("工事番号を入力してください");
                return;
            }

            // 工事番号からテンプレートテーブルを決定
            // 3T・4T始まり → task_template_b、3000・4000番台 → task_template_a、D番 → task_template_b、それ以外(2000番台) → task_template
            let templateTable;
            if (/^[34]T/i.test(projectNumber)) {
                templateTable = 'task_template_b';
            } else if (/^[34]/i.test(projectNumber)) {
                templateTable = 'task_template_a';
            } else if (/^D/i.test(projectNumber)) {
                templateTable = 'task_template_b';
            } else {
                templateTable = 'task_template';
            }

            // 1. テンプレートデータを取得（ID順にソート）
            const { data: templates, error: templateError } = await supabaseClient
                .from(templateTable)
                .select('*')
                .order('id', { ascending: true });

            if (templateError) {
                console.error("Template fetch error:", templateError);
                alert("テンプレートの取得に失敗しました");
                return;
            }

            if (!templates || templates.length === 0) {
                alert("テンプレートデータがありません");
                return;
            }

            // 2. 作成すべき見出し行（親タスク）のリストを定義
            // テンプレートの parent カラム、または text カラムからユニークな項目を抽出
            const parentItems = [];
            const seenNames = new Set();
            templates.forEach(temp => {
                const name = temp.parent || temp.text;
                if (name && !seenNames.has(name)) {
                    seenNames.add(name);
                    parentItems.push({
                        name: name,
                        relative_start: temp.relative_start_day || 0,
                        duration: temp.duration || 1,
                        reference_date: temp.reference_date || 'shipping',
                        major_item: temp.major_item || ''
                    });
                }
            });

            // 3. 新規タスクデータを作成（見出し行のみ）
            const newTasks = [];
            const orderDate = orderDateValue ? new Date(orderDateValue) : new Date();
            const shippingDate = shippingDateValue ? new Date(shippingDateValue) : null;

            parentItems.forEach(item => {
                let startDateStr;
                let duration = item.duration;

                if (item.name === "受注") {
                    // 受注はヘッダーの受注日をそのまま反映
                    startDateStr = orderDateValue || dateToDb(new Date());
                } else if (item.name === "出荷") {
                    // 出荷はヘッダーの出荷日をそのまま反映
                    startDateStr = shippingDateValue || dateToDb(new Date());
                } else if (item.reference_date === 'order') {
                    // 受注日基準（task_template_a / task_template_b の order 指定項目）
                    const calcDate = new Date(orderDate);
                    calcDate.setDate(calcDate.getDate() + item.relative_start);
                    startDateStr = dateToDb(calcDate);
                } else {
                    // 出荷日基準（デフォルト）
                    if (shippingDate) {
                        const calcDate = new Date(shippingDate);
                        calcDate.setDate(calcDate.getDate() + item.relative_start);
                        startDateStr = dateToDb(calcDate);
                    } else {
                        // 出荷日が未入力の場合は受注日を基準にする（フォールバック）
                        const calcDate = new Date(orderDate);
                        calcDate.setDate(calcDate.getDate() + Math.abs(item.relative_start));
                        startDateStr = dateToDb(calcDate);
                    }
                }

                // パターンA・B は子タスクとして作成（text=タスク名、parent=""）
                // 2000番台（task_template）は taskNameOptions の選択肢をすべて子タスクとして作成
                const isChildTaskPattern = (templateTable === 'task_template_a' || templateTable === 'task_template_b');
                if (isChildTaskPattern) {
                    newTasks.push({
                        project_number: projectNumber,
                        customer_name: customerName || "",
                        project_details: projectDetails || "",
                        text: item.name,
                        parent: "",
                        major_item: item.major_item || null,
                        start_date: startDateStr,
                        duration: duration,
                        owner: "",
                        machine: "",
                        unit: ""
                    });
                } else {
                    const taskNameGroup = taskNameOptions.find(g => g.label === item.name);
                    if (taskNameGroup && taskNameGroup.options.length > 0) {
                        taskNameGroup.options.forEach(optName => {
                            // 神戸送り開始日は機械組立の開始日-7日
                            let taskStartDateStr = startDateStr;
                            if (optName === "神戸送り開始日") {
                                const kikaieDate = newTasks.find(t => t.text === "機械組立");
                                if (kikaieDate && kikaieDate.start_date) {
                                    const d = new Date(kikaieDate.start_date);
                                    d.setDate(d.getDate() - 7);
                                    taskStartDateStr = dateToDb(d);
                                }
                            }
                            newTasks.push({
                                project_number: projectNumber,
                                customer_name: customerName || "",
                                project_details: projectDetails || "",
                                text: optName,
                                parent: item.name,
                                major_item: item.major_item || null,
                                start_date: taskStartDateStr,
                                duration: duration,
                                owner: "",
                                machine: "",
                                unit: ""
                            });
                        });
                    } else {
                        // taskNameOptions に定義のない見出しは空タスク1つ
                        newTasks.push({
                            project_number: projectNumber,
                            customer_name: customerName || "",
                            project_details: projectDetails || "",
                            text: "",
                            parent: item.name,
                            major_item: item.major_item || null,
                            start_date: startDateStr,
                            duration: duration,
                            owner: "",
                            machine: "",
                            unit: ""
                        });
                    }
                }
            });

            // 4. Supabaseに一括挿入
            const { error: insertError } = await supabaseClient
                .from('tasks')
                .insert(newTasks);

            if (insertError) {
                console.error("Insert error:", insertError);
                alert("プロジェクトの作成に失敗しました");
            } else {
                alert(`工事番号 ${projectNumber} を作成しました`);
                // フォームをリセット・非表示
                document.getElementById('new-project-modal-overlay').classList.remove('visible');
                document.getElementById('project_number').value = '';
                document.getElementById('customer_name_input').value = '';
                document.getElementById('project_details_input').value = '';
                document.getElementById('order_date').value = '';
                document.getElementById('shipping_date').value = '';
                // 2000番台の場合は新規作成工番をセット（fetchTasks内で見出し行を展開）
                if (templateTable === 'task_template') {
                    _newlyCreatedProject = projectNumber;
                }
                // 画面更新
                fetchTasks();
            }
        }

        // ===== 公開・更新通知 =====
        let _knownPublishedAt = null;   // 閲覧者が最後に読み込んだ公開日時
        let _pollTimer = null;

        // app_settings から published_at を取得
        async function getPublishedAt() {
            const { data, error } = await supabaseClient
                .from('app_settings')
                .select('value')
                .eq('key', 'published_at')
                .maybeSingle();
            if (error || !data) return null;
            return data.value;
        }

        // 編集者：公開ボタン押下
        async function publishNow() {
            const btn = document.getElementById('publish_btn');
            btn.classList.add('publishing');
            btn.textContent = '公開中...';
            const now = new Date().toISOString();

            // 現在のタスクデータをスナップショットとして保存
            const [{ data: taskSnap }, { data: locSnap }] = await Promise.all([
                supabaseClient.from('tasks').select('*').order('sort_order', { ascending: true }),
                supabaseClient.from('task_locations').select('*')
            ]);
            await supabaseClient.from('app_settings').upsert([
                { key: 'published_tasks', value: JSON.stringify(taskSnap  || []) },
                { key: 'published_locs',  value: JSON.stringify(locSnap   || []) }
            ]);

            const { error } = await supabaseClient
                .from('app_settings')
                .upsert({ key: 'published_at', value: now });
            btn.classList.remove('publishing');
            btn.textContent = '📢 公開';
            if (error) {
                alert('公開に失敗しました: ' + error.message);
            } else {
                _knownPublishedAt = now;
                hideBanner();
                // 公開時刻を表示
                const d = new Date(now);
                const label = d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' +
                    String(d.getDate()).padStart(2,'0') + ' ' +
                    String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
                const status = document.getElementById('save-status');
                if (status) { status.textContent = '公開済 ' + label; }
            }
        }

        // 閲覧者：バナーを表示
        function showBanner(publishedAt) {
            const d = new Date(publishedAt);
            const label = d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' +
                String(d.getDate()).padStart(2,'0') + ' ' +
                String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            const msg = document.getElementById('update-banner-msg');
            if (msg) msg.textContent = '🔔 工程表が更新されました（' + label + ' 公開）';
            const banner = document.getElementById('update-banner');
            if (banner) banner.style.display = 'flex';
        }

        function hideBanner() {
            const banner = document.getElementById('update-banner');
            if (banner) banner.style.display = 'none';
        }

        // 閲覧者：バナーの「最新データを取得」
        async function applyUpdate() {
            hideBanner();
            const latest = await getPublishedAt();
            if (latest) _knownPublishedAt = latest;
            await fetchTasks();
        }

        // Realtime：app_settings の変更をリアルタイムで受信
        let _realtimeChannel = null;

        function startPolling() {
            stopPolling();
            _realtimeChannel = supabaseClient
                .channel('app_settings_changes')
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'app_settings',
                    filter: 'key=eq.published_at'
                }, function(payload) {
                    if (_isEditor) return;
                    const latest = payload.new && payload.new.value;
                    if (latest && latest !== _knownPublishedAt) {
                        showBanner(latest);
                    }
                })
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'app_settings',
                    filter: 'key=eq.published_at'
                }, function(payload) {
                    if (_isEditor) return;
                    const latest = payload.new && payload.new.value;
                    if (latest && latest !== _knownPublishedAt) {
                        showBanner(latest);
                    }
                })
                .subscribe();
        }

        function stopPolling() {
            if (_realtimeChannel) {
                supabaseClient.removeChannel(_realtimeChannel);
                _realtimeChannel = null;
            }
        }

        // 認証状態変化時に公開ボタン表示/非表示を切り替え
        const _origUpdateUIForAuth = _updateUIForAuth;
        // gantt-setup.js の _updateUIForAuth をラップ（上書き）
        window._onAuthChanged = function(isEditor) {
            const publishBtn = document.getElementById('publish_btn');
            if (publishBtn) publishBtn.style.display = isEditor ? '' : 'none';
            if (isEditor) {
                stopPolling();
                hideBanner();
            } else {
                startPolling();
            }
        };
        // ===== 公開・更新通知 ここまで =====

        // ===== 設計工程表との出図日付同期 =====
        async function syncDesignDrawingDates() {
            if (!_isEditor) return; // ログイン済みの場合のみ実行
            try {
                // 設計工程表の図面タスク（task_type='drawing'）を取得
                const { data: designTasks, error } = await supabaseClient
                    .from('tasks')
                    .select('project_number, machine, unit, start_date, end_date')
                    .eq('task_type', 'drawing')
                    .not('start_date', 'is', null)
                    .not('end_date', 'is', null);

                if (error) {
                    console.warn('設計工程表タスク取得エラー:', error);
                    return;
                }
                if (!designTasks || designTasks.length === 0) return;

                // (project_number, machine, unit) ごとに最早開始日・最遅終了日を集計
                const groupMap = {};
                designTasks.forEach(t => {
                    if (t.is_archived) return; // アーカイブ済みは除外
                    const pn = (t.project_number || '').toString().trim();
                    const mc = (t.machine || '').trim();
                    const un = (t.unit || '').trim();
                    const key = `${pn}|${mc}|${un}`;
                    const s = (t.start_date || '').substring(0, 10);
                    const e = (t.end_date   || '').substring(0, 10);
                    if (!s || !e) return;
                    if (!groupMap[key]) {
                        groupMap[key] = { min_start: s, max_end: e };
                    } else {
                        if (s < groupMap[key].min_start) groupMap[key].min_start = s;
                        if (e > groupMap[key].max_end)   groupMap[key].max_end = e;
                    }
                });

                // 出図タスク（text='出図'）を全体工程表から検索
                const izuTasks = (window.allTasks || []).filter(t => t.text === '出図');
                if (izuTasks.length === 0) return;

                const dbUpdates = [];
                izuTasks.forEach(t => {
                    const pn = (t.project_number || '').toString().trim();
                    const mc = (t.machine || '').trim();
                    const un = (t.unit || '').trim();
                    const key = `${pn}|${mc}|${un}`;
                    const group = groupMap[key];
                    if (!group) return; // マッチなし → 更新しない

                    // 新しい開始日・期間を計算
                    const newStartDate = group.min_start;
                    const [sy, sm, sd] = group.min_start.split('-').map(Number);
                    const [ey, em, ed] = group.max_end.split('-').map(Number);
                    const startD = new Date(sy, sm - 1, sd);
                    const endD   = new Date(ey, em - 1, ed);
                    const newDuration = Math.round((endD - startD) / (1000 * 60 * 60 * 24)) + 1;

                    // 既存値と比較（変更がある場合のみ更新）
                    const currentStart = (t.start_date instanceof Date)
                        ? dateToDb(t.start_date)
                        : (t.start_date || '').substring(0, 10);
                    if (currentStart === newStartDate && t.duration === newDuration) return;

                    dbUpdates.push({
                        id: t.id,
                        project_number: pn, machine: mc, unit: un,
                        old_start_date: currentStart, old_duration: t.duration,
                        start_date: newStartDate, duration: newDuration
                    });
                });

                if (dbUpdates.length === 0) return;

                // Supabaseを一括更新
                await Promise.all(dbUpdates.map(u =>
                    supabaseClient.from('tasks')
                        .update({ start_date: u.start_date, duration: u.duration })
                        .eq('id', u.id)
                ));

                // 変更履歴を保存
                const logRows = dbUpdates.map(u => ({
                    source:         '設計工程表',
                    project_number: u.project_number,
                    machine:        u.machine,
                    unit:           u.unit,
                    old_start_date: u.old_start_date || null,
                    old_duration:   u.old_duration,
                    new_start_date: u.start_date,
                    new_duration:   u.duration
                }));
                await supabaseClient.from('sync_log').insert(logRows);

                const syncCount = dbUpdates.length;
                console.log(`出図タスク ${syncCount} 件の日付を設計工程表と同期しました`);
                // 更新後に再描画
                await fetchTasks();
                // 編集者にバナー通知
                showSyncChangeBanner('設計工程表', syncCount);
            } catch (e) {
                console.warn('出図タスク日付同期エラー:', e);
            }
        }
        // ===== 設計工程表との出図日付同期 ここまで =====

        // ===== 同期変更バナー（編集者向け） =====
        const _syncBannerMessages = new Map(); // source → count

        function showSyncChangeBanner(source, count) {
            if (!_isEditor) return;
            _syncBannerMessages.set(source, count);
            _renderSyncChangeBanner();
        }

        function _renderSyncChangeBanner() {
            const banner = document.getElementById('sync-change-banner');
            const msgs   = document.getElementById('sync-change-banner-msgs');
            msgs.innerHTML = Array.from(_syncBannerMessages.entries())
                .map(([src, cnt]) => `<span>🔄 ${src}との同期で ${cnt}件 の日付が更新されました</span>`)
                .join('<span style="opacity:0.5;">｜</span>');
            banner.style.display = 'flex';
        }

        function closeSyncChangeBanner() {
            _syncBannerMessages.clear();
            document.getElementById('sync-change-banner').style.display = 'none';
            document.getElementById('sync-change-banner-msgs').innerHTML = '';
        }
        // ===== 同期変更バナー ここまで =====

        // ===== 同期履歴モーダル =====
        let _syncLogData = [];   // 取得した全データをキャッシュ
        let _syncLogFilter = ''; // 現在のフィルター（''=すべて）

        async function openSyncLogModal() {
            document.getElementById('sync-log-overlay').style.display = 'block';
            const content = document.getElementById('sync-log-content');
            content.innerHTML = '<div style="color:#999; text-align:center; padding:20px;">読み込み中...</div>';

            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

            const { data, error } = await supabaseClient
                .from('sync_log')
                .select('*')
                .gte('synced_at', oneMonthAgo.toISOString())
                .order('synced_at', { ascending: false })
                .limit(500);

            if (error || !data || data.length === 0) {
                content.innerHTML = '<div style="color:#999; text-align:center; padding:20px;">過去1ヶ月の同期履歴はありません</div>';
                return;
            }

            _syncLogData = data;
            _syncLogFilter = '';
            _renderSyncLog();
        }

        function _renderSyncLog() {
            const content = document.getElementById('sync-log-content');

            const fmt = (dateStr) => {
                if (!dateStr) return '—';
                const [y, m, d] = dateStr.substring(0, 10).split('-').map(Number);
                return `${String(y).slice(-2)}/${m}/${d}`;
            };
            const fmtDt = (iso) => {
                if (!iso) return '';
                const d = new Date(iso);
                return `${String(d.getFullYear()).slice(-2)}/${d.getMonth()+1}/${d.getDate()} ` +
                    String(d.getHours()).padStart(2,'0') + ':' +
                    String(d.getMinutes()).padStart(2,'0');
            };
            const endDate = (startStr, dur) => {
                if (!startStr || !dur) return '—';
                const [y,m,d] = startStr.substring(0,10).split('-').map(Number);
                const end = new Date(y, m-1, d + dur - 1);
                return fmt(`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`);
            };

            // 連携元の一覧を取得
            const sources = [...new Set(_syncLogData.map(r => r.source || '').filter(Boolean))].sort();

            // フィルターボタン
            let filterHtml = `<div style="margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap;">
                <button onclick="_setSyncLogFilter('')" style="font-size:12px; padding:3px 10px; cursor:pointer; border-radius:3px; border:1px solid #ccc; background:${_syncLogFilter==='' ? '#1565c0' : '#fff'}; color:${_syncLogFilter==='' ? '#fff' : '#333'};">すべて</button>`;
            sources.forEach(s => {
                const active = _syncLogFilter === s;
                filterHtml += `<button onclick="_setSyncLogFilter('${s}')" style="font-size:12px; padding:3px 10px; cursor:pointer; border-radius:3px; border:1px solid #ccc; background:${active ? '#1565c0' : '#fff'}; color:${active ? '#fff' : '#333'};">${s}</button>`;
            });
            filterHtml += '</div>';

            // テーブルデータをフィルタリング
            const rows = _syncLogFilter
                ? _syncLogData.filter(r => r.source === _syncLogFilter)
                : _syncLogData;

            if (rows.length === 0) {
                content.innerHTML = filterHtml + '<div style="color:#999; text-align:center; padding:20px;">該当する履歴はありません</div>';
                return;
            }

            let tableHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                    <tr style="background:#f5f5f5;">
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd; white-space:nowrap;">同期日時</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd; white-space:nowrap;">連携元</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd;">工事番号</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd;">機械</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd;">ユニット</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd;">変更前</th>
                        <th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ddd;">変更後</th>
                    </tr>
                </thead>
                <tbody>`;

            rows.forEach((row, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#fafafa';
                const oldEnd = endDate(row.old_start_date, row.old_duration);
                const newEnd = endDate(row.new_start_date, row.new_duration);
                tableHtml += `<tr style="background:${bg};">
                    <td style="padding:5px 8px; border-bottom:1px solid #eee; white-space:nowrap; color:#666;">${fmtDt(row.synced_at)}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee; color:#555;">${row.source || ''}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee; font-weight:bold;">${row.project_number || ''}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee;">${row.machine || ''}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee;">${row.unit || ''}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee; color:#999;">${fmt(row.old_start_date)} 〜 ${oldEnd}</td>
                    <td style="padding:5px 8px; border-bottom:1px solid #eee; color:#1565c0; font-weight:bold;">${fmt(row.new_start_date)} 〜 ${newEnd}</td>
                </tr>`;
            });

            tableHtml += '</tbody></table>';
            content.innerHTML = filterHtml + tableHtml;
        }

        function _setSyncLogFilter(source) {
            _syncLogFilter = source;
            _renderSyncLog();
        }

        function closeSyncLogModal(e) {
            if (e && e.target !== document.getElementById('sync-log-overlay')) return;
            document.getElementById('sync-log-overlay').style.display = 'none';
        }
        // ===== 同期履歴モーダル ここまで =====

        document.getElementById('resource_close_btn').addEventListener('click', closeResourcePanel);
        loadCompletedProjects().then(() => loadHolidays()).then(() => fetchTasks()).then(() => {
            // 設計工程表との出図日付同期（バックグラウンドで実行）
            syncDesignDrawingDates();
            // 初期表示を今日の日付にスクロール
            // setTimeoutを短縮し、gantt.onRenderイベント等で補完
            const scrollAction = () => {
                if (typeof scrollToToday === 'function') {
                    scrollToToday();
                }
            };
            
            // 1回だけ実行されるようにフラグ管理
            let scrolled = false;
            const onRenderHandler = gantt.attachEvent("onRender", () => {
                if (!scrolled) {
                    scrollAction();
                    scrolled = true;
                    gantt.detachEvent(onRenderHandler);
                }
            });

            // フォールバック（万が一イベントが発火しなかった場合）
            setTimeout(scrollAction, 100);

            // 初回の published_at を記録してポーリング開始（閲覧者のみ）
            getPublishedAt().then(function(val) {
                _knownPublishedAt = val;
                if (!_isEditor) startPolling();
            });
        });

        let _cachedTasksRows = null;
        let _cachedTaskLocationsRows = null;
        let _specFolderUrlMap = {};
        let _salesPersonMap = {};

        function showLoading() {
            const el = document.getElementById('loading-overlay');
            if (el) el.classList.add('visible');
        }
        function hideLoading() {
            const el = document.getElementById('loading-overlay');
            if (el) el.classList.remove('visible');
        }

        function isEligibleSpecProjectNumber(projectNumber) {
            const p = String(projectNumber || "").trim();
            return /^2\d{3}$/.test(p);
        }

        window.hasSpecFolderLink = function(projectNumber) {
            const p = String(projectNumber || "").trim();
            return !!(isEligibleSpecProjectNumber(p) && _specFolderUrlMap[p]);
        };

        function getSpecFolderLink(projectNumber) {
            const p = String(projectNumber || "").trim();
            return window.hasSpecFolderLink(p) ? _specFolderUrlMap[p] : "";
        }

        async function loadSpecFolderUrlMap() {
            const { data, error } = await supabaseClient
                .from("app_settings")
                .select("value")
                .eq("key", "spec_folder_url_map")
                .maybeSingle();
            if (error) {
                console.error("spec_folder_url_map load error:", error);
                _specFolderUrlMap = {};
                return;
            }
            if (!data || !data.value) {
                _specFolderUrlMap = {};
                return;
            }
            try {
                const parsed = JSON.parse(data.value);
                _specFolderUrlMap = parsed && typeof parsed === "object" ? parsed : {};
            } catch (e) {
                console.error("spec_folder_url_map parse error:", e);
                _specFolderUrlMap = {};
            }
        }

        async function loadSalesPersonMap() {
            const { data, error } = await supabaseClient
                .from("app_settings")
                .select("value")
                .eq("key", "sales_person_map")
                .maybeSingle();
            if (error) { console.error("sales_person_map load error:", error); _salesPersonMap = {}; return; }
            if (!data || !data.value) { _salesPersonMap = {}; return; }
            try {
                const parsed = JSON.parse(data.value);
                _salesPersonMap = parsed && typeof parsed === "object" ? parsed : {};
            } catch (e) {
                console.error("sales_person_map parse error:", e);
                _salesPersonMap = {};
            }
        }

        async function upsertSalesPersonEntry(projectNumber, salesPerson) {
            const p = String(projectNumber || "").trim();
            if (!p) return;
            const nextMap = { ..._salesPersonMap };
            if (salesPerson) nextMap[p] = salesPerson;
            else delete nextMap[p];
            const { error } = await supabaseClient
                .from("app_settings")
                .upsert([{ key: "sales_person_map", value: JSON.stringify(nextMap) }], { onConflict: "key" });
            if (error) throw error;
            _salesPersonMap = nextMap;
        }

        async function upsertSpecFolderUrl(projectNumber, folderUrl) {
            const p = String(projectNumber || "").trim();
            const url = String(folderUrl || "").trim();
            if (!isEligibleSpecProjectNumber(p)) return;

            const nextMap = { ..._specFolderUrlMap };
            if (url) nextMap[p] = url;
            else delete nextMap[p];

            const { error } = await supabaseClient
                .from("app_settings")
                .upsert([{ key: "spec_folder_url_map", value: JSON.stringify(nextMap) }], { onConflict: "key" });
            if (error) {
                throw error;
            }
            _specFolderUrlMap = nextMap;
        }

        async function fetchTasks(options) {
            await loadSpecFolderUrlMap();
            await loadSalesPersonMap();
            const useCache = !!(options && options.useCache);
            // スクロール位置を記憶
            const scrollPos = gantt.getScrollState();

            let data, locData;
            const canUseCache = useCache && Array.isArray(_cachedTasksRows) && Array.isArray(_cachedTaskLocationsRows);

            if (canUseCache) {
                data = _cachedTasksRows.map(t => ({ ...t }));
                locData = _cachedTaskLocationsRows.map(l => ({ ...l }));
            } else if (!_isEditor) {
                // 閲覧者: 公開スナップショットのみ（「更新」未実行の DB 変更は表示しない）
                const { data: snap, error: snapErr } = await supabaseClient
                    .from('app_settings')
                    .select('key, value')
                    .in('key', ['published_tasks', 'published_locs']);
                data = [];
                locData = [];
                if (snapErr) {
                    console.error('[fetchTasks] Supabaseクエリエラー:', snapErr);
                }
                if (!snapErr && snap && snap.length > 0) {
                    const tasksEntry = snap.find(s => s.key === 'published_tasks');
                    const locsEntry  = snap.find(s => s.key === 'published_locs');
                    try {
                        const parsed = tasksEntry ? JSON.parse(tasksEntry.value) : null;
                        data = Array.isArray(parsed) ? parsed : [];
                    } catch (e) {
                        console.error('[fetchTasks] published_tasks JSON parse error', e);
                        data = [];
                    }
                    try {
                        const parsedL = locsEntry ? JSON.parse(locsEntry.value) : [];
                        locData = Array.isArray(parsedL) ? parsedL : [];
                    } catch (e) {
                        console.error('[fetchTasks] published_locs JSON parse error', e);
                        locData = [];
                    }
                }
                _cachedTasksRows = Array.isArray(data) ? data.map(t => ({ ...t })) : [];
                _cachedTaskLocationsRows = Array.isArray(locData) ? locData.map(l => ({ ...l })) : [];
            } else {
                // 編集者: ライブデータから読み込む（PostgREST max-rows制限対策でページネーション）
                const sortColumn = currentDisplayMode === 'machine' ? 'sort_order_machine' : 'sort_order';
                const PAGE = 1000;
                let allTasks = [], pageFrom = 0, fetchErr = null;
                while (true) {
                    const { data: page, error } = await supabaseClient
                        .from('tasks').select('*')
                        .order(sortColumn, { ascending: true })
                        .range(pageFrom, pageFrom + PAGE - 1);
                    if (error) { fetchErr = error; break; }
                    if (!page || page.length === 0) break;
                    allTasks = allTasks.concat(page);
                    if (page.length < PAGE) break;
                    pageFrom += PAGE;
                }
                if (fetchErr) return;
                data = allTasks;
                const { data: liveLoc } = await supabaseClient.from('task_locations').select('*').range(0, 49999);
                locData = liveLoc || [];
                _cachedTasksRows = Array.isArray(data) ? data.map(t => ({ ...t })) : [];
                _cachedTaskLocationsRows = Array.isArray(locData) ? locData.map(l => ({ ...l })) : [];
            }

            // 設計・組立工程表の出張タスク（task_type='business_trip'）はメインデータから除外
            // （後で専用クエリで出張タスクとして追加するため、重複表示を防ぐ）
            // 閲覧者は公開スナップショット内の出張行のみ使う（未公開のライブ tasks は読まない）
            let designTripData = Array.isArray(data)
                ? data.filter(t => t.task_type === 'business_trip' && t.is_archived !== true)
                : [];
            if (data) data = data.filter(t => t.task_type !== 'business_trip');
            if (designTripData && designTripData.length > 0) {
                // 全体工程表の既存タスクから工事番号→客先名/工事名のマップを作成
                const projectInfoMap = {};
                (data || []).forEach(t => {
                    if (t.project_number && (t.customer_name || t.project_details)) {
                        if (!projectInfoMap[t.project_number]) {
                            projectInfoMap[t.project_number] = {
                                customer_name: t.customer_name || '',
                                project_details: t.project_details || ''
                            };
                        }
                    }
                });
                designTripData.forEach(t => {
                    // 全体工程表の既存タスクIDと衝突しないよう gantt 上の仮IDを付与（保存時は original_id で本物のDB IDを参照）
                    const pInfo = projectInfoMap[(t.project_number || '').toString().trim()] || {};
                    data.push({
                        id: 'design_trip_' + t.id,
                        original_id: t.id,
                        text: t.text,
                        start_date: t.start_date,
                        end_date: t.end_date,
                        duration: t.duration,
                        owner: t.owner || '',
                        main_owner: t.main_owner || '',
                        project_number: (t.project_number || '').toString().trim(),
                        machine: t.machine || '',
                        unit: t.unit || '',
                        customer_name: pInfo.customer_name || t.customer_name || '',
                        project_details: pInfo.project_details || t.project_details || '',
                        is_business_trip: true,
                        task_type: 'business_trip',
                        $design_trip: true,  // 設計・組立工程表由来の出張タスク識別フラグ（部署色分け用）
                        is_archived: false,
                        sort_order: 999999,
                        sort_order_machine: 999999,
                        parent: '',
                        major_item: t.major_item || '',
                        is_completed: false,
                        bar_color: ''
                    });
                });
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

            // マイルストーンのうち、読み込み時に duration を常に 1 に固定するタスク（工場出荷は複数日出荷のため除外）
            const MILESTONE_ONE_DAY_TASKS = ["外観検査", "客先立会", "出荷確認会議"];

            /**
             * DB の start_date と end_date（包含の最終日）からガント用 duration を求める。
             * 組立工程表側で end_date を更新しても tasks.duration が未更新のまま残ると、全体は旧 duration で描画していた。
             */
            function durationFromDbInclusiveEnd(startVal, endVal) {
                if (startVal == null || endVal == null) return null;
                const sStr = String(startVal).trim().substring(0, 10);
                const eStr = String(endVal).trim().substring(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(sStr) || !/^\d{4}-\d{2}-\d{2}$/.test(eStr)) return null;
                if (eStr < sStr) return null;
                try {
                    const s = gantt.date.str_to_date("%Y-%m-%d")(sStr);
                    const e = gantt.date.str_to_date("%Y-%m-%d")(eStr);
                    const days = Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                    if (days >= 1 && days <= 5000) return days;
                } catch (_err) { /* ignore */ }
                return null;
            }

            const rawTasks = data.map(t => {
                let areaGroup = t.area_group;
                let areaNumber = t.area_number;

                if (locMap[t.id]) {
                    areaGroup = locMap[t.id].area_group;
                    areaNumber = locMap[t.id].area_numbers.join(",");
                }

                const isMilestoneOneDay = MILESTONE_ONE_DAY_TASKS.includes(t.text);
                let durationForGantt = isMilestoneOneDay ? 1 : Number(t.duration);
                if (!isMilestoneOneDay) {
                    if (!Number.isFinite(durationForGantt) || durationForGantt < 1) durationForGantt = 1;
                    if (t.end_date != null && String(t.end_date).trim() !== "") {
                        const derived = durationFromDbInclusiveEnd(t.start_date, t.end_date);
                        if (derived != null) durationForGantt = derived;
                    }
                }

                return {
                    id: t.id, text: t.text, start_date: t.start_date,
                    duration: durationForGantt, owner: t.owner, project_number: (t.project_number || "").toString().trim(),
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
                    bar_color: t.bar_color || '',
                    $design_trip: t.$design_trip || false,
                    original_id: t.original_id || null,
                    task_type: t.task_type || null
                };
            });

            // チェックボックスの状態をDBから復元
            rawTasks.forEach(t => {
                taskCheckboxes[t.id] = t.is_completed || false;
                if (t.bar_color) locationBarColors[t.id] = t.bar_color;
            });

            window.allTasks = rawTasks;
            refreshAssemblyLogSnapshotsFromAllTasks();

            // アクティブ案件（完了済み除外）の最小開始月を GANTT_START_DATE に反映
            {
                const _completedSet = new Set((completedProjects || []).map(cp => (cp.project_number || "").toString().trim()));
                const _strToDate = gantt.date.str_to_date("%Y-%m-%d");
                let _minStart = null;
                rawTasks.forEach(t => {
                    if (!t.start_date) return;
                    if (_completedSet.has((t.project_number || "").toString().trim())) return;
                    const d = t.start_date instanceof Date ? t.start_date : _strToDate(String(t.start_date).substring(0, 10));
                    if (d && !isNaN(d.getTime()) && (_minStart === null || d < _minStart)) _minStart = d;
                });
                if (_minStart) {
                    GANTT_START_DATE = new Date(_minStart.getFullYear(), _minStart.getMonth(), 1);
                }
            }

            const parentOrder = PHASE_PARENT_ORDER;
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
                    const machines = Array.from(machinesSet).sort((a, b) =>
                        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
                    );

                    machines.forEach(mName => {
                        const tasksInMachine = projectTasks.filter(t => {
                            const mStr = t.machine || "設定なし";
                            const mList = mStr.split(",").map(m => m.trim());
                            return mList.includes(mName) || (mName === "設定なし" && mList.includes(""));
                        });

                        const headingRank = (t) => {
                            const p = String(t.parent_name || "").trim();
                            const idx = parentOrder.indexOf(p);
                            return idx === -1 ? parentOrder.length + 1 : idx;
                        };
                        tasksInMachine.sort((a, b) => {
                            const ra = headingRank(a);
                            const rb = headingRank(b);
                            if (ra !== rb) return ra - rb;
                            if (ra === parentOrder.length + 1) {
                                const pa = String(a.parent_name || "").trim();
                                const pb = String(b.parent_name || "").trim();
                                const c = pa.localeCompare(pb, undefined, { numeric: true, sensitivity: 'base' });
                                if (c !== 0) return c;
                            }
                            const ma = Number(a.sort_order_machine != null ? a.sort_order_machine : 1e9);
                            const mb = Number(b.sort_order_machine != null ? b.sort_order_machine : 1e9);
                            if (ma !== mb) return ma - mb;
                            const oa = Number(a.sort_order != null ? a.sort_order : 1e9);
                            const ob = Number(b.sort_order != null ? b.sort_order : 1e9);
                            if (oa !== ob) return oa - ob;
                            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' });
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
                // 設計工程表の出張タスクも含めて全工事番号を収集（完了済み工事番号は除外）
                const _completedPNums = new Set((completedProjects || []).map(cp => (cp.project_number || "").toString().trim()));
                const tripProjects = [...new Set(rawTasks
                    .filter(t => {
                        const val = t.is_business_trip;
                        if (!(val === true || val === 'true' || val === 'TRUE')) return false;
                        return !_completedPNums.has((t.project_number || "").toString().trim());
                    })
                    .map(t => t.project_number)
                )].sort();

                tripProjects.forEach(pNum => {
                    const projectTasks = rawTasks.filter(t => {
                        if (t.project_number !== pNum) return false;
                        const val = t.is_business_trip;
                        return val === true || val === 'true' || val === 'TRUE';
                    });

                    projectTasks.forEach(t => {
                        // window.allTasks の元オブジェクトを汚染しないようクローンして parent を設定
                        tasksWithHierarchy.push({ ...t, parent: 0 });
                    });
                });
            } else {
                projects.forEach(pNum => {
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

        /**
         * ライトボックス等から渡される locations を { area_group, area_number }[] に正規化する。
         * @param {*} locations - get_value の戻り、または DB 行の配列
         */
        function normalizeLocationPairs(locations) {
            if (!locations || !Array.isArray(locations) || locations.length === 0) return [];
            return locations
                .map(function (l) {
                    return {
                        area_group: String(l.area_group != null ? l.area_group : "").trim(),
                        area_number: String(l.area_number != null ? l.area_number : "").trim()
                    };
                })
                .filter(function (p) { return p.area_group && p.area_number; });
        }

        /** 工程見出しの並び（tasks.parent／fetchTasks の parentOrder と共通） */
        const PHASE_PARENT_ORDER = ["受注", "基本設計＆計画承認", "長納期品手配", "出図＆部品手配", "電気設計＆電気品手配", "盤製作", "組立全体", "外観検査", "タスクリスト作成", "試運転", "客先立会", "出荷確認会議", "出荷準備", "出荷", "現地工事"];
        /** 組立場所の自動伝播対象の見出し（tasks.parent）。タスクリスト作成・出荷準備は含めない。 */
        const PARENTS_ASSEMBLY_THROUGH_SHIPPING = new Set([
            "組立全体", "外観検査", "試運転", "客先立会", "出荷確認会議", "出荷"
        ]);

        function isAssemblyThroughShippingParent(parentName) {
            const p = String(parentName != null ? parentName : "").trim();
            return PARENTS_ASSEMBLY_THROUGH_SHIPPING.has(p);
        }

        /** キャッシュから parent を補完しても「組立系」判定を壊さない見出しのみ */
        function isSafeAssemblyParentName(name) {
            const p = String(name != null ? name : "").trim();
            if (!p) return false;
            if (isAssemblyThroughShippingParent(p)) return true;
            return p === "タスクリスト作成" || p === "出荷準備";
        }

        /** DBの parent または fetchTasks 後の parent_name（Realtime とキャッシュで混在し得る） */
        function taskRowParent(row) {
            if (!row) return "";
            const p = row.parent != null ? row.parent : row.parent_name;
            return String(p != null ? p : "").trim();
        }

        /** DELETE 受信時に allTasks から既に消えている場合のログ補完用（組立系タスクのみ） */
        let _assemblyLogSnapshotById = new Map();
        let _assemblyRecentLogByTaskId = new Map();

        /**
         * Realtime の DELETE では old に主キー以外が載らないことが多い（REPLICA IDENTITY DEFAULT）。
         * また major_item だけ載り parent / 工番などが欠けることもある。その場合でも isAssemblyTaskRow が
         * true になり得るため、「判定が通ったら return」するとキャッシュ補完がスキップされ空行になる。
         * 工番・機械・タスク名は allTasks / gantt から埋める。
         * parent は「組立系見出し」のときだけ補完する（受注などに上書きすると isAssemblyTaskRow が false になり履歴が消える）。
         */
        function enrichAssemblyRealtimePayload(payload) {
            const ev = String(payload.eventType || "").toUpperCase();
            if (ev !== "DELETE" || !payload.old) return payload;
            const id = payload.old.id;
            if (id == null) return payload;

            const old = Object.assign({}, payload.old);

            function takeIfEmpty(key, val) {
                const cur = old[key];
                if (cur != null && String(cur).trim() !== "") return;
                if (val != null && String(val).trim() !== "") old[key] = val;
            }

            function takeParentIfSafe(val) {
                if (taskRowParent(old)) return;
                const p = String(val != null ? val : "").trim();
                if (!isSafeAssemblyParentName(p)) return;
                old.parent = p;
            }

            const cached = Array.isArray(window.allTasks)
                ? window.allTasks.find(function (t) {
                    return String(t.id) === String(id);
                })
                : null;
            if (cached) {
                takeParentIfSafe(cached.parent_name);
                takeIfEmpty("major_item", cached.major_item);
                takeIfEmpty("text", cached.text);
                takeIfEmpty("project_number", cached.project_number);
                takeIfEmpty("machine", cached.machine);
                takeIfEmpty("unit", cached.unit);
            }

            try {
                if (typeof gantt !== "undefined" && gantt.getTask) {
                    const gt = gantt.getTask(id);
                    if (gt && !gt.$virtual) {
                        takeParentIfSafe(gt.parent_name || gt.parent);
                        takeIfEmpty("major_item", gt.major_item);
                        takeIfEmpty("text", gt.text);
                        takeIfEmpty("project_number", gt.project_number);
                        takeIfEmpty("machine", gt.machine);
                        takeIfEmpty("unit", gt.unit);
                    }
                }
            } catch (_e) {
                /* gantt に該当タスクが無い場合は無視 */
            }

            const snap = _assemblyLogSnapshotById.get(String(id));
            if (snap) {
                takeIfEmpty("project_number", snap.project_number);
                takeIfEmpty("machine", snap.machine);
                takeIfEmpty("unit", snap.unit);
                takeIfEmpty("text", snap.text);
            }

            return Object.assign({}, payload, { old: old });
        }

        // 組立工程表由来の行かどうかを判定（Realtime payload 用）
        // ※ 組立工程表には部署「組立」「電装」が含まれるため、parent が空の判定でも両方を対象にする。
        function mergeTasksRowForAssemblyWatch(row) {
            if (!row || row.id == null) return row;
            const id = String(row.id);
            const out = Object.assign({}, row);
            const cached = Array.isArray(window.allTasks)
                ? window.allTasks.find(function(t) { return String(t.id) === id; })
                : null;
            if (!cached) return out;
            function takeIfEmpty(key, val) {
                if (out[key] != null && String(out[key]).trim() !== '') return;
                if (val != null && String(val).trim() !== '') out[key] = val;
            }
            takeIfEmpty('parent', cached.parent_name);
            takeIfEmpty('parent', cached.parent);
            takeIfEmpty('major_item', cached.major_item);
            takeIfEmpty('project_number', cached.project_number);
            takeIfEmpty('machine', cached.machine);
            takeIfEmpty('unit', cached.unit);
            takeIfEmpty('text', cached.text);
            return out;
        }

        function isAssemblyTaskRow(row) {
            if (!row) return false;
            const parent = taskRowParent(row);
            if (isAssemblyThroughShippingParent(parent)) return true;
            if (parent === "タスクリスト作成" || parent === "出荷準備") return true;
            // 組立工程表から新規追加された直後は parent が空で届くケースがあるため、
            // parent 空 かつ 部署=組立/電装 の行は組立工程表由来として扱う。
            const major = String(row.major_item != null ? row.major_item : "").trim();
            return !parent && (major === "組立" || major === "電装");
        }

        window.isAssemblyTaskRowForChangeLog = isAssemblyTaskRow;

        function rememberAssemblyTaskSnapshot(row) {
            if (!row || row.id == null) return;
            if (!isAssemblyTaskRow(row)) return;
            _assemblyLogSnapshotById.set(String(row.id), {
                project_number: String(row.project_number != null ? row.project_number : "").trim(),
                machine: String(row.machine != null ? row.machine : "").trim(),
                unit: String(row.unit != null ? row.unit : "").trim(),
                text: String(row.text != null ? row.text : "").trim(),
                start_date: String(row.start_date != null ? row.start_date : "").trim(),
                end_date: String(row.end_date != null ? row.end_date : "").trim(),
                duration: row.duration != null ? Number(row.duration) : null,
                owner: String(row.owner != null ? row.owner : "").trim(),
                main_owner: String(row.main_owner != null ? row.main_owner : "").trim()
            });
        }

        function _toDateYmd(v) {
            if (v == null || v === '') return '';
            if (v instanceof Date) return dateToDb(v);
            const s = String(v).trim();
            return s.length >= 10 ? s.substring(0, 10) : s;
        }

        function _rowDurationNum(row) {
            if (!row || row.duration == null || row.duration === '') return null;
            const n = Number(row.duration);
            return Number.isFinite(n) ? n : null;
        }

        function buildAssemblyChangeDescription(ev, rowNew, rowOld) {
            if (ev === 'INSERT') return 'タスクを追加しました';
            if (ev !== 'UPDATE') return '変更が反映されました';
            if (!rowNew || rowNew.id == null) return '変更が反映されました';

            const snap = _assemblyLogSnapshotById.get(String(rowNew.id)) || null;
            const oldRow = rowOld || {};
            const changes = [];
            const normalizeLoose = function(v) {
                if (v == null) return '';
                return String(v).replace(/[ \t\u3000]+/g, ' ').trim();
            };
            const normalizeOwners = function(v) {
                const s = normalizeLoose(v);
                if (!s) return '';
                return s.replace(/，/g, ',')
                    .split(',')
                    .map(function(x) { return normalizeLoose(x); })
                    .filter(Boolean)
                    .sort()
                    .join(',');
            };

            function pickOldString(key) {
                const a = oldRow[key];
                if (a != null && String(a).trim() !== '') return normalizeLoose(a);
                const b = snap ? snap[key] : null;
                if (b != null && String(b).trim() !== '') return normalizeLoose(b);
                return '';
            }
            function pickNewString(key) {
                const v = rowNew[key];
                if (v == null) return '';
                return normalizeLoose(v);
            }

            const oldText = pickOldString('text');
            const newText = pickNewString('text');
            if (oldText !== '' && newText !== '' && oldText !== newText) changes.push('タスク名を変更');

            const oldStart = _toDateYmd(oldRow.start_date || (snap ? snap.start_date : ''));
            const newStart = _toDateYmd(rowNew.start_date);
            const oldEnd = _toDateYmd(oldRow.end_date || (snap ? snap.end_date : ''));
            const newEnd = _toDateYmd(rowNew.end_date);
            const oldDur = _rowDurationNum(oldRow) != null ? _rowDurationNum(oldRow) : _rowDurationNum(snap);
            const newDur = _rowDurationNum(rowNew);
            const startChanged = oldStart !== '' && newStart !== '' ? oldStart !== newStart : false;
            const durChanged = oldDur != null && newDur != null ? oldDur !== newDur : false;
            const endDateChanged = oldEnd !== '' && newEnd !== '' ? oldEnd !== newEnd : false;
            const endChanged = durChanged || endDateChanged;
            // 組立工程表のRealtime更新では、開始日変更時に duration/end_date も同時更新されることがあるため、
            // 表示は「どちらを直接操作したか」を優先して単一項目に寄せる。
            if (startChanged) changes.push('開始日を変更');
            else if (endChanged) changes.push('終了日を変更');

            const oldOwner = normalizeOwners(pickOldString('owner'));
            const newOwner = normalizeOwners(pickNewString('owner'));
            const oldMainOwner = normalizeLoose(pickOldString('main_owner'));
            const newMainOwner = normalizeLoose(pickNewString('main_owner'));
            const ownerChanged = oldOwner !== '' && newOwner !== '' ? oldOwner !== newOwner : false;
            const mainOwnerChanged = oldMainOwner !== '' && newMainOwner !== '' ? oldMainOwner !== newMainOwner : false;
            if (ownerChanged || mainOwnerChanged) changes.push('担当者を変更');
            const oldMachine = pickOldString('machine');
            const newMachine = pickNewString('machine');
            if (oldMachine !== '' && newMachine !== '' && oldMachine !== newMachine) changes.push('機械を変更');
            const oldUnit = pickOldString('unit');
            const newUnit = pickNewString('unit');
            if (oldUnit !== '' && newUnit !== '' && oldUnit !== newUnit) changes.push('ユニットを変更');

            if (changes.length > 0) return changes.join('・');
            // フォールバック: データ不足で変更項目を特定できなかった場合
            const hasStartHints =
                rowNew.start_date != null || oldRow.start_date != null || (snap && snap.start_date != null);
            const hasEndHints =
                rowNew.end_date != null || rowNew.duration != null ||
                oldRow.end_date != null || oldRow.duration != null ||
                (snap && (snap.end_date != null || snap.duration != null));
            // 開始日が変化していないと確認できる場合 → 終了日変更と判断
            const startDefinitelySame = oldStart !== '' && newStart !== '' && oldStart === newStart;
            if (startDefinitelySame && hasEndHints) return '終了日を変更';
            if (hasStartHints) return '開始日を変更';
            if (hasEndHints) return '終了日を変更';
            return '変更が反映されました';
        }

        function shouldSkipAssemblyRealtimeLog(row, description) {
            if (!row || row.id == null) return false;
            const taskId = String(row.id);
            const now = Date.now();
            const prev = _assemblyRecentLogByTaskId.get(taskId);
            const DUP_MS = 3000;
            const SAME_DUP_MS = 60000; // 同一内容は60秒以内の重複をスキップ

            if (prev) {
                const elapsed = now - prev.at;
                const prevDesc = String(prev.description || '');
                const curDesc = String(description || '');
                const generic = '変更が反映されました';
                const isSame = prevDesc === curDesc;
                const isGenericPair = (prevDesc === generic || curDesc === generic);

                if (isSame && elapsed <= SAME_DUP_MS) {
                    // 同一内容は最初の記録時刻を保持したままスキップ
                    _assemblyRecentLogByTaskId.set(taskId, { at: prev.at, description: curDesc });
                    return true;
                }
                if (isGenericPair && elapsed <= DUP_MS) {
                    _assemblyRecentLogByTaskId.set(taskId, { at: now, description: curDesc });
                    return true;
                }
            }

            _assemblyRecentLogByTaskId.set(taskId, { at: now, description: description || '' });
            return false;
        }

        function refreshAssemblyLogSnapshotsFromAllTasks() {
            if (!Array.isArray(window.allTasks)) return;
            window.allTasks.forEach(function (t) {
                if (!t || t.id == null) return;
                rememberAssemblyTaskSnapshot(t);
            });
        }

        // この画面で発生した tasks 更新を一時識別し、Realtime通知を抑制
        let _suppressAssemblyBannerUntil = 0;
        const _suppressAssemblyByTaskIdUntil = new Map(); // taskId(string) -> epoch(ms)
        const _recentLocalLogs = new Map(); // "全体工程表側 logChange" 済みタスク内容 → expiry（Realtimeの二重記録を防ぐ）
        function _makeLocalLogKey(p, m, u, t) {
            return [String(p||''),String(m||''),String(u||''),String(t||'')].join('\x00').toLowerCase();
        }

        function markLocalTaskMutation(taskId) {
            _suppressAssemblyBannerUntil = Date.now() + 4000;
            if (taskId == null || taskId === '') return;
            _suppressAssemblyByTaskIdUntil.set(String(taskId), Date.now() + 30000);
        }
        window.markLocalTaskMutation = markLocalTaskMutation;

        function hasLocalTaskMutationMark(taskId) {
            if (taskId == null || taskId === '') return false;
            const key = String(taskId);
            const until = _suppressAssemblyByTaskIdUntil.get(key);
            if (!until) return false;
            if (Date.now() > until) {
                _suppressAssemblyByTaskIdUntil.delete(key);
                return false;
            }
            return true;
        }

        function shouldSuppressAssemblyRealtimeByTask(payload, rawOld) {
            const ids = new Set();
            if (payload && payload.new && payload.new.id != null) ids.add(String(payload.new.id));
            if (payload && payload.old && payload.old.id != null) ids.add(String(payload.old.id));
            if (rawOld && rawOld.id != null) ids.add(String(rawOld.id));
            for (const id of ids) {
                if (hasLocalTaskMutationMark(id)) return true;
            }
            return false;
        }
        (function patchSupabaseTasksMutationForBannerSuppression() {
            if (!supabaseClient || supabaseClient._overallTasksPatchApplied) return;
            const originalFrom = supabaseClient.from.bind(supabaseClient);
            supabaseClient.from = function(table) {
                const builder = originalFrom(table);
                if (table !== 'tasks' || !builder) return builder;
                ['insert', 'update', 'delete', 'upsert'].forEach(function(method) {
                    const originalMethod = builder[method];
                    if (typeof originalMethod !== 'function') return;
                    builder[method] = function() {
                        markLocalTaskMutation();
                        const args = Array.from(arguments);
                        // insert/upsert の payload に id がある場合は task 単位でも抑止する
                        if ((method === 'insert' || method === 'upsert') && args.length > 0) {
                            const payload = args[0];
                            const rows = Array.isArray(payload) ? payload : [payload];
                            rows.forEach(function(row) {
                                if (row && row.id != null) markLocalTaskMutation(row.id);
                            });
                        }
                        const ret = originalMethod.apply(this, args);
                        // update/delete は後続の eq('id', ...) で対象IDが決まるため、チェーン側をラップする
                        if (!ret || (method !== 'update' && method !== 'delete')) return ret;
                        const originalEq = ret.eq;
                        if (typeof originalEq !== 'function') return ret;
                        ret.eq = function(column, value) {
                            if (String(column) === 'id') markLocalTaskMutation(value);
                            return originalEq.apply(this, arguments);
                        };
                        return ret;
                    };
                });
                return builder;
            };
            supabaseClient._overallTasksPatchApplied = true;
        })();

        /**
         * task_locations を差し替え、tasks.area_group / area_number を整合（伝播なし）。
         * @param {string} tid
         * @param {{area_group:string,area_number:string}[]} list normalize済み
         */
        async function persistTaskLocationsOnly(tid, list) {
            const { error: delErr } = await supabaseClient.from("task_locations").delete().eq("task_id", tid);
            if (delErr) {
                console.error("task_locations delete:", delErr);
                alert("場所の保存に失敗しました（既存データの削除）。");
                return false;
            }
            if (list.length > 0) {
                const rows = list.map(function (p) {
                    return { task_id: tid, area_group: p.area_group, area_number: p.area_number };
                });
                const { error: insErr } = await supabaseClient.from("task_locations").insert(rows);
                if (insErr) {
                    console.error("task_locations insert:", insErr);
                    alert("場所の保存に失敗しました（場所の登録）。");
                    return false;
                }
            }

            let area_group = "";
            let area_number = "";
            if (list.length > 0) {
                const groups = new Set(list.map(function (p) { return p.area_group; }));
                if (groups.size === 1) {
                    area_group = list[0].area_group;
                    area_number = list.map(function (p) { return p.area_number; }).join(",");
                } else {
                    area_group = "";
                    area_number = list.map(function (p) { return p.area_group + "-" + p.area_number; }).join(",");
                }
            }

            const { error: uerr } = await supabaseClient
                .from("tasks")
                .update(Object.assign(
                    { area_group: area_group, area_number: area_number },
                    (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {}
                ))
                .eq("id", tid);
            if (uerr) {
                console.error("tasks area update:", uerr);
                alert("場所の保存に失敗しました（タスクの場所欄の更新）。");
                return false;
            }
            return true;
        }

        /**
         * 同一工番・機械・ユニットで、見出しが組立全体／外観検査／試運転／客先立会／出荷確認会議／出荷のタスクへ場所をコピーする。
         * @param {string} sourceTid 手動保存したタスクID
         * @param {{area_group:string,area_number:string}[]} list normalize済み（空でない）
         */
        async function propagateAssemblyTaskLocations(sourceTid, list) {
            const { data: srcRow, error: srcErr } = await supabaseClient
                .from("tasks")
                .select("project_number, machine, unit, parent")
                .eq("id", sourceTid)
                .maybeSingle();
            if (srcErr || !srcRow) return;
            const pn = String(srcRow.project_number != null ? srcRow.project_number : "").trim();
            const machine = String(srcRow.machine != null ? srcRow.machine : "").trim();
            const unit = String(srcRow.unit != null ? srcRow.unit : "").trim();
            const par = String(srcRow.parent != null ? srcRow.parent : "").trim();
            if (!pn || !machine || !isAssemblyThroughShippingParent(par)) return;

            const { data: siblings, error: sibErr } = await supabaseClient
                .from("tasks")
                .select("id, parent, is_business_trip, task_type")
                .eq("project_number", pn)
                .eq("machine", machine)
                .eq("unit", unit);
            if (sibErr || !siblings || siblings.length === 0) return;

            for (let i = 0; i < siblings.length; i++) {
                const row = siblings[i];
                const oid = String(row.id);
                if (oid === sourceTid) continue;
                const trip = row.is_business_trip;
                if (trip === true || trip === "true" || trip === "TRUE") continue;
                if (String(row.task_type || "") === "business_trip") continue;
                const p = String(row.parent != null ? row.parent : "").trim();
                if (!isAssemblyThroughShippingParent(p)) continue;
                const ok = await persistTaskLocationsOnly(oid, list);
                if (!ok) return;
            }
        }

        /**
         * task_locations を差し替え、tasks.area_group / area_number を整合させる。
         * 組立全体～出荷の見出し下で、同一工番・機械のタスクへ場所を自動反映する。
         * @param {string|number} taskId
         * @param {{area_group:string,area_number:string}[]} pairs
         * @returns {Promise<boolean>}
         */
        window.persistTaskLocations = async function (taskId, pairsOrRaw) {
            const tid = String(taskId);
            const list = normalizeLocationPairs(pairsOrRaw);

            const ok = await persistTaskLocationsOnly(tid, list);
            if (!ok) return false;

            if (list.length > 0) {
                await propagateAssemblyTaskLocations(tid, list);
            }
            return true;
        };

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
            const isSpecFolder = task.text === "受注";

            if (isDesignDetail) {
                let url = `https://kemcokurosaki-oss.github.io/design-schedule/?project_no=${encodeURIComponent(projectNo)}`;
                if (task.text === "長納期品手配") {
                    url += `&task_type=long_lead_item`;
                } else if (task.text === "出図＆部品手配") {
                    url += `&task_type=drawing`;
                }
                window.open(url, '_blank');
            } else if (isSpecFolder) {
                const folderUrl = getSpecFolderLink(projectNo);
                if (!folderUrl) {
                    alert("仕様書フォルダURLが未設定です");
                    return;
                }
                window.open(folderUrl, "_blank");
            } else {
                alert("準備中");
            }
        };

        function resetFilter() { location.reload(); }

        window.toggleTaskCheckbox = function(id, checked) {
            if (!_isEditor) return;
            const task = gantt.getTask(id);
            const realId = (task && task.original_id) || id;
            taskCheckboxes[realId] = checked;
            // 子タスク行を即時更新（機械別で同一タスクが複数機械行に出る場合はすべて反映）
            gantt.eachTask(function(t) {
                if (t.$virtual) return;
                const rowKey = t.original_id || t.id;
                if (rowKey !== realId) return;
                const rowNode = gantt.getTaskRowNode(t.id);
                if (rowNode) {
                    if (checked) rowNode.classList.add("task-checked");
                    else rowNode.classList.remove("task-checked");
                }
            });
            // 親行（見出し行）の状態を更新
            try {
                if (task && task.parent) {
                    const children = gantt.getChildren(task.parent);
                    const allChecked = children.length > 0 && children.every(cid => {
                        const c = gantt.getTask(cid);
                        const key = (c && c.original_id) || cid;
                        return taskCheckboxes[key];
                    });
                    const parentRow = gantt.getTaskRowNode(task.parent);
                    if (parentRow) {
                        if (allChecked) parentRow.classList.add("task-checked");
                        else parentRow.classList.remove("task-checked");
                    }
                }
            } catch(e) {}
            // Supabaseへの保存はバックグラウンドで実行（常に DB のタスク id）
            supabaseClient.from('tasks').update(Object.assign(
                { is_completed: checked },
                (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {}
            )).eq('id', realId)
                .then(({ error }) => {
                    if (error) { console.error("チェックボックス保存エラー:", error); return; }
                });
        };

        async function setDisplayMode(mode) {
            showLoading();
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

            // データの再読み込みと再描画（表示モード切替時は必ず DB から取得。useCache だと別タブの更新が反映されない）
            await fetchTasks();
            hideLoading();
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
            if (currentDisplayMode === 'business_trip') {
                // 出張予定：工事番号、客先名、工事名、タスク名、担当者、開始日、終了日、＋
                // 列構成が大きく変わるため即時 render（fetchTasks の parse より前に反映）
                const scrollState = gantt.getScrollState();
                gantt.config.columns = [
                    { name: "project_number", label: "工番", width: 55, align: "center", template: function(obj) {
                        return "<div style='text-align:center;width:100%;'>" + (obj.project_number || "") + "</div>";
                    }},
                    { name: "customer_name", label: "客先名", width: 125, align: "center", template: function(obj) {
                        return obj.customer_name || "";
                    }},
                    { name: "project_details", label: "工事名", width: 150, align: "left", template: function(obj) {
                        return obj.project_details || "";
                    }},
                    { name: "text", label: "タスク名", width: 150, tree: false, template: function(obj) {
                        return obj.text;
                    }},
                    { name: "owner", label: "担当", width: 55, align: "center", template: function(obj) {
                        if (obj.$virtual) return "";
                        if (!obj.owner || obj.owner.trim() === "") {
                            return "<span class='unassigned-warning'>⚠️</span>";
                        }
                        return obj.owner;
                    }},
                    { name: "start_date", label: "開始日", width: 130, align: "center", template: function(t) {
                        return dateToDisplay(t.start_date);
                    }},
                    { name: "end_date", label: "終了日", width: 130, align: "center", template: function(t) {
                        const d = gantt.calculateEndDate(t.start_date, t.duration);
                        d.setDate(d.getDate() - 1);
                        return dateToDisplay(d);
                    }},
                    { name: "add", label: "", width: 30 }
                ];
                gantt.render();
                gantt.scrollTo(scrollState.x, scrollState.y);
            } else {
                // 工程別・機械別（共通）：列構成・幅が同一のため render 不要
                // fetchTasks() の gantt.parse() で正しく再描画される
                gantt.config.columns = SHARED_COLUMNS;
                gantt.config.grid_width = SHARED_COLUMNS.reduce(function(s, c) { return s + (c.width || 0); }, 0);
                gantt.config.grid_elastic_columns = false;
            }
        }

        function toggleProjectGroupDropdown(e) {
            e.stopPropagation();
            const dd = document.getElementById('project-group-dropdown');
            const btn = document.getElementById('project-group-filter-btn');
            const visible = dd.classList.toggle('visible');
            btn.textContent = visible ? '▼' : '▶';
            if (visible) {
                const rect = btn.getBoundingClientRect();
                dd.style.top = rect.bottom + 'px';
                dd.style.left = rect.left + 'px';
            }
        }
        document.addEventListener('click', () => {
            const dd = document.getElementById('project-group-dropdown');
            if (dd?.classList.contains('visible')) {
                dd.classList.remove('visible');
                const btn = document.getElementById('project-group-filter-btn');
                if (btn) btn.textContent = '▶';
            }
        });

        function setProjectGroupFilter(type, el) {
            currentProjectGroupFilter = type;
            currentSalesPersonFilter = "";
            const submenu = document.getElementById('sales-person-submenu');
            if (submenu) submenu.style.display = 'none';
            const salesMenuItem2 = document.getElementById('sales-person-menu-item');
            if (salesMenuItem2) salesMenuItem2.textContent = '営業担当 ▶';
            document.querySelectorAll('.project-group-dropdown-item').forEach(d => d.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('project-group-dropdown').classList.remove('visible');
            const btn = document.getElementById('project-group-filter-btn');
            btn.textContent = '▶';
            btn.classList.toggle('filtered', type !== 'all');
            if (window.allTasks) updateProjectList(window.allTasks);
            const scrollState = gantt.getScrollState();
            gantt.render();
            gantt.scrollTo(scrollState.x, scrollState.y);
        }

        function toggleSalesPersonSubMenu(event, el) {
            event.stopPropagation();
            const submenu = document.getElementById('sales-person-submenu');
            const menuItem = document.getElementById('sales-person-menu-item');
            if (!submenu) return;
            const nowOpen = submenu.style.display === 'none';
            submenu.style.display = nowOpen ? '' : 'none';
            if (menuItem) menuItem.textContent = nowOpen ? '営業担当 ▼' : '営業担当 ▶';
        }

        function setSalesPersonFilter(name) {
            currentProjectGroupFilter = 'sales';
            currentSalesPersonFilter = name;
            document.querySelectorAll('.project-group-dropdown-item').forEach(d => d.classList.remove('active'));
            const menuItem = document.getElementById('sales-person-menu-item');
            if (menuItem) menuItem.classList.add('active');
            document.querySelectorAll('.sales-person-item').forEach(d => {
                d.classList.toggle('active', d.textContent.trim() === name);
            });
            document.getElementById('project-group-dropdown').classList.remove('visible');
            const submenu = document.getElementById('sales-person-submenu');
            if (submenu) submenu.style.display = 'none';
            const salesMenuItem = document.getElementById('sales-person-menu-item');
            if (salesMenuItem) salesMenuItem.textContent = '営業担当 ▶';
            const btn = document.getElementById('project-group-filter-btn');
            if (btn) { btn.textContent = '▶'; btn.classList.add('filtered'); }
            if (window.allTasks) updateProjectList(window.allTasks);
            const scrollState = gantt.getScrollState();
            gantt.render();
            gantt.scrollTo(scrollState.x, scrollState.y);
        }

        /** 出張予定行か（全体工程表・設計工程表由来の出張を含む） */
        function _isBusinessTripTaskRow(t) {
            const val = t && t.is_business_trip;
            return val === true || val === 'true' || val === 'TRUE';
        }

        /** 工番ごとに社内工程・出張予定の有無（工事一覧のマーク用） */
        function _buildProjectKindMap(tasks) {
            const map = {};
            (tasks || []).forEach(function(t) {
                const pn = (t.project_number || "").toString().trim();
                if (!pn) return;
                if (!map[pn]) map[pn] = { shanai: false, trip: false };
                if (_isBusinessTripTaskRow(t)) map[pn].trip = true;
                else map[pn].shanai = true;
            });
            return map;
        }

        /** 案内オーバーレイを左グリッド列（.gantt_grid）の矩形に合わせて中央表示（横スクロールでは追従しない） */
        function _layoutGanttEmptyNoticeOverGrid() {
            const wrap = document.querySelector(".gantt-main-wrap");
            if (!wrap) return;
            const grid = document.querySelector("#gantt_here .gantt_grid");
            ["shanai-empty-notice", "trip-empty-notice"].forEach(function(id) {
                const el = document.getElementById(id);
                if (!el) return;
                if (!el.classList.contains("is-visible")) {
                    el.style.left = "";
                    el.style.top = "";
                    el.style.width = "";
                    el.style.height = "";
                    el.style.right = "";
                    el.style.bottom = "";
                    return;
                }
                const wr = wrap.getBoundingClientRect();
                const target = grid || wrap;
                const tr = target.getBoundingClientRect();
                el.style.left = (tr.left - wr.left) + "px";
                el.style.top = (tr.top - wr.top) + "px";
                el.style.width = tr.width + "px";
                el.style.height = tr.height + "px";
                el.style.right = "auto";
                el.style.bottom = "auto";
            });
        }
        window._layoutGanttEmptyNoticeOverGrid = _layoutGanttEmptyNoticeOverGrid;
        window._layoutGanttEmptyNoticeOverDataArea = _layoutGanttEmptyNoticeOverGrid;

        function _scheduleLayoutGanttEmptyNotices() {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    if (typeof window._layoutGanttEmptyNoticeOverGrid === "function") {
                        window._layoutGanttEmptyNoticeOverGrid();
                    }
                });
            });
        }

        /** 工程表／出張シートで、左で選んだ工番に片方の工程しかないときの案内を表示 */
        function _updateGanttEmptyNotices() {
            const shanaiEl = document.getElementById("shanai-empty-notice");
            const tripEl = document.getElementById("trip-empty-notice");
            if (shanaiEl) shanaiEl.classList.remove("is-visible");
            if (tripEl) tripEl.classList.remove("is-visible");
            if (currentFilter) {
                const tasks = window.allTasks;
                if (Array.isArray(tasks)) {
                    const pNum = String(currentFilter).trim();
                    let hasShanai = false;
                    let hasTrip = false;
                    for (let i = 0; i < tasks.length; i++) {
                        const t = tasks[i];
                        if (String(t.project_number || "").trim() !== pNum) continue;
                        if (_isBusinessTripTaskRow(t)) hasTrip = true;
                        else hasShanai = true;
                    }
                    const mode = typeof currentDisplayMode !== "undefined" ? currentDisplayMode : "process";
                    if (mode === "business_trip") {
                        if (!hasTrip && hasShanai && tripEl) tripEl.classList.add("is-visible");
                    } else {
                        if (!hasShanai && hasTrip && shanaiEl) shanaiEl.classList.add("is-visible");
                    }
                }
            }
            _scheduleLayoutGanttEmptyNotices();
        }
        window._updateShanaiEmptyNotice = _updateGanttEmptyNotices;

        /** 工事一覧ホバー用ツールチップ（ラベル＋行ごと色分けで種別を判別しやすく） */
        function fillProjectListTooltip(tooltipEl, info, salesPerson) {
            tooltipEl.replaceChildren();
            const rows = [
                { label: "客先名", value: (info.customer || "").trim(), kind: "customer" },
                { label: "工事名", value: (info.details || "").trim(), kind: "project" },
                { label: "営業担当", value: (salesPerson || "").trim(), kind: "sales" }
            ];
            rows.forEach(r => {
                if (!r.value) return;
                const row = document.createElement("div");
                row.className = "custom-tooltip-row custom-tooltip-row--" + r.kind;
                const lab = document.createElement("span");
                lab.className = "custom-tooltip-label";
                lab.textContent = r.label;
                const val = document.createElement("span");
                val.className = "custom-tooltip-value";
                val.textContent = r.value;
                row.appendChild(lab);
                row.appendChild(val);
                tooltipEl.appendChild(row);
            });
        }

        function updateProjectList(tasks) {
            const listEl = document.getElementById('project_list');
            const projectKindMap = _buildProjectKindMap(tasks);
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
            } else if (currentProjectGroupFilter === 'sales' && currentSalesPersonFilter) {
                projects = projects.filter(p => _salesPersonMap[p] === currentSalesPersonFilter);
            }
            listEl.innerHTML = "";
            let tooltip = document.getElementById('custom_project_tooltip') || document.createElement('div');
            tooltip.id = 'custom_project_tooltip'; tooltip.className = 'custom-tooltip'; document.body.appendChild(tooltip);
            projects.forEach(p => {
                const item = document.createElement('div');
                item.className = `project-item ${currentFilter === p ? 'active' : ''}`;
                const numEl = document.createElement('span');
                numEl.className = 'project-item__num';
                numEl.textContent = p;
                const kind = projectKindMap[p] || { shanai: false, trip: false };
                if (kind.trip && !kind.shanai) {
                    item.classList.add('project-item--trip-only');
                }
                item.appendChild(numEl);
                const info = projectInfoMap[p];
                const salesPerson = _salesPersonMap[p] || "";
                if (info.customer || info.details || salesPerson) {
                    item.onmouseenter = (e) => {
                        fillProjectListTooltip(tooltip, info, salesPerson);
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
            if (typeof window._updateShanaiEmptyNotice === 'function') window._updateShanaiEmptyNotice();
        }

        const _lastProjectFilterOpenedVirtualIds = new Set();
        function filterByProject(p) { 
            const scrollState = gantt.getScrollState();
            currentFilter = (currentFilter === p) ? null : p; 
            
            // フィルタ変更時に再描画
            gantt.render();
            if (currentFilter) {
                _openOnlyFilteredProjectVirtual(currentFilter);
            } else if (!_hasActiveSearchFilter()) {
                _collapseLastProjectFilterVirtual();
            }
            
            gantt.scrollTo(scrollState.x, scrollState.y);
            if (typeof updateProjectList === 'function') {
                updateProjectList(window.allTasks); 
            }
            if (typeof window._updateShanaiEmptyNotice === 'function') window._updateShanaiEmptyNotice();
        }
        function filterByMajorItem(major) {
            const scrollState = gantt.getScrollState();
            if (!major) {
                currentMajorFilters.clear();
            } else if (currentMajorFilters.has(major)) {
                currentMajorFilters.delete(major);
            } else {
                currentMajorFilters.add(major);
            }

            _updateMajorFilterBtn();

            // フィルタ変更時に再描画
            gantt.render();

            // フィルタステータスの更新
            const statusEl = document.getElementById('filter_status');
            if (statusEl) {
                const arr = Array.from(currentMajorFilters);
                if (arr.length > 0) {
                    statusEl.innerText = arr.join('・') + 'を表示中';
                    statusEl.style.display = '';
                } else {
                    statusEl.style.display = 'none';
                }
            }

            gantt.scrollTo(scrollState.x, scrollState.y);
        }

        function _updateMajorFilterBtn() {
            const label = document.getElementById('major-filter-label');
            if (label) {
                const arr = Array.from(currentMajorFilters);
                if (arr.length === 0) label.textContent = '全部署';
                else if (arr.length === 1) label.textContent = arr[0];
                else label.textContent = arr.length + '部署選択中';
            }
            const btn = document.getElementById('major-filter-btn');
            if (btn) btn.classList.toggle('active', currentMajorFilters.size > 0);
            const depts = ['営業','設計','製管','組立','電装','品証','操業','電技','明石'];
            depts.forEach(function(dept) {
                const chk = document.getElementById('major-chk-' + dept);
                if (chk) chk.checked = currentMajorFilters.has(dept);
            });
        }

        function toggleMajorFilterDropdown(event) {
            event.stopPropagation();
            const dd = document.getElementById('major-filter-dropdown');
            if (!dd) return;
            // 他のドロップダウンを閉じる
            const otherDd = document.getElementById('resource-dept-dropdown');
            if (otherDd) otherDd.style.display = 'none';
            const otherArrow = document.getElementById('resource-dept-arrow');
            if (otherArrow) otherArrow.textContent = '▶';
            const nowOpen = dd.style.display === 'none';
            dd.style.display = nowOpen ? '' : 'none';
            const arrow = document.getElementById('major-filter-arrow');
            if (arrow) arrow.textContent = nowOpen ? '▼' : '▶';
        }

        document.addEventListener('click', function(e) {
            const wrapper = document.getElementById('major-filter-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                const dd = document.getElementById('major-filter-dropdown');
                if (dd) dd.style.display = 'none';
                const arrow = document.getElementById('major-filter-arrow');
                if (arrow) arrow.textContent = '▶';
            }
            const rWrapper = document.getElementById('resource-dept-wrapper');
            if (rWrapper && !rWrapper.contains(e.target)) {
                const rDd = document.getElementById('resource-dept-dropdown');
                if (rDd) rDd.style.display = 'none';
                const rArrow = document.getElementById('resource-dept-arrow');
                if (rArrow) rArrow.textContent = '▶';
            }
        });

        // 部署別リソースのドロップダウン開閉
        function toggleResourceDeptDropdown(event) {
            event.stopPropagation();
            const dd = document.getElementById('resource-dept-dropdown');
            if (!dd) return;
            // 他のドロップダウンを閉じる
            const otherDd = document.getElementById('major-filter-dropdown');
            if (otherDd) otherDd.style.display = 'none';
            const otherArrow = document.getElementById('major-filter-arrow');
            if (otherArrow) otherArrow.textContent = '▶';
            const nowOpen = dd.style.display === 'none';
            dd.style.display = nowOpen ? '' : 'none';
            const arrow = document.getElementById('resource-dept-arrow');
            if (arrow) arrow.textContent = nowOpen ? '▼' : '▶';
        }

        // 部署別リソースの選択
        function selectResourceDept(value) {
            const dd = document.getElementById('resource-dept-dropdown');
            if (dd) dd.style.display = 'none';
            const arrow = document.getElementById('resource-dept-arrow');
            if (arrow) arrow.textContent = '▶';
            _updateResourceDeptBtn(value);
            if (typeof filterByDepartmentSelect === 'function') {
                filterByDepartmentSelect(value);
            }
        }

        // 部署別リソース ボタンのラベル/選択状態を更新
        function _updateResourceDeptBtn(value) {
            const label = document.getElementById('resource-dept-label');
            if (label) label.textContent = value ? value : '－';
            const btn = document.getElementById('resource-dept-select');
            if (btn) btn.classList.toggle('active', !!value);
            document.querySelectorAll('#resource-dept-dropdown .resource-dept-item').forEach(function(item) {
                item.classList.toggle('selected', item.getAttribute('data-dept') === value);
            });
        }
        // グローバル公開（他ファイルから呼び出すため）
        window._updateResourceDeptBtn = _updateResourceDeptBtn;
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
        function _openOnlyFilteredProjectVirtual(projectNumber) {
            const target = String(projectNumber || "");
            if (!target) return;
            _lastProjectFilterOpenedVirtualIds.clear();
            gantt.eachTask(function(task) {
                if (!task.$virtual) return;
                const pNum = String(task.project_number || "");
                if (pNum === target) {
                    gantt.open(task.id);
                    _lastProjectFilterOpenedVirtualIds.add(task.id);
                }
            });
        }
        function _collapseLastProjectFilterVirtual() {
            _lastProjectFilterOpenedVirtualIds.forEach(function(id) {
                if (gantt.isTaskExists(id)) gantt.close(id);
            });
            _lastProjectFilterOpenedVirtualIds.clear();
        }
        function _hasActiveSearchFilter() {
            return !!(currentOwnerFilter || currentMachineFilter || currentTaskFilter);
        }

        function _showFilterLoading(show) {
            let el = document.getElementById('search-filter-loading');
            if (!el) return;
            el.style.display = show ? 'flex' : 'none';
        }

        let _filterDebounceTimer = null;
        function _applyFilterDebounced(setFn, expandIfActive) {
            setFn();
            clearTimeout(_filterDebounceTimer);
            _showFilterLoading(true);
            _filterDebounceTimer = setTimeout(function() {
                const scrollState = gantt.getScrollState();
                gantt.render();
                if (expandIfActive()) {
                    _expandAllVirtual();
                } else if (!_hasActiveSearchFilter()) {
                    _collapseAllVirtual();
                }
                gantt.scrollTo(scrollState.x, scrollState.y);
                _showFilterLoading(false);
            }, 300);
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
            document.getElementById('spec_folder_url_input').value = '';
        }

        async function addProjectFromTemplate() {
            const projectNumber = document.getElementById('project_number').value.trim();
            const customerName = document.getElementById('customer_name_input').value.trim();
            const projectDetails = document.getElementById('project_details_input').value.trim();
            const salesPerson = document.getElementById('sales_person_input').value.trim();
            const orderDateValue = document.getElementById('order_date').value;
            const shippingDateValue = document.getElementById('shipping_date').value;
            const specFolderUrl = document.getElementById('spec_folder_url_input').value.trim();
            const resolveMajorItemForTask = (taskName, fallbackMajorItem) => {
                if (taskName === "出荷準備(組立)") return "組立";
                if (taskName === "出荷準備(電装)") return "電装";
                return fallbackMajorItem || null;
            };

            if (!projectNumber) {
                alert("工事番号を入力してください");
                return;
            }
            if (specFolderUrl) {
                try {
                    new URL(specFolderUrl);
                } catch (_) {
                    alert("仕様書フォルダURLの形式が正しくありません");
                    return;
                }
            }

            // 工事番号からテンプレートテーブルを決定
            // 3T・4T始まり → task_template_b、3000・4000番台・D番 → task_template_a、それ以外(2000番台) → task_template
            let templateTable;
            if (/^[34]T/i.test(projectNumber)) {
                templateTable = 'task_template_b';
            } else if (/^[34]/i.test(projectNumber)) {
                templateTable = 'task_template_a';
            } else if (/^D/i.test(projectNumber)) {
                templateTable = 'task_template_a';
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
                    const majorItem = resolveMajorItemForTask(item.name, item.major_item);
                    newTasks.push({
                        project_number: projectNumber,
                        customer_name: customerName || "",
                        project_details: projectDetails || "",
                        text: item.name,
                        parent: "",
                        major_item: majorItem,
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
                            const majorItem = resolveMajorItemForTask(optName, item.major_item);
                            newTasks.push({
                                project_number: projectNumber,
                                customer_name: customerName || "",
                                project_details: projectDetails || "",
                                text: optName,
                                parent: item.name,
                                major_item: majorItem,
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

            // 「基本設計＆計画承認」配下は新規作成時のみ自動計算で初期値を設定する。
            // 以降はDB保存値（ドラッグ変更値）をそのまま使うため、fetch時には上書きしない。
            const orderTaskForInit = newTasks.find(t => t.parent === "受注" || t.text === "受注");
            const drawingTaskForInit = newTasks.find(t => t.parent === "出図＆部品手配" || t.text === "出図＆部品手配");
            if (orderTaskForInit && drawingTaskForInit) {
                const orderStart = new Date(orderTaskForInit.start_date);
                const basicStart = gantt.calculateEndDate(orderStart, orderTaskForInit.duration || 1);
                const drawingStart = new Date(drawingTaskForInit.start_date);
                const diffTime = drawingStart.getTime() - basicStart.getTime();
                const basicDuration = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                newTasks.forEach(t => {
                    if (t.parent === "基本設計＆計画承認") {
                        t.start_date = dateToDb(basicStart);
                        t.duration = basicDuration;
                    }
                });
            }

            newTasks.forEach(function(t) {
                t.end_date = inclusiveEndDateToDb(t.start_date, t.duration);
            });

            // 4. Supabaseに一括挿入
            const { error: insertError } = await supabaseClient
                .from('tasks')
                .insert(newTasks);

            if (insertError) {
                console.error("Insert error:", insertError);
                alert("プロジェクトの作成に失敗しました");
            } else {
                try {
                    await upsertSpecFolderUrl(projectNumber, specFolderUrl);
                } catch (e) {
                    console.error("spec_folder_url_map upsert error:", e);
                    alert("工事は作成しましたが、仕様書フォルダURLの保存に失敗しました");
                }
                try {
                    await upsertSalesPersonEntry(projectNumber, salesPerson);
                } catch (e) {
                    console.error("sales_person_map upsert error:", e);
                }
                alert(`工事番号 ${projectNumber} を作成しました`);
                // フォームをリセット・非表示
                document.getElementById('new-project-modal-overlay').classList.remove('visible');
                document.getElementById('project_number').value = '';
                document.getElementById('customer_name_input').value = '';
                document.getElementById('project_details_input').value = '';
                document.getElementById('sales_person_input').value = '';
                document.getElementById('order_date').value = '';
                document.getElementById('shipping_date').value = '';
                document.getElementById('spec_folder_url_input').value = '';
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
        let _updateBannerHideTimer = null;

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
        function _buildPublishDiffLog(prevTasks, nextTasks, alreadyLoggedKeys) {
            const editorName = (window._getCurrentEditorName && window._getCurrentEditorName()) || '';
            const COMPARE_FIELDS = [
                { key: 'text',             label: 'タスク名を変更' },
                { key: 'start_date',       label: '開始日を変更' },
                { key: 'end_date',         label: '終了日を変更' },
                { key: 'owner',            label: '担当者を変更' },
                { key: 'major_item',       label: '部署を変更' },
                { key: 'parent',           label: '見出しを変更' },
                { key: 'machine',          label: '機械名を変更' },
                { key: 'unit',             label: 'ユニットを変更' },
                { key: 'project_number',   label: '工事番号を変更' },
            ];
            const _isDetailed = t => (t.is_detailed === true || String(t.is_detailed).toLowerCase() === "true" || String(t.is_detailed).toLowerCase() === "t" || String(t.is_detailed) === "1");
            const prevMap = new Map(prevTasks.filter(t => !_isDetailed(t)).map(t => [String(t.id), t]));
            const nextMap = new Map(nextTasks.filter(t => !_isDetailed(t)).map(t => [String(t.id), t]));
            const rows = [];

            const makeRow = (task, desc) => ({
                source:         '全体工程表',
                changed_by:     task.last_updated_by || editorName,
                project_number: (task.project_number || '').toString(),
                machine:        (task.machine        || '').toString(),
                unit:           (task.unit           || '').toString(),
                task_text:      (task.text           || '').toString(),
                description:    desc
            });
            const logKey = t => [
                (t.project_number || ''), (t.machine || ''), (t.unit || ''), (t.text || '')
            ].join('\x00').toLowerCase();
            const isAlreadyLogged = t =>
                alreadyLoggedKeys && isAssemblyTaskRow(t) && alreadyLoggedKeys.has(logKey(t));

            // 追加検出
            for (const [id, t] of nextMap) {
                if (!prevMap.has(id) && !isAlreadyLogged(t)) rows.push(makeRow(t, 'タスクを追加しました'));
            }

            // 変更検出
            for (const [id, newT] of nextMap) {
                const oldT = prevMap.get(id);
                if (!oldT) continue;
                if (isAlreadyLogged(newT)) continue;
                const changes = [];
                for (const { key, label } of COMPARE_FIELDS) {
                    const ov = oldT[key] == null ? '' : String(oldT[key]);
                    const nv = newT[key] == null ? '' : String(newT[key]);
                    if (ov !== nv) changes.push(label);
                }
                // 完了フラグ
                if (String(oldT.is_completed) !== String(newT.is_completed)) {
                    changes.push(newT.is_completed ? '完了に変更' : '未完了に変更');
                }
                // 場所（area_group / area_number をまとめて1件）
                const areaChanged = ['area_group', 'area_number'].some(k =>
                    (oldT[k] == null ? '' : String(oldT[k])) !== (newT[k] == null ? '' : String(newT[k]))
                );
                if (areaChanged) changes.push('場所を変更');
                // 出張フラグ
                if (String(oldT.is_business_trip) !== String(newT.is_business_trip)) {
                    changes.push(newT.is_business_trip ? '出張予定に変更' : '出張予定を解除');
                }
                if (changes.length > 0) rows.push(makeRow(newT, changes.join('・')));
            }
            return rows;
        }

        async function publishNow() {
            const btn = document.getElementById('publish_btn');
            btn.classList.add('publishing');
            btn.textContent = '更新中...';
            const now = new Date().toISOString();

            // 前回スナップショット・前回公開日時・現在タスクを並行取得
            const [{ data: taskSnap }, { data: locSnap }, { data: prevSnapRow }, { data: prevAtRow }] = await Promise.all([
                supabaseClient.from('tasks').select('*').order('sort_order', { ascending: true }),
                supabaseClient.from('task_locations').select('*'),
                supabaseClient.from('app_settings').select('value').eq('key', 'published_tasks').maybeSingle(),
                supabaseClient.from('app_settings').select('value').eq('key', 'published_at').maybeSingle()
            ]);

            // 前回公開以降に組立工程表が既に記録済みのタスクキーを取得（二重記録防止）
            let alreadyLoggedKeys = null;
            if (prevAtRow && prevAtRow.value) {
                try {
                    const { data: recentLogs } = await supabaseClient
                        .from('change_log')
                        .select('project_number, machine, unit, task_text')
                        .eq('source', '組立工程表')
                        .gte('changed_at', prevAtRow.value);
                    if (recentLogs && recentLogs.length > 0) {
                        alreadyLoggedKeys = new Set(recentLogs.map(r =>
                            [r.project_number || '', r.machine || '', r.unit || '', r.task_text || ''].join('\x00').toLowerCase()
                        ));
                    }
                } catch(e) {
                    console.warn('既存ログ取得エラー:', e);
                }
            }

            // 前回スナップショットとの差分を change_log に記録
            if (prevSnapRow) {
                try {
                    const prevTasks = JSON.parse(prevSnapRow.value || '[]');
                    const logRows = _buildPublishDiffLog(prevTasks, taskSnap || [], alreadyLoggedKeys);
                    if (logRows.length > 0) {
                        await supabaseClient.from('change_log').insert(logRows);
                    }
                } catch(e) {
                    console.warn('変更履歴の差分記録エラー:', e);
                }
            }

            await supabaseClient.from('app_settings').upsert([
                { key: 'published_tasks', value: JSON.stringify(taskSnap  || []) },
                { key: 'published_locs',  value: JSON.stringify(locSnap   || []) }
            ], { onConflict: 'key' });

            const { error } = await supabaseClient
                .from('app_settings')
                .upsert({ key: 'published_at', value: now }, { onConflict: 'key' });
            btn.classList.remove('publishing');
            btn.textContent = '🔄 更新';
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


        // 閲覧者：バナーを表示（5秒後に自動で閉じる）
        function showBanner(publishedAt) {
            if (_updateBannerHideTimer) {
                clearTimeout(_updateBannerHideTimer);
                _updateBannerHideTimer = null;
            }
            const d = new Date(publishedAt);
            const label = d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' +
                String(d.getDate()).padStart(2,'0') + ' ' +
                String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            const msg = document.getElementById('update-banner-msg');
            if (msg) msg.textContent = '🔔 工程表が更新されました（' + label + ' 公開）';
            const banner = document.getElementById('update-banner');
            if (banner) banner.style.display = 'flex';
            _updateBannerHideTimer = setTimeout(function() {
                _updateBannerHideTimer = null;
                hideBanner();
            }, 5000);
        }

        function hideBanner() {
            if (_updateBannerHideTimer) {
                clearTimeout(_updateBannerHideTimer);
                _updateBannerHideTimer = null;
            }
            const banner = document.getElementById('update-banner');
            if (!banner || banner.style.display === 'none') return;
            banner.classList.add('hiding');
            setTimeout(function() {
                banner.style.display = 'none';
                banner.classList.remove('hiding');
            }, 400);
        }

        // Realtime：app_settings の変更をリアルタイムで受信
        let _realtimeChannel = null;
        let _assemblyTaskChannel = null;

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
                        _knownPublishedAt = latest;
                        fetchTasks()
                            .then(function() { showBanner(latest); })
                            .catch(function(err) {
                                console.error('[fetchTasks] 閲覧者の自動更新', err);
                            });
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
                        _knownPublishedAt = latest;
                        fetchTasks()
                            .then(function() { showBanner(latest); })
                            .catch(function(err) {
                                console.error('[fetchTasks] 閲覧者の自動更新', err);
                            });
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

        // 組立工程表（別画面）からの tasks 変更を更新履歴に残す（ローカル編集は _suppressAssemblyBannerUntil で除外）
        async function logAssemblyRealtimeChange(payload) {
            if (!_isEditor) return;
            payload = enrichAssemblyRealtimePayload(payload);
            const ev = String(payload.eventType || '').toUpperCase();
            const rowNew = payload.new || null;
            const rowOld = payload.old || null;
            const row = rowNew || rowOld;
            if (!row) return;
            /* DELETE の change_log は DB トリガー（change_log_task_delete_trigger.sql）が
               OLD 行の内容で挿入する。Realtime の薄い payload では空欄になりやすいため。 */
            if (ev === "DELETE") {
                if (row.id != null) _assemblyLogSnapshotById.delete(String(row.id));
                if (row.id != null) _assemblyRecentLogByTaskId.delete(String(row.id));
                return;
            }
            const description = buildAssemblyChangeDescription(ev, rowNew, rowOld);
            if (shouldSkipAssemblyRealtimeLog(row, description)) {
                rememberAssemblyTaskSnapshot(row);
                return;
            }
            try {
                await supabaseClient.from('change_log').insert({
                    source: '組立工程表',
                    changed_by: (rowNew && rowNew.last_updated_by) || '',
                    project_number: (row.project_number || '').toString(),
                    machine: (row.machine || '').toString(),
                    unit: (row.unit || '').toString(),
                    task_text: (row.text || '').toString(),
                    description
                });
                rememberAssemblyTaskSnapshot(row);
            } catch (e) {
                console.warn('組立工程表の変更履歴保存エラー:', e);
            }
        }

        // 編集者向け：組立工程表のタスク変更をRealtime受信して通知
        function startAssemblyTaskWatch() {
            stopAssemblyTaskWatch();
            _assemblyTaskChannel = supabaseClient
                .channel('assembly_tasks_changes')
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'tasks'
                }, function(payload) {
                    if (!_isEditor) return;
                    const rawOld = payload.old || null;
                    const p = enrichAssemblyRealtimePayload(payload);
                    // 自タブで直前に保存した同一 task の echo のみ除外（全体の保存直後4秒で他タブ組立まで無視しない）
                    if (shouldSuppressAssemblyRealtimeByTask(p, rawOld)) return;

                    // 組立・設計など別画面の DB 更新をガントに反映（自タブ echo は上で除外済み）
                    scheduleFetchTasksAfterRemoteTaskChange();

                    const rowNew = mergeTasksRowForAssemblyWatch(p.new || null);
                    const rowOld = mergeTasksRowForAssemblyWatch(p.old || null);
                    let skipDuplicateAssemblyLog = false;
                    const _rlRow = rowNew || rowOld;
                    if (_rlRow) {
                        const _rlExp = _recentLocalLogs.get(_makeLocalLogKey(
                            _rlRow.project_number, _rlRow.machine, _rlRow.unit, _rlRow.text));
                        if (_rlExp != null && Date.now() < _rlExp) skipDuplicateAssemblyLog = true;
                    }
                    const ev = String(payload.eventType || "").toUpperCase();
                    const delRow = (ev === "DELETE" && (p.old || rawOld)) ? mergeTasksRowForAssemblyWatch(p.old || rawOld) : null;
                    const isTarget = isAssemblyTaskRow(rowNew) || isAssemblyTaskRow(rowOld)
                        || (ev === "DELETE" && delRow && isAssemblyTaskRow(delRow));
                    if (!isTarget) return;
                    if (Date.now() < _suppressAssemblyBannerUntil) return;
                    if (skipDuplicateAssemblyLog) return;
                    void logAssemblyRealtimeChange(p);
                })
                .subscribe();
        }

        function stopAssemblyTaskWatch() {
            if (_assemblyTaskChannel) {
                supabaseClient.removeChannel(_assemblyTaskChannel);
                _assemblyTaskChannel = null;
            }
        }

        /** 組立工程表（別タブ）等からの tasks Realtime 後に DB を再取得してガントを同期（連打はデバウンス） */
        let _assemblyRealtimeFetchTimer = null;
        function scheduleFetchTasksAfterRemoteTaskChange() {
            if (_assemblyRealtimeFetchTimer) clearTimeout(_assemblyRealtimeFetchTimer);
            _assemblyRealtimeFetchTimer = setTimeout(function() {
                _assemblyRealtimeFetchTimer = null;
                fetchTasks().catch(function(err) {
                    console.error('[fetchTasks] tasks Realtime 後の再同期', err);
                });
            }, 400);
        }

        // 別タブ/別ブラウザから復帰した際に、カレンダーヘッダー文字が消える現象を防ぐ
        // 検知条件に頼らず、復帰後に必ずスケールを再構築する。
        // setLevel の2連呼び出しは同期処理のため画面フラッシュは発生しない。
        const refreshCalendarHeaderAfterReturn = (() => {
            let t1 = null, t2 = null;

            function rebuildScale() {
                try {
                    if (!(gantt.ext && gantt.ext.zoom)) return;
                    const zoom = (typeof gantt.ext.zoom.getCurrentLevel === 'function')
                        ? (gantt.ext.zoom.getCurrentLevel() || 'days') : 'days';
                    if (typeof gantt.setSizes === 'function') gantt.setSizes();
                    // setLevel を別レベル→元レベルの順に呼ぶことでスケール設定を強制再構築
                    const fallback = zoom === 'days' ? 'weeks' : 'days';
                    gantt.ext.zoom.setLevel(fallback);
                    gantt.ext.zoom.setLevel(zoom);
                    if (typeof gantt.render === 'function') gantt.render();
                } catch (e) {
                    console.warn('calendar header rebuild error:', e);
                }
            }

            return function() {
                clearTimeout(t1);
                clearTimeout(t2);
                // 100ms後に1回目（即時修復）
                t1 = setTimeout(rebuildScale, 100);
                // 500ms後に2回目（Gantt自身の遅延リサイズ後の再修復）
                t2 = setTimeout(rebuildScale, 500);
            };
        })();

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                refreshCalendarHeaderAfterReturn();
            }
        });
        window.addEventListener('focus', refreshCalendarHeaderAfterReturn);
        window.addEventListener('pageshow', refreshCalendarHeaderAfterReturn);

        // 認証状態変化時に公開ボタン表示/非表示を切り替え
        const _origUpdateUIForAuth = _updateUIForAuth;
        // gantt-setup.js の _updateUIForAuth をラップ（上書き）
        window._onAuthChanged = function(isEditor) {
            const publishBtn = document.getElementById('publish_btn');
            if (publishBtn) publishBtn.style.display = isEditor ? '' : 'none';
            if (isEditor) {
                stopPolling();
                hideBanner();
                startAssemblyTaskWatch();
            } else {
                stopAssemblyTaskWatch();
                startPolling();
            }
        };
        // ===== 公開・更新通知 ここまで =====

        // ===== 変更履歴ログ =====
        async function logChange(projectNumber, machine, unit, taskText, description, source) {
            if (!_isEditor) return;
            _recentLocalLogs.set(_makeLocalLogKey(projectNumber, machine, unit, taskText), Date.now() + 10000);
            try {
                await supabaseClient.from('change_log').insert({
                    source:         source        || '全体工程表',
                    changed_by:     (window._getCurrentEditorName && window._getCurrentEditorName()) || '',
                    project_number: projectNumber || '',
                    machine:        machine       || '',
                    unit:           unit          || '',
                    task_text:      taskText      || '',
                    description:    description   || ''
                });
            } catch(e) {
                console.warn('変更履歴保存エラー:', e);
            }
        }
        window.logChange = logChange;
        // ===== 変更履歴ログ ここまで =====

        // ===== 設計工程表との出図日付同期 =====
        async function syncDesignDrawingDates() {
            if (!_isEditor) return; // ログイン済みの場合のみ実行
            try {
                // 設計工程表の図面タスク（task_type='drawing'）を取得
                const { data: designTasks, error } = await supabaseClient
                    .from('tasks')
                    .select('project_number, machine, unit, start_date, end_date, last_updated_by')
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
                        groupMap[key] = { min_start: s, max_end: e, editors: new Set() };
                    } else {
                        if (s < groupMap[key].min_start) groupMap[key].min_start = s;
                        if (e > groupMap[key].max_end)   groupMap[key].max_end = e;
                    }
                    const editor = (t.last_updated_by || '').trim();
                    if (editor) groupMap[key].editors.add(editor);
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
                        start_date: newStartDate, duration: newDuration,
                        editorsStr: [...(group.editors || [])].join('・')
                    });
                });

                if (dbUpdates.length === 0) return;

                // Supabaseを一括更新
                await Promise.all(dbUpdates.map(u =>
                    supabaseClient.from('tasks')
                        .update(Object.assign({
                            start_date: u.start_date,
                            duration: u.duration,
                            end_date: inclusiveEndDateToDb(u.start_date, u.duration)
                        }, (window._editorLastTouchPatch && window._editorLastTouchPatch()) || {}))
                        .eq('id', u.id)
                ));

                // 変更履歴を保存
                const logRows = dbUpdates.map(u => ({
                    source:         '設計工程表',
                    changed_by:     u.editorsStr || '',
                    project_number: u.project_number,
                    machine:        u.machine,
                    unit:           u.unit,
                    task_text:      '出図',
                    description:    '開始日・終了日を変更'
                }));
                await supabaseClient.from('change_log').insert(logRows);

                const syncCount = dbUpdates.length;
                console.log(`出図タスク ${syncCount} 件の日付を設計工程表と同期しました`);
                // 更新後に再描画
                await fetchTasks();
            } catch (e) {
                console.warn('出図タスク日付同期エラー:', e);
            }
        }
        // ===== 設計工程表との出図日付同期 ここまで =====


        // ===== 更新履歴モーダル =====
        let _syncLogData = []; // 取得した全データをキャッシュ
        let _syncLogFilter = {
            keyword: '',
            dateFrom: '',
            dateTo: '',
            preset: ''
        };
        let _syncLogTableHeaderStickyTop = 0;

        async function openSyncLogModal() {
            document.getElementById('sync-log-overlay').style.display = 'block';
            const content = document.getElementById('sync-log-content');
            content.innerHTML = '<div style="color:#999; text-align:center; padding:20px;">読み込み中...</div>';

            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

            const { data, error } = await supabaseClient
                .from('change_log')
                .select('*')
                .gte('changed_at', oneMonthAgo.toISOString())
                .order('changed_at', { ascending: false })
                .limit(500);

            if (error) {
                content.innerHTML = '<div style="color:#f44; text-align:center; padding:20px;">change_log の取得に失敗しました。テーブル未作成の場合は create_change_log.sql、既存DBに source 列が無い場合は add_change_log_source_column.sql を Supabase で実行してください。</div>';
                return;
            }
            if (!data || data.length === 0) {
                content.innerHTML = '<div style="color:#999; text-align:center; padding:20px;">過去1ヶ月の更新履歴はありません</div>';
                return;
            }

            _syncLogData = data;
            const dates = data
                .map((row) => _toDateKey(row.changed_at))
                .filter(Boolean)
                .sort();
            const minDate = dates[0] || '';
            const maxDate = dates[dates.length - 1] || '';
            _syncLogFilter = {
                keyword: '',
                dateFrom: minDate,
                dateTo: maxDate,
                preset: ''
            };
            _renderSyncLog();
        }

        function _toDateKey(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        function _setSyncLogFilterKeyword(value) {
            _syncLogFilter.keyword = (value || '').trim();
            _renderSyncLogTable();
        }
        window.setSyncLogFilterKeyword = _setSyncLogFilterKeyword;

        function _setSyncLogFilterDateFrom(value) {
            _syncLogFilter.dateFrom = value || '';
            _syncLogFilter.preset = '';
            _renderSyncLog();
        }
        window.setSyncLogFilterDateFrom = _setSyncLogFilterDateFrom;

        function _setSyncLogFilterDateTo(value) {
            _syncLogFilter.dateTo = value || '';
            _syncLogFilter.preset = '';
            _renderSyncLog();
        }
        window.setSyncLogFilterDateTo = _setSyncLogFilterDateTo;

        function _setSyncLogFilterPreset(preset) {
            const now = new Date();
            const make = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const day = now.getDay();
            if (preset === 'thisWeek') {
                const monday = new Date(now);
                const delta = day === 0 ? 6 : day - 1;
                monday.setDate(now.getDate() - delta);
                _syncLogFilter.dateFrom = make(monday);
                _syncLogFilter.dateTo = make(now);
                _syncLogFilter.preset = 'thisWeek';
            } else if (preset === 'lastWeek') {
                const thisMonday = new Date(now);
                const delta = day === 0 ? 6 : day - 1;
                thisMonday.setDate(now.getDate() - delta);
                const lastMonday = new Date(thisMonday);
                lastMonday.setDate(thisMonday.getDate() - 7);
                const lastSunday = new Date(thisMonday);
                lastSunday.setDate(thisMonday.getDate() - 1);
                _syncLogFilter.dateFrom = make(lastMonday);
                _syncLogFilter.dateTo = make(lastSunday);
                _syncLogFilter.preset = 'lastWeek';
            } else {
                const dates = _syncLogData
                    .map((row) => _toDateKey(row.changed_at))
                    .filter(Boolean)
                    .sort();
                _syncLogFilter.dateFrom = dates[0] || '';
                _syncLogFilter.dateTo = dates[dates.length - 1] || '';
                _syncLogFilter.preset = '';
            }
            _renderSyncLog();
        }
        window.setSyncLogFilterPreset = _setSyncLogFilterPreset;

        function _clearSyncLogFilter() {
            const dates = _syncLogData
                .map((row) => _toDateKey(row.changed_at))
                .filter(Boolean)
                .sort();
            _syncLogFilter.keyword = '';
            _syncLogFilter.dateFrom = dates[0] || '';
            _syncLogFilter.dateTo = dates[dates.length - 1] || '';
            _syncLogFilter.preset = '';
            _renderSyncLog();
        }
        window.clearSyncLogFilter = _clearSyncLogFilter;

        function _setSyncLogBtnHover(btn, kind, isHover) {
            if (!btn) return;
            if (kind === 'green') {
                btn.style.background = isHover ? '#66bb6a' : '#81c784';
                btn.style.borderColor = isHover ? '#5aa95d' : '#66bb6a';
            } else {
                btn.style.background = isHover ? '#f3f4f6' : '#fff';
                btn.style.borderColor = isHover ? '#bfc6cc' : '#d5d5d5';
            }
        }
        window.setSyncLogBtnHover = _setSyncLogBtnHover;

        function _setSyncLogBtnPressed(btn, isPressed) {
            if (!btn) return;
            if (isPressed) {
                btn.style.transform = 'translateY(1px)';
                btn.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.18)';
            } else {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = 'none';
            }
        }
        window.setSyncLogBtnPressed = _setSyncLogBtnPressed;

        function _getFilteredSyncLogRows() {
            const keyword = (_syncLogFilter.keyword || '').toLowerCase();
            return _syncLogData.filter((row) => {
                const dateKey = _toDateKey(row.changed_at);
                if (_syncLogFilter.dateFrom && dateKey && dateKey < _syncLogFilter.dateFrom) return false;
                if (_syncLogFilter.dateTo && dateKey && dateKey > _syncLogFilter.dateTo) return false;
                if (!keyword) return true;
                const target = [
                    row.project_number || '',
                    row.machine || '',
                    row.unit || '',
                    row.task_text || '',
                    row.description || '',
                    row.changed_by || ''
                ].join(' ').toLowerCase();
                return target.indexOf(keyword) >= 0;
            });
        }

        function _renderSyncLog() {
            const content = document.getElementById('sync-log-content');
            const filterHtml = `<div id="sync-log-filter-wrap" style="position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid #dfe5ea;padding:8px 0 8px 0;box-shadow:0 -1px 0 #fff, 0 1px 0 #fff;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                    <label style="font-size:12px;color:#555;white-space:nowrap;">キーワード</label>
                    <input type="text" value="${_syncLogFilter.keyword || ''}" placeholder="工事番号・タスク名・変更内容・変更者..." oninput="setSyncLogFilterKeyword(this.value)" style="flex:1;min-width:280px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:12px;color:#555;white-space:nowrap;">期間</label>
                    <input type="date" value="${_syncLogFilter.dateFrom || ''}" onchange="setSyncLogFilterDateFrom(this.value)" style="padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
                    <span style="font-size:12px;color:#666;">〜</span>
                    <input type="date" value="${_syncLogFilter.dateTo || ''}" onchange="setSyncLogFilterDateTo(this.value)" style="padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
                    <button onclick="setSyncLogFilterPreset('thisWeek')" onmouseover="setSyncLogBtnHover(this,'${_syncLogFilter.preset === 'thisWeek' ? 'green' : 'white'}',true)" onmouseout="setSyncLogBtnHover(this,'${_syncLogFilter.preset === 'thisWeek' ? 'green' : 'white'}',false)" onmousedown="setSyncLogBtnPressed(this,true)" onmouseup="setSyncLogBtnPressed(this,false)" onmouseleave="setSyncLogBtnPressed(this,false)" style="padding:4px 8px;border:1px solid ${_syncLogFilter.preset === 'thisWeek' ? '#66bb6a' : '#d5d5d5'};border-radius:4px;background:${_syncLogFilter.preset === 'thisWeek' ? '#81c784' : '#fff'};font-size:12px;cursor:pointer;color:${_syncLogFilter.preset === 'thisWeek' ? '#fff' : '#333'};font-weight:${_syncLogFilter.preset === 'thisWeek' ? '700' : '400'};transition:background-color .12s,border-color .12s,transform .06s,box-shadow .06s;">今週</button>
                    <button onclick="setSyncLogFilterPreset('lastWeek')" onmouseover="setSyncLogBtnHover(this,'${_syncLogFilter.preset === 'lastWeek' ? 'green' : 'white'}',true)" onmouseout="setSyncLogBtnHover(this,'${_syncLogFilter.preset === 'lastWeek' ? 'green' : 'white'}',false)" onmousedown="setSyncLogBtnPressed(this,true)" onmouseup="setSyncLogBtnPressed(this,false)" onmouseleave="setSyncLogBtnPressed(this,false)" style="padding:4px 8px;border:1px solid ${_syncLogFilter.preset === 'lastWeek' ? '#66bb6a' : '#d5d5d5'};border-radius:4px;background:${_syncLogFilter.preset === 'lastWeek' ? '#81c784' : '#fff'};font-size:12px;cursor:pointer;color:${_syncLogFilter.preset === 'lastWeek' ? '#fff' : '#333'};font-weight:${_syncLogFilter.preset === 'lastWeek' ? '700' : '400'};transition:background-color .12s,border-color .12s,transform .06s,box-shadow .06s;">先週</button>
                    <button onclick="clearSyncLogFilter()" onmouseover="setSyncLogBtnHover(this,'green',true)" onmouseout="setSyncLogBtnHover(this,'green',false)" onmousedown="setSyncLogBtnPressed(this,true)" onmouseup="setSyncLogBtnPressed(this,false)" onmouseleave="setSyncLogBtnPressed(this,false)" style="padding:4px 8px;border:1px solid #66bb6a;border-radius:4px;background:#81c784;font-size:12px;cursor:pointer;color:#fff;font-weight:700;transition:background-color .12s,border-color .12s,transform .06s,box-shadow .06s;">クリア</button>
                    <span id="sync-log-count" style="margin-left:auto;font-size:12px;color:#666;"></span>
                </div>
            </div>`;
            const filterWrap = document.getElementById('sync-log-filter-wrap');
            _syncLogTableHeaderStickyTop = filterWrap ? filterWrap.offsetHeight : 0;
            content.innerHTML = `${filterHtml}<div style="position:sticky;top:${_syncLogTableHeaderStickyTop}px;height:2px;background:#fff;z-index:25;"></div><div id="sync-log-table-wrap"></div>`;
            _renderSyncLogTable();
        }

        function _renderSyncLogTable() {
            const tableWrap = document.getElementById('sync-log-table-wrap');
            if (!tableWrap) return;
            const countEl = document.getElementById('sync-log-count');
            const filterWrap = document.getElementById('sync-log-filter-wrap');
            if (filterWrap) {
                _syncLogTableHeaderStickyTop = filterWrap.offsetHeight;
            }
            const filteredRows = _getFilteredSyncLogRows();
            if (countEl) {
                countEl.textContent = `表示 ${filteredRows.length} / ${_syncLogData.length} 件`;
            }

            const fmtDt = (iso) => {
                if (!iso) return '';
                const d = new Date(iso);
                return `${String(d.getFullYear()).slice(-2)}/${d.getMonth()+1}/${d.getDate()} ` +
                    String(d.getHours()).padStart(2,'0') + ':' +
                    String(d.getMinutes()).padStart(2,'0');
            };

            const thStickyTop = Math.max(0, Number(_syncLogTableHeaderStickyTop) || 0);
            const thSticky = `position:sticky;top:${thStickyTop}px;z-index:6;background:#eceff1;background-clip:padding-box;box-shadow:0 2px 3px rgba(0,0,0,0.12);`;
            const thSep = 'border-top:2px solid #cfd8dc;border-bottom:2px solid #cfd8dc;';
            const cellWrap = 'word-break:break-word;overflow-wrap:anywhere;white-space:normal;vertical-align:top;';
            const SYNC_LOG_COL_PX = {
                changedAt: 132,
                projectNo: 84,
                machine: 68,
                unit: 76,
                taskText: 156,
                description: 352,
                changedBy: 96
            };
            const SYNC_LOG_TABLE_WIDTH_PX = SYNC_LOG_COL_PX.changedAt + SYNC_LOG_COL_PX.projectNo + SYNC_LOG_COL_PX.machine +
                SYNC_LOG_COL_PX.unit + SYNC_LOG_COL_PX.taskText + SYNC_LOG_COL_PX.description + SYNC_LOG_COL_PX.changedBy;
            const w = SYNC_LOG_COL_PX;
            let tableHtml = `<table style="width:${SYNC_LOG_TABLE_WIDTH_PX}px;margin:0;border-collapse:separate;border-spacing:0;font-size:12px;table-layout:fixed;">
                <colgroup>
                    <col style="width:${w.changedAt}px" />
                    <col style="width:${w.projectNo}px" />
                    <col style="width:${w.machine}px" />
                    <col style="width:${w.unit}px" />
                    <col style="width:${w.taskText}px" />
                    <col style="width:${w.description}px" />
                    <col style="width:${w.changedBy}px" />
                </colgroup>
                <thead>
                    <tr>
                        <th style="padding:6px 10px;text-align:left;white-space:nowrap;${thSep}${thSticky}">更新日時</th>
                        <th style="padding:6px 10px;text-align:left;white-space:nowrap;${thSep}${thSticky}">工事番号</th>
                        <th style="padding:6px 10px;text-align:left;white-space:nowrap;${thSep}${thSticky}">機械</th>
                        <th style="padding:6px 10px;text-align:left;white-space:nowrap;${thSep}${thSticky}">ユニット</th>
                        <th style="padding:6px 10px;text-align:left;${cellWrap}${thSep}${thSticky}">タスク名</th>
                        <th style="padding:6px 10px;text-align:left;${cellWrap}${thSep}${thSticky}">変更箇所</th>
                        <th style="padding:6px 8px;text-align:left;white-space:nowrap;${thSep}${thSticky}">変更者</th>
                    </tr>
                </thead>
                <tbody>`;

            filteredRows.forEach((row, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#fafafa';
                tableHtml += `<tr style="background:${bg};">
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;color:#666;">${fmtDt(row.changed_at)}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:bold;white-space:nowrap;">${row.project_number || ''}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${row.machine || ''}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${row.unit || ''}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;${cellWrap}">${row.task_text || ''}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#000;${cellWrap}">${row.description || ''}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;color:#555;">${row.changed_by || ''}</td>
                </tr>`;
            });

            tableHtml += '</tbody></table>';
            if (filteredRows.length === 0) {
                tableHtml = `<div style="padding:20px;color:#888;text-align:center;">条件に一致する更新履歴はありません</div>`;
            }
            tableWrap.innerHTML = `<div style="width:${SYNC_LOG_TABLE_WIDTH_PX}px;max-width:100%;box-sizing:border-box;">${tableHtml}</div>`;
        }

        function closeSyncLogModal(e) {
            if (e && e.target !== document.getElementById('sync-log-overlay')) return;
            document.getElementById('sync-log-overlay').style.display = 'none';
        }
        // ===== 更新履歴モーダル ここまで =====

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
                hideLoading();
            });

            // フォールバック（万が一イベントが発火しなかった場合）
            setTimeout(() => { scrollAction(); hideLoading(); }, 500);

            // 初回の published_at を記録してポーリング開始（閲覧者のみ）
            getPublishedAt().then(function(val) {
                _knownPublishedAt = val;
                if (_isEditor) {
                    startAssemblyTaskWatch();
                } else {
                    startPolling();
                }
            });
        });

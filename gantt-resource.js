
        // ガントグリッド幅をGRID_WIDTHに強制設定し、リソース下段に同期
        (function syncGridWidth() {
            const TARGET = GRID_WIDTH;
            // DHTMLX Ganttのgridビューに幅を強制適用してre-render
            try {
                const gridView = gantt.$ui.getView("grid");
                if (gridView) {
                    gridView.$config.width = TARGET;
                }
            } catch(e) {}
            gantt.config.grid_width = TARGET;
            gantt.render();
            // render後に実幅を読み取りリソース下段に同期
            const actualWidth = (document.querySelector('.gantt_grid') || {}).offsetWidth || TARGET;
            GRID_WIDTH = actualWidth;
            const style = document.createElement('style');
            style.textContent = `.resource-grid-container { width: ${actualWidth}px !important; min-width: ${actualWidth}px !important; } .resource-grid { width: ${actualWidth}px !important; min-width: ${actualWidth}px !important; }`;
            document.head.appendChild(style);
            // マーク一覧の開始位置をグリッド幅に合わせる
            const legend = document.getElementById('mark-legend');
            if (legend) legend.style.marginLeft = (actualWidth - 80) + 'px';
        })();

        // ツリー展開・折り畳み後にカレンダーヘッダーが消える問題を修正
        function fixScaleAfterTreeToggle() {
            setTimeout(function() {
                const scroll = gantt.getScrollState();
                gantt.scrollTo(scroll.x + 1, scroll.y);
                gantt.scrollTo(scroll.x, scroll.y);
            }, 30);
        }
        gantt.attachEvent("onTaskOpened", fixScaleAfterTreeToggle);
        gantt.attachEvent("onTaskClosed", fixScaleAfterTreeToggle);

        // 🔍・チェックボックス列の左寄せをレンダリング後に強制適用
        gantt.attachEvent("onGanttRender", function() {
            document.querySelectorAll('.gantt_row .gantt_cell:nth-child(1), .gantt_row_project .gantt_cell:nth-child(1), .gantt_row .gantt_cell:nth-child(2), .gantt_row_project .gantt_cell:nth-child(2), .gantt_row .gantt_cell:nth-child(3), .gantt_row_project .gantt_cell:nth-child(3)').forEach(function(cell) {
                cell.style.textAlign = 'left';
                cell.style.justifyContent = 'flex-start';
            });
            // タスク名列の▶左インデント余白を縮小
            document.querySelectorAll('.gantt_row_project .gantt_tree_indent').forEach(function(el) {
                el.style.width = '6px';
                el.style.minWidth = '6px';
            });
            // 🔍・チェックボックスを左罫線にぴったり寄せる
            document.querySelectorAll('.gantt_row .gantt_cell:nth-child(1), .gantt_row_project .gantt_cell:nth-child(1), .gantt_row .gantt_cell:nth-child(3), .gantt_row_project .gantt_cell:nth-child(3)').forEach(function(cell) {
                cell.style.paddingLeft = '0px';
                cell.style.paddingRight = '0px';
            });
            // タスク名列の▶を左罫線にぴったり寄せる
            document.querySelectorAll('.gantt_row .gantt_cell:nth-child(4), .gantt_row_project .gantt_cell:nth-child(4)').forEach(function(cell) {
                cell.style.paddingLeft = '0px';
            });
            // ▶と見出し名の間の空白をなくす
            document.querySelectorAll('.gantt_tree_content').forEach(function(el) {
                el.style.marginLeft = '0px';
                el.style.paddingLeft = '0px';
            });
            document.querySelectorAll('.gantt_tree_icon').forEach(function(el) {
                el.style.width = '12px';
                el.style.minWidth = '12px';
                el.style.margin = '0';
                el.style.padding = '0';
            });
        });

        // 担当者名の名寄せ（正規化）処理
        function getNormalizedOwners(ownerStr) {
            if (!ownerStr) return [];
            // 区切り文字：半角カンマ、全角カンマ、読点、中黒、スペース（半角・全角）
            return ownerStr.split(/[,,，、・\s]+/).map(s => s.trim()).filter(Boolean);
        }

        // 大項目フィルタ（部署別フィルタ）
        function filterByMajorItem(majorItem) {
            currentMajorFilter = majorItem || null;
            // セレクトの値を同期
            const sel = document.getElementById('major-filter-select');
            if (sel) sel.value = currentMajorFilter || '';
            gantt.render();

            // リソース画面が表示されており、かつ部署フィルタが有効な場合は再描画
            if (currentResourceMode === 'dept' && currentResourceDeptFilter) {
                // filterByDepartmentを直接呼ぶとトグル処理が走ってしまうため、
                // 内部の描画ロジックのみを再実行する
                const resourcePanel = document.getElementById("resource_panel");
                const ganttHere = document.getElementById("gantt_here");
                
                if (currentResourceDeptFilter) {
                    // filterByDepartment(currentResourceDeptFilter) と同等の抽出ロジック
                    const deptTasks = (window.allTasks || []).filter(t => {
                        const isDetailed = (t.is_detailed === true || String(t.is_detailed).toLowerCase() === "true" || String(t.is_detailed).toLowerCase() === "t" || String(t.is_detailed) === "1");
                        // 設計部の部署別リソース画面では、is_detailedがTRUEのタスク（設計工程表専用）を非表示にする
                        if (isDetailed) return false;
                        if (t.major_item !== currentResourceDeptFilter) return false;
                        return true;
                    });

                    const owners = [...new Set(deptTasks.flatMap(t => {
                        const normalized = getNormalizedOwners(t.owner);
                        return normalized.filter(name => {
                            if (name === "外注") return t.major_item === currentResourceDeptFilter;
                            return true;
                        });
                    }))].sort();

                    if (resourcePanel) resourcePanel.style.display = "flex";
                    renderDepartmentSummary(owners, currentResourceDeptFilter);
                }
            }
        }

        // 入力した担当名 or 部署名で下段のみ絞り込み
        function filterByDepartment(deptName, btn) {
            currentResourceMode = 'dept';
            lastDeptName = deptName;
            const backBar = document.getElementById("resource_back_bar");
            if (backBar) backBar.style.display = "none";

            // 1. 選択状態の管理
            if (currentResourceDeptFilter === deptName && btn) { // btnがある場合のみトグル動作
                currentResourceDeptFilter = "";
                currentResourceMode = 'individual'; // 解除時はデフォルトに戻す
            } else {
                currentResourceDeptFilter = deptName;
            }

            // ボタンのアクティブ状態を更新
            document.querySelectorAll('.resource-dept-btn').forEach(b => {
                b.classList.toggle('active', b === btn && currentResourceDeptFilter !== "");
            });

            // セレクトの値を同期
            const resourceDeptSel = document.getElementById('resource-dept-select');
            if (resourceDeptSel) resourceDeptSel.value = currentResourceDeptFilter || '';

            const resourcePanel = document.getElementById("resource_panel");
            const ganttHere = document.getElementById("gantt_here");

            if (!currentResourceDeptFilter) {
                // 解除時はパネルを閉じる
                if (resourcePanel) resourcePanel.style.display = "none";
                return;
            }

            // 2. window.allTasks から major_item が deptName と一致するタスクを抽出
            // 外注の場合は、major_item も一致している必要がある
            const deptTasks = (window.allTasks || []).filter(t => {
                // is_detailed が true のタスクは除外（設計工程表専用タスクを全体工程表のリソース画面で非表示にする）
                const isDetailed = (t.is_detailed === true || String(t.is_detailed).toLowerCase() === "true" || String(t.is_detailed).toLowerCase() === "t" || String(t.is_detailed) === "1");
                if (isDetailed) return false;

                if (t.major_item !== deptName) return false;
                return true;
            });

            // 3. 抽出したタスクから owner のリスト（重複なし・名寄せ済み）を生成
            // 外注タスクの場合、そのタスクの major_item が現在の deptName と一致する場合のみ、その部署の外注として扱う
            const owners = [...new Set(deptTasks.flatMap(t => {
                const normalized = getNormalizedOwners(t.owner);
                return normalized.filter(name => {
                    if (name === "外注") {
                        return t.major_item === deptName;
                    }
                    return true;
                });
            }))].sort();

            // 4. リソースパネルを表示
            if (resourcePanel) resourcePanel.style.display = "flex";
            renderDepartmentSummary(owners, deptName);
        }

        function renderDepartmentSummary(owners, deptName) {
            const container = document.getElementById("resource_content_inner");
            if (!container) return;
            container.innerHTML = "";

            if (owners.length === 0) {
                container.innerHTML = `<div class="resource-placeholder">【${deptName}】に該当する担当タスクはありません</div>`;
                return;
            }

            // ライトボックス（チェックボックス）の並び順（ownerMaster）に合わせる
            const masterList = ownerMaster[deptName] || [];
            if (masterList.length > 0) {
                owners.sort((a, b) => {
                    const indexA = masterList.indexOf(a);
                    const indexB = masterList.indexOf(b);
                    // マスターにない名前（手入力など）は後ろに配置
                    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
                    if (indexA === -1) return 1;
                    if (indexB === -1) return -1;
                    return indexA - indexB;
                });
            }

            // スケール情報の取得
            const scale = gantt.getScale();
            const timelineWidth = scale.full_width;
            const columnWidth = scale.col_width;
            const totalWidth = GRID_WIDTH + timelineWidth;
            
            // 背景の目盛り線の開始位置を計算（週表示などでズレを防ぐ）
            const firstDate = scale.trace_x[0];
            const firstPos = gantt.posFromDate(firstDate);
            
            // 背景のグリッド線（縦・横）を生成
            const gridBackground = `repeating-linear-gradient(to right, transparent, transparent ${columnWidth - 1}px, #ebebeb ${columnWidth - 1}px, #ebebeb ${columnWidth}px), repeating-linear-gradient(to bottom, transparent, transparent 26px, #ebebeb 26px, #ebebeb 27px)`;
            
            // 土日の背景色を個別のdivとして生成するためのHTML
            let weekendBackgroundHtml = "";
            const currentZoom = (gantt.ext.zoom.getCurrentLevel() || "days");
            if (currentZoom === "days") {
                scale.trace_x.forEach((date, i) => {
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const ds = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
                    if (isWeekend || holidaySet.has(ds)) {
                        weekendBackgroundHtml += `<div style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; background: #f4f4f4; z-index: 0;"></div>`;
                    }
                });
            }
            
            // background-position を調整してメイン画面のグリッド線と同期
            const backgroundStyle = `background-image: ${gridBackground}; background-position: ${-firstPos}px 0; background-size: ${columnWidth}px 27px; height: 100%;`;

            // 今日線は各データ行のタイムライン内のみ（ヘッダー行には置かず、メイン線の「途切れ」を作る）
            const todayPos = gantt.posFromDate(new Date());
            const todayLineHtml = `<div class="resource-today-line" style="left: ${todayPos}px;"></div>`;

            let html = "";
            
            // ヘッダー行
            html += `
                <div class="resource-item resource-summary-header resource-dept-view" style="display: flex; border-bottom: 1px solid #ddd; min-height: 27px; height: 27px; align-items: center; background: #f8f9fa; position: sticky; top: 0; left: 0; z-index: 10; width: ${totalWidth}px;">
                    <div style="padding: 0 15px; font-weight: bold; color: #2c3e50; font-size: 11px; position: sticky; left: 0; background: inherit; height: 100%; display: flex; align-items: center; z-index: 11; white-space: nowrap;">
                    部署：${deptName}（${owners.length}名）
                </div>
                <div style="position: sticky; right: 0; background: inherit; height: 100%; display: flex; align-items: center; padding-right: 10px; margin-left: auto; z-index: 11;">
                    <button type="button" class="resource-header-close" onclick="closeResourcePanel()">×</button>
                </div>
            </div>
            `;

            const buildResourceTooltipText = function(task) {
                const detailText = [task.project_number, task.machine, task.unit]
                    .map(function(v) { return (v || "").toString().trim(); })
                    .filter(Boolean)
                    .join(" ");
                const taskText = (task.text || "").toString().trim();
                return detailText ? `${taskText} (${detailText})` : taskText;
            };

            const escapeTooltipAttr = function(text) {
                return (text || "")
                    .replace(/&/g, "&amp;")
                    .replace(/"/g, "&quot;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
            };

            // 各担当者ごとの行を生成
            owners.forEach((ownerName, ownerIndex) => {
                // 名寄せ後の名前に基づいてタスクを抽出
                // 「外注」の場合は、major_item が現在の部署 (deptName) と一致するものだけを抽出する
                const ownerTasks = window.allTasks.filter(t => {
                    // is_detailed が true のタスクは除外（設計工程表専用タスクを全体工程表のリソース画面で非表示にする）
                    const isDetailed = (t.is_detailed === true || String(t.is_detailed).toLowerCase() === "true" || String(t.is_detailed).toLowerCase() === "t" || String(t.is_detailed) === "1");
                    if (isDetailed) return false;

                    const normalized = getNormalizedOwners(t.owner);
                    let isMatch = false;
                    if (ownerName === "外注") {
                        isMatch = normalized.includes("外注") && t.major_item === deptName;
                    } else {
                        isMatch = normalized.includes(ownerName);
                    }
                    if (!isMatch) return false;
                    return true;
                });

                // この担当者の行内で重なりがある日付（セル）を特定して赤斜線背景を生成
                let rowConflictBackgroundHtml = "";
                scale.trace_x.forEach((date, i) => {
                    const cellStart = date;
                    const cellEnd = gantt.date.add(cellStart, 1, scale.unit);
                    
                    let hasConflictInCell = false;
                    for (let idx1 = 0; idx1 < ownerTasks.length; idx1++) {
                        const t1 = ownerTasks[idx1];
                        const s1 = new Date(t1.start_date);
                        const e1 = gantt.calculateEndDate(s1, t1.duration);
                        if (!(s1 < cellEnd && e1 > cellStart)) continue;
                        
                        for (let idx2 = idx1 + 1; idx2 < ownerTasks.length; idx2++) {
                            const t2 = ownerTasks[idx2];
                            const s2 = new Date(t2.start_date);
                            const e2 = gantt.calculateEndDate(s2, t2.duration);
                            if (!(s2 < cellEnd && e2 > cellStart)) continue;
                            
                            if (s1 < e2 && e1 > s2) {
                                hasConflictInCell = true;
                                break;
                            }
                        }
                        if (hasConflictInCell) break;
                    }
                    
                    if (hasConflictInCell) {
                        rowConflictBackgroundHtml += `<div class="resource-cell-conflict-bg" style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; z-index: 1;"></div>`;
                    }
                });
                
                // タスクの重なりを判定してスタック位置を計算
                const sortedTasks = ownerTasks.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
                const stacks = []; // 各スタックの終了時間を保持

                // 共通ロジックを使用して色を決定
                const isSyncMode = currentMajorFilter && currentResourceDeptFilter && currentMajorFilter === currentResourceDeptFilter;
                const resourceColorClass = isSyncMode ? getOwnerColorClass(ownerName, deptName) : "";
                const dotColorClass = isSyncMode ? getOwnerDotColorClass(ownerName, deptName) : "";
                const dotDisplay = isSyncMode ? "inline" : "none";

                html += `
                    <div class="resource-item resource-dept-view" style="display: flex; border-bottom: 1px solid #eee; min-height: 27px; height: 27px; align-items: stretch;">
                        <div class="resource-grid-container" style="width: ${GRID_WIDTH}px; min-width: ${GRID_WIDTH}px; flex-shrink: 0; display: flex; border-right: 1px solid #ddd; background: #f9f9f9; position: sticky; left: 0; z-index: 1;">
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[0]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[1]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[2]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[3]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[4]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[5]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[6]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[7]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[8]}px; border-right: 1px solid #eee;"></div>
                            <div class="resource-cell owner-name-cell" style="width: ${COLUMN_WIDTHS[9]}px; padding: 0 4px; display: flex; align-items: center; font-size: 12.8px; font-family: メイリオ, sans-serif; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <span class="${dotColorClass}" style="margin-right: 4px; font-size: 14px; display: ${dotDisplay};">●</span>${ownerName.replace(/\d+/g, "")}
                            </div>
                        </div>
                        <div class="resource-timeline" style="width: ${timelineWidth}px; flex-shrink: 0; position: relative; background: #fff; border-right: 1px solid #ebebeb;">
                            <div class="resource-timeline-clip">
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 0;">${weekendBackgroundHtml}</div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; ${backgroundStyle} z-index: 1;"></div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1;">${rowConflictBackgroundHtml}</div>
                            <div class="resource-cell-bars" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2;">
                `;

                // 担当者のタスクをタイムラインに描画
                sortedTasks.forEach(t => {
                    const start = new Date(t.start_date);
                    const end = gantt.calculateEndDate(start, t.duration);
                    const left = gantt.posFromDate(start);
                    const right = gantt.posFromDate(end);
                    const width = Math.max(2, right - left);
                    const isPartsDeliveryTask = t.text === "神戸送り開始日";
                    
                    // リソース表示時のみ、担当者ごとに異なる色を使用
                    let colorClass = resourceColorClass;
                    if (!isSyncMode) {
                        colorClass = getResourceTaskClass(t);
                    }
                    
                    // マイルストーン判定（アイコン表示）は維持
                    let milestoneClass = "";
                    if (t.text === "外観検査") milestoneClass = "milestone-circle";
                    else if (t.text === "出荷確認会議") milestoneClass = "milestone-diamond";
                    else if (t.text === "工場出荷") milestoneClass = "milestone-star";
                    else if (t.text === "客先立会") milestoneClass = "milestone-square";
                    const partsDeliveryClass = isPartsDeliveryTask ? "parts-delivery-resource" : "";

                    // スタック位置の計算
                    let stackIndex = 0;
                    while (stacks[stackIndex] && stacks[stackIndex] > start.getTime()) {
                        stackIndex++;
                    }
                    stacks[stackIndex] = end.getTime();
                    
                    // スタックに応じて高さをずらす
                    const topOffset = 3 + (stackIndex * 5);
                    const barHeight = 21;

                    // 部署別リソース画面（担当者一覧）において、バーの重なりがある場合に赤斜線を付与
                    // ※背景セルに表示するため、バー自体の赤斜線クラス(is-conflict)は付与しない
                    const isOverlapping = ownerTasks.some(other => {
                        if (other.id === t.id) return false;
                        const oStart = new Date(other.start_date);
                        const oEnd = gantt.calculateEndDate(oStart, other.duration);
                        return (start < oEnd && end > oStart);
                    });
                    const conflictClass = ""; // isOverlapping ? "is-conflict" : "";

                    html += `
                        <div class="resource-cell-bar ${colorClass} ${milestoneClass} ${partsDeliveryClass} ${conflictClass}" 
                             style="position: absolute; top: ${topOffset}px; height: ${barHeight}px; left: ${left}px; width: ${width}px; border-radius: 3px; opacity: 0.8; display: flex; align-items: center; justify-content: center; color: #222; font-size: 13px; font-weight: bold; font-family: '游ゴシック','Yu Gothic',YuGothic,sans-serif; overflow: hidden; white-space: nowrap; text-shadow: none; z-index: ${5 + stackIndex}; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.15);" 
                             data-resource-tooltip="${escapeTooltipAttr(buildResourceTooltipText(t))}">
                            <span class="resource-bar-text">${(milestoneClass || isPartsDeliveryTask) ? "" : `${t.project_number || ""} ${t.machine || ""} ${t.unit || ""}`}</span>
                        </div>
                    `;
                });

                html += `
                            </div>
                            </div>
                            ${todayLineHtml}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            initResourceBarTooltip(container);
            syncResourceScroll();
        }

        function initResourceBarTooltip(container) {
            let tooltip = document.getElementById('custom_resource_tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'custom_resource_tooltip';
                tooltip.style.position = 'fixed';
                tooltip.style.display = 'none';
                tooltip.style.padding = '6px 10px';
                tooltip.style.background = '#fff';
                tooltip.style.color = '#000';
                tooltip.style.fontSize = '12px';
                tooltip.style.fontFamily = "'メイリオ','Meiryo',sans-serif";
                tooltip.style.borderRadius = '8px';
                tooltip.style.pointerEvents = 'none';
                tooltip.style.whiteSpace = 'nowrap';
                tooltip.style.zIndex = '9999';
                tooltip.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
                document.body.appendChild(tooltip);
            }

            container.querySelectorAll('.resource-cell-bar[data-resource-tooltip]').forEach(function(bar) {
                bar.addEventListener('mouseenter', function(e) {
                    const text = bar.getAttribute('data-resource-tooltip') || '';
                    if (!text) return;
                    tooltip.textContent = text;
                    tooltip.style.display = 'block';

                    const offset = 14;
                    let left = e.clientX + offset;
                    let top = e.clientY + offset;
                    const rect = tooltip.getBoundingClientRect();
                    if (left + rect.width > window.innerWidth - 8) {
                        left = Math.max(8, e.clientX - rect.width - offset);
                    }
                    if (top + rect.height > window.innerHeight - 8) {
                        top = Math.max(8, e.clientY - rect.height - offset);
                    }
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                });
                bar.addEventListener('mouseleave', function() {
                    tooltip.style.display = 'none';
                });
            });
        }

        function showResourceViewByOwner(ownerValue) {
            currentResourceMode = 'individual';
            const finalOwner = ownerValue || document.getElementById("resource_owner_input")?.value || lastOwnerName;
            lastOwnerName = finalOwner;

            currentResourceDeptFilter = "";
            currentResourceOwnerFilter = (finalOwner || "").trim();

            // 入力欄も更新（数字を除去して名前のみ表示）
            const inp = document.getElementById("resource_owner_input");
            if (inp) inp.value = currentResourceOwnerFilter.replace(/\d+/g, "");

            // 担当者入力時は部署ボタンのアクティブを解除
            document.querySelectorAll('.resource-dept-btn').forEach(b => b.classList.remove('active'));

            // 直前の部署がある場合のみ戻るボタンバーを表示
            const backBar = document.getElementById("resource_back_bar");
            if (backBar) backBar.style.display = lastDeptName ? "flex" : "none";

            updateResourceVisibility();
        }

        function backToDeptResource() {
            if (!lastDeptName) return;
            const backBar = document.getElementById("resource_back_bar");
            if (backBar) backBar.style.display = "none";
            filterByDepartment(lastDeptName, null);
        }

        function updateResourceVisibility() {
            const resourcePanel = document.getElementById("resource_panel");
            const hasFilter = currentResourceOwnerFilter || currentResourceDeptFilter || currentLocationResourceMode;

            if (hasFilter) {
                if (resourcePanel) resourcePanel.style.display = "flex";
                if (currentLocationResourceMode) {
                    renderLocationResourceTimeline();
                } else if (currentResourceMode === 'dept' && currentResourceDeptFilter) {
                    // 部署別表示中のとき: 担当者一覧ビューを再描画する
                    // filterByDepartment(dept, null) は btn=null のためトグルせず再描画のみ行う
                    filterByDepartment(currentResourceDeptFilter, null);
                } else {
                    renderResourceTimeline();
                }
            } else {
                if (resourcePanel) resourcePanel.style.display = "none";
            }
        }

        // 部署別リソースのセレクト変更ハンドラ
        function filterByDepartmentSelect(value) {
            if (!value) {
                currentResourceDeptFilter = "";
                currentResourceMode = 'individual';
                const backBar = document.getElementById("resource_back_bar");
                if (backBar) backBar.style.display = "none";
                const resourcePanel = document.getElementById("resource_panel");
                if (resourcePanel) resourcePanel.style.display = "none";
                const sel = document.getElementById('resource-dept-select');
                if (sel) sel.value = '';
                return;
            }
            filterByDepartment(value, null);
        }

        // リソース画面を閉じる
        function closeResourcePanel() {
            const inp = document.getElementById("resource_owner_input");
            if (inp) inp.value = "";
            currentResourceOwnerFilter = "";
            currentResourceDeptFilter = "";
            currentLocationResourceMode = false;
            document.getElementById('location_resource_btn')?.classList.remove('active');
            const resourceDeptSel = document.getElementById('resource-dept-select');
            if (resourceDeptSel) resourceDeptSel.value = '';
            updateResourceVisibility();
        }

        // 組立場所リソースのトグル
        async function toggleLocationResource(btn) {
            if (currentLocationResourceMode) {
                closeResourcePanel();
            } else {
                // 他のリソースフィルタをクリア
                currentResourceOwnerFilter = "";
                currentResourceDeptFilter = "";
                document.querySelectorAll('.resource-dept-btn').forEach(b => b.classList.remove('active'));
                const inp = document.getElementById("resource_owner_input");
                if (inp) inp.value = "";

                currentLocationResourceMode = true;
                btn.classList.add('active');
                updateResourceVisibility();
            }
        }

        // 組立場所の展開/折りたたみ
        function toggleLocationGroup(group) {
            locationExpandedGroups[group] = !locationExpandedGroups[group];
            renderLocationResourceTimeline();
        }

        // 組立場所リソースの描画
        async function renderLocationResourceTimeline() {
            const container = document.getElementById("resource_content_inner");
            if (!container) return;

            // task_locations データを取得
            const { data: locData, error } = await supabaseClient
                .from('task_locations')
                .select('task_id, area_group, area_number');
            
            if (error) {
                container.innerHTML = '<div class="resource-placeholder">データの取得に失敗しました</div>';
                return;
            }

            // タスクデータと結合
            const locationTasks = locData.map(ld => {
                const task = window.allTasks.find(t => t.id === ld.task_id);
                if (!task) return null;

                // is_detailed が true のタスクは除外
                const isDetailed = (task.is_detailed === true || String(task.is_detailed).toLowerCase() === "true" || String(task.is_detailed).toLowerCase() === "t" || String(task.is_detailed) === "1");
                if (isDetailed) return null;

                return { ...task, area_group: ld.area_group, area_number: ld.area_number };
            }).filter(Boolean);

            const scale = gantt.getScale();
            const timelineWidth = scale.full_width;
            const columnWidth = scale.col_width;
            const totalWidth = GRID_WIDTH + timelineWidth;
            
            // 背景の目盛り線の開始位置を計算（週表示などでズレを防ぐ）
            const firstDate = scale.trace_x[0];
            const firstPos = gantt.posFromDate(firstDate);
            
            // 背景のグリッド線（縦・横）を生成
            const gridBackground = `repeating-linear-gradient(to right, transparent, transparent ${columnWidth - 1}px, #ebebeb ${columnWidth - 1}px, #ebebeb ${columnWidth}px), repeating-linear-gradient(to bottom, transparent, transparent 26px, #ebebeb 26px, #ebebeb 27px)`;
            
            // 土日の背景色を個別のdivとして生成するためのHTML
            let weekendBackgroundHtml = "";
            const currentZoom = (gantt.ext.zoom.getCurrentLevel() || "days");
            if (currentZoom === "days") {
                scale.trace_x.forEach((date, i) => {
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const ds = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
                    if (isWeekend || holidaySet.has(ds)) {
                        weekendBackgroundHtml += `<div style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; background: #f4f4f4; z-index: 0;"></div>`;
                    }
                });
            }
            
            // background-position を調整してメイン画面のグリッド線と同期
            const backgroundStyle = `background-image: ${gridBackground}; background-position: ${-firstPos}px 0; background-size: ${columnWidth}px 27px; height: 100%;`;

            // 今日線は各データ行のタイムライン内のみ（ヘッダー行には置かず、メイン線の「途切れ」を作る）
            const todayPos = gantt.posFromDate(new Date());
            const todayLineHtml = `<div class="resource-today-line" style="left: ${todayPos}px;"></div>`;

            let html = "";
            
            // ヘッダー
                html += `
                    <div class="resource-item resource-summary-header" style="display: flex; border-bottom: 1px solid #ddd; min-height: 27px; height: 27px; align-items: center; background: #f8f9fa; position: sticky; top: 0; left: 0; z-index: 10; width: ${totalWidth}px;">
                        <div style="padding: 0 15px; font-weight: bold; color: #2c3e50; font-size: 11px; position: sticky; left: 0; background: inherit; height: 100%; display: flex; align-items: center; z-index: 11; white-space: nowrap;">
                        組立場所別リソース状況
                    </div>
                    <div style="position: sticky; right: 0; background: inherit; height: 100%; display: flex; align-items: center; padding-right: 10px; margin-left: auto; z-index: 11;">
                        <button type="button" class="resource-header-close" onclick="closeResourcePanel()">×</button>
                    </div>
                </div>
            `;

            LOCATION_GROUPS.forEach(group => {
                LOCATION_NUMBERS.forEach(num => {
                    const areaTasks = locationTasks.filter(t => t.area_group === group && t.area_number === num);
                    
                    // 組立場所表示は常にスタックとコンフリクト強調を行う
                    const sortedTasks = areaTasks.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
                    const stacks = []; // 各スタックの終了時間を保持

                    // この組立場所の行内で重なりがある日付（セル）を特定して赤斜線背景を生成
                    let rowConflictBackgroundHtml = "";
                    scale.trace_x.forEach((date, i) => {
                        const cellStart = date;
                        const cellEnd = gantt.date.add(cellStart, 1, scale.unit);
                        
                        let hasConflictInCell = false;
                        for (let idx1 = 0; idx1 < areaTasks.length; idx1++) {
                            const t1 = areaTasks[idx1];
                            const s1 = new Date(t1.start_date);
                            const e1 = gantt.calculateEndDate(s1, t1.duration);
                            if (!(s1 < cellEnd && e1 > cellStart)) continue;
                            
                            for (let idx2 = idx1 + 1; idx2 < areaTasks.length; idx2++) {
                                const t2 = areaTasks[idx2];
                                const s2 = new Date(t2.start_date);
                                const e2 = gantt.calculateEndDate(s2, t2.duration);
                                if (!(s2 < cellEnd && e2 > cellStart)) continue;
                                
                                if (s1 < e2 && e1 > s2) {
                                    hasConflictInCell = true;
                                    break;
                                }
                            }
                            if (hasConflictInCell) break;
                        }
                        
                        if (hasConflictInCell) {
                            rowConflictBackgroundHtml += `<div class="resource-cell-conflict-bg" style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; z-index: 1;"></div>`;
                        }
                    });

                    html += `
                        <div class="resource-item resource-dept-view" style="display: flex; border-bottom: 1px solid #eee; min-height: 27px; height: 27px; align-items: stretch;">
                            <div class="resource-grid-container" style="width: ${GRID_WIDTH}px; min-width: ${GRID_WIDTH}px; flex-shrink: 0; display: flex; border-right: 1px solid #ddd; background: #fff; position: sticky; left: 0; z-index: 1;">
                            <div class="resource-cell" style="width: ${COLUMN_WIDTHS[0]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[1]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[2]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[3]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[4]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[5]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[6]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[7]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[8]}px; border-right: 1px solid #eee;"></div>
                                <div class="resource-cell" style="width: ${COLUMN_WIDTHS[9]}px; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #666;">${group}-${num}</div>
                            </div>
                            <div class="resource-timeline" style="width: ${timelineWidth}px; flex-shrink: 0; position: relative; background: #fff; border-right: 1px solid #ebebeb; box-sizing: border-box;">
                            <div class="resource-timeline-clip">
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 0;">${weekendBackgroundHtml}</div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; ${backgroundStyle} z-index: 1;"></div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1;">${rowConflictBackgroundHtml}</div>
                            <div class="resource-cell-bars" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2;">
                    `;

                    sortedTasks.forEach(t => {
                        const start = new Date(t.start_date);
                        const end = gantt.calculateEndDate(start, t.duration);
                        const left = gantt.posFromDate(start);
                        const right = gantt.posFromDate(end);
                        const width = Math.max(2, right - left);
                        const colorClass = getResourceTaskClass(t);

                        // スタック位置の計算
                        let stackIndex = 0;
                        while (stacks[stackIndex] && stacks[stackIndex] > start.getTime()) {
                            stackIndex++;
                        }
                        stacks[stackIndex] = end.getTime();
                        
                        // スタックに応じて高さをずらす (3px, 8px, 13px...)
                        const topOffset = 3 + (stackIndex * 5);
                        const barHeight = 21; // 重なる場合も高さを維持

                        // 重なりがある場合のクラス判定
                        // ※背景セルに表示するため、バー自体の赤斜線クラス(is-conflict)は付与しない
                        const isOverlapping = areaTasks.some(other => {
                            if (other.id === t.id) return false;
                            const oStart = new Date(other.start_date);
                            const oEnd = gantt.calculateEndDate(oStart, other.duration);
                            return (start < oEnd && end > oStart);
                        });
                        const conflictClass = ""; // isOverlapping ? "is-conflict" : "";
                        const customBarColor = locationBarColors[t.id] || '';
                        const customColorStyle = customBarColor ? `background-color: ${customBarColor} !important;` : '';
                        const barTextColor = '#222';

                        html += `
                            <div class="resource-cell-bar ${colorClass} ${conflictClass}"
                                 data-task-id="${t.id}"
                                 style="position: absolute; top: ${topOffset}px; height: ${barHeight}px; left: ${left}px; width: ${width}px; border-radius: 3px; opacity: 0.8; display: flex; align-items: center; justify-content: center; color: ${barTextColor}; font-size: 13px; font-weight: bold; font-family: '游ゴシック','Yu Gothic',YuGothic,sans-serif; overflow: hidden; white-space: nowrap; text-shadow: none; z-index: ${5 + stackIndex}; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.15); ${customColorStyle}"
                                 title="${t.project_number || ""}-${t.machine || ""}${t.unit || ""}">
                                 <span class="resource-bar-text">${t.project_number || ""} ${t.machine || ""} ${t.unit || ""}</span>
                            </div>
                        `;
                    });

                    html += `
                                </div>
                                </div>
                                ${todayLineHtml}
                            </div>
                        </div>
                    `;
                });
            });

            container.innerHTML = html;
            initLocationBarColorPicker(container);
            syncResourceScroll();
        }

        // リソース画面の描画処理
        function renderResourceTimeline() {
            const container = document.getElementById("resource_content_inner");
            if (!container) return;

            if (!currentResourceOwnerFilter && !currentResourceDeptFilter) {
                container.innerHTML = '<div class="resource-placeholder">担当者または部署を選択してリソース状況を表示</div>';
                return;
            }

            // window.allTasks からフィルタリング
            const filteredTasks = (window.allTasks || []).filter(t => {
                // is_detailed が true のタスクは除外
                const isDetailed = (t.is_detailed === true || String(t.is_detailed).toLowerCase() === "true" || String(t.is_detailed).toLowerCase() === "t" || String(t.is_detailed) === "1");
                if (isDetailed) return false;

                let isMatch = false;
                let currentDept = currentResourceDeptFilter || lastDeptName;

                if (currentResourceDeptFilter) {
                    isMatch = t.major_item === currentResourceDeptFilter;
                } else {
                    // 名寄せ後の名前に基づいてフィルタリング
                    const normalizedOwners = getNormalizedOwners(t.owner).map(o => o.toLowerCase());
                    const searchOwner = currentResourceOwnerFilter.toLowerCase();
                    
                    // 「外注」で検索された場合は、そのタスクの major_item が最後に選択された部署 (lastDeptName) と一致する必要がある
                    if (searchOwner === "外注") {
                        isMatch = normalizedOwners.includes("外注") && (t.major_item === lastDeptName);
                    } else {
                        isMatch = normalizedOwners.includes(searchOwner);
                    }
                }

                if (!isMatch) return false;

                return true;
            });

            if (filteredTasks.length === 0) {
                container.innerHTML = `<div class="resource-placeholder">該当する${currentResourceDeptFilter ? '部署' : '担当者'}のタスクはありません</div>`;
                return;
            }

            // 工事番号の優先度計算
            const getPriority = (p) => {
                if (!p) return 5;
                if (p.startsWith('2')) return 1;
                if (p.startsWith('3')) return 2;
                if (p.startsWith('4')) return 3;
                if (p.startsWith('D')) return 4;
                return 5;
            };

            // 上段の工程表と同じ条件でソート
            filteredTasks.sort((a, b) => {
                const pNumA = a.project_number || "";
                const pNumB = b.project_number || "";
                const priA = getPriority(pNumA);
                const priB = getPriority(pNumB);
                if (priA !== priB) return priA - priB;
                return pNumA.localeCompare(pNumB, undefined, { numeric: true, sensitivity: 'base' });
            });

            const scale = gantt.getScale();
            const timelineWidth = scale.full_width;
            const columnWidth = scale.col_width;
            const totalWidth = GRID_WIDTH + timelineWidth;

            // 背景の目盛り線の開始位置を計算（週表示などでズレを防ぐ）
            const firstDate = scale.trace_x[0];
            const firstPos = gantt.posFromDate(firstDate);
            
            // 背景のグリッド線（縦・横）を生成
            const gridBackground = `repeating-linear-gradient(to right, transparent, transparent ${columnWidth - 1}px, #ebebeb ${columnWidth - 1}px, #ebebeb ${columnWidth}px), repeating-linear-gradient(to bottom, transparent, transparent 26px, #ebebeb 26px, #ebebeb 27px)`;
            
            // 土日の背景色を個別のdivとして生成するためのHTML
            let weekendBackgroundHtml = "";
            const currentZoom = (gantt.ext.zoom.getCurrentLevel() || "days");
            if (currentZoom === "days") {
                scale.trace_x.forEach((date, i) => {
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const ds = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
                    if (isWeekend || holidaySet.has(ds)) {
                        weekendBackgroundHtml += `<div style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; background: #f4f4f4; z-index: 0;"></div>`;
                    }
                });
            }
            
            // background-position を調整してメイン画面のグリッド線と同期
            const backgroundStyle = `background-image: ${gridBackground}; background-position: ${-firstPos}px 0; background-size: ${columnWidth}px 27px; height: 100%;`;

            // 今日線は各データ行のタイムライン内のみ（ヘッダー行には置かず、メイン線の「途切れ」を作る）
            const todayPos = gantt.posFromDate(new Date());
            const todayLineHtml = `<div class="resource-today-line" style="left: ${todayPos}px;"></div>`;

            let html = "";
            
            // 担当者名とタスク件数を表示する固定ヘッダー行
            const filterTitle = currentResourceDeptFilter ? `部署：${currentResourceDeptFilter}` : `担当：${currentResourceOwnerFilter}`;
            const viewClass = currentResourceDeptFilter ? "resource-dept-view" : "resource-owner-view";

            // タスクの重なりを判定してスタック位置を計算
            const sortedTasks = filteredTasks.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
            const stacks = []; // 各スタックの終了時間を保持

            const backBtnHtml = (!currentResourceDeptFilter && lastDeptName)
                ? `<button type="button" onclick="backToDeptResource()" style="margin-left: auto; padding: 1px 8px; font-size: 11px; cursor: pointer; border: 1px solid #aaa; border-radius: 3px; background: #fff; white-space: nowrap;">◀ 部署別に戻る</button>`
                : "";

            html += `
                <div class="resource-item resource-summary-header ${viewClass}" style="display: flex; border-bottom: 1px solid #ddd; min-height: 27px; height: 27px; align-items: center; background: #f8f9fa; position: sticky; top: 0; left: 0; z-index: 10; width: ${totalWidth}px;">
                    <div style="width: ${GRID_WIDTH}px; flex-shrink: 0; position: sticky; left: 0; background: inherit; height: 100%; display: flex; align-items: center; padding: 0 8px; z-index: 11;">
                        <span style="font-weight: bold; color: #2c3e50; font-size: 11px; white-space: nowrap;">【${filterTitle}】のタスク　${filteredTasks.length}件</span>
                        ${backBtnHtml}
                    </div>
                    <div style="position: sticky; right: 0; background: inherit; height: 100%; display: flex; align-items: center; padding-right: 10px; margin-left: auto; z-index: 11;">
                        <button type="button" class="resource-header-close" onclick="closeResourcePanel()">×</button>
                    </div>
                </div>
            `;
            
            sortedTasks.forEach(t => {
                const start = new Date(t.start_date);
                const end = gantt.calculateEndDate(start, t.duration);
                const isPartsDeliveryTask = t.text === "神戸送り開始日";
                
                const left = gantt.posFromDate(start);
                const right = gantt.posFromDate(end);
                const width = Math.max(2, right - left);
                
                const colorClass = getResourceTaskClass(t);
                const partsDeliveryClass = isPartsDeliveryTask ? "parts-delivery-resource" : "";
                const detailText = [t.project_number, t.machine, t.unit]
                    .map(function(v) { return (v || "").toString().trim(); })
                    .filter(Boolean)
                    .join(" ");
                const title = detailText ? `${t.text || ""} (${detailText})` : (t.text || "");

                // 部署別表示の場合のみスタックとコンフリクト判定を行う
                let topOffset = 3;
                let barHeight = 21;
                let conflictClass = "";
                
                // 担当者別詳細画面ではスタック（段積み）を行わず、常に中央（top: 3px）に配置する
                // これによりメイン工程表と全く同じ見た目（27px行、21pxバー、上下3px余白）を実現する
                topOffset = 3;
                barHeight = 21;

                if (currentResourceDeptFilter) {
                    // 部署別表示の場合のみ重なりがあるかの判定を行い、赤斜線クラスを付与
                    // また、部署別表示の場合のみスタック位置を計算する
                    const stacks = []; // 部署別表示用のローカルスタック
                    let stackIndex = 0;
                    const deptSortedTasks = filteredTasks.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
                    
                    // 現在のタスクまでのスタック位置を特定
                    for (let i = 0; i < deptSortedTasks.length; i++) {
                        const dt = deptSortedTasks[i];
                        const dtStart = new Date(dt.start_date);
                        const dtEnd = gantt.calculateEndDate(dtStart, dt.duration);
                        
                        let sIdx = 0;
                        while (stacks[sIdx] && stacks[sIdx] > dtStart.getTime()) {
                            sIdx++;
                        }
                        stacks[sIdx] = dtEnd.getTime();
                        
                        if (dt.id === t.id) {
                            stackIndex = sIdx;
                            break;
                        }
                    }
                    
                    topOffset = 3 + (stackIndex * 5);

                    const isOverlapping = filteredTasks.some(other => {
                        if (other.id === t.id) return false;
                        const oStart = new Date(other.start_date);
                        const oEnd = gantt.calculateEndDate(oStart, other.duration);
                        return (start < oEnd && end > oStart);
                    });
                    if (isOverlapping) {
                        conflictClass = ""; // 背景セルに表示するため、バー自体の赤斜線クラスは付与しない
                    }
                }

                const zIndex = 5 + (currentResourceDeptFilter ? 1 : 0); // 部署別表示時のみスタック順を考慮可能

                // この担当者の行内で重なりがある日付（セル）を特定して赤斜線背景を生成
                let rowConflictBackgroundHtml = "";
                if (currentResourceDeptFilter) {
                    scale.trace_x.forEach((date, i) => {
                        const cellStart = date;
                        const cellEnd = gantt.date.add(cellStart, 1, scale.unit);
                        
                        let hasConflictInCell = false;
                        for (let idx1 = 0; idx1 < filteredTasks.length; idx1++) {
                            const t1 = filteredTasks[idx1];
                            const s1 = new Date(t1.start_date);
                            const e1 = gantt.calculateEndDate(s1, t1.duration);
                            if (!(s1 < cellEnd && e1 > cellStart)) continue;
                            
                            for (let idx2 = idx1 + 1; idx2 < filteredTasks.length; idx2++) {
                                const t2 = filteredTasks[idx2];
                                const s2 = new Date(t2.start_date);
                                const e2 = gantt.calculateEndDate(s2, t2.duration);
                                if (!(s2 < cellEnd && e2 > cellStart)) continue;
                                
                                if (s1 < e2 && e1 > s2) {
                                    hasConflictInCell = true;
                                    break;
                                }
                            }
                            if (hasConflictInCell) break;
                        }
                        
                        if (hasConflictInCell) {
                            rowConflictBackgroundHtml += `<div class="resource-cell-conflict-bg" style="position: absolute; top: 0; bottom: 0; left: ${i * columnWidth}px; width: ${columnWidth}px; z-index: 1;"></div>`;
                        }
                    });
                }

            // 4. 【グリッド幅の固定】
            html += `
                <div class="resource-item ${viewClass}" style="display: flex; border-bottom: 1px solid #eee; min-height: 27px; height: 27px; align-items: stretch; box-sizing: border-box;">
                    <div class="resource-grid-container" style="width: ${GRID_WIDTH}px; min-width: ${GRID_WIDTH}px; flex-shrink: 0; display: flex; border-right: 1px solid #ddd; background: #fff; position: sticky; left: 0; z-index: 1;">
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[0]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;"></div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[1]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${t.project_number || ""}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[2]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; font-size: 14px;"></div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[3]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.text || ""}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[4]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${t.machine || ""}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[5]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${t.unit || ""}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[6]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; font-size: 13px;">${(t.owner || "").replace(/\d+/g, "")}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[7]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${t.area_group || ""}${t.area_number ? "-" + t.area_number : ""}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[8]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${dateToDisplay(start)}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[9]}px; border-right: 1px solid #eee; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">${dateToDisplay(end)}</div>
                        <div class="resource-cell" style="width: ${COLUMN_WIDTHS[10]}px; padding: 0 4px;"></div>
                    </div>
                        <div class="resource-timeline" style="width: ${timelineWidth}px; flex-shrink: 0; position: relative; background: #fff; border-right: 1px solid #ebebeb; box-sizing: border-box;">
                            <div class="resource-timeline-clip">
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 0;">${weekendBackgroundHtml}</div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; ${backgroundStyle} z-index: 1;"></div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1;">${rowConflictBackgroundHtml}</div>
                            <div class="resource-cell-bars" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2;">
                                <div class="resource-cell-bar ${colorClass} ${partsDeliveryClass} ${conflictClass}" 
                                     style="position: absolute; top: ${topOffset}px; height: ${barHeight}px; left: ${left}px; width: ${width}px; border-radius: 3px; opacity: 0.8; display: flex; align-items: center; justify-content: center; color: #222; font-size: 13px; font-weight: bold; font-family: '游ゴシック','Yu Gothic',YuGothic,sans-serif; overflow: hidden; white-space: nowrap; text-shadow: none; z-index: ${zIndex}; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.15);" 
                                     data-resource-tooltip="${title.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">
                                     <span class="resource-bar-text">${isPartsDeliveryTask ? "" : `${t.project_number || ""} ${t.machine || ""} ${t.unit || ""}`}</span>
                                </div>
                            </div>
                            </div>
                            ${todayLineHtml}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            initResourceBarTooltip(container);
            syncResourceScroll();
        }

        // 2. 【スクロールの同期】（下段リソースパネル表示時のみ）

        /** ガントから resource の scrollLeft を同期したとき、scroll リスナが gantt.scrollTo を呼ばないようにする */
        let _resourceScrollSyncFromGantt = false;
        let _resourceScrollSyncClearTimer = null;

        function _applyResourceScrollLeftFromGantt(resourceContent, left) {
            if (_resourceScrollSyncClearTimer !== null) {
                cancelAnimationFrame(_resourceScrollSyncClearTimer);
                _resourceScrollSyncClearTimer = null;
            }
            _resourceScrollSyncFromGantt = true;
            resourceContent.scrollLeft = left;
            // scrollLeft 設定後にブラウザが scroll イベントを発火させる（isTrusted===true）。
            // setTimeout(0) よりも rAF を 2 回ネストする方が確実に scroll イベントの後にフラグをリセットできる。
            _resourceScrollSyncClearTimer = requestAnimationFrame(function() {
                _resourceScrollSyncClearTimer = requestAnimationFrame(function() {
                    _resourceScrollSyncClearTimer = null;
                    _resourceScrollSyncFromGantt = false;
                });
            });
        }

        gantt.attachEvent("onGanttScroll", function (left, top){
            const resourcePanel = document.getElementById("resource_panel");
            if (resourcePanel && resourcePanel.style.display !== "none") {
                const resourceContent = document.querySelector(".resource-content");
                if (resourceContent && resourceContent.scrollLeft !== left) {
                    _applyResourceScrollLeftFromGantt(resourceContent, left);
                }
            }
        });

        // 3. 【ズーム切り替え時の再描画】
        function setZoom(level) {
            // スクロール位置を保存
            const scrollState = gantt.getScrollState();

            // ボタンのアクティブ状態を切り替え
            document.getElementById('zoom_days_btn').classList.toggle('active', level === 'days');
            document.getElementById('zoom_weeks_btn').classList.toggle('active', level === 'weeks');

            gantt.ext.zoom.setLevel(level); 

            // ズームレベルに応じてコンテナにクラスを付与（CSSでの制御用）
            const container = document.getElementById("gantt_here");
            if (level === "days") {
                container.classList.add("zoom-days");
            } else {
                container.classList.remove("zoom-days");
            }

            gantt.config.start_date = new Date(GANTT_START_DATE.getTime());
            gantt.config.end_date = new Date(GANTT_END_DATE.getTime());
            gantt.config.fit_tasks = false;
            gantt.render();
            
            // スクロール位置を復元
            gantt.scrollTo(scrollState.x, scrollState.y);

            if (currentLocationResourceMode) {
                renderLocationResourceTimeline();
            } else if (currentResourceMode === 'dept' && lastDeptName) {
                filterByDepartment(lastDeptName);
            } else {
                const owner = document.getElementById("resource_owner_input")?.value || lastOwnerName;
                if (owner) showResourceViewByOwner(owner);
            }
        }

        function syncResourceScroll() {
            const resourcePanel = document.getElementById("resource_panel");
            if (!resourcePanel || resourcePanel.style.display === "none") return;
            const ganttScroll = gantt.getScrollState();
            const resourceContent = document.querySelector(".resource-content");
            if (resourceContent) {
                _applyResourceScrollLeftFromGantt(resourceContent, ganttScroll.x);
                // グリッド幅分だけクリップ位置を調整（もし必要なら）
                resourceContent.style.setProperty('--resource-clip-left', '0px');
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            // 担当検索欄・リソース担当検索欄の自動入力を監視してクリア
            const ownerSearch = document.getElementById('owner_search');
            const resourceOwnerInput = document.getElementById('resource_owner_input');
            [ownerSearch, resourceOwnerInput].forEach(el => {
                if (!el) return;
                const clear = () => {
                    if (el.value.includes('@') || el.value.includes('.com') || el.value.includes('.jp')) {
                        el.value = '';
                    }
                };
                el.addEventListener('input', clear);
                el.addEventListener('change', clear);
            });

            setTimeout(() => {
                const resourceContent = document.querySelector(".resource-content");
                if (resourceContent) {
                    resourceContent.addEventListener('scroll', function(ev) {
                        // _applyResourceScrollLeftFromGantt で scrollLeft を設定したときに発火する scroll は
                        // isTrusted===true になる場合があるため isTrusted チェックは使わず、フラグのみで判断する。
                        if (_resourceScrollSyncFromGantt) return;
                        // リソース側のスクロールをガント側に同期
                        // ただし、無限ループを防ぐために現在の位置と異なる場合のみ実行
                        const ganttScroll = gantt.getScrollState();
                        if (Math.abs(ganttScroll.x - this.scrollLeft) > 1) {
                            gantt.scrollTo(this.scrollLeft, null);
                        }
                    }, { passive: true });
                }
            }, 1000);
        });

        // ========== 組立場所リソース バーカラーピッカー ==========
        function isDarkColor(hex) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            // 相対輝度（知覚的な明るさ）で判定
            return (r * 299 + g * 587 + b * 114) / 1000 < 128;
        }

        const LOC_BAR_COLORS = [
            '#EF5350', // 赤
            '#FF9800', // オレンジ
            '#FFEE58', // 黄
            '#8BC34A', // 黄緑
            '#26A69A', // ティール
            '#42A5F5', // 青
            '#7E57C2', // 紫
            '#EC407A', // ピンク
            '#78909C', // グレーブルー
            '#A1887F', // ブラウン
            '#66BB6A', // 緑
            '#9FA8DA', // ラベンダー
            '#80DEEA', // 水色
            '#FFAB91', // サーモン
            '#FFD54F', // 琥珀
        ];

        function getOrCreateLocationColorPicker() {
            let picker = document.getElementById('location-bar-color-picker');
            if (!picker) {
                picker = document.createElement('div');
                picker.id = 'location-bar-color-picker';
                LOC_BAR_COLORS.forEach(color => {
                    const swatch = document.createElement('div');
                    swatch.className = 'loc-bar-color-swatch';
                    swatch.style.backgroundColor = color;
                    swatch.dataset.color = color;
                    picker.appendChild(swatch);
                });
                document.body.appendChild(picker);
            }
            return picker;
        }

        let _locBarPickerTarget = null;
        let _locBarPickerHideTimer = null;

        function initLocationBarColorPicker(container) {
            const picker = getOrCreateLocationColorPicker();

            container.querySelectorAll('.resource-cell-bar[data-task-id]').forEach(bar => {
                bar.addEventListener('click', e => {
                    e.stopPropagation();
                    if (_locBarPickerTarget === bar && picker.classList.contains('visible')) {
                        picker.classList.remove('visible');
                        _locBarPickerTarget = null;
                        return;
                    }
                    _locBarPickerTarget = bar;
                    const rect = bar.getBoundingClientRect();
                    let top = rect.bottom + 4;
                    let left = e.clientX;
                    if (left + 180 > window.innerWidth) left = window.innerWidth - 185;
                    picker.style.top = top + 'px';
                    picker.style.left = left + 'px';
                    const currentColor = locationBarColors[bar.dataset.taskId] || '';
                    picker.querySelectorAll('.loc-bar-color-swatch').forEach(s => {
                        s.classList.toggle('active', s.dataset.color === currentColor);
                    });
                    picker.classList.add('visible');
                });
            });

            picker.addEventListener('click', e => {
                const swatch = e.target.closest('.loc-bar-color-swatch');
                if (!swatch || !_locBarPickerTarget) return;
                const color = swatch.dataset.color;
                const taskId = _locBarPickerTarget.dataset.taskId;
                locationBarColors[taskId] = color;
                _locBarPickerTarget.style.setProperty('background-color', color, 'important');
                supabaseClient.from('tasks').update({ bar_color: color }).eq('id', taskId)
                    .then(({ error }) => { if (error) console.error("バー色保存エラー:", error); });
                picker.querySelectorAll('.loc-bar-color-swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === color);
                });
                picker.classList.remove('visible');
                _locBarPickerTarget = null;
            });

            // ピッカー外クリックで閉じる
            document.addEventListener('click', () => {
                picker.classList.remove('visible');
                _locBarPickerTarget = null;
            });
        }
        // ========================================================

        function getResourceTaskClass(task) {
            if (task.text === "外観検査") return "milestone-circle";
            if (task.text === "出荷確認会議") return "milestone-diamond";
            if (task.text === "工場出荷") return "milestone-star";
            if (task.text === "客先立会") return "milestone-square";
            switch (task.major_item) {
                case '設計': return "task-blue";
                case '製管': case '品証': return "task-green";
                case '組立': return "task-yellow";
                case '電装': return "task-purple";
                case '操業': return "task-red";
                case '電技': return "task-teal";
                case '明石': return "task-brown";
                case '営業': return "task-orange";
                default: return "";
            }
        }

        let _ganttFirstLoad = true;          // 初回ロードフラグ
        const _headerOpenStates = {};        // 見出し行の開閉状態 { taskId: true/false }
        let _newlyCreatedProject = null;     // 新規作成直後の工番（fetchTasks後に見出し行を開く）

        // ユーザー操作 or プログラム呼び出しで開閉が変わったとき即時記録
        gantt.attachEvent("onTaskOpened", function(id) {
            _headerOpenStates[String(id)] = true;
        });
        gantt.attachEvent("onTaskClosed", function(id) {
            _headerOpenStates[String(id)] = false;
        });

        async function loadCompletedProjects() {
            const { data, error } = await supabaseClient.from('completed_projects').select('*');
            if (error) { console.error('[loadCompletedProjects] エラー:', error); return; }
            completedProjects = data || [];
        }

        async function loadHolidays() {
            const { data, error } = await supabaseClient.from('holidays').select('date');
            if (error) {
                console.error('[loadHolidays] エラー:', error);
                return;
            }
            if (data) {
                // "YYYY/M/D" → "YYYY-MM-DD" に正規化してガント側のフォーマットに合わせる
                holidaySet = new Set(data.map(r => {
                    const parts = String(r.date).split('/');
                    if (parts.length === 3) {
                        return parts[0] + '-' + parts[1].padStart(2,'0') + '-' + parts[2].padStart(2,'0');
                    }
                    return String(r.date).substring(0, 10);
                }));
            }
        }


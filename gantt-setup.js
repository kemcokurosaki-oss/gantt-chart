        /**
         * @typedef {Object} TaskLocation
         * @property {number} id - Primary Key
         * @property {string} task_id - tasks.idへの外部キー
         * @property {string} area_group - E1, E2, E3などのテキスト
         * @property {string} area_number - 0〜7などのテキスト
         */

        const S_URL = "https://dgekjzkrybrswsxlcbvh.supabase.co";
        const S_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZWtqemtyeWJyc3dzeGxjYnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4ODQ3MjIsImV4cCI6MjA4NDQ2MDcyMn0.BsEj53lV3p76yE9fMPTaLn7ocKTNzYPTqIAnBafYItU";
        // createClient呼び出し前にURLのtype情報を保存（Supabaseがhashを処理・クリアする前に取得）
        const _pageInitType = new URLSearchParams(window.location.hash.replace('#', '?')).get('type')
                           || new URLSearchParams(window.location.search).get('type');
        const supabaseClient = supabase.createClient(S_URL, S_KEY);

        // ===== 認証管理 =====
        // 編集可能なメールアドレスリスト（確定後に追加してください）
        const EDITORS = [
            'm2-kusakabe@kusakabe.com', // 常務
            'e-kurosaki@kusakabe.com',  // 工程管理者
            's-morimura@kusakabe.com',  // 工程管理者
        ];

        let _isEditor = false;

        function _updateUIForAuth(isEditor) {
            _isEditor = isEditor;
            gantt.config.readonly = !isEditor;
            document.getElementById('new_project_btn').style.display = '';
            document.getElementById('new_project_btn').disabled = !isEditor;
            document.getElementById('kanryo-btn').style.display = '';
            document.getElementById('kanryo-btn').disabled = !isEditor;
            const authBtn = document.getElementById('auth_btn');
            if (authBtn) {
                authBtn.textContent = isEditor ? 'ログアウト' : 'ログイン';
                authBtn.classList.toggle('logged-in', isEditor);
            }
            if (typeof gantt.render === 'function') gantt.render();
            // 公開ボタン・ポーリング制御
            if (typeof window._onAuthChanged === 'function') window._onAuthChanged(isEditor);
        }

        function handleAuthBtn() {
            if (_isEditor) {
                if (confirm('ログアウトしますか？')) { doLogout(); }
            } else {
                openLoginDialog();
            }
        }

        function openLoginDialog() {
            document.getElementById('login_email').value = '';
            document.getElementById('login_password').value = '';
            document.getElementById('login_error').style.display = 'none';
            document.getElementById('login_overlay').classList.add('open');
            setTimeout(() => document.getElementById('login_email').focus(), 100);
        }

        function closeLoginDialog() {
            document.getElementById('login_overlay').classList.remove('open');
        }

        async function doLogin() {
            const email    = document.getElementById('login_email').value.trim();
            const password = document.getElementById('login_password').value;
            const errEl    = document.getElementById('login_error');
            errEl.style.display = 'none';
            document.getElementById('login_btn_submit').textContent = '処理中...';
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            document.getElementById('login_btn_submit').textContent = 'ログイン';
            if (error) {
                errEl.textContent = 'メールアドレスまたはパスワードが正しくありません';
                errEl.style.display = 'block';
            } else {
                closeLoginDialog();
            }
        }

        async function doLogout() {
            await supabaseClient.auth.signOut();
        }

        function openSetPasswordDialog() {
            document.getElementById('setpw_pw1').value = '';
            document.getElementById('setpw_pw2').value = '';
            document.getElementById('setpw_error').style.display = 'none';
            document.getElementById('setpw_overlay').classList.add('open');
            setTimeout(() => document.getElementById('setpw_pw1').focus(), 100);
        }

        async function doSetPassword() {
            const pw1 = document.getElementById('setpw_pw1').value;
            const pw2 = document.getElementById('setpw_pw2').value;
            const errEl = document.getElementById('setpw_error');
            errEl.style.display = 'none';
            if (pw1.length < 8) {
                errEl.textContent = 'パスワードは8文字以上で入力してください';
                errEl.style.display = 'block'; return;
            }
            if (pw1 !== pw2) {
                errEl.textContent = 'パスワードが一致しません';
                errEl.style.display = 'block'; return;
            }
            document.getElementById('setpw_btn_submit').textContent = '処理中...';
            const { error } = await supabaseClient.auth.updateUser({ password: pw1 });
            document.getElementById('setpw_btn_submit').textContent = 'パスワードを設定する';
            if (error) {
                errEl.textContent = 'エラー: ' + error.message;
                errEl.style.display = 'block';
            } else {
                document.getElementById('setpw_overlay').classList.remove('open');
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        }

        supabaseClient.auth.onAuthStateChange((_event, session) => {
            if (_event === 'PASSWORD_RECOVERY' || (_event === 'SIGNED_IN' && _pageInitType === 'invite')) {
                openSetPasswordDialog();
            } else {
                const email = session?.user?.email || '';
                _updateUIForAuth(!!session && EDITORS.includes(email));
            }
        });

        let currentFilter = null;
        let currentMajorFilter = null;
        let currentDisplayMode = 'process'; // 'process' or 'machine'
        let currentResourceMode = 'individual'; // 'individual' か 'dept'
        let lastDeptName = ''; 
        let lastOwnerName = '';
        let currentOwnerFilter = "";
        let isUnassignedOnly = false; // 担当未定フィルタの状態
        let currentOwnerFilterNoData = false; // tasks と task_template の両方に該当がないとき true
        let currentMachineFilter = "";
        let currentTaskFilter = "";
        let currentLocationResourceMode = false; // 組立場所リソースモード
        let locationExpandedGroups = { "E1": true, "E3": true }; // 展開状態
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        let currentResourceDeptFilter = "";
        let currentProjectGroupFilter = "all"; // "all" | "2000" | "other"
        let completedProjects = [];
        // 各エントリ: { project_number, customer_name, project_details, completed_date }
        let holidaySet = new Set(); // Supabaseのholidaysテーブルから取得した休日日付セット（"YYYY-MM-DD"形式）

        const dateToDb = gantt.date.date_to_str("%Y-%m-%d");
        const dateToDisplay = gantt.date.date_to_str("%y/%m/%d");

        // 組立場所の選択肢
        const LOCATION_GROUPS = ["E1", "E3"];
        const LOCATION_NUMBERS = ["0", "1", "2", "3", "4", "5", "6"];

        // カスタムライトボックスセクション：組立場所
        gantt.form_blocks["location_selector"] = {
            render: function (sns) {
                // コンテナ自体にIDを付与して、後で非表示にしやすくする
                let html = "<div id='location_selector_container' class='location_selector_container' style='padding: 5px; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px;'>";
                LOCATION_GROUPS.forEach(group => {
                    html += `<div style='margin-bottom: 8px;'><strong>${group}:</strong><br/>`;
                    LOCATION_NUMBERS.forEach(num => {
                        const val = `${group}-${num}`;
                        html += `<label style='margin-right: 10px; display: inline-block; cursor: pointer;'>
                                    <input type='checkbox' name='loc_cb' value='${val}' data-group='${group}' data-num='${num}' style='vertical-align: middle;'> ${num}
                                 </label>`;
                    });
                    html += "</div>";
                });
                html += "</div>";
                return html;
            },
            set_value: function (node, value, task) {
                // 1. チェックボックス要素をすべて取得
                const checkboxes = node.querySelectorAll("input[name='loc_cb']");
                
                // 2. 現在のグループ(E1/E3)と番号を取得（型を文字列に統一）
                // task_locations テーブルのデータが優先されるように、
                // task オブジェクトに保存されている area_group / area_number を使用する
                const currentGroup = String(task.area_group || "").trim();
                // 番号は "0,1,2" のようなカンマ区切りを配列にする
                const currentNumbers = String(task.area_number || "").split(",").map(n => n.trim());
                
                // 3. 一旦すべてのチェックを外す
                checkboxes.forEach(cb => {
                    cb.checked = false;
                    
                    const cbGroup = cb.getAttribute("data-group");
                    const cbNum = cb.getAttribute("data-num");
                    
                    // 4. グループと番号が一致する場合のみチェックを入れる
                    // task.area_group が空でない場合（tasksテーブルまたはtask_locationsから取得済み）
                    if (currentGroup && currentNumbers.includes(cbNum)) {
                        // グループが一致するか、またはグループ指定がない場合はチェック
                        if (!currentGroup || cbGroup === currentGroup) {
                            cb.checked = true;
                        }
                    }
                });
            },
            get_value: function (node, task) {
                const checked = node.querySelectorAll("input[name='loc_cb']:checked");
                if (checked.length > 0) {
                    // チェックされたすべての要素から、グループと番号を抽出
                    const locations = Array.from(checked).map(cb => ({
                        group: cb.getAttribute("data-group"),
                        num: cb.getAttribute("data-num")
                    }));
                    
                    // 最初のチェックから代表のグループ(E1かE3)をセット（後方互換性のため）
                    task.area_group = locations[0].group;
                    // チェックされたすべての番号を配列にしてカンマ区切り文字列でセット
                    const nums = locations.map(loc => loc.num);
                    task.area_number = nums.join(",");
                    
                    // 複数のグループが混在する場合に備え、詳細な情報を保持
                    task._selected_locations = locations;
                } else {
                    task.area_group = "";
                    task.area_number = "";
                    task._selected_locations = [];
                }
                // Gantt管理用の戻り値
                return task.area_group + "-" + task.area_number;
            },
            focus: function (node) {
            }
        };

        // カスタムライトボックスセクション：担当者複数選択
        gantt.form_blocks["owner_selector"] = {
            render: function (sns) {
                return `<div id='owner_selector_container' class='owner_selector_container' style='padding: 5px; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; min-height: 30px; display: flex; flex-wrap: wrap; gap: 10px;'></div>`;
            },
            set_value: function (node, value, task) {
                const majorItem = task.major_item || "";
                const options = getOwnerOptions(majorItem);
                const container = node.querySelector('#owner_selector_container');
                const mainOwner = (task.main_owner || "").trim();
                const selectedOwners = (value || "").split(',').map(s => s.trim());

                let html = "";
                if (options.length === 0) {
                    html = "<span style='color: #999; font-size: 11px;'>フィルタ色分けを選択してください</span>";
                } else {
                    options.forEach(opt => {
                        const isChecked = selectedOwners.includes(opt.key) ? "checked" : "";
                        const isMain = mainOwner === opt.key ? "checked" : "";
                        html += `<label style='display: inline-flex; align-items: center; gap: 3px; cursor: pointer; font-size: 11px;'>
                                    <input type='radio' name='main_owner_radio' value='${opt.key}' ${isMain} title='メイン担当に設定' style='vertical-align: middle; cursor: pointer;'>
                                    <input type='checkbox' name='owner_checkbox' value='${opt.key}' ${isChecked} style='vertical-align: middle;'> ${opt.label}
                                 </label>`;
                    });
                }
                container.innerHTML = html;
            },
            get_value: function (node, task) {
                const checkboxes = node.querySelectorAll('input[name="owner_checkbox"]:checked');
                const selected = [];
                checkboxes.forEach(cb => selected.push(cb.value));
                const mainRadio = node.querySelector('input[name="main_owner_radio"]:checked');
                task.main_owner = mainRadio ? mainRadio.value : "";
                return selected.join(', ');
            },
            focus: function (node) {}
        };

        // 上段・下段で完全に一致させる固定値（1ピクセルも狂いなく同期）
        let GRID_WIDTH = 600;
        const COLUMN_WIDTHS = [30, 50, 22, 114, 37, 37, 65, 60, 80, 80, 25]; // 詳細, 工事番号, チェック, タスク名, 機械, ユニット, 担当, 場所, 開始日, 終了日, add(担当者名)
        
        // 1列目を固定
        gantt.config.grid_elastic_columns = false;
        gantt.config.columns[0].frozen = true;
        // 下段リソースで担当者検索時にのみフィルタする用（未選択時は下段を非表示）
        let currentResourceOwnerFilter = "";
        let currentProjectFilter = ""; // 工事番号フィルター用
        window.allTasks = []; // グローバルに全データを保持用

        // チェックボックスの状態を保持するオブジェクト
        const taskCheckboxes = {};

        // 組立場所リソースバーの色を保持するオブジェクト
        const locationBarColors = {};

        // 表示期間（上段・下段で同一にし、ズレを防ぐ）
        const GANTT_START_DATE = new Date(2024, 10, 1);  // 2024/11/1
        const GANTT_END_DATE = new Date(2027, 11, 0);   // 2027/11/30（11月末）
        
        // リソースパネルのリサイズ機能
        (function() {
            let isResizing = false;
            let lastY = 0;
            const minHeight = 50;
            const maxHeight = 600;

            window.addEventListener('DOMContentLoaded', () => {
                const resizer = document.getElementById('resource_resizer');
                const panel = document.getElementById('resource_panel');

                if (!resizer || !panel) return;

                resizer.addEventListener('mousedown', (e) => {
                    isResizing = true;
                    lastY = e.clientY;
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isResizing) return;
                    
                    const deltaY = lastY - e.clientY;
                    const panel = document.getElementById('resource_panel');
                    const currentHeight = parseInt(getComputedStyle(panel).height);
                    let newHeight = currentHeight + deltaY;

                    if (newHeight < minHeight) newHeight = minHeight;
                    if (newHeight > maxHeight) newHeight = maxHeight;

                    panel.style.height = newHeight + 'px';
                    lastY = e.clientY;
                });

                window.addEventListener('mouseup', () => {
                    if (isResizing) {
                        isResizing = false;
                        document.body.style.cursor = 'default';
                    }
                });
            });
        })();

        var GANTT_CALENDAR_CONFIG = {
            start_date: new Date(GANTT_START_DATE.getTime()),
            end_date: new Date(GANTT_END_DATE.getTime())
        };

        gantt.plugins({ marker: true, grouplist: true, inline_editors: true, dnd: true });
        
        gantt.config.start_date = GANTT_CALENDAR_CONFIG.start_date;
        gantt.config.end_date = GANTT_CALENDAR_CONFIG.end_date;
        gantt.config.fit_tasks = false; // タスクの有無に関わらず設定期間を維持（下段が10月で終わらないように）
        gantt.config.include_empty_scales = true; // タスクがない期間もカレンダーを表示する
        gantt.config.date_format = "%Y-%m-%d";
        gantt.config.date_grid = "%Y/%m/%d";
        gantt.config.start_on_monday = true; // 週の開始を月曜日に固定

        // 編集画面（ライトボックス）の設定
        const majorItemOptions = [
            { key: "営業", label: "営業" },
            { key: "設計", label: "設計" },
            { key: "製管", label: "製管" },
            { key: "組立", label: "組立" },
            { key: "電装", label: "電装" },
            { key: "品証", label: "品証" },
            { key: "操業", label: "操業" },
            { key: "電技", label: "電技" },
            { key: "明石", label: "明石" },
            { key: "", label: "指定なし" }
        ];

        // 担当者のマスターデータ
        const ownerMaster = {
            "営業": ["専務", "銭", "麻生", "原田", "岡本", "津村", "前川", "池田"],
            "設計": ["藤山", "田中(善)", "安岡", "川邊", "檀", "堀井", "宮﨑", "津田", "古村", "柴田", "橋本", "松本(英)"],
            "製管": ["製造管理", "資材"],
            "組立": ["米澤", "桂", "香西", "古賀", "長谷川", "早川", "廣田", "宮本", "山下", "センティル", "増田", "千代盛", "外注"],
            "電装": ["木村(至)", "木村(圭)", "守時", "外注"],
            "品証": ["田中(孝)"],
            "操業": ["堀尾", "三浦", "黒見", "大西(元)", "大西(優)", "木本", "前田", "本郷", "大重", "外注"],
            "電技": ["松本(幹)", "秋藤"],
            "明石": ["明石工場"]
        };

        // 担当者ごとの色を決定する共通ロジック
        function getOwnerColorClass(ownerName, deptName) {
            if (!ownerName || !deptName) return "";
            const owners = getNormalizedOwners(ownerName);
            if (owners.length === 0) return "";
            
            // 最初の担当者を基準にする
            const firstOwner = owners[0];
            const masterList = ownerMaster[deptName] || [];
            
            // マスターリスト内でのインデックスを探す
            let index = masterList.indexOf(firstOwner);
            if (index === -1) {
                // マスターにない場合は名前の文字列からハッシュ的にインデックスを生成（簡易版）
                let hash = 0;
                for (let i = 0; i < firstOwner.length; i++) {
                    hash = firstOwner.charCodeAt(i) + ((hash << 5) - hash);
                }
                index = Math.abs(hash);
            }
            
            return `resource-bar-color-${index % 20}`;
        }

        // 担当者ごとの●の色を決定する共通ロジック
        function getOwnerDotColorClass(ownerName, deptName) {
            if (!ownerName || !deptName) return "";
            const owners = getNormalizedOwners(ownerName);
            if (owners.length === 0) return "";
            
            const firstOwner = owners[0];
            const masterList = ownerMaster[deptName] || [];
            
            let index = masterList.indexOf(firstOwner);
            if (index === -1) {
                let hash = 0;
                for (let i = 0; i < firstOwner.length; i++) {
                    hash = firstOwner.charCodeAt(i) + ((hash << 5) - hash);
                }
                index = Math.abs(hash);
            }
            
            return `owner-dot-color-${index % 20}`;
        }

        function getOwnerOptions(majorItem) {
            const list = ownerMaster[majorItem] || [];
            return list.map(name => ({ key: name, label: name }));
        }

        // インラインエディタの設定
        const ownerEditor = {
            type: "select",
            map_to: "owner",
            options: [] // 動的に変更される
        };

        gantt.config.editor_types.owner_editor = {
            show: function (id, column, config, placeholder) {
                const task = gantt.getTask(id);
                const options = getOwnerOptions(task.major_item);
                
                let html = "<select style='width:100%; height:100%; border:none;'>";
                html += "<option value=''>未選択</option>";
                options.forEach(opt => {
                    html += `<option value="${opt.key}" ${task.owner === opt.key ? "selected" : ""}>${opt.label}</option>`;
                });
                html += "</select>";
                placeholder.innerHTML = html;
            },
            hide: function () {
            },
            set_value: function (value, id, column, node) {
                node.firstChild.value = value || "";
            },
            get_value: function (id, column, node) {
                return node.firstChild.value;
            },
            is_changed: function (value, id, column, node) {
                const task = gantt.getTask(id);
                return value !== task.owner;
            },
            is_valid: function (value, id, column, node) {
                return true;
            },
            save: function (id, column, node) {
            },
            focus: function (node) {
                node.firstChild.focus();
            }
        };

        // インラインエディタを有効化
        gantt.config.show_errors = false;

        // 担当者用カスタムコントロールの登録
        gantt.form_blocks["owner_selector"] = {
            render: function(sns) {
                return `<div class='owner_selector_wrapper' style='padding:5px;'>
                            <div class='owner_selector_container' style='height:100px; overflow-y:auto; border:1px solid #ccc; padding:5px; background:#fff;'></div>
                            <div style='margin-top:5px; display:flex; gap:5px;'>
                                <button class='add_owner_option' style='flex-grow:1; height:25px; cursor:pointer; background:#4CAF50; color:white; border:none; border-radius:4px; font-weight:bold; font-size:12px;'>+ 担当者追加</button>
                                <button class='remove_owner_option' style='flex-grow:1; height:25px; cursor:pointer; background:#f44336; color:white; border:none; border-radius:4px; font-weight:bold; font-size:12px;'>- 選択中を削除</button>
                            </div>
                        </div>`;
            },
            set_value: function(node, value, task) {
                const container = node.querySelector(".owner_selector_container");
                if (!container) return;

                const majorItem = task.major_item || "";
                
                // イベントリスナーの設定（初回のみ）
                if (!node._events_attached) {
                    node.querySelector(".add_owner_option").onclick = function() {
                        const currentMajorItem = task.major_item;
                        if (!currentMajorItem) {
                            alert("先に「フィルタ色分け（部署）」を選択してください。");
                            return;
                        }
                        const newOwnerName = prompt(`「${currentMajorItem}」に新しい担当者を追加します:`);
                        if (newOwnerName && newOwnerName.trim() !== "") {
                            if (!ownerMaster[currentMajorItem]) {
                                ownerMaster[currentMajorItem] = [];
                            }
                            if (!ownerMaster[currentMajorItem].includes(newOwnerName)) {
                                ownerMaster[currentMajorItem].push(newOwnerName);
                                // 再描画
                                gantt.form_blocks["owner_selector"].set_value(node, value, task);
                            }
                        }
                    };

                    node.querySelector(".remove_owner_option").onclick = function() {
                        const currentMajorItem = task.major_item;
                        if (!currentMajorItem) return;

                        const checkedCheckboxes = container.querySelectorAll("input:checked");
                        if (checkedCheckboxes.length === 0) {
                            alert("削除する担当者にチェックを入れてください。");
                            return;
                        }

                        const namesToRemove = Array.from(checkedCheckboxes).map(cb => cb.value);
                        if (confirm(`選択された担当者（${namesToRemove.join(", ")}）をリストから削除しますか？`)) {
                            ownerMaster[currentMajorItem] = ownerMaster[currentMajorItem].filter(name => !namesToRemove.includes(name));
                            // 再描画（削除されたのでチェックは外れる）
                            gantt.form_blocks["owner_selector"].set_value(node, "", task);
                        }
                    };
                    node._events_attached = true;
                }

                const owners = ownerMaster[majorItem] || [];
                const selected = (value || "").split(",").map(s => s.trim());

                let html = "";
                if (owners.length === 0) {
                    html = "<span style='color:#999; font-size:11px;'>部署（フィルタ色分け）を選択してください</span>";
                } else {
                    owners.forEach(name => {
                        const isChecked = selected.includes(name) ? "checked" : "";
                        html += `<label style='display:inline-block; width:120px; margin-bottom:3px; font-size:11px; cursor:pointer;'>
                                    <input type='checkbox' value='${name}' ${isChecked} style='vertical-align:middle;'> ${name}
                                 </label>`;
                    });
                }
                container.innerHTML = html;
            },
            get_value: function(node, task) {
                const container = node.querySelector(".owner_selector_container");
                const checked = Array.from(container.querySelectorAll("input:checked")).map(cb => cb.value);
                return checked.join(", ");
            },
            focus: function (node) {}
        };

        // タスク名のプルダウン選択肢
        const taskNameOptions = [
            { label: "受注", options: ["受注日", "受注説明会"] },
            { label: "基本設計＆計画承認", options: ["計画設計", "計画図客先提出", "客先承認", "操作盤外形図検討", "外形図客先提出", "電気図面設計", "電気図面客先提出", "客先承認"] },
            { label: "長納期品手配", options: ["長納期製作品", "長納期購入品", "長納期電気品"] },
            { label: "出図＆部品手配", options: ["出図", "製作品納期", "購入品納期", "組立図", "神戸送り開始日"] },
            { label: "電気設計＆電気品手配", options: ["最終電気図面", "電気品手配", "電気品納期"] },
            { label: "盤製作", options: ["盤組立"] },
            { label: "組立全体", options: ["機械組立", "電気艤装"] },
            { label: "外観検査", options: ["外観検査"] },
            { label: "試運転", options: ["試運転"] },
            { label: "客先立会", options: ["客先立会"] },
            { label: "出荷確認会議", options: ["出荷確認会議"] },
            { label: "出荷", options: ["出荷準備", "工場出荷"] }
        ];

        // タスク名用カスタムコントロールの登録
        gantt.form_blocks["task_name_selector"] = {
            render: function(sns) {
                return `<div class='task_name_selector_container' style='padding:5px; display:flex; align-items:center; gap:5px;'>
                            <div style='display:flex; flex-direction:column; gap:4px; flex-grow:1;'>
                                <select style='width:100%; height:30px; font-size:13px; padding:4px;'></select>
                                <input type='text' class='task_name_free_input' placeholder='タスク名を自由入力...' style='width:100%; height:30px; font-size:13px; padding:4px; border:1px solid #aaa; border-radius:4px; box-sizing:border-box; display:none;'>
                            </div>
                            <button class='add_task_option' style='width:30px; height:30px; cursor:pointer; background:#4CAF50; color:white; border:none; border-radius:4px; font-weight:bold;'>+</button>
                            <button class='remove_task_option' style='width:30px; height:30px; cursor:pointer; background:#f44336; color:white; border:none; border-radius:4px; font-weight:bold;'>-</button>
                        </div>`;
            },
            set_value: function(node, value, task) {
                const select = node.querySelector("select");
                const freeInput = node.querySelector(".task_name_free_input");
                if (!select) return;

                // 出張予定モードの場合の選択肢
                const businessTripOptions = ["現地搬入", "現地据付", "現地工事", "現地試運転", "現地操業", "現地SV"];

                // イベントリスナーの設定（初回のみ）
                if (!node._events_attached) {
                    node.querySelector(".add_task_option").onclick = function() {
                        const newTaskName = prompt("新しいタスク名を入力してください:");
                        if (newTaskName && newTaskName.trim() !== "") {
                            if (currentDisplayMode === 'business_trip') {
                                // 出張予定モード時は一時的な選択肢として追加（保存はされないが、その場では選択可能）
                                const newOpt = document.createElement("option");
                                newOpt.value = newTaskName;
                                newOpt.text = newTaskName;
                                select.add(newOpt);
                                select.value = newTaskName;
                            } else {
                                const parentName = task.parent_name || "その他";
                                let group = taskNameOptions.find(g => g.label === parentName);
                                if (!group) {
                                    group = { label: parentName, options: [] };
                                    taskNameOptions.push(group);
                                }
                                if (!group.options.includes(newTaskName)) {
                                    group.options.push(newTaskName);
                                    // プルダウンを再描画
                                    gantt.form_blocks["task_name_selector"].set_value(node, newTaskName, task);
                                }
                            }
                        }
                    };

                    node.querySelector(".remove_task_option").onclick = function() {
                        const currentValue = select.value;
                        if (!currentValue) {
                            alert("削除するタスク名を選択してください。");
                            return;
                        }
                        if (confirm(`「${currentValue}」をリストから削除しますか？`)) {
                            if (currentDisplayMode === 'business_trip') {
                                // 出張予定モード時は、固定リストに含まれないものだけ削除可能（見た目上）
                                if (!businessTripOptions.includes(currentValue)) {
                                    for (let i = 0; i < select.options.length; i++) {
                                        if (select.options[i].value === currentValue) {
                                            select.remove(i);
                                            break;
                                        }
                                    }
                                    select.value = "";
                                } else {
                                    alert("この項目は固定リストのため削除できません。");
                                }
                            } else {
                                const parentName = task.parent_name || "";
                                let group = taskNameOptions.find(g => g.label === parentName);
                                if (!group) {
                                    // 全体から探す
                                    taskNameOptions.forEach(g => {
                                        const idx = g.options.indexOf(currentValue);
                                        if (idx !== -1) g.options.splice(idx, 1);
                                    });
                                } else {
                                    const idx = group.options.indexOf(currentValue);
                                    if (idx !== -1) group.options.splice(idx, 1);
                                }
                                // プルダウンを再描画
                                gantt.form_blocks["task_name_selector"].set_value(node, "", task);
                            }
                        }
                    };
                    select.addEventListener("change", function() {
                        if (freeInput) {
                            freeInput.style.display = select.value === "__free__" ? "" : "none";
                            if (select.value === "__free__") freeInput.focus();
                        }
                    });
                    node._events_attached = true;
                }

                let html = "<option value=''>選択してください</option>";

                if (currentDisplayMode === 'business_trip') {
                    // 出張予定モード：固定の選択肢を表示
                    businessTripOptions.forEach(opt => {
                        html += `<option value="${opt}">${opt}</option>`;
                    });
                } else {
                    // 通常モード：見出し名（parent_name）に基づいて選択肢を生成
                    const parentName = task.parent_name || "";
                    const group = taskNameOptions.find(g => g.label === parentName);
                    
                    if (group) {
                        // 一致する見出し名がある場合、そのグループのタスクのみ表示
                        group.options.forEach(opt => {
                            html += `<option value="${opt}">${opt}</option>`;
                        });
                    } else {
                        // 一致する見出し名がない場合は全件表示
                        taskNameOptions.forEach(g => {
                            html += `<optgroup label="${g.label}">`;
                            g.options.forEach(opt => {
                                html += `<option value="${opt}">${opt}</option>`;
                            });
                            html += "</optgroup>";
                        });
                    }
                }
                html += `<option value="__free__">── 自由入力 ──</option>`;
                select.innerHTML = html;

                // 既存の値が選択肢にない場合は「自由入力」を選択して入力欄に表示
                if (value) {
                    let exists = false;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === value) { exists = true; break; }
                    }
                    if (!exists) {
                        select.value = "__free__";
                        if (freeInput) { freeInput.value = value; freeInput.style.display = ""; }
                    } else {
                        select.value = value;
                        if (freeInput) freeInput.style.display = "none";
                    }
                } else {
                    select.value = "";
                    if (freeInput) freeInput.style.display = "none";
                }
            },
            get_value: function(node, task) {
                const select = node.querySelector("select");
                if (!select) return "";
                if (select.value === "__free__") {
                    const freeInput = node.querySelector(".task_name_free_input");
                    return freeInput ? freeInput.value.trim() : "";
                }
                return select.value;
            },
            focus: function(node) {
                const select = node.querySelector("select");
                if (select) select.focus();
            }
        };

        gantt.form_blocks["datepicker"] = {
            render: function(sns) {
                // 単一ルート要素で包む（DHTMLX edge は section.node = ltext.firstChild のため必須）
                return `<div class="datepicker-wrap" style="display:flex; align-items:center; gap:4px; padding:2px 0;">
                    <input type='date' class='datepicker-input' style='flex:1; height:26px; font-size:13px;'>
                    <span style='flex-shrink:0;'>～</span>
                    <input type='date' class='datepicker-input-end' style='flex:1; height:26px; font-size:13px;'>
                </div>`;
            },
            set_value: function(node, value, task) {
                const startInput = node ? node.querySelector(".datepicker-input") : null;
                const endInput = node ? node.querySelector(".datepicker-input-end") : null;
                if (!startInput || !endInput) return;
                if (task.start_date) {
                    startInput.value = gantt.date.date_to_str("%Y-%m-%d")(task.start_date);
                }
                if (task.end_date) {
                    endInput.value = gantt.date.date_to_str("%Y-%m-%d")(task.end_date);
                }
            },
            get_value: function(node, task) {
                const startInput = node ? node.querySelector(".datepicker-input") : null;
                const endInput = node ? node.querySelector(".datepicker-input-end") : null;
                if (!startInput || !endInput) return task.start_date;
                if (startInput.value) {
                    task.start_date = gantt.date.str_to_date("%Y-%m-%d")(startInput.value);
                }
                if (endInput.value) {
                    task.end_date = gantt.date.str_to_date("%Y-%m-%d")(endInput.value);
                }
                return task.start_date;
            },
            focus: function(node) {
                const startInput = node ? node.querySelector(".datepicker-input") : null;
                if (startInput) startInput.focus();
            }
        };

        gantt.config.lightbox.sections = [
            { name: "project_number", height: 24, map_to: "project_number", type: "textarea", focus: true },
            { name: "parent_name", height: 24, map_to: "parent_name", type: "textarea" },
            { name: "major_item", height: 24, map_to: "major_item", type: "select", options: majorItemOptions },
            { name: "machine", height: 24, map_to: "machine", type: "textarea" },
            { name: "unit", height: 24, map_to: "unit", type: "textarea" },
            { name: "description", height: 34, map_to: "text", type: "task_name_selector" },
            { name: "owner", height: 80, map_to: "owner", type: "owner_selector" },
            { name: "locations", height: 80, map_to: "locations", type: "location_selector" },
            { name: "time", height: 30, type: "datepicker", map_to: "auto" }
        ];

        // gantt.showLightbox を全タスク共通のシンプルな構造に書き換え
        const originalShowLightbox = gantt.showLightbox;
        gantt.showLightbox = async function(id) {
            try {
                // ① タスクを取得
                const task = gantt.getTask(id);

                // ② 担当者プルダウンの更新（major_itemに連動）
                // ※ owner_selector は checkbox 形式なので innerHTML 直接操作は不要
                // ※ 必要に応じて getLightboxSection で取得して再描画させる
                const ownerSection = gantt.getLightboxSection("owner");
                if (ownerSection && ownerSection.control) {
                    // owner_selector の set_value を呼び出して再描画
                    ownerSection.set_value(ownerSection.control, task.owner || "", task);
                }

                // ③ Supabase から場所データを取得してタスクオブジェクトに保持させる
                // これにより、後続の originalShowLightbox -> set_value でチェックが復元される
                const { data: locations, error } = await supabaseClient
                    .from('task_locations')
                    .select('*')
                    .eq('task_id', id);
                
                if (!error && locations) {
                    task.locations = locations;
                    // area_group, area_number も同期しておく
                    if (locations.length > 0) {
                        task.area_group = locations[0].area_group;
                        task.area_number = locations.map(l => l.area_number).join(",");
                    }
                } else {
                    task.locations = [];
                }

                // ④ ライトボックスを表示（内部で set_value が呼ばれる）
                originalShowLightbox.call(gantt, id);

                // ⑤ ダイアログが描画された直後にドラッグを設定
                setTimeout(function() {
                    const dialog = document.querySelector(".gantt_cal_light");
                    if (!dialog) return;

                    // html/body の overflow:hidden を解除（fixed要素が画面外で切れないよう）
                    document.documentElement.style.overflow = "visible";
                    document.body.style.overflow = "visible";

                    // ダイアログが閉じたら overflow を復元
                    const overflowObserver = new MutationObserver(function() {
                        if (!document.querySelector(".gantt_cal_light") ||
                            document.querySelector(".gantt_cal_light").style.display === "none") {
                            document.documentElement.style.overflow = "hidden";
                            document.body.style.overflow = "hidden";
                            overflowObserver.disconnect();
                        }
                    });
                    overflowObserver.observe(document.body, { childList: true, subtree: false });

                    if (dialog._dragAttached) return;
                    dialog._dragAttached = true;
                    const titleBar = dialog.querySelector(".gantt_cal_title") || dialog.querySelector(".gantt_cal_header");
                    const handle = titleBar || dialog;
                    handle.style.cursor = "move";
                    handle.addEventListener("mousedown", function(e) {
                        if (e.target.closest(".gantt_cal_x, input, select, textarea, button, label")) return;
                        // 現在の位置を取得してtransformを解除し left/top で管理
                        const rect = dialog.getBoundingClientRect();
                        let curLeft = rect.left;
                        let curTop  = rect.top;
                        dialog.style.setProperty("transform", "none", "important");
                        dialog.style.setProperty("left", curLeft + "px", "important");
                        dialog.style.setProperty("top",  curTop  + "px", "important");
                        function onMove(ev) {
                            curLeft += ev.movementX;
                            curTop  += ev.movementY;
                            dialog.style.setProperty("left", curLeft + "px", "important");
                            dialog.style.setProperty("top",  curTop  + "px", "important");
                        }
                        function onUp() {
                            document.removeEventListener("mousemove", onMove);
                            document.removeEventListener("mouseup",  onUp);
                        }
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup",  onUp);
                        e.preventDefault();
                    });
                }, 50);

            } catch (e) {
                console.error("Lightbox error:", e);
                // エラー時も最低限表示を試みる
                originalShowLightbox.call(gantt, id);
            }
        };

        gantt.locale.labels.section_locations = "組立場所";

        // major_item が変更された時に担当者リストを更新する
        // 未ログイン・編集権限なしの場合はライトボックスを開かない
        gantt.attachEvent("onBeforeLightbox", function(id) {
            const task = gantt.getTask(id);
            if (task && task.$virtual) return false; // 見出し行はライトボックスを開かない
            return _isEditor;
        });

        // ダブルクリックによるライトボックス表示もブロック
        gantt.attachEvent("onTaskDblClick", function(id, e) {
            const task = gantt.getTask(id);
            if (task && task.$virtual) return false; // 見出し行はブロック
            return _isEditor;
        });

        // ネイティブイベントレベルでダブルクリックをキャプチャしてブロック（最優先）
        document.getElementById('gantt_here').addEventListener('dblclick', function(e) {
            if (!_isEditor) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);

        // ライトボックスをドラッグで移動できるようにする
        gantt.attachEvent("onLightboxReady", function() {
            const dialog = document.querySelector(".gantt_cal_light");
            if (!dialog) return;
            const titleBar = dialog.querySelector(".gantt_cal_title") || dialog.querySelector(".gantt_cal_header") || dialog;
            titleBar.style.cursor = "move";
            titleBar.addEventListener("mousedown", function(e) {
                if (e.target.closest(".gantt_cal_x, input, select, textarea, button, label, input[type=checkbox]")) return;
                const rect = dialog.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;
                dialog.style.setProperty("transform", "none", "important");
                dialog.style.setProperty("left", rect.left + "px", "important");
                dialog.style.setProperty("top",  rect.top  + "px", "important");
                function onMouseMove(ev) {
                    dialog.style.setProperty("left", (ev.clientX - offsetX) + "px", "important");
                    dialog.style.setProperty("top",  (ev.clientY - offsetY) + "px", "important");
                }
                function onMouseUp() {
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup",  onMouseUp);
                }
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup",  onMouseUp);
                e.preventDefault();
            });
        });

        // ライトボックス表示後にDHHTMLXのインライン height/padding を強制リセット（縦1列）
        gantt.attachEvent("onLightboxReady", function() {
            const larea = document.querySelector(".gantt_cal_larea");
            if (!larea) return;
            Array.from(larea.children).forEach(function(el) {
                if (el.classList.contains("gantt_cal_lsection")) {
                    el.style.cssText = "border:none; margin:0; padding:4px 0 1px; font-size:11px; font-weight:normal; line-height:1.3; color:#333; display:block;";
                } else if (el.classList.contains("gantt_cal_ltext")) {
                    el.style.margin = "0";
                    el.style.padding = "0";
                    el.style.setProperty("height", "auto", "important");
                    el.style.setProperty("overflow", "visible", "important");
                    // textarea/select を含む場合は高さを制限
                    const ta = el.querySelector("textarea");
                    const sel = el.querySelector("select");
                    if ((ta || sel) && !el.querySelector(".datepicker-input") && !el.querySelector("input[type=checkbox]") && !el.querySelector("button")) {
                        const h = sel ? "32px" : "24px";
                        el.style.setProperty("height", h, "important");
                        el.style.setProperty("overflow", "hidden", "important");
                    }
                }
            });
        });

        // 部署プルダウン変更時に担当チェックボックスをリアルタイム更新
        function _refreshOwnerCheckboxes(majorItem) {
            const container = document.querySelector('.owner_selector_container');
            if (!container) return;
            const options = getOwnerOptions(majorItem || "");
            // 現在チェック済みの担当者を保持
            const checked = Array.from(container.querySelectorAll('input[name="owner_checkbox"]:checked')).map(el => el.value);
            const mainChecked = (container.querySelector('input[name="main_owner_radio"]:checked') || {}).value || "";
            let html = "";
            if (options.length === 0) {
                html = "<span style='color: #999; font-size: 11px;'>部署を選択してください</span>";
            } else {
                options.forEach(opt => {
                    const isChecked = checked.includes(opt.key) ? "checked" : "";
                    const isMain = mainChecked === opt.key ? "checked" : "";
                    html += `<label style='display: inline-flex; align-items: center; gap: 3px; cursor: pointer; font-size: 11px;'>
                                <input type='radio' name='main_owner_radio' value='${opt.key}' ${isMain} title='メイン担当に設定' style='vertical-align: middle; cursor: pointer;'>
                                <input type='checkbox' name='owner_checkbox' value='${opt.key}' ${isChecked} style='vertical-align: middle;'> ${opt.label}
                             </label>`;
                });
            }
            container.innerHTML = html;
        }


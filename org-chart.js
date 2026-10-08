// 体制表（指揮系統）の表示・編集
// Supabase の org_charts（工番ごとの系統ツリー）と staff_directory（社内名簿）を使う。
// 読み込み前に PROJECT_NUMBER / S_URL / S_KEY を定義し、#orgChartRow と #orgChartTools を置いておくこと。
// 編集できるのは org_chart_admins に登録された管理者のみ（ログインは工程表と共通のアカウント）。
//
// 編集操作：上に置くカード → その下につなぐカードの順にクリックすると線でつながる（ドラッグで重ねても可）。
// 新しいカードは「未接続カード置き場」で作ってからつなぐ。位置は常に自動整列。
(function () {
    const row = document.getElementById('orgChartRow');
    const tools = document.getElementById('orgChartTools');
    if (!row || !tools) return;

    const client = supabase.createClient(S_URL, S_KEY);
    const ROLE_SUGGEST = ['試運転責任者', '全般', '組立業者 責任者', '組立業者 助勢', '電気業者', '組立発注担当者', '機械', '電気'];

    let charts = [];        // [{ id, title, tree: [node] }]
    let tray = [];          // 未接続カード（保存されない）
    let snapshot = '';      // キャンセル時に戻すための保存時点の状態
    let deletedIds = [];
    let undoStack = [];
    let staff = [];
    let editing = false;
    let canEdit = false;    // 管理者としてログイン中か（編集ボタンの表示判定）
    let loadFailed = false; // 体制表の取得失敗時は HTML 記載の表を出すだけで編集させない
    let selected = null;    // 選択中のカード（node オブジェクト）
    let dragNode = null;
    let nodeIndex = new Map();   // uid -> { node, siblings, chartIdx }（chartIdx=-1 は置き場）
    let uidSeq = 0;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function stripRuntime(nodes) {
        return nodes.map(n => {
            const o = { ...n, children: stripRuntime(n.children || []) };
            delete o._uid;
            return o;
        });
    }
    function containsNode(node, target) {
        return node === target || (node.children || []).some(c => containsNode(c, target));
    }
    function nodeLabel(n) {
        if (!n) return '';
        return n.type === 'label' ? `〔${n.text || 'ラベル'}〕` : ([n.role, n.name].filter(Boolean).join('：') || '（未設定）');
    }

    // ===== 描画 =====
    function nodeBoxHtml(n, depth) {
        const attrs = editing ? ` data-uid="${n._uid}" draggable="true"` : '';
        const sel = editing && n === selected ? ' oc-sel' : '';
        if (n.type === 'label') {
            return `<div class="org-box org-box--label${sel}"${attrs}>${esc(n.text) || '（ラベル）'}</div>`;
        }
        const name = esc(n.name) + (n.subName ? `<br><small>（${esc(n.subName)}）</small>` : '');
        const tel = esc(n.tel) + (n.subTel ? `<br><small>（${esc(n.subTel)}）</small>` : '');
        return `<div class="org-box${depth === 0 ? ' org-box--root' : ''}${sel}"${attrs}>
            ${n.role ? `<span class="org-role${n.roleAlt ? ' alt' : ''}">${esc(n.role)}</span>` : ''}
            ${n.org ? `<div class="org-org">${esc(n.org)}</div>` : ''}
            <div class="org-name">${name || '（未設定）'}</div>
            ${tel ? `<div class="org-tel">${tel}</div>` : ''}
        </div>`;
    }
    function treeHtml(nodes, depth, chartIdx) {
        if (!nodes.length) return '';
        return `<ul${depth === 0 ? ' class="tree"' : ''}>` + nodes.map(n => {
            n._uid = ++uidSeq;
            nodeIndex.set(n._uid, { node: n, siblings: nodes, chartIdx });
            return `<li>${nodeBoxHtml(n, depth)}${treeHtml(n.children || [], depth + 1, chartIdx)}</li>`;
        }).join('') + '</ul>';
    }
    function render() {
        nodeIndex = new Map();
        row.classList.toggle('oc-editing', editing);
        // 編集中は右パネルを全画面に広げる（終了すると元の幅に戻る）
        const panel = row.closest('.fullscreen-overlay');
        if (panel) panel.classList.toggle('oc-full', editing);
        let html = charts.map((c, i) => {
            const title = editing
                ? `<div class="oc-chart-head">
                    <input class="oc-title-input" data-ci="${i}" value="${esc(c.title)}" placeholder="系統名">
                    <button type="button" data-ca="left" data-ci="${i}" title="系統を左へ">◀</button>
                    <button type="button" data-ca="right" data-ci="${i}" title="系統を右へ">▶</button>
                    <button type="button" data-ca="del" data-ci="${i}" title="系統を削除">✕</button>
                  </div>`
                : `<div class="org-section-title">${esc(c.title)}</div>`;
            const zone = editing ? `<div class="oc-rootzone" data-root="${i}">ここをクリック／ドロップで最上位に置く</div>` : '';
            return `<div class="org-chart-col${i === 0 ? ' wide' : ''}">${title}${zone}${treeHtml(c.tree, 0, i)}</div>`;
        }).join('');
        if (editing) {
            html += `<div class="oc-tray" data-tray="1">
                <div class="oc-tray-head">
                    <span>未接続カード置き場</span>
                    <button type="button" class="oc-btn" data-t="newperson">＋人カード</button>
                    <button type="button" class="oc-btn" data-t="newlabel">＋分岐ラベル（不在時など）</button>
                </div>
                ${tray.length ? treeHtml(tray, 1, -1).replace(/^<ul>/, '<ul class="tree">')
                    : '<div class="oc-tray-empty">新しいカードはここに作られます。切り離したカードもここに入ります。</div>'}
            </div>`;
        }
        row.innerHTML = html;
        renderTools();
    }
    function renderTools() {
        if (!editing) {
            // 編集ボタンは管理者としてログイン中のときだけ表示（外注先には見せない）
            tools.innerHTML = canEdit && !loadFailed ? `<button type="button" class="oc-btn oc-btn--ghost" data-t="start">体制表を編集</button>` : '';
            return;
        }
        const selBar = selected
            ? `<div class="oc-selbar">
                <span class="oc-selname">選択中：<b>${esc(nodeLabel(selected))}</b></span>
                <span class="oc-hint">→ 次にクリックしたカードを、このカードの下につなぎます</span>
                <button type="button" class="oc-btn" data-t="edit">✎ 編集</button>
                <button type="button" class="oc-btn" data-t="left" title="兄弟の中で左へ">◀</button>
                <button type="button" class="oc-btn" data-t="right" title="兄弟の中で右へ">▶</button>
                <button type="button" class="oc-btn" data-t="detach">切り離す</button>
                <button type="button" class="oc-btn oc-btn--danger" data-t="del">削除</button>
                <button type="button" class="oc-btn oc-btn--ghost" data-t="deselect">選択解除（Esc）</button>
              </div>`
            : `<div class="oc-selbar oc-selbar--idle">上に置くカード → その下につなぐカードの順にクリックすると線でつながります。ドラッグで重ねても OK。ダブルクリックで内容を編集。</div>`;
        tools.innerHTML = `
            <div class="oc-toolrow">
                <button type="button" class="oc-btn" data-t="undo"${undoStack.length ? '' : ' disabled'}>↶ 元に戻す</button>
                <button type="button" class="oc-btn" data-t="addchart">＋系統を追加</button>
                <button type="button" class="oc-btn" data-t="staff">社内名簿の管理</button>
                <a class="oc-btn oc-btn--ghost oc-help" href="体制表_編集ガイド.html" target="_blank" rel="noopener">？ 使い方</a>
                <span class="oc-spacer"></span>
                <button type="button" class="oc-btn oc-btn--ghost" data-t="cancel">キャンセル</button>
                <button type="button" class="oc-btn oc-btn--primary" data-t="save">保存</button>
            </div>${selBar}`;
    }

    // ===== 操作（すべて undo 可能） =====
    function pushUndo() {
        undoStack.push(JSON.stringify({ charts, tray }));
        if (undoStack.length > 50) undoStack.shift();
    }
    function undo() {
        if (!undoStack.length) return;
        const s = JSON.parse(undoStack.pop());
        charts = s.charts;
        tray = s.tray;
        selected = null;
        render();
    }
    function detach(node) {
        const cur = nodeIndex.get(node._uid);
        cur.siblings.splice(cur.siblings.indexOf(node), 1);
    }
    function connect(parent, child) {
        if (parent === child) return;
        if (containsNode(child, parent)) { alert('このつなぎ方はできません。\n（あるカードを、自分の下につながっているカードの下に移すと、輪になってしまうため）'); return; }
        if ((parent.children || []).includes(child)) return;
        pushUndo();
        detach(child);
        parent.children = parent.children || [];
        parent.children.push(child);
    }
    function moveTo(node, list) {
        pushUndo();
        detach(node);
        list.push(node);
    }
    function nodeFromEl(el) {
        const box = el.closest('.org-box[data-uid]');
        return box ? nodeIndex.get(Number(box.dataset.uid)).node : null;
    }

    // ===== 読込・保存 =====
    async function load() {
        const { data, error } = await client.from('org_charts')
            .select('id, title, sort_order, tree')
            .eq('project_number', PROJECT_NUMBER)
            .order('sort_order');
        if (error) {
            // テーブル未作成などのときは HTML に書かれた体制表をそのまま表示する
            console.error('体制表の取得に失敗しました', error);
            loadFailed = true;
            tools.innerHTML = '';
            return;
        }
        if (!data.length) { renderTools(); return; }   // 未登録の工番は HTML の記載を表示
        charts = data.map(r => ({ id: r.id, title: r.title, tree: Array.isArray(r.tree) ? r.tree : [] }));
        snapshot = JSON.stringify(charts);
        render();
    }
    async function save() {
        if (tray.length && !confirm(`未接続のカードが ${tray.length} 枚あります。これらは保存されません。保存しますか？`)) return;
        const { data: { session } } = await client.auth.getSession();
        if (!session) { alert('ログインが切れています。再度ログインしてください。'); await loginDialog(); return; }
        const email = session.user.email;
        try {
            for (let i = 0; i < charts.length; i++) {
                const c = charts[i];
                const rec = {
                    project_number: PROJECT_NUMBER, title: c.title.trim() || '（無題の系統）',
                    sort_order: i, tree: stripRuntime(c.tree),
                    updated_at: new Date().toISOString(), updated_by: email,
                };
                if (c.id) {
                    const { data, error } = await client.from('org_charts').update(rec).eq('id', c.id).select('id');
                    if (error) throw error;
                    if (!data.length) throw new Error('更新できませんでした（権限がないか、ログインが切れています）');
                } else {
                    const { data, error } = await client.from('org_charts').insert(rec).select('id').single();
                    if (error) throw error;
                    c.id = data.id;
                }
            }
            if (deletedIds.length) {
                const { error } = await client.from('org_charts').delete().in('id', deletedIds);
                if (error) throw error;
            }
        } catch (e) {
            console.error('体制表の保存に失敗しました', e);
            alert('保存に失敗しました：' + (e.message || e));
            return;
        }
        endEdit();
        await load();
    }
    function endEdit() {
        editing = false;
        selected = null;
        tray = [];
        deletedIds = [];
        undoStack = [];
    }

    // ===== 管理者ログイン =====
    async function checkAdmin() {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return false;
        const { data, error } = await client.rpc('is_org_chart_admin');
        return !error && data === true;
    }
    async function startEdit() {
        if (!(await checkAdmin())) {
            const ok = await loginDialog();
            if (!ok) return;
            if (!(await checkAdmin())) { alert('このアカウントには体制表の編集権限がありません。'); return; }
        }
        await loadStaff();
        if (!charts.length) charts = [{ id: null, title: '試運転指揮系統', tree: [] }];
        snapshot = snapshot || JSON.stringify(charts);
        editing = true;
        render();
    }
    function loginDialog() {
        return new Promise(resolve => {
            const m = openModal('管理者ログイン', `
                <p class="oc-note">工程表と同じアカウントでログインしてください。</p>
                <label class="oc-field"><span>メールアドレス</span><input type="email" name="email" autocomplete="username"></label>
                <label class="oc-field"><span>パスワード</span><input type="password" name="pw" autocomplete="current-password"></label>
                <div class="oc-err"></div>`, [
                { label: 'キャンセル', ghost: true, onClick: () => { m.close(); resolve(false); } },
                { label: 'ログイン', primary: true, onClick: async () => {
                    const email = m.el.querySelector('[name=email]').value.trim();
                    const password = m.el.querySelector('[name=pw]').value;
                    const { error } = await client.auth.signInWithPassword({ email, password });
                    if (error) { m.el.querySelector('.oc-err').textContent = 'ログインに失敗しました：' + error.message; return; }
                    m.close(); resolve(true);
                } },
            ]);
            m.el.querySelector('[name=pw]').addEventListener('keydown', e => {
                if (e.key === 'Enter') m.el.querySelector('.oc-btn--primary').click();
            });
            m.el.querySelector('[name=email]').focus();
        });
    }

    // ===== 社内名簿 =====
    async function loadStaff() {
        const { data, error } = await client.from('staff_directory')
            .select('id, name, company, department, tel, sort_order, active')
            .order('sort_order').order('department').order('name');
        if (error) { console.error('社内名簿の取得に失敗しました', error); staff = []; return; }
        staff = data;
    }
    function staffOrg(s) { return [s.company, s.department].filter(Boolean).join(' '); }
    function staffOptions(selectedId) {
        const groups = {};
        staff.filter(s => s.active || s.id === selectedId).forEach(s => {
            const k = s.department || '（部署未設定）';
            (groups[k] = groups[k] || []).push(s);
        });
        return `<option value="">― 社外・手入力 ―</option>` + Object.keys(groups).map(k =>
            `<optgroup label="${esc(k)}">` + groups[k].map(s =>
                `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}${s.tel ? '（' + esc(s.tel) + '）' : ''}</option>`
            ).join('') + '</optgroup>'
        ).join('');
    }

    function staffDialog() {
        let rows = staff.map(s => ({ ...s }));
        const removed = [];
        const m = openModal('社内名簿の管理', `
            <p class="oc-note">Excel の「氏名・部署・電話」の3列（見出し行なし）をコピーして下の欄に貼り付けると、まとめて追加できます。</p>
            <div class="oc-paste"><textarea rows="3" placeholder="氏名[Tab]部署[Tab]電話"></textarea><button type="button" class="oc-btn" data-s="paste">貼り付け分を追加</button></div>
            <div class="oc-staff-wrap"><table class="oc-staff">
                <thead><tr><th>氏名</th><th>会社</th><th>部署</th><th>電話</th><th>順</th><th>使用</th><th></th></tr></thead>
                <tbody></tbody></table></div>
            <button type="button" class="oc-btn" data-s="add">＋1行追加</button>
            <div class="oc-err"></div>`, [
            { label: '閉じる', ghost: true, onClick: () => m.close() },
            { label: '名簿を保存', primary: true, onClick: async () => {
                collect();
                const bad = rows.find(r => !r.name.trim());
                if (bad) { m.el.querySelector('.oc-err').textContent = '氏名が空欄の行があります。'; return; }
                try {
                    for (const r of rows) {
                        const rec = { name: r.name.trim(), company: r.company.trim() || '日下部電機㈱', department: r.department.trim() || null,
                            tel: r.tel.trim() || null, sort_order: Number(r.sort_order) || 0, active: !!r.active, updated_at: new Date().toISOString() };
                        if (r.id) {
                            const { data, error } = await client.from('staff_directory').update(rec).eq('id', r.id).select('id');
                            if (error) throw error;
                            if (!data.length) throw new Error('更新できませんでした（権限がないか、ログインが切れています）');
                        } else {
                            const { data, error } = await client.from('staff_directory').insert(rec).select('id').single();
                            if (error) throw error;
                            r.id = data.id;
                        }
                    }
                    if (removed.length) {
                        const { error } = await client.from('staff_directory').delete().in('id', removed);
                        if (error) throw error;
                    }
                } catch (e) {
                    m.el.querySelector('.oc-err').textContent = '保存に失敗しました：' + (e.message || e);
                    return;
                }
                await loadStaff();
                m.close();
            } },
        ], 'oc-modal--wide');
        const tbody = m.el.querySelector('tbody');
        function draw() {
            tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}">
                <td><input data-f="name" value="${esc(r.name)}"></td>
                <td><input data-f="company" value="${esc(r.company)}"></td>
                <td><input data-f="department" value="${esc(r.department)}"></td>
                <td><input data-f="tel" value="${esc(r.tel)}"></td>
                <td><input data-f="sort_order" type="number" value="${esc(r.sort_order)}" class="oc-num"></td>
                <td><input data-f="active" type="checkbox"${r.active ? ' checked' : ''}></td>
                <td><button type="button" data-del="${i}" title="削除">✕</button></td></tr>`).join('');
        }
        function collect() {
            tbody.querySelectorAll('tr').forEach(tr => {
                const r = rows[tr.dataset.i];
                tr.querySelectorAll('[data-f]').forEach(inp => {
                    r[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
                });
            });
        }
        function blank() { return { id: null, name: '', company: '日下部電機㈱', department: '', tel: '', sort_order: 0, active: true }; }
        m.el.addEventListener('click', e => {
            const t = e.target;
            if (t.dataset.s === 'add') { collect(); rows.push(blank()); draw(); }
            if (t.dataset.s === 'paste') {
                collect();
                const ta = m.el.querySelector('.oc-paste textarea');
                ta.value.split(/\r?\n/).map(l => l.split('\t')).filter(c => c[0] && c[0].trim()).forEach(c => {
                    rows.push({ ...blank(), name: c[0].trim(), department: (c[1] || '').trim(), tel: (c[2] || '').trim() });
                });
                ta.value = '';
                draw();
            }
            if (t.dataset.del != null) {
                collect();
                const r = rows.splice(Number(t.dataset.del), 1)[0];
                if (r.id) removed.push(r.id);
                draw();
            }
        });
        draw();
    }

    // ===== カードの内容編集 =====
    // node の中身を書き換える（つながり＝children は変えない）。isNew のときは置き場に追加する
    function nodeDialog(node, isNew) {
        const d = { type: 'person', role: '', roleAlt: false, org: '', name: '', tel: '', subName: '', subTel: '', staffId: null, subStaffId: null, text: '', ...node };
        const m = openModal(isNew ? 'カードを作成' : 'カードを編集', `
            <div class="oc-type">
                <label><input type="radio" name="type" value="person"${d.type !== 'label' ? ' checked' : ''}> 人</label>
                <label><input type="radio" name="type" value="label"${d.type === 'label' ? ' checked' : ''}> 分岐ラベル（例：○○氏 不在時）</label>
            </div>
            <div class="oc-for-label">
                <label class="oc-field"><span>ラベル文字</span><input name="text" value="${esc(d.text)}"></label>
            </div>
            <div class="oc-for-person">
                <label class="oc-field"><span>担当者（社内名簿から選択）</span><select name="staff">${staffOptions(d.staffId)}</select></label>
                <div class="oc-grid2">
                    <label class="oc-field"><span>役割</span><input name="role" list="ocRoleList" value="${esc(d.role)}"></label>
                    <label class="oc-field"><span>役割の色</span><select name="roleAlt">
                        <option value="0"${!d.roleAlt ? ' selected' : ''}>青（責任者）</option>
                        <option value="1"${d.roleAlt ? ' selected' : ''}>灰（担当・助勢）</option></select></label>
                </div>
                <datalist id="ocRoleList">${ROLE_SUGGEST.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
                <label class="oc-field"><span>所属</span><input name="org" value="${esc(d.org)}"></label>
                <div class="oc-grid2">
                    <label class="oc-field"><span>氏名</span><input name="name" value="${esc(d.name)}"></label>
                    <label class="oc-field"><span>電話</span><input name="tel" value="${esc(d.tel)}"></label>
                </div>
                <fieldset class="oc-fs"><legend>代理（任意・（ ）書きで表示）</legend>
                    <label class="oc-field"><span>社内名簿から選択</span><select name="subStaff">${staffOptions(d.subStaffId)}</select></label>
                    <div class="oc-grid2">
                        <label class="oc-field"><span>氏名</span><input name="subName" value="${esc(d.subName)}"></label>
                        <label class="oc-field"><span>電話</span><input name="subTel" value="${esc(d.subTel)}"></label>
                    </div>
                </fieldset>
                ${staff.length ? '' : '<p class="oc-note">社内名簿が未登録です。「社内名簿の管理」から登録するとプルダウンで選べます。</p>'}
            </div>`, [
            { label: 'キャンセル', ghost: true, onClick: () => m.close() },
            { label: isNew ? '作成' : '反映', primary: true, onClick: () => {
                const f = n => m.el.querySelector(`[name=${n}]`);
                const type = m.el.querySelector('[name=type]:checked').value;
                let out;
                if (type === 'label') {
                    out = { type: 'label', text: f('text').value.trim() };
                } else {
                    out = {
                        type: 'person', role: f('role').value.trim(), roleAlt: f('roleAlt').value === '1',
                        org: f('org').value.trim(), name: f('name').value.trim(), tel: f('tel').value.trim(),
                        staffId: f('staff').value ? Number(f('staff').value) : null,
                    };
                    if (f('subName').value.trim() || f('subTel').value.trim()) {
                        out.subName = f('subName').value.trim();
                        out.subTel = f('subTel').value.trim();
                        out.subStaffId = f('subStaff').value ? Number(f('subStaff').value) : null;
                    }
                }
                pushUndo();
                // 同じオブジェクトを書き換えて、つながり（children）と選択状態を保つ
                const children = node.children || [];
                Object.keys(node).forEach(k => { if (k !== '_uid') delete node[k]; });
                Object.assign(node, out, { children });
                if (isNew) tray.push(node);
                m.close();
                render();
            } },
        ]);
        const syncType = () => {
            const isLabel = m.el.querySelector('[name=type]:checked').value === 'label';
            m.el.querySelector('.oc-for-label').style.display = isLabel ? '' : 'none';
            m.el.querySelector('.oc-for-person').style.display = isLabel ? 'none' : '';
        };
        m.el.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', syncType));
        syncType();
        // 名簿から選ぶと所属・氏名・電話を自動入力（入力後の手直しも可）
        m.el.querySelector('[name=staff]').addEventListener('change', e => {
            const s = staff.find(x => x.id === Number(e.target.value));
            if (!s) return;
            m.el.querySelector('[name=org]').value = staffOrg(s);
            m.el.querySelector('[name=name]').value = s.name;
            m.el.querySelector('[name=tel]').value = s.tel || '';
        });
        m.el.querySelector('[name=subStaff]').addEventListener('change', e => {
            const s = staff.find(x => x.id === Number(e.target.value));
            if (!s) return;
            m.el.querySelector('[name=subName]').value = s.name;
            m.el.querySelector('[name=subTel]').value = s.tel || '';
        });
        (isNew && d.type === 'label' ? f0('text') : f0('staff')).focus();
        function f0(n) { return m.el.querySelector(`[name=${n}]`); }
    }

    // ===== クリック・ドラッグ =====
    row.addEventListener('click', e => {
        if (!editing) return;
        const btn = e.target.closest('button');
        if (btn && btn.dataset.ca) {
            const ci = Number(btn.dataset.ci);
            pushUndo();
            if (btn.dataset.ca === 'del') {
                if (!confirm(`「${charts[ci].title}」の系統を削除しますか？`)) { undoStack.pop(); return; }
                const [c] = charts.splice(ci, 1);
                if (c.id) deletedIds.push(c.id);
            }
            const to = btn.dataset.ca === 'left' ? ci - 1 : btn.dataset.ca === 'right' ? ci + 1 : -1;
            if (to >= 0 && to < charts.length) [charts[ci], charts[to]] = [charts[to], charts[ci]];
            render();
            return;
        }
        if (btn && btn.dataset.t) { onTool(btn.dataset.t); return; }

        const zone = e.target.closest('.oc-rootzone');
        if (zone) {
            if (selected) { moveTo(selected, charts[Number(zone.dataset.root)].tree); selected = null; render(); }
            return;
        }
        const node = nodeFromEl(e.target);
        if (node) {
            if (!selected) selected = node;
            else if (selected === node) selected = null;
            else { connect(selected, node); selected = null; }
            render();
            return;
        }
        if (selected && !e.target.closest('input')) { selected = null; render(); }
    });
    row.addEventListener('dblclick', e => {
        if (!editing) return;
        const node = nodeFromEl(e.target);
        if (!node) return;
        selected = node;
        render();
        nodeDialog(node, false);
    });
    row.addEventListener('input', e => {
        if (e.target.classList.contains('oc-title-input')) charts[Number(e.target.dataset.ci)].title = e.target.value;
    });

    row.addEventListener('dragstart', e => {
        const node = editing && nodeFromEl(e.target);
        if (!node) return;
        dragNode = node;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(node._uid));
    });
    function dropTarget(el) {
        return el.closest('.org-box[data-uid]') || el.closest('.oc-rootzone') || el.closest('.oc-tray');
    }
    row.addEventListener('dragover', e => {
        if (!dragNode) return;
        const t = dropTarget(e.target);
        if (!t) return;
        e.preventDefault();
        row.querySelectorAll('.oc-drop').forEach(x => x !== t && x.classList.remove('oc-drop'));
        t.classList.add('oc-drop');
    });
    row.addEventListener('dragleave', e => {
        const t = dropTarget(e.target);
        if (t && !t.contains(e.relatedTarget)) t.classList.remove('oc-drop');
    });
    row.addEventListener('drop', e => {
        if (!dragNode) return;
        e.preventDefault();
        const t = dropTarget(e.target);
        const node = dragNode;
        dragNode = null;
        if (!t) return;
        if (t.matches('.org-box')) connect(nodeFromEl(t), node);
        else if (t.matches('.oc-rootzone')) moveTo(node, charts[Number(t.dataset.root)].tree);
        else if (!tray.includes(node)) moveTo(node, tray);
        selected = null;
        render();
    });
    row.addEventListener('dragend', () => {
        dragNode = null;
        row.querySelectorAll('.oc-drop').forEach(x => x.classList.remove('oc-drop'));
    });

    // ===== ツールバー =====
    tools.addEventListener('click', e => {
        const t = e.target.closest('button');
        if (t && t.dataset.t) onTool(t.dataset.t);
    });
    async function onTool(t) {
        switch (t) {
            case 'start': await startEdit(); return;
            case 'save': await save(); return;
            case 'staff': staffDialog(); return;
            case 'newperson': nodeDialog({ type: 'person' }, true); return;
            case 'newlabel': nodeDialog({ type: 'label' }, true); return;
            case 'edit': if (selected) nodeDialog(selected, false); return;
            case 'undo': undo(); return;
            case 'deselect': selected = null; break;
            case 'addchart': pushUndo(); charts.push({ id: null, title: '新しい系統', tree: [] }); break;
            case 'left': case 'right': {
                if (!selected) return;
                const { siblings } = nodeIndex.get(selected._uid);
                const i = siblings.indexOf(selected), j = t === 'left' ? i - 1 : i + 1;
                if (j < 0 || j >= siblings.length) return;
                pushUndo();
                [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
                break;
            }
            case 'detach':
                if (!selected || tray.includes(selected)) return;
                moveTo(selected, tray);
                selected = null;
                break;
            case 'del':
                if (!selected) return;
                if ((selected.children || []).length && !confirm('このカードの下につながっているカードもすべて削除されます。よろしいですか？')) return;
                pushUndo();
                detach(selected);
                selected = null;
                break;
            case 'cancel':
                if (!confirm('編集内容を破棄して元に戻しますか？')) return;
                charts = snapshot ? JSON.parse(snapshot) : [];
                endEdit();
                if (charts.length) break;
                location.reload();
                return;
        }
        render();
    }

    document.addEventListener('keydown', e => {
        if (!editing || document.querySelector('.oc-modal-bg')) return;
        if (e.target.matches('input, textarea, select')) return;
        if (e.key === 'Escape' && selected) { selected = null; render(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'Delete' && selected) onTool('del');
    });

    // ===== モーダル =====
    function openModal(title, bodyHtml, buttons, extraClass) {
        const wrap = document.createElement('div');
        wrap.className = 'oc-modal-bg';
        wrap.innerHTML = `<div class="oc-modal ${extraClass || ''}">
            <div class="oc-modal-head">${esc(title)}</div>
            <div class="oc-modal-body">${bodyHtml}</div>
            <div class="oc-modal-foot"></div></div>`;
        const foot = wrap.querySelector('.oc-modal-foot');
        buttons.forEach(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'oc-btn' + (b.primary ? ' oc-btn--primary' : '') + (b.ghost ? ' oc-btn--ghost' : '');
            el.textContent = b.label;
            el.addEventListener('click', b.onClick);
            foot.appendChild(el);
        });
        document.body.appendChild(wrap);
        return { el: wrap, close: () => wrap.remove() };
    }

    // 工程表など別タブでログイン／ログアウトしたときも、ボタンの表示を追従させる
    client.auth.onAuthStateChange(async (event) => {
        if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
        canEdit = event === 'SIGNED_IN' && await checkAdmin();
        if (!editing) renderTools();
    });

    checkAdmin().then(ok => { canEdit = ok; }).finally(load);
})();

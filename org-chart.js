// 体制表（指揮系統）の表示・編集
// Supabase の org_charts（工番ごとの系統ツリー）と staff_directory（社内名簿）を使う。
// 読み込み前に PROJECT_NUMBER / S_URL / S_KEY を定義し、#orgChartRow と #orgChartTools を置いておくこと。
// 編集できるのは org_chart_admins に登録された管理者のみ（ログインは工程表と共通のアカウント）。
//
// 編集操作：各カードの上下左右に出る「＋」から、社内名簿のプルダウン選択か自由入力でカードを追加する。
// カードをクリックすると内容の修正・削除・左右の入れ替え。保存すると通常表示（自動整列）に戻る。
(function () {
    const row = document.getElementById('orgChartRow');
    const tools = document.getElementById('orgChartTools');
    if (!row || !tools) return;

    const client = supabase.createClient(S_URL, S_KEY);
    const ROLE_SUGGEST = ['試運転責任者', '全般', '組立業者 責任者', '組立業者 助勢', '電気業者', '組立発注担当者', '機械', '電気'];
    const DIR_LABEL = { up: '上', down: '下', left: '左', right: '右' };

    let charts = [];        // [{ id, title, tree: [node] }]
    let snapshot = '';      // キャンセル時に戻すための保存時点の状態
    let deletedIds = [];
    let undoStack = [];
    let staff = [];
    let editing = false;
    let canEdit = false;    // 管理者としてログイン中か（編集ボタンの表示判定）
    let loadFailed = false; // 体制表の取得失敗時は HTML 記載の表を出すだけで編集させない
    let nodeIndex = new Map();   // uid -> { node, siblings, depth }
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
    function nodeLabel(n) {
        return n.type === 'label' ? `「${n.text || 'ラベル'}」` : `「${n.name || n.role || '未設定'}」`;
    }

    // ===== 描画 =====
    function nodeBoxHtml(n) {
        const attrs = editing ? ` data-uid="${n._uid}" title="クリックで修正・削除"` : '';
        if (n.type === 'label') {
            return `<div class="org-box org-box--label"${attrs}>${esc(n.text) || '（ラベル）'}</div>`;
        }
        const name = esc(n.name) + (n.subName ? `<br><small>（${esc(n.subName)}）</small>` : '');
        const tel = esc(n.tel) + (n.subTel ? `<br><small>（${esc(n.subTel)}）</small>` : '');
        return `<div class="org-box"${attrs}>
            ${n.role ? `<span class="org-role${n.roleAlt ? ' alt' : ''}">${esc(n.role)}</span>` : ''}
            ${n.org ? `<div class="org-org">${esc(n.org)}</div>` : ''}
            <div class="org-name">${name || '（未設定）'}</div>
            ${tel ? `<div class="org-tel">${tel}</div>` : ''}
        </div>`;
    }
    function cellHtml(n) {
        const box = nodeBoxHtml(n);
        if (!editing) return box;
        const plus = d => `<button type="button" class="oc-plus oc-plus--${d}" data-p="${d}" data-uid="${n._uid}" title="${DIR_LABEL[d]}にカードを追加">＋</button>`;
        return `<div class="oc-cell">${plus('up')}${plus('left')}${box}${plus('right')}${plus('down')}</div>`;
    }
    function treeHtml(nodes, depth) {
        if (!nodes.length) return '';
        return `<ul${depth === 0 ? ' class="tree"' : ''}>` + nodes.map(n => {
            n._uid = ++uidSeq;
            nodeIndex.set(n._uid, { node: n, siblings: nodes, depth });
            return `<li>${cellHtml(n)}${treeHtml(n.children || [], depth + 1)}</li>`;
        }).join('') + '</ul>';
    }
    function render() {
        nodeIndex = new Map();
        row.classList.toggle('oc-editing', editing);
        // 編集中は右パネルを全画面に広げる（終了すると元の幅に戻る）
        const panel = row.closest('.fullscreen-overlay');
        if (panel) panel.classList.toggle('oc-full', editing);
        row.innerHTML = charts.map((c, i) => {
            const title = editing
                ? `<div class="oc-chart-head">
                    <input class="oc-title-input" data-ci="${i}" value="${esc(c.title)}" placeholder="系統名">
                    <button type="button" data-ca="left" data-ci="${i}" title="系統を左へ">◀</button>
                    <button type="button" data-ca="right" data-ci="${i}" title="系統を右へ">▶</button>
                    <button type="button" data-ca="del" data-ci="${i}" title="系統を削除">✕</button>
                  </div>`
                : `<div class="org-section-title">${esc(c.title)}</div>`;
            const body = c.tree.length ? treeHtml(c.tree, 0)
                : (editing ? `<button type="button" class="oc-first" data-first="${i}">＋ カードを追加</button>` : '');
            return `<div class="org-chart-col">${title}${body}</div>`;
        }).join('');
        renderTools();
        fitCharts();
    }
    // 通常表示（右パネル）では系統を縦に並べ、パネル幅に収まらないときは縮小して横スクロールをなくす。
    // カード・文字の大きさを系統間でそろえるため、最も横に広い系統に合わせた同じ縮小率を全系統にかける
    function fitCharts() {
        const trees = [...row.querySelectorAll('.org-chart-col > .tree')];
        trees.forEach(t => { t.style.zoom = ''; });
        if (editing || !trees.length) return;
        let scale = 1;
        trees.forEach(t => {
            t.style.width = 'max-content';
            const need = t.offsetWidth;
            t.style.width = '';
            const avail = t.parentElement.clientWidth;
            if (avail > 0 && need > avail) scale = Math.min(scale, avail / need);
        });
        if (scale < 1) trees.forEach(t => { t.style.zoom = scale.toFixed(3); });
    }
    window.addEventListener('resize', fitCharts);
    window.addEventListener('beforeprint', fitCharts);
    window.addEventListener('afterprint', fitCharts);
    function renderTools() {
        if (!editing) {
            // 編集ボタンは管理者としてログイン中のときだけ表示（外注先には見せない）
            tools.innerHTML = canEdit && !loadFailed ? `<button type="button" class="oc-btn oc-btn--ghost" data-t="start">体制表を編集</button>` : '';
            return;
        }
        tools.innerHTML = `
            <div class="oc-toolrow">
                <button type="button" class="oc-btn" data-t="undo"${undoStack.length ? '' : ' disabled'}>↶ 元に戻す</button>
                <button type="button" class="oc-btn" data-t="addchart">＋系統を追加</button>
                <button type="button" class="oc-btn" data-t="staff">社内名簿の管理</button>
                <button type="button" class="oc-btn oc-btn--ghost" data-t="help">💡 ヒント表示</button>
                <span class="oc-spacer"></span>
                <button type="button" class="oc-btn oc-btn--ghost" data-t="cancel">キャンセル</button>
                <button type="button" class="oc-btn oc-btn--primary" data-t="save">保存</button>
            </div>
            <div class="oc-selbar oc-selbar--idle">カードにマウスを乗せると、そのカードの上下左右に「＋」が出ます。押すとその位置にカードを追加できます。カードをクリックすると修正・削除。できあがったら「保存」を押してください。</div>`;
    }

    // ===== 操作（すべて undo 可能） =====
    function pushUndo() {
        undoStack.push(JSON.stringify(charts));
        if (undoStack.length > 50) undoStack.shift();
    }
    function undo() {
        if (!undoStack.length) return;
        charts = JSON.parse(undoStack.pop());
        render();
    }
    // dir の方向に新しいカードを置く
    function insertAt(uid, dir, newNode) {
        const { node, siblings } = nodeIndex.get(uid);
        const i = siblings.indexOf(node);
        if (dir === 'down') { node.children = node.children || []; node.children.push(newNode); }
        else if (dir === 'up') { newNode.children = [node]; siblings[i] = newNode; }   // 間に差し込む
        else siblings.splice(dir === 'left' ? i : i + 1, 0, newNode);
    }
    // カードを消す。下につながっていたカードはその位置に繰り上げる
    function removeNode(uid) {
        const { node, siblings } = nodeIndex.get(uid);
        siblings.splice(siblings.indexOf(node), 1, ...(node.children || []));
    }
    function swapSibling(uid, delta) {
        const { node, siblings } = nodeIndex.get(uid);
        const i = siblings.indexOf(node), j = i + delta;
        if (j < 0 || j >= siblings.length) return false;
        [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
        return true;
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
            fitCharts();
            return;
        }
        if (!data.length) { renderTools(); fitCharts(); return; }   // 未登録の工番は HTML の記載を表示
        charts = data.map(r => ({ id: r.id, title: r.title, tree: Array.isArray(r.tree) ? r.tree : [] }));
        snapshot = JSON.stringify(charts);
        render();
    }
    async function save() {
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
        closeHelp();
        editing = false;
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
        return `<option value="">― 自由入力（社外の人など）―</option>` + Object.keys(groups).map(k =>
            `<optgroup label="${esc(k)}">` + groups[k].map(s =>
                `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}${s.tel ? '（' + esc(s.tel) + '）' : ''}</option>`
            ).join('') + '</optgroup>'
        ).join('');
    }

    // 名簿は社内の人だけなので会社は画面に出さない（DB の company は既定値「日下部電機㈱」のまま、カードの所属表示に使う）。
    // 部署は DB では「組立部 電装課」のように部と課を1つにまとめて持ち、画面では部と課に分けて編集する
    function splitDept(dept) {
        const [bu, ...ka] = String(dept || '').trim().split(/\s+/);
        return { bu: bu || '', ka: ka.join(' ') };
    }
    function staffDialog() {
        const toRow = s => ({ id: s.id, name: s.name || '', ...splitDept(s.department), tel: s.tel || '', sort_order: s.sort_order ?? 0, active: s.active !== false });
        let rows = staff.map(toRow);
        const original = new Map(rows.map(r => [r.id, JSON.stringify(r)]));
        const removed = [];
        const buList = [...new Set(rows.map(r => r.bu).filter(Boolean))];
        const kaList = [...new Set(rows.map(r => r.ka).filter(Boolean))];
        const m = openModal('社内名簿の管理', `
            <div class="oc-howto-box">
                <b>追加</b>：一覧のいちばん下の「＋1行追加」を押して入力 ／ <b>変更</b>：一覧の欄を直接書き換え ／ <b>削除</b>：行の ✕<br>
                最後に <b>「名簿を保存」</b> を押すと反映されます（「使用」のチェックを外すと、プルダウンに出なくなります）。
            </div>
            <datalist id="ocBuList">${buList.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
            <datalist id="ocKaList">${kaList.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
            <div class="oc-staff-wrap"><table class="oc-staff">
                <thead><tr><th>氏名</th><th>部</th><th>課</th><th>電話</th><th title="プルダウンでの並び順（小さい順）">順</th><th title="外すとプルダウンに出なくなります">使用</th><th></th></tr></thead>
                <tbody></tbody></table></div>
            <button type="button" class="oc-btn" data-s="add">＋1行追加</button>
            <div class="oc-err"></div>`, [
            { label: '閉じる', ghost: true, onClick: () => {
                collect();
                if (isDirty() && !confirm('保存していない変更があります。破棄して閉じますか？')) return;
                m.close();
            } },
            { label: '名簿を保存', primary: true, onClick: async () => {
                collect();
                const bad = rows.find(r => !r.name.trim());
                if (bad) { m.el.querySelector('.oc-err').textContent = '氏名が空欄の行があります。'; return; }
                try {
                    // 変更のあった行・新しい行だけを書き込む
                    for (const r of rows.filter(r => !r.id || original.get(r.id) !== JSON.stringify(r))) {
                        const rec = { name: r.name.trim(), department: [r.bu, r.ka].map(s => s.trim()).filter(Boolean).join(' ') || null,
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
        const wrap = m.el.querySelector('.oc-staff-wrap');
        function draw() {
            tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}"${r.id ? '' : ' class="oc-new"'}>
                <td><input data-f="name" value="${esc(r.name)}"></td>
                <td><input data-f="bu" list="ocBuList" value="${esc(r.bu)}"></td>
                <td><input data-f="ka" list="ocKaList" value="${esc(r.ka)}"></td>
                <td><input data-f="tel" value="${esc(r.tel)}" placeholder="090-1234-5678"></td>
                <td><input data-f="sort_order" type="number" value="${esc(r.sort_order)}" class="oc-num"></td>
                <td><input data-f="active" type="checkbox"${r.active ? ' checked' : ''}></td>
                <td><button type="button" data-del="${i}" title="削除">✕</button></td></tr>`).join('');
        }
        function collect() {
            tbody.querySelectorAll('tr').forEach(tr => {
                const r = rows[tr.dataset.i];
                tr.querySelectorAll('[data-f]').forEach(inp => {
                    const f = inp.dataset.f;
                    r[f] = inp.type === 'checkbox' ? inp.checked : f === 'sort_order' ? (Number(inp.value) || 0) : inp.value;
                });
            });
        }
        function isDirty() {
            return removed.length > 0 || rows.some(r => !r.id || original.get(r.id) !== JSON.stringify(r));
        }
        // 新しい行は一覧の最後に並ぶよう、今の最大の並び順より後ろの値にする
        function nextOrder() { return rows.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 10; }
        function blank() { return { id: null, name: '', bu: '', ka: '', tel: '', sort_order: nextOrder(), active: true }; }
        function scrollToEnd() { wrap.scrollTop = wrap.scrollHeight; }
        m.el.addEventListener('click', e => {
            const t = e.target;
            if (t.dataset.s === 'add') {
                collect(); rows.push(blank()); draw(); scrollToEnd();
                tbody.lastElementChild.querySelector('[data-f="name"]').focus();
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

    // ===== カードの入力画面（追加・修正共通） =====
    // opts: { title, node(初期値), isNew, onApply(out), onDelete?, onMove?(delta) }
    function cardDialog(opts) {
        const d = { type: 'person', role: '', roleAlt: false, org: '', name: '', tel: '', subName: '', subTel: '', staffId: null, subStaffId: null, text: '', ...opts.node };
        const hasSub = !!(d.subName || d.subTel);
        const buttons = [];
        if (opts.onDelete) buttons.push({ label: '削除', danger: true, side: true, onClick: () => { m.close(); opts.onDelete(); } });
        if (opts.onMove) {
            buttons.push({ label: '◀ 左へ', side: true, onClick: () => { m.close(); opts.onMove(-1); } });
            buttons.push({ label: '右へ ▶', side: true, onClick: () => { m.close(); opts.onMove(1); } });
        }
        buttons.push({ label: 'キャンセル', ghost: true, onClick: () => m.close() });
        buttons.push({ label: opts.isNew ? '追加' : '反映', primary: true, onClick: () => {
            const type = f('type:checked').value;
            let out;
            if (type === 'label') {
                out = { type: 'label', text: f('text').value.trim() };
                if (!out.text) { m.el.querySelector('.oc-err').textContent = 'ラベルの文字を入力してください。'; return; }
            } else {
                out = {
                    type: 'person', role: f('role').value.trim(), roleAlt: !f('roleBlue').checked,
                    org: f('org').value.trim(), name: f('name').value.trim(), tel: f('tel').value.trim(),
                    staffId: f('staff').value ? Number(f('staff').value) : null,
                };
                if (!out.name && !out.role) { m.el.querySelector('.oc-err').textContent = '担当者を選ぶか、氏名を入力してください。'; return; }
                if (f('subName').value.trim() || f('subTel').value.trim()) {
                    out.subName = f('subName').value.trim();
                    out.subTel = f('subTel').value.trim();
                    out.subStaffId = f('subStaff').value ? Number(f('subStaff').value) : null;
                }
            }
            m.close();
            opts.onApply(out);
        } });

        const m = openModal(opts.title, `
            <div class="oc-type">
                <label><input type="radio" name="type" value="person"${d.type !== 'label' ? ' checked' : ''}> 人</label>
                <label><input type="radio" name="type" value="label"${d.type === 'label' ? ' checked' : ''}> 分岐ラベル（例：○○氏 不在時）</label>
            </div>
            <div class="oc-for-label">
                <label class="oc-field"><span>ラベルの文字</span><input name="text" value="${esc(d.text)}" placeholder="例：○○氏 不在時"></label>
            </div>
            <div class="oc-for-person">
                <label class="oc-field"><span>担当者</span><select name="staff">${staffOptions(d.staffId)}</select></label>
                ${staff.length ? '' : '<p class="oc-note">社内名簿が未登録です。「社内名簿の管理」から登録すると、ここで選べるようになります。</p>'}
                <div class="oc-grid2">
                    <label class="oc-field"><span>役割</span><input name="role" list="ocRoleList" value="${esc(d.role)}" placeholder="例：試運転責任者"></label>
                    <label class="oc-check"><input type="checkbox" name="roleBlue"${!d.roleAlt ? ' checked' : ''}> 責任者として青で表示</label>
                </div>
                <datalist id="ocRoleList">${ROLE_SUGGEST.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
                <div class="oc-free">
                    <label class="oc-field"><span>所属</span><input name="org" value="${esc(d.org)}" placeholder="例：シマブンエンジニアリング株式会社"></label>
                    <div class="oc-grid2">
                        <label class="oc-field"><span>氏名</span><input name="name" value="${esc(d.name)}"></label>
                        <label class="oc-field"><span>電話</span><input name="tel" value="${esc(d.tel)}"></label>
                    </div>
                </div>
                <details class="oc-sub"${hasSub ? ' open' : ''}><summary>代理の人を追加（任意・（ ）書きで表示）</summary>
                    <label class="oc-field"><span>代理</span><select name="subStaff">${staffOptions(d.subStaffId)}</select></label>
                    <div class="oc-grid2">
                        <label class="oc-field"><span>氏名</span><input name="subName" value="${esc(d.subName)}"></label>
                        <label class="oc-field"><span>電話</span><input name="subTel" value="${esc(d.subTel)}"></label>
                    </div>
                </details>
            </div>
            <div class="oc-err"></div>`, buttons);

        function f(n) { return m.el.querySelector(`[name=${n.replace(':checked', '')}]${n.endsWith(':checked') ? ':checked' : ''}`); }
        const syncType = () => {
            const isLabel = f('type:checked').value === 'label';
            m.el.querySelector('.oc-for-label').style.display = isLabel ? '' : 'none';
            m.el.querySelector('.oc-for-person').style.display = isLabel ? 'none' : '';
        };
        m.el.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', syncType));
        syncType();
        // 名簿から選ぶと所属・氏名・電話を自動入力（入力後の手直しも可）
        f('staff').addEventListener('change', e => {
            const s = staff.find(x => x.id === Number(e.target.value));
            if (!s) return;
            f('org').value = staffOrg(s);
            f('name').value = s.name;
            f('tel').value = s.tel || '';
        });
        f('subStaff').addEventListener('change', e => {
            const s = staff.find(x => x.id === Number(e.target.value));
            if (!s) return;
            f('subName').value = s.name;
            f('subTel').value = s.tel || '';
        });
        (d.type === 'label' ? f('text') : f('staff')).focus();
    }

    function addCard(uid, dir) {
        const { node, depth } = nodeIndex.get(uid);
        const newDepth = dir === 'down' ? depth + 1 : depth;
        cardDialog({
            title: `${nodeLabel(node)}の${DIR_LABEL[dir]}にカードを追加`,
            node: { roleAlt: newDepth > 0 }, isNew: true,
            onApply: out => { pushUndo(); insertAt(uid, dir, { ...out, children: [] }); render(); },
        });
    }
    function editCard(uid) {
        const { node } = nodeIndex.get(uid);
        cardDialog({
            title: `${nodeLabel(node)}を修正`, node, isNew: false,
            onApply: out => {
                pushUndo();
                // 同じオブジェクトを書き換えて、下につながるカード（children）を保つ
                const children = node.children || [];
                Object.keys(node).forEach(k => { if (k !== '_uid') delete node[k]; });
                Object.assign(node, out, { children });
                render();
            },
            onDelete: () => {
                const hasKids = (node.children || []).length;
                if (!confirm(hasKids ? `${nodeLabel(node)}を削除します。\n下につながっているカードは、このカードの位置に繰り上がります。` : `${nodeLabel(node)}を削除しますか？`)) return;
                pushUndo(); removeNode(uid); render();
            },
            onMove: delta => {
                pushUndo();
                if (swapSibling(uid, delta)) render(); else undoStack.pop();
            },
        });
    }

    // ===== クリック =====
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
        if (btn && btn.dataset.first != null) {
            const ci = Number(btn.dataset.first);
            cardDialog({
                title: `「${charts[ci].title || '無題'}」にカードを追加`, node: { roleAlt: false }, isNew: true,
                onApply: out => { pushUndo(); charts[ci].tree.push({ ...out, children: [] }); render(); },
            });
            return;
        }
        if (btn && btn.dataset.p) { addCard(Number(btn.dataset.uid), btn.dataset.p); return; }
        const box = e.target.closest('.org-box[data-uid]');
        if (box) editCard(Number(box.dataset.uid));
    });
    row.addEventListener('input', e => {
        if (e.target.classList.contains('oc-title-input')) charts[Number(e.target.dataset.ci)].title = e.target.value;
    });

    // ===== ツールバー =====
    tools.addEventListener('click', async e => {
        const t = e.target.closest('button');
        if (!t || !t.dataset.t) return;
        switch (t.dataset.t) {
            case 'start': await startEdit(); return;
            case 'save': await save(); return;
            case 'staff': staffDialog(); return;
            case 'undo': undo(); return;
            case 'help': openHelp(); return;
            case 'addchart': pushUndo(); charts.push({ id: null, title: '新しい系統', tree: [] }); break;
            case 'cancel':
                if (!confirm('編集内容を破棄して元に戻しますか？')) return;
                charts = snapshot ? JSON.parse(snapshot) : [];
                endEdit();
                if (charts.length) break;
                location.reload();
                return;
        }
        render();
    });

    document.addEventListener('keydown', e => {
        if (!editing || document.querySelector('.oc-modal-bg')) return;
        if (e.target.matches('input, textarea, select')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });

    // ===== ヒント表示（工程表のヒント表示と同じ方式：対象を枠でハイライトし、ホバーで吹き出し） =====
    // sel は編集ツールバー → 体制表の順に最初に見つかった要素を対象にする。pad は枠を外側に広げる量（＋ボタンを含めるため）
    const HELP_TIPS = [
        { sel: '[data-t="help"]', title: 'ヒント表示', text: '各所の説明吹き出しを表示します\n暗い部分をクリック（または Esc）で閉じます', noBullets: true, closeOnClick: true },
        { sel: '[data-t="undo"]', title: '元に戻す', text: '直前の操作を取り消します（Ctrl+Z でも可）\n50回前までさかのぼれます', noBullets: true },
        { sel: '[data-t="addchart"]', title: '系統を追加', text: '空の系統（表）を右端に追加します\n「＋ カードを追加」から作り始めます', noBullets: true },
        { sel: '[data-t="staff"]', title: '社内名簿の管理', text: 'カードのプルダウンに出る社内の人の\n追加・変更・削除を行います', noBullets: true },
        { sel: '[data-t="cancel"]', title: 'キャンセル', text: '保存せずに編集を終え、編集前の状態に戻します', noBullets: true },
        { sel: '[data-t="save"]', title: '保存', text: '変更を保存して編集を終えます\n整った体制表の表示に戻り、外注先の画面にも反映されます', noBullets: true },
        { sel: '.oc-chart-head', title: '系統名', text: '欄に直接入力して名前を変更\n◀ ▶ で系統の並び順を入れ替え\n✕ で系統ごと削除' },
        { sel: '.oc-cell', pad: 28, wide: true, title: 'カード（＋で追加）', text: 'マウスを乗せると上下左右に「＋」が出ます\n下の＋ → 下につながるカードを追加\n左右の＋ → 同じ段の隣に追加（一番上の段はカード同士が横線で結ばれます）\n上の＋ → そのカードの上に差し込み\nカードをクリック → 内容の修正・削除・左右の入れ替え\n社内の人はプルダウンで選択、社外の人は自由入力' },
        { sel: '.oc-first', title: 'カードを追加', text: '空の系統に最初のカードを追加します', noBullets: true },
    ];

    function openHelp() {
        if (document.getElementById('ocHelp')) return;
        const box = document.createElement('div');
        box.id = 'ocHelp';
        box.innerHTML = '<div class="oc-help-bg"></div><button type="button" class="oc-help-guide" title="操作マニュアルを開く">📖 操作マニュアルを開く</button>';
        document.body.appendChild(box);
        box.querySelector('.oc-help-bg').addEventListener('click', closeHelp);
        box.querySelector('.oc-help-guide').addEventListener('click', () => window.open('体制表_編集ガイド.html', '_blank'));
        const helpBtn = tools.querySelector('[data-t="help"]');
        if (helpBtn) helpBtn.classList.add('oc-help-active');
        HELP_TIPS.forEach(t => {
            const el = tools.querySelector(t.sel) || row.querySelector(t.sel);
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const p = t.pad || 0;
            addHelpItem(box, t, { top: r.top - p, left: r.left - p, right: r.right + p, bottom: r.bottom + p });
        });
    }
    // 吹き出し本文：複数行は各行先頭に「・」（noBullets のときは付けない）
    function formatHelpText(raw, noBullets) {
        const lines = String(raw).split('\n').map(l => l.trim()).filter(Boolean).map(esc);
        return noBullets || lines.length <= 1 ? lines.join('<br>') : lines.map(l => '・' + l).join('<br>');
    }
    function addHelpItem(box, tip, rect) {
        const hl = document.createElement('div');
        hl.className = 'oc-help-hl';
        Object.assign(hl.style, { top: rect.top + 'px', left: rect.left + 'px', width: (rect.right - rect.left) + 'px', height: (rect.bottom - rect.top) + 'px' });
        if (tip.closeOnClick) { hl.style.cursor = 'pointer'; hl.addEventListener('click', closeHelp); }
        box.appendChild(hl);

        const tipDiv = document.createElement('div');
        tipDiv.className = 'oc-help-tip' + (tip.wide ? ' oc-help-tip--wide' : '');
        tipDiv.innerHTML = `<div class="oc-help-tip-title">${esc(tip.title)}</div>${formatHelpText(tip.text, tip.noBullets)}`;
        box.appendChild(tipDiv);
        requestAnimationFrame(() => {
            const vw = window.innerWidth, vh = window.innerHeight;
            const tw = tipDiv.offsetWidth, th = tipDiv.offsetHeight;
            let top = rect.bottom + 8, left = rect.left;
            if (left + tw > vw - 8) left = vw - tw - 8;
            if (left < 4) left = 4;
            if (top + th > vh - 8) {
                top = Math.max(4, rect.top - th - 8);
                tipDiv.classList.add('oc-help-tip--above');
            }
            tipDiv.style.top = top + 'px';
            tipDiv.style.left = left + 'px';
        });
        hl.addEventListener('mouseenter', () => tipDiv.classList.add('oc-help-tip--show'));
        hl.addEventListener('mouseleave', () => tipDiv.classList.remove('oc-help-tip--show'));
    }
    function closeHelp() {
        const box = document.getElementById('ocHelp');
        if (!box) return;
        box.remove();
        const helpBtn = tools.querySelector('[data-t="help"]');
        if (helpBtn) helpBtn.classList.remove('oc-help-active');
    }
    // 枠の位置は開いた時点の画面座標で決めているため、スクロール・サイズ変更したら閉じる
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });
    window.addEventListener('resize', closeHelp);
    const helpPanel = row.closest('.fullscreen-overlay');
    if (helpPanel) helpPanel.addEventListener('scroll', closeHelp);

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
            el.className = 'oc-btn' + (b.primary ? ' oc-btn--primary' : '') + (b.ghost ? ' oc-btn--ghost' : '')
                + (b.danger ? ' oc-btn--danger' : '') + (b.side ? ' oc-foot-side' : '');
            el.textContent = b.label;
            el.addEventListener('click', b.onClick);
            foot.appendChild(el);
        });
        document.body.appendChild(wrap);
        return { el: wrap, close: () => wrap.remove() };
    }

    // 工程表など別タブでログイン／ログアウトしたときも、ボタンの表示を追従させる。
    // このコールバックは認証処理の途中（ロック中）に呼ばれ、ログイン情報が残っていると起動時にも SIGNED_IN が来る。
    // ここで直接 getSession/rpc を await すると互いに待ち合って止まるため、setTimeout で処理を後ろにずらす
    client.auth.onAuthStateChange((event) => {
        if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
        setTimeout(async () => {
            canEdit = event === 'SIGNED_IN' && await checkAdmin();
            if (!editing) renderTools();
        }, 0);
    });

    checkAdmin().then(ok => { canEdit = ok; }).finally(load);
})();

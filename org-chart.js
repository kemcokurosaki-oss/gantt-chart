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
    // 社内名簿の管理：左に部・課ごとの一覧、右に選んだ人の編集フォーム（新規追加も同じフォーム）。
    // 変更は画面内にためておき、「名簿を保存」でまとめて DB に書き込む
    function staffDialog() {
        let seq = 0;
        const sig = r => JSON.stringify([r.name, r.bu, r.ka, r.tel, r.sort_order, r.active]);
        const gkey = r => (r.bu || '') + '\u0001' + (r.ka || '');
        const toRow = s => ({ _k: ++seq, id: s.id, name: s.name || '', ...splitDept(s.department), tel: s.tel || '', sort_order: s.sort_order ?? 0, active: s.active !== false });
        let rows, original;
        const removed = new Set();
        function reset() { rows = staff.map(toRow); original = new Map(rows.map(r => [r.id, sig(r)])); removed.clear(); }
        reset();
        let sel = null, mode = null, draft = null, tried = false, q = '', fBu = 'all', fSt = 'all';

        const m = openModal('社内名簿の管理', `
            <div class="oc-sd">
                <div class="oc-sd-list">
                    <div class="oc-sd-tools">
                        <div class="oc-sd-tools-row">
                            <input type="search" class="oc-sd-q" placeholder="氏名・電話・部署で検索">
                            <div class="oc-sd-seg"></div>
                            <button type="button" class="oc-btn oc-btn--primary oc-sd-addbtn" data-s="new">＋ 社員を追加</button>
                        </div>
                        <div class="oc-sd-chips"></div>
                    </div>
                    <div class="oc-sd-cols"><div>氏名</div><div>課</div><div>電話</div><div></div></div>
                    <div class="oc-sd-rows"></div>
                </div>
                <div class="oc-sd-side"></div>
            </div>
            <datalist id="ocBuList"></datalist>
            <datalist id="ocKaList"></datalist>`, [
            { label: '閉じる', ghost: true, onClick: () => {
                if (isDirty() && !confirm('保存していない変更があります。破棄して閉じますか？')) return;
                m.close();
            } },
            { label: '名簿を保存', primary: true, onClick: save },
        ], 'oc-modal--staff');

        const $ = s => m.el.querySelector(s);
        const head = $('.oc-modal-head');
        head.insertAdjacentHTML('beforeend', '<span class="oc-sd-count"></span>');
        const foot = $('.oc-modal-foot');
        foot.insertAdjacentHTML('afterbegin', '<div class="oc-sd-status"></div>');
        const saveBtn = foot.querySelector('.oc-btn--primary');
        const listEl = $('.oc-sd-rows'), sideEl = $('.oc-sd-side');

        const statusOf = r => removed.has(r) ? 'del' : !r.id ? 'new' : original.get(r.id) !== sig(r) ? 'chg' : '';
        const live = () => rows.filter(r => !removed.has(r));
        const sorted = () => [...rows].sort((a, b) => a.sort_order - b.sort_order || a._k - b._k);
        const norm = s => String(s || '').replace(/[-\s　]/g, '').toLowerCase();
        function isDirty() { return removed.size > 0 || rows.some(r => statusOf(r)); }
        function nextOrder() { return rows.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 10; }

        function drawDatalists() {
            const form = mode === 'new' ? draft : sel;
            const bus = [...new Set(rows.map(r => r.bu).filter(Boolean))];
            const kas = [...new Set(rows.filter(r => !form || !form.bu || r.bu === form.bu).map(r => r.ka).filter(Boolean))];
            $('#ocBuList').innerHTML = bus.map(v => `<option value="${esc(v)}">`).join('');
            $('#ocKaList').innerHTML = kas.map(v => `<option value="${esc(v)}">`).join('');
        }

        function drawList() {
            const qn = norm(q);
            const base = sorted().filter(r => (!qn || norm([r.name, r.bu, r.ka, r.tel].join('')).includes(qn))
                && (fSt === 'all' || (fSt === 'on' ? r.active : !r.active)));
            const shown = base.filter(r => fBu === 'all' || r.bu === fBu);

            const seg = [['all', 'すべて'], ['on', '表示中'], ['off', '非表示']];
            $('.oc-sd-seg').innerHTML = seg.map(([k, l]) => `<button type="button" data-st="${k}" class="${fSt === k ? 'is-on' : ''}">${l}</button>`).join('');
            const bus = [...new Set(sorted().map(r => r.bu).filter(Boolean))];
            if (fBu !== 'all' && !bus.includes(fBu)) fBu = 'all';
            const chip = (k, l, n) => `<button type="button" data-bu="${esc(k)}" class="oc-sd-chip${fBu === k ? ' is-on' : ''}">${esc(l)}<span>${n}</span></button>`;
            $('.oc-sd-chips').innerHTML = chip('all', 'すべての部署', base.length)
                + bus.map(b => chip(b, b, base.filter(r => r.bu === b).length)).join('');

            const groups = [], gm = new Map();
            shown.forEach(r => {
                const k = gkey(r);
                if (!gm.has(k)) { const g = { bu: r.bu || '（部署未設定）', ka: r.ka, items: [] }; gm.set(k, g); groups.push(g); }
                gm.get(k).items.push(r);
            });
            const badgeOf = r => ({ new: ['新規', 'new'], del: ['削除予定', 'del'], chg: ['変更', 'chg'] })[statusOf(r)] || (!r.active ? ['非表示', 'off'] : null);
            listEl.innerHTML = groups.length ? groups.map(g => `
                <div class="oc-sd-group">
                    <div class="oc-sd-ghead"><i></i>${esc(g.bu)}<span>${esc(g.ka || '')}</span><small>${g.items.length}名</small></div>
                    ${g.items.map(r => {
                        const st = statusOf(r), b = badgeOf(r);
                        return `<div class="oc-sd-row${r === sel ? ' is-sel' : ''}${st ? ' is-' + st : ''}${!r.active ? ' is-off' : ''}" data-k="${r._k}">
                            <div class="oc-sd-name">${esc(r.name || '（氏名未入力）')}</div>
                            <div class="oc-sd-dept">${esc(r.ka || '—')}</div>
                            <div class="oc-sd-tel">${esc(r.tel || '—')}</div>
                            <div class="oc-sd-badge">${b ? `<span class="oc-sd-b--${b[1]}">${b[0]}</span>` : ''}</div>
                        </div>`;
                    }).join('')}
                </div>`).join('') : '<div class="oc-sd-empty">該当する社員がいません</div>';
            drawMeta();
        }

        function drawMeta() {
            const l = live();
            head.querySelector('.oc-sd-count').textContent = `登録 ${l.length}名 ・ プルダウンに表示 ${l.filter(r => r.active).length}名`;
            const nNew = rows.filter(r => statusOf(r) === 'new').length, nChg = rows.filter(r => statusOf(r) === 'chg').length;
            const st = foot.querySelector('.oc-sd-status');
            if (isDirty()) st.innerHTML = `<i></i><b>未保存の変更</b><span>追加 ${nNew}・変更 ${nChg}・削除 ${removed.size}</span><button type="button" class="oc-sd-link" data-s="discard">変更を破棄</button>`;
            else st.innerHTML = '<span class="oc-sd-muted">変更はまとめて「名簿を保存」で反映されます</span>';
            saveBtn.disabled = !isDirty();
        }

        function drawSide() {
            drawDatalists();
            if (!mode) {
                sideEl.innerHTML = `<div class="oc-sd-idle"><div>左の一覧から社員を選ぶと<br>ここで内容を修正できます。</div>
                    <button type="button" class="oc-first" data-s="new">＋ 新しい社員を追加</button></div>`;
                return;
            }
            const f = mode === 'new' ? draft : sel;
            sideEl.innerHTML = `
                <div class="oc-sd-form">
                    <div class="oc-sd-tagrow"><span class="oc-sd-tag${mode === 'new' ? ' is-new' : ''}">${mode === 'new' ? '新しい社員を追加' : '社員情報の編集'}</span><span class="oc-sd-formst"></span></div>
                    <div class="oc-sd-delbox"></div>
                    <label class="oc-field"><span>氏名 <em>*</em></span><input data-f="name" class="oc-sd-nameinp" value="${esc(f.name)}" placeholder="例：山田 太郎"><small class="oc-sd-msg"></small></label>
                    <div class="oc-grid2">
                        <label class="oc-field"><span>部</span><input data-f="bu" list="ocBuList" value="${esc(f.bu)}" placeholder="例：組立部"></label>
                        <label class="oc-field"><span>課</span><input data-f="ka" list="ocKaList" value="${esc(f.ka)}" placeholder="例：電装課"></label>
                    </div>
                    <label class="oc-field"><span>電話</span><input data-f="tel" inputmode="tel" value="${esc(f.tel)}" placeholder="090-1234-5678"></label>
                    <div class="oc-sd-card oc-sd-toggle" data-s="active">
                        <div><b>体制表のプルダウンに表示</b><small>オフにすると選択肢に出なくなります（名簿には残ります）</small></div>
                        <span class="oc-sd-switch${f.active ? ' is-on' : ''}"></span>
                    </div>
                    ${mode === 'edit' ? `<div class="oc-sd-card">
                        <div><b>プルダウンでの並び順</b><small class="oc-sd-pos"></small></div>
                        <button type="button" class="oc-btn oc-btn--ghost" data-s="up">↑ 上へ</button>
                        <button type="button" class="oc-btn oc-btn--ghost" data-s="down">↓ 下へ</button>
                    </div>` : ''}
                </div>
                <div class="oc-sd-sidefoot">${mode === 'edit'
                    ? `<button type="button" class="oc-btn oc-btn--danger" data-s="del">この人を削除</button><span></span><button type="button" class="oc-btn oc-btn--ghost" data-s="unsel">選択を解除</button>`
                    : `<button type="button" class="oc-btn oc-btn--ghost" data-s="unsel">やめる</button><span class="oc-sd-acts"><button type="button" class="oc-btn" data-s="addnext" title="Enter でも追加できます">追加して続けて入力</button><button type="button" class="oc-btn oc-btn--primary" data-s="add">追加</button></span>`}
                </div>`;
            drawFormMeta();
        }

        function drawFormMeta() {
            if (!mode) return;
            const f = mode === 'new' ? draft : sel;
            const st = sel ? statusOf(sel) : '';
            sideEl.querySelector('.oc-sd-formst').textContent = mode === 'new' ? '部・課は前回の入力を引き継ぎます'
                : st === 'new' ? '保存前の新規登録' : st === 'chg' ? '変更あり（未保存）' : '';
            sideEl.querySelector('.oc-sd-delbox').innerHTML = st === 'del'
                ? '<div class="oc-sd-delnote"><span>この人は「名簿を保存」で削除されます。</span><button type="button" class="oc-btn oc-btn--danger" data-s="undel">削除を取り消す</button></div>' : '';
            const empty = !f.name.trim() && (mode === 'edit' || tried);
            const dup = f.name.trim() && rows.some(r => r !== f && !removed.has(r) && norm(r.name) === norm(f.name));
            const msg = sideEl.querySelector('.oc-sd-msg');
            msg.textContent = empty ? '氏名を入力してください' : dup ? '同じ氏名の人がすでに登録されています' : '';
            msg.className = 'oc-sd-msg' + (empty ? ' is-err' : dup ? ' is-warn' : '');
            sideEl.querySelector('.oc-sd-nameinp').classList.toggle('is-err', empty);
            const pos = sideEl.querySelector('.oc-sd-pos');
            if (pos) { const same = sorted().filter(r => gkey(r) === gkey(sel)); pos.textContent = `同じ課の中で ${same.indexOf(sel) + 1} / ${same.length} 番目`; }
        }

        function scrollToRow(r) {
            const el = listEl.querySelector(`[data-k="${r._k}"]`); if (!el) return;
            const lr = listEl.getBoundingClientRect(), er = el.getBoundingClientRect();
            if (er.top < lr.top + 34 || er.bottom > lr.bottom) listEl.scrollTop += er.top - lr.top - lr.height / 2;
        }
        const focusName = () => setTimeout(() => { const i = sideEl.querySelector('.oc-sd-nameinp'); if (i) i.focus(); }, 0);

        function startNew() {
            const base = mode === 'edit' && sel ? sel : null;
            draft = { name: '', bu: base ? base.bu : (fBu !== 'all' ? fBu : ''), ka: base ? base.ka : '', tel: '', active: true };
            mode = 'new'; sel = null; tried = false;
            drawList(); drawSide(); focusName();
        }
        function add(keep) {
            if (!draft.name.trim()) { tried = true; drawFormMeta(); focusName(); return; }
            const r = { _k: ++seq, id: null, name: draft.name.trim(), bu: draft.bu.trim(), ka: draft.ka.trim(), tel: draft.tel.trim(), sort_order: nextOrder(), active: draft.active };
            rows.push(r);
            q = ''; $('.oc-sd-q').value = '';
            if (fBu !== 'all' && fBu !== r.bu) fBu = 'all';
            tried = false;
            if (keep) { draft = { name: '', bu: r.bu, ka: r.ka, tel: '', active: true }; }
            else { mode = 'edit'; sel = r; draft = null; }
            drawList(); drawSide(); scrollToRow(r);
            if (keep) focusName();
        }
        function move(delta) {
            const same = sorted().filter(r => gkey(r) === gkey(sel));
            const i = same.indexOf(sel), other = same[i + delta];
            if (!other) return;
            const a = sel.sort_order, b = other.sort_order;
            if (a === b) sel.sort_order += delta; else { sel.sort_order = b; other.sort_order = a; }
            drawList(); drawFormMeta(); scrollToRow(sel);
        }
        async function save() {
            if (!isDirty()) return;
            const bad = live().find(r => !r.name.trim());
            if (bad) { alert('氏名が空欄の人がいます。'); sel = bad; mode = 'edit'; drawList(); drawSide(); scrollToRow(bad); return; }
            saveBtn.disabled = true;
            try {
                // 変更のあった行・新しい行だけを書き込む
                for (const r of live().filter(r => statusOf(r))) {
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
                const ids = [...removed].map(r => r.id).filter(Boolean);
                if (ids.length) {
                    const { error } = await client.from('staff_directory').delete().in('id', ids);
                    if (error) throw error;
                }
            } catch (e) {
                alert('保存に失敗しました：' + (e.message || e));
                drawMeta();
                return;
            }
            await loadStaff();
            const keepId = sel && !removed.has(sel) ? sel.id : null;
            reset();
            sel = keepId ? rows.find(r => r.id === keepId) || null : null;
            mode = sel ? 'edit' : null; draft = null;
            drawList(); drawSide();
            foot.querySelector('.oc-sd-status').innerHTML = '<span class="oc-sd-ok">✓ 名簿を保存しました</span>';
        }

        $('.oc-sd-q').addEventListener('input', e => { q = e.target.value; drawList(); });
        sideEl.addEventListener('input', e => {
            const f = e.target.dataset.f; if (!f) return;
            (mode === 'new' ? draft : sel)[f] = e.target.value;
            if (f === 'bu') drawDatalists();
            if (mode === 'edit') drawList();
            drawFormMeta(); drawMeta();
        });
        sideEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && mode === 'new' && e.target.dataset.f && !e.isComposing) { e.preventDefault(); add(true); }
        });
        m.el.addEventListener('click', e => {
            const row = e.target.closest('.oc-sd-row');
            if (row) { sel = rows.find(r => r._k === Number(row.dataset.k)); mode = 'edit'; draft = null; drawList(); drawSide(); return; }
            const st = e.target.closest('[data-st]');
            if (st) { fSt = st.dataset.st; drawList(); return; }
            const bu = e.target.closest('[data-bu]');
            if (bu) { fBu = bu.dataset.bu; drawList(); listEl.scrollTop = 0; return; }
            const s = e.target.closest('[data-s]'); if (!s) return;
            switch (s.dataset.s) {
                case 'new': startNew(); break;
                case 'add': add(false); break;
                case 'addnext': add(true); break;
                case 'unsel': sel = null; mode = null; draft = null; tried = false; drawList(); drawSide(); break;
                case 'active': {
                    const f = mode === 'new' ? draft : sel;
                    f.active = !f.active;
                    sideEl.querySelector('.oc-sd-switch').classList.toggle('is-on', f.active);
                    if (mode === 'edit') drawList();
                    drawFormMeta(); break;
                }
                case 'up': move(-1); break;
                case 'down': move(1); break;
                case 'del':
                    if (!sel.id) { rows = rows.filter(r => r !== sel); sel = null; mode = null; drawSide(); }
                    else { removed.add(sel); drawFormMeta(); }
                    drawList(); break;
                case 'undel': removed.delete(sel); drawList(); drawFormMeta(); break;
                case 'discard':
                    if (!confirm('保存していない変更をすべて破棄しますか？')) return;
                    reset(); sel = null; mode = null; draft = null; drawList(); drawSide(); break;
            }
        });
        drawList(); drawSide();
        $('.oc-sd-q').focus();
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
            <div class="oc-cd-typehead">カードの種類</div>
            <div class="oc-cd-seg" role="radiogroup">
                <label><input type="radio" name="type" value="person"${d.type !== 'label' ? ' checked' : ''}><span>人</span></label>
                <label><input type="radio" name="type" value="label"${d.type === 'label' ? ' checked' : ''}><span>分岐ラベル<small>（例：○○氏 不在時）</small></span></label>
            </div>
            <div class="oc-for-label">
                <div class="oc-cd-sec oc-cd-preview">
                    <div class="oc-cd-sechead"><b>ラベルの文字</b><small>ラベルの中を直接クリックして入力します</small></div>
                    <div class="oc-cd-stage">
                        <div class="org-box org-box--label oc-cd-labelbox"><input name="text" value="${esc(d.text)}" placeholder="例：○○氏 不在時" autocomplete="off"></div>
                    </div>
                </div>
            </div>
            <div class="oc-for-person">
                <div class="oc-cd-sec">
                    <div class="oc-cd-sechead"><b>担当者</b><small>名簿から選ぶと所属・氏名・電話が自動で入ります</small></div>
                    <select name="staff" class="oc-cd-staff">${staffOptions(d.staffId)}</select>
                    <p class="oc-cd-hint"></p>
                    ${staff.length ? '' : '<p class="oc-note">社内名簿が未登録です。「社内名簿の管理」から登録すると、ここで選べるようになります。</p>'}
                </div>
                <div class="oc-cd-sec oc-cd-preview oc-cd-content">
                    <div class="oc-cd-sechead"><b>カードに表示する内容</b><small>カードの文字を直接クリックして入力します</small><span class="oc-cd-freetag">ここに直接入力</span></div>
                    <div class="oc-cd-stage">
                        <div class="org-box oc-cd-box">
                            <span class="org-role oc-cd-role"><input name="role" autocomplete="off" value="${esc(d.role)}" placeholder="役割（例：試運転責任者）" aria-label="役割"></span>
                            <input name="org" class="org-org" value="${esc(d.org)}" placeholder="所属（例：シマブンエンジニアリング株式会社）" aria-label="所属">
                            <input name="name" class="org-name oc-cd-name" value="${esc(d.name)}" placeholder="氏名" aria-label="氏名">
                            <small class="oc-cd-subprev oc-cd-subprev--name"></small>
                            <input name="tel" class="org-tel" value="${esc(d.tel)}" placeholder="電話（090-1234-5678）" inputmode="tel" aria-label="電話">
                            <small class="oc-cd-subprev oc-cd-subprev--tel"></small>
                        </div>
                    </div>
                    <label class="oc-sd-card oc-sd-toggle oc-cd-toggle">
                        <div><b>責任者として青で表示</b><small>オフにすると通常の色で表示します</small></div>
                        <input type="checkbox" name="roleBlue" class="oc-cd-switch"${!d.roleAlt ? ' checked' : ''}>
                    </label>
                </div>
                <details class="oc-cd-sub"${hasSub ? ' open' : ''}>
                    <summary><b>代理の人</b><small>任意・カードに（ ）書きで表示</small></summary>
                    <div class="oc-cd-subbody">
                        <label class="oc-field"><span>代理</span><select name="subStaff">${staffOptions(d.subStaffId)}</select></label>
                        <div class="oc-grid2">
                            <label class="oc-field"><span>氏名</span><input name="subName" value="${esc(d.subName)}"></label>
                            <label class="oc-field"><span>電話</span><input name="subTel" value="${esc(d.subTel)}" inputmode="tel"></label>
                        </div>
                    </div>
                </details>
            </div>
            <div class="oc-err"></div>`, buttons, 'oc-modal--card');

        function f(n) { return m.el.querySelector(`[name=${n.replace(':checked', '')}]${n.endsWith(':checked') ? ':checked' : ''}`); }
        const syncType = () => {
            const isLabel = f('type:checked').value === 'label';
            m.el.querySelector('.oc-for-label').style.display = isLabel ? '' : 'none';
            m.el.querySelector('.oc-for-person').style.display = isLabel ? 'none' : '';
        };
        m.el.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', syncType));
        syncType();
        // 名簿から選ぶと所属・氏名・電話を自動入力（入力後の手直しも可）
        // 自由入力のときは下の所属・氏名・電話に直接入力することを案内する
        const syncFree = (picked) => {
            const free = !f('staff').value && picked;
            m.el.querySelector('.oc-cd-content').classList.toggle('is-free', free);
            const hint = m.el.querySelector('.oc-cd-hint');
            hint.className = 'oc-cd-hint' + (free ? ' is-free' : '');
            hint.textContent = free ? '名簿にいない人は、下の「所属・氏名・電話」に直接入力してください。'
                : f('staff').value && picked ? '名簿の内容を下に入れました。必要なら直接修正できます。' : '';
        };
        syncFree(false);
        // カード見本：役割の色・幅と代理の（ ）表示を入力に合わせて更新
        const syncCard = () => {
            const role = f('role');
            const rolePill = m.el.querySelector('.oc-cd-role');
            rolePill.classList.toggle('alt', !f('roleBlue').checked);
            rolePill.classList.toggle('is-empty', !role.value);
            role.style.width = Math.max(4, [...(role.value || role.placeholder)].length + 1) + 'em';
            const sn = f('subName').value.trim(), st = f('subTel').value.trim();
            m.el.querySelector('.oc-cd-subprev--name').textContent = sn ? `（${sn}）` : '';
            m.el.querySelector('.oc-cd-subprev--tel').textContent = st ? `（${st}）` : '';
        };
        m.el.addEventListener('input', syncCard);
        m.el.addEventListener('change', syncCard);
        syncCard();
        // 画面の高さは「人」で代理を閉じた状態の中身に合わせて固定する（種類を切り替えても大きさが変わらないように）
        {
            const box = m.el.querySelector('.oc-modal'), det = m.el.querySelector('.oc-cd-sub');
            const forL = m.el.querySelector('.oc-for-label'), forP = m.el.querySelector('.oc-for-person');
            const keep = [det.open, forL.style.display, forP.style.display];
            det.open = false; forL.style.display = 'none'; forP.style.display = '';
            box.style.height = 'auto';
            box.style.height = Math.ceil(box.getBoundingClientRect().height) + 2 + 'px';
            [det.open, forL.style.display, forP.style.display] = keep;
            // 代理を閉じているときは、端数のずれで出る細いスクロールバーを出さない
            const body = m.el.querySelector('.oc-modal-body');
            const syncScroll = () => {
                body.style.overflowY = 'auto';
                const fits = !det.open && body.scrollHeight <= body.clientHeight + 4;
                body.style.overflowY = fits ? 'hidden' : 'auto';
                if (fits) body.scrollTop = 0;
            };
            det.addEventListener('toggle', syncScroll);
            m.el.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', syncScroll));
            const onResize = () => { if (!document.body.contains(m.el)) return window.removeEventListener('resize', onResize); syncScroll(); };
            window.addEventListener('resize', onResize);
            syncScroll();
        }
        f('staff').addEventListener('change', e => {
            syncFree(true);
            const s = staff.find(x => x.id === Number(e.target.value));
            if (!s) { setTimeout(() => f('org').focus(), 0); return; }
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
        const staffPick = pickerFor(f('staff'));
        pickerFor(f('subStaff'));
        suggestFor(f('role'), ROLE_SUGGEST);
        (d.type === 'label' ? f('text') : staffPick).focus();

        // ===== プルダウン（社内名簿の管理と同じ見た目の一覧） =====
        // 元の select は値の保持用に残して隠し、選ぶと change を発火させる（自動入力の処理はそのまま動く）
        let pop = null;
        function closePop() { if (pop) { pop.remove(); pop = null; } }
        function openPop(anchor, build) {
            closePop();
            pop = document.createElement('div');
            pop.className = 'oc-cd-pop';
            m.el.appendChild(pop);
            const r = anchor.getBoundingClientRect();
            const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
            const up = below < 240 && above > below;
            const w = Math.max(r.width, 260);
            pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
            pop.style.width = w + 'px';
            pop.style.maxHeight = Math.min(360, up ? above : below) + 'px';
            if (up) pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; else pop.style.top = (r.bottom + 4) + 'px';
            build(pop);
            return pop;
        }
        m.el.addEventListener('mousedown', e => {
            if (pop && !pop.contains(e.target) && !e.target.closest('.oc-cd-pick, [name=role]')) closePop();
        });
        m.el.querySelector('.oc-modal-body').addEventListener('scroll', closePop);

        function pickerFor(sel) {
            sel.classList.add('oc-cd-hidden');
            sel.tabIndex = -1;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oc-cd-pick' + (sel.classList.contains('oc-cd-staff') ? ' oc-cd-pick--main' : '');
            sel.after(btn);
            const items = [];
            [...sel.children].forEach(c => {
                if (c.tagName === 'OPTGROUP') [...c.children].forEach(o => items.push({ v: o.value, g: c.label, o }));
                else items.push({ v: c.value, g: '', o: c });
            });
            const info = v => { const s = staff.find(x => String(x.id) === String(v)); return s ? { name: s.name, sub: staffOrg(s), tel: s.tel || '' } : null; };
            function paint() {
                const s = info(sel.value);
                btn.innerHTML = s
                    ? `<span class="oc-cd-pick-main"><b>${esc(s.name)}</b><small>${esc(s.sub)}</small></span><span class="oc-cd-pick-tel">${esc(s.tel)}</span><i></i>`
                    : `<span class="oc-cd-pick-main"><span class="oc-cd-pick-free">自由入力（社外の人など）</span></span><i></i>`;
            }
            paint();
            function open() {
                let q = '', idx = -1;
                openPop(btn, p => {
                    p.innerHTML = `<div class="oc-cd-pop-search"><input type="search" placeholder="氏名・電話・部署で検索"></div><div class="oc-cd-pop-list"></div>`;
                    const inp = p.querySelector('input'), list = p.querySelector('.oc-cd-pop-list');
                    const norm = s => String(s || '').replace(/[-\s　]/g, '').toLowerCase();
                    let shown = [];
                    function draw() {
                        const qn = norm(q);
                        shown = items.filter(it => !it.v || !qn || norm(it.o.textContent + it.g).includes(qn));
                        let html = '', lastG = null;
                        shown.forEach((it, i) => {
                            if (it.g !== lastG && it.g) html += `<div class="oc-cd-pop-g"><i></i>${esc(it.g)}</div>`;
                            lastG = it.g;
                            const s = info(it.v);
                            const cls = 'oc-cd-pop-item' + (it.v === sel.value ? ' is-sel' : '') + (i === idx ? ' is-hi' : '');
                            html += s
                                ? `<div class="${cls}" data-i="${i}"><b>${esc(s.name)}</b><span>${esc(s.tel)}</span></div>`
                                : `<div class="${cls} oc-cd-pop-free" data-i="${i}">自由入力（社外の人など）</div>`;
                        });
                        if (shown.length <= 1 && qn) html += '<div class="oc-cd-pop-empty">該当する社員がいません</div>';
                        list.innerHTML = html;
                        const hi = list.querySelector('.is-hi') || list.querySelector('.is-sel');
                        if (hi) { const lr = list.getBoundingClientRect(), er = hi.getBoundingClientRect();
                            if (er.top < lr.top + 28 || er.bottom > lr.bottom) list.scrollTop += er.top - lr.top - lr.height / 2; }
                    }
                    function choose(it) {
                        if (!it) return;
                        sel.value = it.v;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        paint(); closePop(); btn.focus();
                    }
                    list.addEventListener('mousedown', e => e.preventDefault());
                    list.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (el) choose(shown[Number(el.dataset.i)]); });
                    inp.addEventListener('input', () => { q = inp.value; idx = q ? 1 : -1; if (idx >= shown.length) idx = 0; draw(); });
                    inp.addEventListener('keydown', e => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); draw(); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
                        else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); choose(shown[idx]); }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); }
                    });
                    draw();
                    setTimeout(() => inp.focus(), 0);
                });
            }
            btn.addEventListener('click', () => (pop && pop._owner === btn) ? closePop() : (open(), pop._owner = btn));
            btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); pop._owner = btn; } });
            return btn;
        }

        function suggestFor(inp, words) {
            let idx = -1, shown = [];
            function draw() {
                const v = inp.value.trim();
                shown = words.filter(w => !v || (w.includes(v) && w !== v));
                if (!shown.length) { closePop(); return; }
                const p = pop && pop._owner === inp ? pop : openPop(inp, () => {});
                p._owner = inp;
                p.innerHTML = `<div class="oc-cd-pop-head">よく使う役割</div><div class="oc-cd-pop-list">${shown.map((w, i) =>
                    `<div class="oc-cd-pop-item${i === idx ? ' is-hi' : ''}" data-i="${i}"><b>${esc(w)}</b></div>`).join('')}</div>`;
                const list = p.querySelector('.oc-cd-pop-list');
                list.addEventListener('mousedown', e => e.preventDefault());
                list.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (el) pick(shown[Number(el.dataset.i)]); });
            }
            function pick(w) { inp.value = w; idx = -1; closePop(); inp.dispatchEvent(new Event('change', { bubbles: true })); }
            inp.addEventListener('focus', () => { idx = -1; draw(); });
            inp.addEventListener('input', () => { idx = -1; draw(); });
            inp.addEventListener('blur', () => setTimeout(() => { if (pop && pop._owner === inp) closePop(); }, 0));
            inp.addEventListener('keydown', e => {
                if (!pop || pop._owner !== inp) { if (e.key === 'ArrowDown') { idx = 0; draw(); e.preventDefault(); } return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); draw(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
                else if (e.key === 'Enter' && idx >= 0 && !e.isComposing) { e.preventDefault(); pick(shown[idx]); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
            });
        }
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

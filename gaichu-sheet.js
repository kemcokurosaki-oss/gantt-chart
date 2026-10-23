// 外注先用シートの共通部分
//   ・工番は URL の ?pn= で指定（ページ側で PROJECT_NUMBER に入れておく）。表示する外注先は &v=（シートID または all）
//   ・工事名称・客先・出荷納期は工程表（tasks）から自動表示
//   ・この工事の外注先は外注先シート（gaichu_sheets＋gaichu_vendors）から読み、「全体／各外注先」の切り替えボタンを作る
//   ・外注先シートは社内ログイン者しか読めないため、未ログインのときはサインインの案内を出す
// 読み込み前に PROJECT_NUMBER / S_URL / S_KEY を定義しておくこと。
// 外注先を切り替えると document に 'gaichusheetchange' イベント（detail = GaichuSheet.state）を送る。
(function () {
    const client = supabase.createClient(S_URL, S_KEY);
    const qs = new URLSearchParams(location.search);
    const KUSAKABE = { name: '日下部電機㈱', color: '#7b8088' };   // 外注先の色が目立つように、日下部電機は落ち着いた灰色

    const state = {
        pn: PROJECT_NUMBER,
        project: { name: '', customer: '', shipDate: null },
        sheets: [],          // [{ id, vendor_id, name, display, color, spec, trial, rep }]（rep は外注先マスタの代表者 { title, name, tel } か null）
        current: 'all',      // 'all' または シートID
        currentSheet: null,  // 選択中のシート（全体のときは null）
        loggedIn: false,
        isAdmin: false,      // 体制表の管理者（org_chart_admins）なら編集できる
        contacts: [],        // 弊社担当 [{ dept, title, name, tel, email }]（外注先用シートの設定。全工番共通）
        isPublic: true,      // この工番の社内公開（工番ごと）。オフの間は管理者しか中身を読めない（DBの制限）。確認できないときは公開中として扱う
        ready: false,
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function $(id) { return document.getElementById(id); }
    function fmtDate(s) {
        if (!s) return '―';
        const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
        return `${y}/${m}/${d}`;
    }

    // ===== 読み込み =====
    async function loadProject() {
        // 工事名称・客先は、その工番のタスクのうち値が入っている最初のものから取る
        const firstValue = col => client.from('tasks').select(col).eq('project_number', state.pn)
            .not(col, 'is', null).neq(col, '').limit(1);
        const [name, customer, ship] = await Promise.all([
            firstValue('project_details'),
            firstValue('customer_name'),
            client.from('tasks').select('end_date').eq('project_number', state.pn).eq('text', '工場出荷')
                .not('end_date', 'is', null).order('end_date', { ascending: false }).limit(1),
        ]);
        [name, customer, ship].forEach(r => { if (r.error) console.error('工事情報の取得に失敗しました', r.error); });
        const first = (r, col) => (r.data && r.data[0] && r.data[0][col]) || '';
        state.project.name = first(name, 'project_details');
        state.project.customer = first(customer, 'customer_name');
        state.project.shipDate = first(ship, 'end_date') || null;
    }
    async function loadSheets() {
        const { data, error } = await client.from('gaichu_sheets')
            .select('id, vendor_id, color, sort_order, spec, trial, gaichu_vendors(name, display_name)')
            .eq('project_number', state.pn).order('sort_order').order('id');
        if (error) { console.error('外注先シートの取得に失敗しました', error); return; }
        state.sheets = (data || []).map(r => ({
            id: r.id,
            vendor_id: r.vendor_id,
            name: (r.gaichu_vendors && r.gaichu_vendors.name) || '',
            display: (r.gaichu_vendors && r.gaichu_vendors.name) || '',   // 正式社名（見出し・仕様書など）
            short: (r.gaichu_vendors && (r.gaichu_vendors.display_name || shortName(r.gaichu_vendors.name))) || '',   // 略称（表・バッジ・切り替えボタンなど狭いところ）
            color: r.color || '#7f8c8d',
            spec: r.spec || {},
            trial: r.trial || {},
            rep: null,
        }));
        const ids = [...new Set(state.sheets.map(s => s.vendor_id))];
        if (!ids.length) return;
        const { data: reps, error: repErr } = await client.from('gaichu_vendor_contacts').select('vendor_id, title, name, tel').in('vendor_id', ids);
        if (repErr) { console.warn('外注先の代表者の取得に失敗しました', repErr); return; }
        (reps || []).forEach(r => state.sheets.forEach(s => { if (s.vendor_id === r.vendor_id) s.rep = r; }));
    }
    // 外注先の代表者を「役職　氏名 様」の形にする（仕様書のご担当者に使う）
    function repLabel(sheet) {
        const r = sheet && sheet.rep;
        if (!r || !(r.title || r.name)) return '';
        return [r.title, r.name ? r.name + ' 様' : ''].filter(Boolean).join('　');
    }

    // ===== 表示 =====
    function renderHeader() {
        $('sheetJobNo').textContent = state.pn;
        $('sheetTitle').textContent = state.project.name || '（工事名称未登録）';
        $('customerName').textContent = state.project.customer || '―';
        $('shipDate').textContent = fmtDate(state.project.shipDate);
        $('sheetVendors').textContent = state.sheets.length ? state.sheets.map(s => s.display).join(' ／ ')
            : (state.loggedIn ? '（未登録）' : '（ログインすると表示されます）');
        document.title = `外注先用 工事詳細シート｜${state.pn} ${state.project.name || ''}`.trim();
        window.dispatchEvent(new Event('resize'));   // ヘッダーの高さが変わるとサイドメニュー・右パネルの位置を合わせ直す
    }
    function renderSwitch() {
        const box = $('vendorSwitch');
        // 管理者には、この工番の外注先を追加・削除するボタンも出す（画面は gaichu-admin.js）
        const manage = state.isAdmin && window.GaichuAdmin ? `<button type="button" class="vendor-switch-manage" data-gs-manage>外注先の追加・削除</button>` : '';
        if (!state.sheets.length) { box.innerHTML = manage ? `<span class="vendor-switch-label">外注先</span>${manage}` : ''; return; }
        const btn = (key, label, color) => `<button type="button" class="vendor-switch-btn${String(state.current) === String(key) ? ' active' : ''}" data-v="${key}">`
            + (color ? `<span class="dot" style="background:${esc(color)}"></span>` : '') + `${esc(label)}</button>`;
        box.innerHTML = `<span class="vendor-switch-label">外注先</span>` + btn('all', '全体')
            + state.sheets.map(s => btn(s.id, s.short, s.color)).join('') + manage;
    }
    // 担当の印（会社の色の薄い背景＋濃い色の文字）。色は外注先シートの色から作るので、外注先が増えても同じ見た目になる
    function chipStyle(color) {
        const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
        if (!m) return 'background:#f3f3f1;color:#2b2f36';
        const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
        const hex = arr => '#' + arr.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
        return `background:${hex(ch.map(c => c + (255 - c) * 0.88))};color:${hex(ch.map(c => c * 0.68))}`;
    }
    function chipHtml(label, color) {
        return `<span class="party-chip" style="${chipStyle(color)}"><span class="dot" style="background:${esc(color)}"></span>${esc(label)}</span>`;
    }
    function renderLegend() {
        const chip = chipHtml;
        const list = state.currentSheet ? [state.currentSheet] : state.sheets;
        $('partyLegendItems').innerHTML = list.map(s => chip(s.short, s.color)).join('') + chip(KUSAKABE.name, KUSAKABE.color);
    }
    function renderLoginNote() {
        const note = $('sheetLoginNote');
        // 社内公開がオフの間、管理者以外には準備中の案内だけを出し、資料の部分は隠す
        const blocked = state.loggedIn && !state.isAdmin && !state.isPublic;
        document.body.classList.toggle('gaichu-blocked', blocked);
        if (blocked) { note.hidden = false; note.innerHTML = '<span>外注先用シートは準備中です。公開されるまでお待ちください。</span>'; return; }
        if (state.loggedIn) {
            note.hidden = !state.isAdmin || state.isPublic;
            note.innerHTML = note.hidden ? '' : '<span>この工番は社内公開がオフです（管理者だけが見られます）。公開の切り替えは左下の管理者メニューで行います。</span>';
            return;
        }
        note.hidden = false;
        note.innerHTML = `<span>外注先ごとの内容は、社内のアカウントでログインすると表示されます。</span>`
            + `<button type="button" class="sheet-login-btn" data-sheet-login>Microsoftでサインイン</button><span class="sheet-login-err"></span>`;
    }

    // ===== 切り替え =====
    function select(key, { silent } = {}) {
        const sheet = state.sheets.find(s => String(s.id) === String(key)) || null;
        state.current = sheet ? sheet.id : 'all';
        state.currentSheet = sheet;
        const url = new URL(location.href);
        if (sheet) url.searchParams.set('v', sheet.id); else url.searchParams.delete('v');
        history.replaceState(null, '', url);
        renderSwitch();
        renderLegend();
        if (!silent) document.dispatchEvent(new CustomEvent('gaichusheetchange', { detail: state }));
    }

    document.addEventListener('click', async e => {
        if (e.target.closest('[data-gs-manage]')) {
            // 追加・削除のあとは、外注先の一覧が変わるのでページを読み込み直す
            GaichuAdmin.openManage({ pn: state.pn, onDone: () => location.reload() });
            return;
        }
        const b = e.target.closest('.vendor-switch-btn');
        if (b) { select(b.dataset.v); return; }
        if (e.target.closest('[data-sheet-login]')) {
            const err = document.querySelector('.sheet-login-err');
            if (location.protocol === 'file:') {
                err.textContent = '「体制表を開く.bat」から開いてください（ファイルを直接開いた状態ではログインできません）。';
                return;
            }
            // ログイン後に同じ工番・外注先の表示へ戻れるよう、クエリ（?pn=&v=）も戻り先に含める
            const back = location.origin + location.pathname + location.search;
            localStorage.setItem('m365_return_to', location.origin + location.pathname);
            localStorage.setItem(RETURN_QS_KEY, location.search);
            const { error } = await client.auth.signInWithOAuth({
                provider: 'azure', options: { scopes: 'openid profile email', redirectTo: back },
            });
            if (error) err.textContent = 'Microsoftでのログインを開始できませんでした：' + error.message;
        }
    });

    // Supabase の戻り先の登録によっては ?pn=&v= が外れたURLに戻ってくるため、ログイン前に控えた指定に戻す
    const RETURN_QS_KEY = 'gaichu_sheet_return_qs';
    function restoreQueryAfterLogin() {
        const saved = localStorage.getItem(RETURN_QS_KEY);
        if (saved == null) return false;
        localStorage.removeItem(RETURN_QS_KEY);
        if (saved && !qs.has('pn') && /[?&]pn=/.test(saved)) { location.replace(location.pathname + saved); return true; }
        return false;
    }
    window.GaichuSheetReturnKey = RETURN_QS_KEY;

    async function init() {
        // getSession はログインから戻った直後のトークン取り込みが終わってから返る
        const { data: { session } } = await client.auth.getSession();
        if (session && restoreQueryAfterLogin()) return;
        state.loggedIn = !!session;
        await Promise.all([
            loadProject(),
            state.loggedIn ? loadSheets() : Promise.resolve(),
            state.loggedIn ? client.rpc('is_org_chart_admin').then(r => { state.isAdmin = !r.error && r.data === true; }) : Promise.resolve(),
            state.loggedIn ? client.rpc('gaichu_pn_public', { pn: state.pn }).then(r => { state.isPublic = r.error ? true : r.data === true; }) : Promise.resolve(),
            state.loggedIn ? client.from('gaichu_settings').select('value').eq('key', 'company_contacts').maybeSingle()
                .then(r => { if (r.error) console.error('弊社担当の取得に失敗しました', r.error); state.contacts = (r.data && Array.isArray(r.data.value)) ? r.data.value : []; }) : Promise.resolve(),
        ]);
        renderHeader();
        renderLoginNote();
        state.ready = true;
        select(qs.get('v') || 'all');
    }

    // ===== 工程表のタスク（外注先の判定・試運転期間・試運転場所に使う） =====
    let tasksPromise = null;
    function loadTasks() {
        if (!tasksPromise) {
            tasksPromise = client.from('tasks')
                .select('id, text, owner, major_item, machine, unit, vendor_id, test_run_location, start_date, end_date')
                .eq('project_number', state.pn)
                .then(r => { if (r.error) { console.error('工程表のタスクの取得に失敗しました', r.error); return []; } return r.data || []; });
        }
        return tasksPromise;
    }
    const isOutsource = owner => String(owner || '').split(/[,，]/).some(s => s.trim() === '外注');
    // ユニット名を1台ずつに分ける：「CV1&2&3 PV1」「CV4＆5,RV4＆6」→ CV1, CV2, CV3, PV1 / CV4, CV5, RV4, RV6
    // 全角・半角（＆/&、全角英数字）の違いは NFKC でそろえる。「ALL」や空欄は空の配列を返す
    function unitTokens(s) {
        const out = [];
        String(s || '').normalize('NFKC').toUpperCase().split(/[\s,、]+/).filter(Boolean).forEach(g => {
            let prefix = '';
            g.split('&').forEach(p => {
                const m = p.match(/^([A-Z]+)(\d*)$/);
                if (m && m[1] !== 'ALL') { prefix = m[1]; out.push(m[1] + m[2]); }
                else if (/^\d+$/.test(p) && prefix) out.push(prefix + p);
            });
        });
        return out;
    }
    const machineKey = m => String(m || '').normalize('NFKC').trim().toUpperCase();
    // その外注先の「外注」タスクがある機械ごとのユニット { TR: Set(CV1, CV2, ...) }。ユニットが ALL・空欄のタスクがあれば '*'（その機械すべて）
    function vendorUnits(tasks, vendorId) {
        const map = new Map();
        tasks.filter(t => isOutsource(t.owner) && t.vendor_id === vendorId).forEach(t => {
            const mk = machineKey(t.machine);
            if (!map.has(mk)) map.set(mk, new Set());
            const tk = unitTokens(t.unit);
            (tk.length ? tk : ['*']).forEach(u => map.get(mk).add(u));
        });
        return map;
    }
    // そのタスクが外注先のユニットにかかるか（タスク側のユニットが ALL・空欄なら、同じ機械に外注先のタスクがあれば該当）
    function coversVendor(task, units) {
        const set = units.get(machineKey(task.machine));
        if (!set) return false;
        const tk = unitTokens(task.unit);
        return set.has('*') || tk.length === 0 || tk.some(u => set.has(u));
    }
    // ===== 担当範囲一覧の行（工程表から作る） =====
    // 担当に「外注」が入っている「機械組立」「電気艤装」のタスクの 機械・ユニット（工程表の書き方のまま）を1行にする。
    // 各列：機械組立・電気艤装＝その行の同じ名前のタスクの担当（外注→外注先企業、未入力なら 'unset'＝未定。社員の名前→日下部電機）
    //       試運転＝機械・ユニットが重なる「試運転」タスクの担当、試運転場所＝そのタスクの試運転場所（空欄なら日下部電機）
    // 機械名と、工事ごとに追加した列は手入力（manualRows に key で保存。key が無い以前の1ユニットずつの行は、ユニットが含まれる行に寄せる）
    const SCOPE_TASKS = { '機械組立': 'assembly', '電気艤装': 'electrical' };
    const normText = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const scopeRowKey = (machine, unit) => machineKey(machine) + '|' + normText(unit).toUpperCase();
    const hasStaff = owner => String(owner || '').split(/[,，]/).some(s => s.trim() && s.trim() !== '外注');
    // 担当先のキー：外注先（外注先マスタのID）／'unset'（外注だが外注先企業が未入力）／'kusakabe'（社員の名前）
    function ownerParties(t) {
        const out = [];
        if (isOutsource(t.owner)) out.push(t.vendor_id != null ? t.vendor_id : 'unset');
        if (hasStaff(t.owner)) out.push('kusakabe');
        return out;
    }
    // 試運転場所の文字を担当先のキーにする（外注先シートの外注先・日下部電機の名前に当てはまれば、そのキー。空欄は日下部電機）
    const nameKey = s => String(s || '').normalize('NFKC').replace(/殿|様|株式会社|\(株\)|㈱|有限会社|\(有\)|\s/g, '');
    function placeParty(text) {
        const k = nameKey(text);
        if (!k) return 'kusakabe';
        const s = state.sheets.find(x => [x.name, x.display, x.short].some(n => { const nk = nameKey(n); return nk && (nk === k || nk.includes(k) || k.includes(nk)); }));
        if (s) return s.vendor_id;
        return k.includes('日下部') ? 'kusakabe' : String(text).trim();   // 当てはまらない文字はそのまま（灰色のバッジ）
    }
    function scopeRows(tasks, manualRows) {
        const isName = (t, n) => normText(t.text) === n;
        const groups = new Map();
        (tasks || []).forEach(t => {
            const col = SCOPE_TASKS[normText(t.text)];
            if (!col || !isOutsource(t.owner)) return;
            const key = t._rowKey || scopeRowKey(t.machine, t.unit);
            if (!groups.has(key)) groups.set(key, { key, machine: normText(t.machine), unit: normText(t.unit), start: t.start_date || '' });
            const g = groups.get(key);
            if (t.start_date && (!g.start || t.start_date < g.start)) g.start = t.start_date;
        });
        const uniq = a => [...new Map(a.map(v => [String(v), v])).values()];
        const trials = (tasks || []).filter(t => isName(t, '試運転'));
        const covers = (t, g) => {
            if (machineKey(t.machine) !== machineKey(g.machine)) return false;
            const a = unitTokens(t.unit), b = unitTokens(g.unit);
            return !a.length || !b.length || a.some(u => b.includes(u));
        };
        const manual = Array.isArray(manualRows) ? manualRows : [];
        const isNew = k => String(k).startsWith('new');   // シートで追加した（まだ保存していない）行は最後に並べる
        const rows = [...groups.values()].sort((a, b) => (isNew(a.key) - isNew(b.key)) || a.machine.localeCompare(b.machine, 'ja') || String(a.start).localeCompare(String(b.start)) || a.unit.localeCompare(b.unit, 'ja')).map(g => {
            const same = (tasks || []).filter(t => (t._rowKey || scopeRowKey(t.machine, t.unit)) === g.key);
            const row = { key: g.key, machine: g.machine, unit: g.unit, taskIds: {}, rowTaskIds: same.filter(t => SCOPE_TASKS[normText(t.text)]).map(t => t.id) };
            row.deleted = same.length > 0 && same.filter(t => SCOPE_TASKS[normText(t.text)]).every(t => t._deleted);
            Object.entries(SCOPE_TASKS).forEach(([name, col]) => {
                const ts = same.filter(t => isName(t, name));
                row[col] = uniq(ts.flatMap(ownerParties));
                row.taskIds[col] = ts.filter(t => isOutsource(t.owner)).map(t => t.id);   // 外注先企業を付け直せるのは外注のタスクだけ
            });
            const tr = trials.filter(t => covers(t, g));
            row.taskIds.trial_place = tr.map(t => t.id);
            row.trial = uniq(tr.flatMap(ownerParties));
            row.trial_place = tr.length ? uniq(tr.map(t => placeParty(t.test_run_location))) : [];
            // 手入力の列（機械名・追加した列）
            const m = manual.find(r => r.key === g.key);
            const legacy = m ? [] : manual.filter(r => !r.key && machineKey(r.machine || g.machine) === machineKey(g.machine) && unitTokens(r.unit).length && unitTokens(r.unit).every(u => unitTokens(g.unit).includes(u)));
            row.manual = m ? { ...m } : legacy.reduce((acc, r) => {
                Object.entries(r).forEach(([k, v]) => {
                    if (['machine', 'unit', 'assembly', 'electrical', 'trial', 'trial_place', 'key'].includes(k)) return;
                    if (Array.isArray(v)) acc[k] = uniq((acc[k] || []).concat(v));
                    else if (String(v || '').trim()) acc[k] = acc[k] ? (acc[k].split('・').includes(v) ? acc[k] : acc[k] + '・' + v) : v;
                });
                return acc;
            }, {});
            return row;
        });
        return rows;
    }

    // 試運転期間：機械・ユニットが外注先の「外注」タスクと一致する「試運転」タスク（現地試運転は除く）の最初の開始日〜最後の終了日
    async function trialPeriod(sheet) {
        if (!sheet) return null;
        const tasks = await loadTasks();
        const units = vendorUnits(tasks, sheet.vendor_id);
        const hits = tasks.filter(t => String(t.text || '').trim() === '試運転' && t.start_date && t.end_date && coversVendor(t, units));
        if (!hits.length) return { start: null, end: null, count: 0, hasVendorTasks: units.size > 0 };
        const start = hits.map(t => t.start_date).sort()[0];
        const end = hits.map(t => t.end_date).sort().slice(-1)[0];
        return { start, end, count: hits.length, hasVendorTasks: true };
    }

    // 外注先シートの一部（spec / trial）を保存する。権限がない・ログイン切れで0件更新のときは失敗として扱う
    async function saveSheet(id, patch) {
        const { data: { session } } = await client.auth.getSession();
        if (!session) throw new Error('ログインが切れています。再度ログインしてください。');
        const rec = { ...patch, updated_at: new Date().toISOString(), updated_by: session.user.email };
        const { data, error } = await client.from('gaichu_sheets').update(rec).eq('id', id).select('id, spec, trial');
        if (error) throw error;
        if (!data || !data.length) throw new Error('保存できませんでした（編集の権限がないか、ログインが切れています）');
        const sheet = state.sheets.find(s => s.id === id);
        if (sheet) { sheet.spec = data[0].spec || {}; sheet.trial = data[0].trial || {}; }
        return sheet;
    }

    // 略称が未入力のときの代わり（正式社名から「殿」「株式会社」「㈱」などを外す）
    function shortName(s) { return _short(s); }
    const _short = s => String(s || '').normalize('NFKC').replace(/殿$/, '').replace(/株式会社|有限会社|\(株\)|\(有\)/g, '').trim() || String(s || '');
    window.GaichuSheet = {
        shortName, scopeRows, scopeRowKey,
        repLabel,
        state, client, select, saveSheet,
        loadTasks, unitTokens, isOutsource, vendorUnits, coversVendor, trialPeriod, fmtDate,
        sheetById: id => state.sheets.find(s => String(s.id) === String(id)) || null,
        KUSAKABE, chipStyle, chipHtml,
    };
    init();
})();

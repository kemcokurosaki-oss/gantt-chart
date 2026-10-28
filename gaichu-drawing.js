// 外注先用シート：組図配布チェックリスト（管理者だけが使う機能。左下の管理者メニューから開く。外注先ごと）
//   ・行は工程表（tasks）の設計工程表に出ているタスク（is_detailed）のうち、表示中の工番で、その外注先が「機械組立」を担当する機械・ユニットのもの
//   ・外注先が担当する機械・ユニットは、組立範囲の担当範囲一覧（gaichu_scopes.rows）から拾う。「CV1&2&3」は CV1・CV2・CV3 として照合する
//     担当範囲一覧の機械が空欄の行はユニットだけで照合する。W付きのユニット（RV1W・WKW）は W の前のユニット（RV1・WK）と同じ扱い
//   ・完了した工番（アーカイブ済み）のタスクも出す（工事が終わったあとに見ても空にならないように）
//   ・入力できるのは支給日だけ（gaichu_drawing_dist に外注先ごとに保存）。支給日が入っている行＝配布済み（グレー）。支給日を消すと未配布に戻る
//   ・並び順は設計工程表と同じ（sort_order → id）
// 読み込み前に gaichu-sheet.js を読み込み、ページに #drawRoot・#drawBar を置いておくこと。
(function () {
    const root = document.getElementById('drawRoot');
    const bar = document.getElementById('drawBar');
    const GS = window.GaichuSheet;
    if (!root || !GS) return;
    const db = () => GS.client;

    // 表の列 [key, 見出し]（支給日は一番右に別に出す）
    const COLS = [['project_number', '工事番号'], ['machine', '機械'], ['unit', 'ユニット'], ['text', '組立図面名'], ['model_type', '機種'],
        ['unit2', 'ユニ2'], ['hyphen', '-'], ['characteristic', '特性'], ['derivation', '派生'], ['owner', '担当']];

    // 読み込んだ内容（工番ごと）。tasks：設計の詳細タスク、scopeRows：担当範囲一覧の行、dist：`${task_id}:${vendor_id}` → 支給日
    let data = null, dataPn = null, loading = false, loadError = null, distError = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const norm = s => String(s || '').normalize('NFKC').trim().toUpperCase();
    const distKey = (taskId, vendorId) => `${taskId}:${vendorId}`;
    const sortValue = t => (t.sort_order != null ? t.sort_order : Number(t.id) * 1000);

    // ===== 読み込み =====
    async function load() {
        const st = GS.state;
        if (!st.ready || !st.loggedIn || !st.isAdmin || !st.pn) { render(); return; }
        if (loading) return;
        loading = true; loadError = null; distError = null;
        render();
        try {
            const pn = st.pn;
            const [tasks, scope, dist] = await Promise.all([
                db().from('tasks')
                    .select('id, project_number, machine, unit, text, model_type, unit2, hyphen, characteristic, derivation, owner, sort_order')
                    .eq('project_number', pn).eq('is_detailed', true).limit(5000),
                db().from('gaichu_scopes').select('rows').eq('project_number', pn).maybeSingle(),
                db().from('gaichu_drawing_dist').select('task_id, vendor_id, supplied_on').eq('project_number', pn).limit(5000),
            ]);
            if (tasks.error) throw new Error('工程表のタスクを読めませんでした：' + tasks.error.message);
            if (scope.error) throw new Error('組立範囲を読めませんでした：' + scope.error.message);
            if (dist.error) distError = '支給日を読めませんでした：' + dist.error.message;
            const map = new Map();
            (dist.data || []).forEach(r => map.set(distKey(r.task_id, r.vendor_id), r.supplied_on));
            data = {
                tasks: (tasks.data || []).sort((a, b) => sortValue(a) - sortValue(b) || Number(a.id) - Number(b.id)),
                scopeRows: (scope.data && Array.isArray(scope.data.rows)) ? scope.data.rows : [],
                dist: map,
            };
            dataPn = pn;
        } catch (e) {
            loadError = e;
        } finally {
            loading = false;
            render();
        }
    }

    // ===== 外注先の担当（担当範囲一覧の「機械組立」） =====
    //   [{ machine: 'TR'（空欄なら ''）, units: Set(CV1, CV2, ...) }]
    function vendorScopes(vendorId) {
        return data.scopeRows
            .filter(r => (Array.isArray(r.assembly) ? r.assembly : []).some(k => String(k) === String(vendorId)))
            .map(r => ({ machine: norm(r.machine), units: new Set(GS.unitTokens(r.unit)) }))
            .filter(s => s.units.size);
    }
    // タスクのユニット（W付きは W の前のユニットとしても見る）
    function taskUnits(unit) {
        const u = norm(unit);
        const out = new Set(GS.unitTokens(u));
        if (u.length > 1 && u.endsWith('W')) GS.unitTokens(u.slice(0, -1)).forEach(x => out.add(x));
        return [...out];
    }
    function vendorTasks(vendorId) {
        const scopes = vendorScopes(vendorId);
        if (!scopes.length) return [];
        return data.tasks.filter(t => {
            const units = taskUnits(t.unit);
            if (!units.length) return false;
            const m = norm(t.machine);
            return scopes.some(s => (!s.machine || s.machine === m) && units.some(u => s.units.has(u)));
        });
    }

    // ===== 表示 =====
    function setBar(html) { if (bar) bar.innerHTML = html; }
    function placeBarTop() {
        const panel = root.closest('.sub-panel'), subBar = panel && panel.querySelector('.sub-bar');
        const solo = document.body.classList.contains('solo');
        const head = solo ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h')) || 0) : 0;
        if (bar) bar.style.setProperty('--spec-top', (head + (subBar ? subBar.offsetHeight : 0)) + 'px');
    }
    window.addEventListener('resize', placeBarTop);

    function render() {
        placeBarTop();
        const st = GS.state;
        if (!st.ready) { setBar(''); root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!st.loggedIn) { setBar(''); root.innerHTML = '<p class="spec-msg">組図配布チェックリストは、社内のアカウントでログインすると表示されます。</p>'; return; }
        if (!st.isAdmin) { setBar(''); root.innerHTML = '<p class="spec-msg">組図配布チェックリストは管理者だけが使える機能です。</p>'; return; }
        if (!st.sheets.length) { setBar(''); root.innerHTML = '<p class="spec-msg">この工事には外注先が登録されていません。</p>'; return; }
        const sheet = st.currentSheet;
        const tabs = st.sheets.map(s => `<button type="button" class="vendor-switch-btn${sheet && sheet.id === s.id ? ' active' : ''}" data-v="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.short)}</button>`).join('');
        const reloadBtn = `<button type="button" class="spec-btn" data-dd="reload"${loading ? ' disabled' : ''} title="工程表・組立範囲・支給日をもう一度読みます">最新を読む</button>`;
        if (loadError) { setBar(`<div class="spec-tabs">${tabs}<span class="spec-spacer"></span>${reloadBtn}</div>`); root.innerHTML = `<p class="sp-warn">${esc(loadError.message || String(loadError))}</p>`; return; }
        if (!data || dataPn !== st.pn) { setBar(`<div class="spec-tabs">${tabs}</div>`); root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!sheet) {
            setBar(`<div class="spec-tabs">${tabs}<span class="spec-spacer"></span>${reloadBtn}</div>`);
            root.innerHTML = '<p class="spec-msg">組図配布チェックリストは外注先ごとに表示します。上のボタンから外注先を選んでください。</p>';
            return;
        }
        const rows = vendorTasks(sheet.vendor_id);
        const dateOf = t => data.dist.get(distKey(t.id, sheet.vendor_id)) || '';
        const done = rows.filter(dateOf).length;
        const prog = rows.length ? `<span class="sp-prog">配布済み <b>${done}</b> ／ ${rows.length}</span>` : '';
        setBar(`<div class="spec-tabs">${tabs}<span class="spec-spacer"></span>${prog}${reloadBtn}</div>`);

        const warn = distError ? `<p class="sp-warn">${esc(distError)}</p>` : '';
        if (!vendorScopes(sheet.vendor_id).length) {
            root.innerHTML = warn + `<p class="spec-msg">組立範囲の担当範囲一覧に、${esc(sheet.short)} が機械組立を担当する行がありません。</p>`;
            return;
        }
        if (!rows.length) {
            root.innerHTML = warn + `<p class="spec-msg">${esc(sheet.short)} が機械組立を担当する機械・ユニットのタスクが、設計工程表にありません。</p>`;
            return;
        }
        const head = COLS.map(([, label]) => `<th>${esc(label)}</th>`).join('') + '<th>支給日</th>';
        const body = rows.map(t => {
            const d = dateOf(t);
            const cells = COLS.map(([k]) => `<td${k === 'text' ? ' class="sp-name"' : ''}>${esc(t[k] == null ? '' : t[k])}</td>`).join('');
            return `<tr class="${d ? 'is-done' : ''}">${cells}<td class="sp-date-col"><input type="date" class="sp-in sp-in--date${d ? '' : ' is-empty'}" data-dd-date="${esc(t.id)}" value="${esc(d)}"${distError ? ' disabled' : ''} title="組立図を配布した日（消すと未配布に戻ります）"></td></tr>`;
        }).join('');
        root.innerHTML = warn + `<div class="sp-table-wrap"><table class="sp-table dd-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
        fitTable();
    }
    // 表は中でスクロールさせ、上の操作の行・見出しは止めておく（表の高さを画面の下までにする）
    function fitTable() {
        const wrap = root.querySelector('.sp-table-wrap');
        if (!wrap) return;
        const panel = root.closest('.sub-panel');
        if (!panel || !panel.classList.contains('open')) return;
        const top = wrap.getBoundingClientRect().top + (panel.scrollTop || 0);
        wrap.style.maxHeight = Math.max(240, window.innerHeight - top - 28) + 'px';
    }
    window.addEventListener('resize', fitTable);

    // ===== 支給日の保存（入れたら保存、消したら削除） =====
    async function saveDate(input) {
        const sheet = GS.state.currentSheet;
        if (!sheet || !data) return;
        const taskId = Number(input.dataset.ddDate), vendorId = sheet.vendor_id, key = distKey(taskId, vendorId);
        const value = input.value || '';
        const prev = data.dist.get(key) || '';
        if (value === prev) return;
        input.disabled = true;
        try {
            let res;
            if (value) {
                const { data: { session } } = await db().auth.getSession();
                res = await db().from('gaichu_drawing_dist').upsert({
                    task_id: taskId, vendor_id: vendorId, project_number: GS.state.pn, supplied_on: value,
                    updated_at: new Date().toISOString(), updated_by: session && session.user.email,
                }, { onConflict: 'task_id,vendor_id' }).select('task_id');
            } else {
                res = await db().from('gaichu_drawing_dist').delete().eq('task_id', taskId).eq('vendor_id', vendorId).select('task_id');
            }
            // 0件（ログイン切れ・権限なし）も失敗として扱う
            if (res.error || !res.data || !res.data.length) throw new Error((res.error && res.error.message) || '編集の権限がないか、ログインが切れています');
            if (value) data.dist.set(key, value); else data.dist.delete(key);
        } catch (e) {
            alert('支給日を保存できませんでした：' + (e.message || String(e)));
        }
        render();
    }

    // ===== 操作 =====
    if (bar) bar.addEventListener('click', e => { if (e.target.closest('[data-dd="reload"]')) load(); });
    root.addEventListener('change', e => { const inp = e.target.closest('[data-dd-date]'); if (inp) saveDate(inp); });
    // 外注先を切り替えたときは描き直すだけ（工番が変わったときは読み直す）
    document.addEventListener('gaichusheetchange', () => { if (GS.state.ready && dataPn !== GS.state.pn) load(); else render(); });
    // パネルを開いたときに表の高さを合わせる（openDoc が resize を出す）
    (function wait() {
        if (GS.state.ready) { load(); return; }
        render();
        setTimeout(wait, 300);
    })();
})();

// 外注先用シート：支給品チェックリスト（管理者だけが使う機能。左下の管理者メニューから開く。外注先ごと・加工品／購入品）
//   ・行は OneDrive の「ユニット外注」フォルダーのチェック表（Excel。デスクトップアプリで作成）を読み込んで作る（gaichu_supply_items・gaichu_supply_docs）
//   ・支給の前の事前チェックとして行ごとに✓。✓を付けた日と人は自動で残る（checked_on・checked_by。✓にマウスを乗せると出る）
//   ・支給日は✓とは別に、編集画面で入力する（supply_date）
//   ・ふだんは OneDrive の「ユニット外注」フォルダーのチェック表（Excel）を読み込む。読み直すと前の内容と比べて「訂正」「追加」「削除」の印を付ける
//   ・作成・編集・✓は体制表の管理者（org_chart_admins）だけ。閲覧は外注先用シートを見られる人
//   ・概要ページに #ovSupply があれば外注先ごとの進み具合を出す（今は概要には置いていない）
// 読み込み前に gaichu-sheet.js・gaichu-admin.js を読み込み、ページに #supplyRoot・#supplyBar を置いておくこと。
(function () {
    const root = document.getElementById('supplyRoot');
    const bar = document.getElementById('supplyBar');
    const ovEl = document.getElementById('ovSupply');
    const GS = window.GaichuSheet;
    if (!root || !GS) return;
    const db = () => GS.client;

    const KINDS = [['machined', '加工品', '工事企画表'], ['purchased', '購入品', '購入部品表']];
    // 表の列 [key, 見出し, 入力の種類]（✓・支給日・ユニット・資料は全部の表に付ける）
    const COLS = {
        machined: [['drawing_no', '図面番号', 'text'], ['name', '品名', 'text'], ['material', '材質', 'text'], ['qty', '数量', 'num'],
            ['weight_material', '素材重量', 'num'], ['weight_finished', '仕上重量', 'num'], ['plan_code', '工程計画', 'text'], ['remark', '備考', 'text']],
        purchased: [['seq', '通番', 'int'], ['name', '品名', 'text'], ['spec', '寸法・型式', 'text'], ['qty', '数量', 'num'],
            ['maker', 'メーカー', 'text'], ['remark', '備考', 'text']],
    };
    // 画面で変えられるのは✓と支給日だけ（品名・数量などは OneDrive の Excel を直して読み直す。Excel とずれないように）。行は選んで一括削除できる
    let hasSupplyDate = true;   // 支給日の列（scripts/gaichu_supply_date_setup.sql）があるか

    let items = [];          // この工番の全外注先の行
    let loadedPn = null, loadError = null, loading = false;
    let kind = 'machined';
    // Excelのような列ごとの絞り込み・並べ替え（加工品・購入品ごとに持つ。外注先を切り替えたら解除）
    //   filters[key] = 表示する値の Set（値は画面に出す文字。空欄は「（空白）」、支給日の空欄は「（未入力）」）
    const views = { machined: { filters: {}, sort: null }, purchased: { filters: {}, sort: null } };
    let viewSheetId = null;
    const BLANK = '（空白）', NOT_YET = '（未入力）', CHECKED = '✓ チェック済み', UNCHECKED = '未チェック';
    const selected = new Set();   // 選んだ行の id（一括入力の対象）
    let bulkDate = '';            // 一括入力の支給日の欄に入れた日付（描き直しても残す）

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const md = s => { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${m}/${d}`; };
    const ymdJa = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${y}/${m}/${d}`; };
    function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    const num = v => (v == null || v === '' ? '' : String(Number(v)));
    // 絞り込み・並べ替えに使う列（表の列の順と同じ。✓はチェック済み／未チェック）
    const viewCols = k => [['checked_on', '✓', 'check'], ['supply_date', '支給日', 'date'], ['change_flag', '変更', 'flag'], ['unit_code', 'ユニット', 'text'], ...COLS[k], ['doc_no', '資料', 'text']];
    function dispOf(r, key, type) {
        const v = r[key];
        if (type === 'check') return v ? CHECKED : UNCHECKED;
        if (type === 'flag') return v || '（なし）';
        if (type === 'date') return v ? ymdJa(v) : NOT_YET;
        if (v == null || String(v).trim() === '') return BLANK;
        return type === 'num' || type === 'int' ? num(v) : String(v);
    }
    function cmpVal(a, b, type) {
        const blankA = a == null || a === '', blankB = b == null || b === '';
        if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;   // 空欄はいつも最後
        if (type === 'num' || type === 'int') return Number(a) - Number(b);
        return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
    }
    function applyView(rows, k) {
        const v = views[k], cols = viewCols(k);
        let out = rows.filter(r => cols.every(([key, , type]) => !v.filters[key] || v.filters[key].has(dispOf(r, key, type))));
        if (v.sort) {
            const c = cols.find(x => x[0] === v.sort.key);
            if (c) out = out.map((r, i) => [r, i]).sort((x, y) => {
                const blankX = x[0][c[0]] == null || x[0][c[0]] === '', blankY = y[0][c[0]] == null || y[0][c[0]] === '';
                if (blankX !== blankY) return blankX ? 1 : -1;
                return (v.sort.dir === 'desc' ? -1 : 1) * cmpVal(x[0][c[0]], y[0][c[0]], c[2]) || x[1] - y[1];
            }).map(x => x[0]);
        }
        return out;
    }
    const viewActive = k => !!views[k].sort || Object.keys(views[k].filters).length > 0;
    const notFoundTable = err => err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|Could not find the table/i.test(err.message || ''));

    // ===== 読み込み =====
    async function load(force) {
        const st = GS.state;
        if (!st.ready || !st.loggedIn || !st.pn) return;
        if (!force && loadedPn === st.pn) return;
        loading = true;
        const [{ data, error }, probe, probe2] = await Promise.all([
            db().from('gaichu_supply_items').select('*').eq('project_number', st.pn).order('sort_order').order('id'),
            db().from('gaichu_supply_items').select('supply_date').limit(1),
            db().from('gaichu_supply_items').select('source_file, change_flag, prev').limit(1),
        ]);
        hasSupplyDate = !probe.error;
        hasSyncCols = !probe2.error;
        loading = false;
        loadedPn = st.pn;
        loadError = error || null;
        items = error ? [] : (data || []);
        render();
    }
    const sheetItems = (sheetId, k) => items.filter(r => r.sheet_id === sheetId && (!k || r.kind === k));
    const progress = list => ({ done: list.filter(r => r.checked_on).length, total: list.length });

    // ===== 概要ページ：外注先ごとの進み具合 =====
    function renderOverview() {
        if (!ovEl) return;
        const st = GS.state;
        if (!st.ready) return;
        if (!st.loggedIn) { ovEl.innerHTML = '<p class="ov-muted">ログインすると表示されます。</p>'; return; }
        if (loadError) { ovEl.innerHTML = `<p class="ov-muted">${notFoundTable(loadError) ? '支給品チェックリストの準備（SQLの実行）がまだです。' : '読み込めませんでした。'}</p>`; return; }
        const sheets = st.currentSheet ? [st.currentSheet] : st.sheets;
        if (!sheets.length) { ovEl.innerHTML = '<p class="ov-muted">外注先が登録されていません。</p>'; return; }
        const cell = (s, k) => {
            const p = progress(sheetItems(s.id, k));
            if (!p.total) return '<span class="sp-ov-none">―</span>';
            const pct = Math.round(p.done / p.total * 100);
            return `<span class="sp-ov-bar"><i style="width:${pct}%;background:${esc(s.color)}"></i></span><b>${p.done}</b><span>／${p.total}</span>${p.done === p.total ? '<em class="sp-ov-done">完了</em>' : ''}`;
        };
        const last = s => { const ds = sheetItems(s.id).map(r => r.supply_date).filter(Boolean).sort(); return ds.length ? ymdJa(ds[ds.length - 1]) : '―'; };
        ovEl.innerHTML = `<table class="sp-ov"><thead><tr><th>外注先</th><th>加工品（チェック済み／全数）</th><th>購入品（チェック済み／全数）</th><th>最後の支給日</th></tr></thead><tbody>`
            + sheets.map(s => `<tr><td>${GS.chipHtml(s.short, s.color)}</td><td>${cell(s, 'machined')}</td><td>${cell(s, 'purchased')}</td><td>${last(s)}</td></tr>`).join('')
            + `</tbody></table>`;
    }

    // ===== 詳細ページ =====
    function setBar(html) { if (bar) bar.innerHTML = html; }
    function placeBarTop() {
        const panel = root.closest('.sub-panel'), subBar = panel && panel.querySelector('.sub-bar');
        const solo = document.body.classList.contains('solo');
        const head = solo ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h')) || 0) : 0;
        if (bar) bar.style.setProperty('--spec-top', (head + (subBar ? subBar.offsetHeight : 0)) + 'px');
    }
    window.addEventListener('resize', placeBarTop);

    function render() {
        renderOverview();
        placeBarTop();
        const st = GS.state;
        if (!st.ready || loading) { setBar(''); root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!st.loggedIn) { setBar(''); root.innerHTML = '<p class="spec-msg">支給品チェックリストは、社内のアカウントでログインすると表示されます。</p>'; return; }
        if (!st.isAdmin) { setBar(''); root.innerHTML = '<p class="spec-msg">支給品チェックリストは管理者だけが使える機能です。</p>'; return; }
        if (loadError) {
            setBar('');
            root.innerHTML = `<p class="spec-msg">${notFoundTable(loadError) ? '支給品チェックリストの準備ができていません。管理者が Supabase で scripts/gaichu_supply_setup.sql を実行してください。' : '読み込めませんでした：' + esc(loadError.message)}</p>`;
            return;
        }
        if (!st.sheets.length) { setBar(''); root.innerHTML = '<p class="spec-msg">この工事には外注先が登録されていません。</p>'; return; }
        const sheet = st.currentSheet;
        const tabs = st.sheets.map(s => `<button type="button" class="vendor-switch-btn${sheet && sheet.id === s.id ? ' active' : ''}" data-v="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.short)}</button>`).join('');
        if (!sheet) {
            setBar(`<div class="spec-tabs">${tabs}</div>`);
            root.innerHTML = '<p class="spec-msg">支給品チェックリストは外注先ごとに作成します。上のボタンから外注先を選んでください。</p>';
            return;
        }

        if (viewSheetId !== sheet.id) { viewSheetId = sheet.id; Object.values(views).forEach(v => { v.filters = {}; v.sort = null; }); selected.clear(); selAnchorId = null; }
        const rows = sheetItems(sheet.id).filter(r => r.kind === kind);
        const shown = applyView(rows, kind);
        const kindBtns = KINDS.map(([k, label]) => {
            const p = progress(sheetItems(sheet.id, k));
            return `<button type="button" data-sp-kind="${k}"${k === kind ? ' class="is-on"' : ''}>${label}<small>${p.total ? `${p.done}/${p.total}` : '0'}</small></button>`;
        }).join('');
        const filterSel = !viewActive(kind) ? '' : `<span class="sp-view-note">${shown.length} / ${rows.length} 行を表示</span>`;
        const tools = `<span class="spec-spacer"></span><button type="button" class="spec-btn spec-btn--primary" data-sp="import">読み込む</button>`;
        setBar(`<div class="spec-tabs">${tabs}<span class="sp-sep"></span><span class="sp-kinds">${kindBtns}</span>${filterSel}${tools}</div>`);

        const cols = COLS[kind];
        const p = progress(rows);
        // 見出し：押すと絞り込み・並べ替えのメニュー
        const v = views[kind];
        const th = ([key, label, type]) => {
            const cls = type === 'check' ? ' class="sp-chk-col"' : '';
            const on = !!v.filters[key], s = v.sort && v.sort.key === key ? v.sort.dir : '';
            return `<th${cls}><button type="button" class="sp-th${on || s ? ' is-on' : ''}" data-sp-col="${key}" title="絞り込み・並べ替え">${label}<i>${s === 'asc' ? '▲' : '▼'}</i></button></th>`;
        };
        const vc = viewCols(kind);
        // 一括入力の対象：選んだ行のうち、いま表示している行（絞り込みで隠れた行には入れない）
        const selShown = shown.filter(r => selected.has(r.id));
        const allSel = shown.length > 0 && selShown.length === shown.length;
        const head = `<tr><th class="sp-sel-col"><input type="checkbox" data-sp-selall title="表示している行をすべて選ぶ"${allSel ? ' checked' : ''}></th>${vc.map(th).join('')}</tr>`;
        const cellView = (r, [k, , type]) => {
            const v = r[k];
            if (type === 'num' || type === 'int') return `<td class="sp-num">${esc(num(v))}</td>`;
            return `<td${k === 'name' ? ' class="sp-name"' : ''}>${esc(v || '')}</td>`;
        };
        const dateOff = hasSupplyDate ? '' : ' disabled title="支給日の列がまだありません（scripts/gaichu_supply_date_setup.sql を実行してください）"';
        const body = shown.map(r => `<tr class="${r.checked_on ? 'is-done' : ''}${r.change_flag === '削除' ? ' is-removed' : ''}${selected.has(r.id) || ctrlPick.has(r.id) ? ' is-sel' : ''}">`
            + `<td class="sp-sel-col"><input type="checkbox" data-sp-sel="${r.id}"${selected.has(r.id) ? ' checked' : ''}></td>`
            + `<td class="sp-chk-col"><button type="button" class="sp-chk${r.checked_on ? ' is-on' : ''}" data-sp-check="${r.id}" title="${r.checked_on ? `${ymdJa(r.checked_on)} にチェック${r.checked_by ? '（' + esc(r.checked_by) + '）' : ''}` : '事前チェックが済んだら✓'}">${r.checked_on ? '✓' : ''}</button></td>`
            + `<td class="sp-date-col"><input type="date" class="sp-in sp-in--date${r.supply_date ? '' : ' is-empty'}" data-sp-date="${r.id}" value="${esc(r.supply_date || '')}"${dateOff}></td>`
            + flagCell(r)
            + `<td>${esc(r.unit_code || '')}</td>`
            + cols.map(c => cellView(r, c)).join('')
            + `<td class="sp-doc">${esc(r.doc_no || '')}</td></tr>`).join('');
        const kindLabel = KINDS.find(x => x[0] === kind);
        const empty = !rows.length
            ? `<p class="spec-msg">${esc(kindLabel[1])}の行はまだありません。上の「読み込む」から、OneDrive のチェック表（Excel）を読み込むと作成できます。</p>` : '';
        root.innerHTML = `<div class="sp-summary"><b>${esc(sheet.display)}</b>　${esc(kindLabel[1])}（${esc(kindLabel[2])}から）`
            + (rows.length ? `<span class="sp-hint">${ctrlPick.size ? `<b>${ctrlPick.size} 行を選択中</b>：Ctrlを離すとまとめて${pickWillCheck() ? '✓を付けます' : '✓を外します'}` : '✓は Shift＋クリックで範囲、Ctrl＋クリックで複数の行をまとめて付け外し'}</span><span class="sp-prog">チェック済み <b>${p.done}</b> ／ ${p.total}</span>` : '') + `</div>`
            + (rows.length ? `<div class="sp-bulk"><b>選んだ ${selShown.length} 行に</b>
                <label title="日付を選ぶと、選んだ行にすぐ入ります。カレンダーの「クリア」で選んだ行の支給日を消します">支給日 <input type="date" data-sp-bulkdate value="${esc(bulkDate)}"${selShown.length && hasSupplyDate ? '' : ' disabled'}></label>
                <span class="sp-sep"></span><button type="button" class="spec-btn" data-sp-bulk="check"${selShown.length ? '' : ' disabled'} title="選んだ行に✓のないものがあれば全部に✓、全部✓済みなら全部外します">${selShown.length && selShown.every(r => r.checked_on) ? '✓を外す' : '✓を付ける'}</button>
                <span class="sp-sep"></span><button type="button" class="spec-btn sp-btn-danger" data-sp-bulk="delete"${selShown.length ? '' : ' disabled'} title="選んだ行をリストから消します（OneDrive の Excel に残っている部品は、次に読み込んだときに「追加」として戻ります）">削除</button>
                ${selShown.length ? '<button type="button" class="spec-btn" data-sp-bulk="clearsel">選択を解除</button>' : ''}
                <span class="sp-bulk-note">左の欄で行を選びます（見出しの欄で表示中の行をすべて選択、Shift＋クリックで範囲）。見出しの絞り込みと組み合わせて使えます。入力はすぐ保存されます。</span></div>` : '')
            + (empty || `<div class="sp-table-wrap"><table class="sp-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length + 6}" class="sp-none">この条件の行はありません。</td></tr>`}</tbody></table></div>`);
    }

    // ===== ✓ =====
    // ===== まとめて✓（Shift＋クリック：範囲／Ctrl＋クリック：選んでCtrlを離したとき） =====
    let anchorId = null;          // 最後に押した行（Shift の範囲の起点）
    const ctrlPick = new Set();   // Ctrl＋クリックで選んだ行の id
    const pickWillCheck = () => [...ctrlPick].some(id => { const r = items.find(x => x.id === id); return r && !r.checked_on; });
    let bulkBusy = false;
    // 行をまとめて✓あり／なしにする（状態が変わる行だけ1回で保存。付けた人はDB側で自動で入る）
    async function setChecks(ids, on) {
        const targets = ids.map(id => items.find(x => x.id === id)).filter(r => r && !!r.checked_on !== on);
        if (!targets.length || bulkBusy) return;
        bulkBusy = true;
        const { data, error } = await db().from('gaichu_supply_items').update({ checked_on: on ? todayStr() : null }).in('id', targets.map(r => r.id)).select('*');
        // ✓を付けた行の「訂正」「追加」の印を消す
        if (!error && on && hasSyncCols) {
            const flagged = targets.filter(r => r.change_flag === '訂正' || r.change_flag === '追加').map(r => r.id);
            if (flagged.length) {
                const r2 = await db().from('gaichu_supply_items').update({ change_flag: null, prev: null }).in('id', flagged).select('*');
                if (!r2.error) (r2.data || []).forEach(d => { const x = (data || []).find(y => y.id === d.id); if (x) Object.assign(x, d); });
            }
        }
        bulkBusy = false;
        if (error || !data || !data.length) { alert('保存できませんでした：' + ((error && error.message) || '編集の権限がないか、ログインが切れています')); return; }
        data.forEach(d => { const r = items.find(x => x.id === d.id); if (r) Object.assign(r, d); });
        render();
    }
    // 表示している行の並び（絞り込み・並べ替えの後）
    function shownIds() {
        const sheet = GS.state.currentSheet;
        return sheet ? applyView(sheetItems(sheet.id, kind), kind).map(r => r.id) : [];
    }
    function onCheckClick(id, e) {
        if (e.ctrlKey || e.metaKey) {
            if (ctrlPick.has(id)) ctrlPick.delete(id); else ctrlPick.add(id);
            render();
            return;
        }
        if (e.shiftKey && anchorId != null) {
            const list = shownIds(), a = list.indexOf(anchorId), b = list.indexOf(id);
            const anchor = items.find(x => x.id === anchorId);
            if (a >= 0 && b >= 0 && anchor) {
                const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
                setChecks(range, !!anchor.checked_on);   // 起点の行と同じ状態にそろえる
                return;
            }
        }
        anchorId = id;
        toggleCheck(id);
    }
    // Ctrl を離したら、選んだ行をまとめて✓（1つでも✓なしがあれば付ける、全部✓済みなら外す）
    window.addEventListener('keyup', e => {
        if ((e.key === 'Control' || e.key === 'Meta') && ctrlPick.size) {
            const ids = [...ctrlPick], on = pickWillCheck();
            ctrlPick.clear();
            anchorId = ids[ids.length - 1];
            setChecks(ids, on);
            render();
        }
    });
    window.addEventListener('blur', () => { if (ctrlPick.size) { ctrlPick.clear(); render(); } });   // 別の画面に移ったら選択をやめる
    // Shift＋クリックで文字が選択されないようにする
    root.addEventListener('mousedown', e => { if (e.shiftKey && e.target.closest('[data-sp-check]')) e.preventDefault(); });

    // 変更の印（訂正は前の値も出す）
    function flagCell(r) {
        const f = r.change_flag;
        if (!f) return '<td class="sp-flag-col"></td>';
        const prev = r.prev && typeof r.prev === 'object' ? Object.entries(r.prev).map(([k, o]) => `${FIELD_LABEL[k] || k} ${o == null || o === '' ? '（空）' : (typeof o === 'number' ? num(o) : o)}→${r[k] == null || r[k] === '' ? '（空）' : (typeof r[k] === 'number' ? num(r[k]) : r[k])}`).join('、') : '';
        const cls = f === '訂正' ? 'fix' : f === '追加' ? 'add' : 'del';
        const tip = f === '訂正' ? `訂正図面で変わりました：${prev}。確かめて✓を付けると印が消えます`
            : f === '追加' ? 'Excel を読み直したときに増えた部品です。確かめて✓を付けると印が消えます'
            : 'Excel を読み直したときになくなった部品です（線で消した表示で残しています）';
        return `<td class="sp-flag-col"><span class="sp-flag sp-flag--${cls}" title="${esc(tip)}">${f}</span>${prev ? `<small class="sp-flag-prev">${esc(prev)}</small>` : ''}</td>`;
    }
    // ✓を付けたら「訂正」「追加」の印を消す（確かめたことになるため）
    const clearFlagPatch = r => (hasSyncCols && r && (r.change_flag === '訂正' || r.change_flag === '追加') ? { change_flag: null, prev: null } : {});

    async function toggleCheck(id) {
        const r = items.find(x => x.id === id);
        if (!r) return;
        // 確認なしですぐ付け外しする（間違えたらもう一度押せば戻る）。保存中に同じ行を押しても重ねて保存しない
        if (r._busy) return;
        r._busy = true;
        const value = r.checked_on ? null : todayStr();
        const { data, error } = await db().from('gaichu_supply_items').update({ checked_on: value, ...(value ? clearFlagPatch(r) : {}) }).eq('id', id).select('*');
        r._busy = false;
        if (error || !data || !data.length) { alert('保存できませんでした：' + ((error && error.message) || '編集の権限がないか、ログインが切れています')); return; }
        Object.assign(r, data[0]);
        render();
    }

    // ===== 読み込む（OneDrive のチェック表だけ） =====
    const ADM = () => window.GaichuAdmin;
    function openImport() {
        const sheet = GS.state.currentSheet;
        const m = ADM().modal(`支給品を OneDrive から読み込む（${sheet.display}）`, `
            <div data-im-pane="od">
                <p class="ga-note" style="margin:0 0 10px">OneDrive の「${OD_FOLDER}」フォルダーにある、工番 ${esc(GS.state.pn)} のチェック表（Excel）を、<b>${esc(sheet.display)}</b> のリストに読み込みます。読み直したときは、前の内容と比べて「訂正」「追加」「削除」の印を付けます（付けた✓や支給日はそのまま残ります）。</p>
                <button type="button" class="ga-btn" data-od-show>OneDrive のファイルを表示</button>
                <div class="sp-od-list" data-od-list></div>
                <p class="sp-busy" data-od-status></p>
            </div>`, [
            { label: 'キャンセル', ghost: true, onClick: () => m.close() },
            { label: '読み込む', primary: true, onClick: () => runOd(m) },
        ], 'ga-modal--add');
        // Microsoft のサインインの仕組みを先に読み込んでおく（ボタンを押したときにサインインの画面を開けるように）。サインイン済みならすぐ一覧を出す
        loadMsal().then(inst => { if (inst.getAllAccounts().length) openOdPane(m); }).catch(() => {});
        m.el.addEventListener('click', e => {
            if (e.target.closest('[data-od-show]')) openOdPane(m);
            if (e.target.closest('[data-od-url-save]')) saveFolderAndRetry(m);
        });
    }

    // ===== OneDrive（森村さんの「ユニット外注」フォルダー）のチェック表（Excel）を読み込む =====
    //   ・サインインとファイルの読み取りは、3Dモデルアプリと同じ Microsoft のアプリの登録（Files.Read.All・委任）を使う
    //   ・「ユニット外注」フォルダーの中の、工番で始まるフォルダー（例：2820RV）にある「…支給チェック表.xlsx」を一覧に出す
    //   ・Excel はブラウザの中だけで読む（社外には送らない）。加工品・購入品のシートの表を、貼り付けと同じしくみで行にする
    //   ・読み直したときは、同じファイルから読んだ行と比べて反映する（変わらない行はそのまま、変わった行は「訂正」、
    //     増えた行は「追加」、なくなった行は「削除」の印。✓を付けると「訂正」「追加」の印は消える）
    const MSAL_CONFIG = {
        auth: {
            clientId: 'a947a172-1208-4f57-8960-1a1956240adb',
            authority: 'https://login.microsoftonline.com/b825147d-5f85-4b12-bda8-8e3108196121',
            redirectUri: new URL('msal-redirect.html', location.href).href,   // ポップアップの戻り先（何も表示しないページ）
        },
        cache: { cacheLocation: 'localStorage' },
    };
    const GRAPH_SCOPES = ['Files.Read.All'];
    const OD_FOLDER = 'ユニット外注';   // 共有されているチェック表のフォルダー
    let msalReady = null;
    function loadMsal() {
        if (!msalReady) msalReady = import('https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.30.0/+esm').then(async m => {
            const inst = new m.PublicClientApplication(MSAL_CONFIG);
            await inst.initialize();
            return inst;
        });
        return msalReady;
    }
    async function graphToken() {
        const inst = await loadMsal();
        let acc = inst.getActiveAccount() || inst.getAllAccounts()[0];
        if (!acc) { const r = await inst.loginPopup({ scopes: GRAPH_SCOPES, prompt: 'select_account' }); acc = r.account; }
        inst.setActiveAccount(acc);
        try { return (await inst.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: acc })).accessToken; }
        catch (e) { return (await inst.acquireTokenPopup({ scopes: GRAPH_SCOPES, account: acc })).accessToken; }
    }
    async function graph(path, { raw } = {}) {
        const token = await graphToken();
        const res = await fetch(path.startsWith('http') ? path : 'https://graph.microsoft.com/v1.0' + path, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) { const e = new Error(`OneDrive の読み取りに失敗しました（${res.status}）`); e.status = res.status; throw e; }
        return raw ? res.arrayBuffer() : res.json();
    }
    // 「ユニット外注」フォルダーを探す：登録したフォルダーのリンク → 共有されたアイテム →（自分の OneDrive にある場合）デスクトップの下
    //   フォルダーのリンクは外注先用シートの設定（gaichu_settings の key=supply_onedrive_folder, value={url}）に1つだけ持つ（全工番共通）
    let odRoot = null;
    const SETTING_KEY = 'supply_onedrive_folder';
    async function savedFolderUrl() {
        const { data } = await db().from('gaichu_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
        return data && data.value && data.value.url ? data.value.url : '';
    }
    async function saveFolderUrl(url) {
        const { data: { session } } = await db().auth.getSession();
        const { error } = await db().from('gaichu_settings').upsert({ key: SETTING_KEY, value: { url }, updated_at: new Date().toISOString(), updated_by: session && session.user.email }, { onConflict: 'key' });
        if (error) throw new Error('フォルダーのリンクを保存できませんでした：' + error.message);
    }
    // ブラウザのアドレス（…/my?id=/personal/…/Documents/…）は、そのフォルダーの直接のURLに直す
    function normalizeFolderUrl(raw) {
        const u = new URL(String(raw).trim());
        const id = u.searchParams.get('id');
        if (id && id.startsWith('/')) return u.origin + id;
        return u.href;
    }
    async function resolveFolderUrl(raw) {
        const url = normalizeFolderUrl(raw);
        // 1) 共有リンク・直接のURL（Graph の shares）
        const enc = 'u!' + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
        try {
            const it = await graph(`/shares/${enc}/driveItem`);
            if (it && it.id && it.folder) return { driveId: it.parentReference.driveId, id: it.id };
        } catch (e) { /* 次の方法へ */ }
        // 2) 個人の OneDrive の直接のURL（https://…-my.sharepoint.com/personal/ユーザー/Documents/フォルダー）
        const m = decodeURIComponent(new URL(url).pathname).match(/^\/personal\/([^/]+)\/Documents\/(.+?)\/?$/);
        if (m) {
            const drive = await graph(`/sites/${new URL(url).host}:/personal/${m[1]}:/drive`);
            const it = await graph(`/drives/${drive.id}/root:/${m[2].split('/').map(encodeURIComponent).join('/')}`);
            if (it && it.id) return { driveId: drive.id, id: it.id };
        }
        throw new Error('登録したリンクからフォルダーを開けませんでした。OneDrive でフォルダーの「リンクをコピー」で作ったリンクを貼り付けてください。');
    }
    async function findOdRoot() {
        if (odRoot) return odRoot;
        const saved = await savedFolderUrl().catch(() => '');
        if (saved) { odRoot = await resolveFolderUrl(saved); return odRoot; }
        const shared = await graph('/me/drive/sharedWithMe?$top=500').catch(() => ({ value: [] }));
        const hit = (shared.value || []).find(x => x.name === OD_FOLDER && (x.folder || (x.remoteItem && x.remoteItem.folder)));
        if (hit) {
            const ri = hit.remoteItem || hit;
            odRoot = { driveId: ri.parentReference.driveId, id: ri.id };
            return odRoot;
        }
        // 「デスクトップ」ごと共有されているとき
        const desk = (shared.value || []).find(x => /^(デスクトップ|Desktop)$/i.test(x.name) && (x.folder || (x.remoteItem && x.remoteItem.folder)));
        if (desk) {
            const ri = desk.remoteItem || desk;
            const kids = await graph(`/drives/${ri.parentReference.driveId}/items/${ri.id}/children?$top=500`);
            const f = (kids.value || []).find(x => x.name === OD_FOLDER && x.folder);
            if (f) { odRoot = { driveId: ri.parentReference.driveId, id: f.id }; return odRoot; }
        }
        // 自分の OneDrive（森村さん本人）
        for (const p of ['デスクトップ', 'Desktop']) {
            try {
                const it = await graph(`/me/drive/root:/${encodeURIComponent(p)}/${encodeURIComponent(OD_FOLDER)}`);
                if (it && it.id) { odRoot = { driveId: it.parentReference.driveId, id: it.id }; return odRoot; }
            } catch (e) { /* 次の候補へ */ }
        }
        const names = (shared.value || []).filter(x => x.folder || (x.remoteItem && x.remoteItem.folder)).map(x => x.name).slice(0, 15);
        const err = new Error(`OneDrive の「${OD_FOLDER}」フォルダーが見つかりませんでした。下にフォルダーのリンクを貼り付けて登録してください。`
            + (names.length ? `（共有されているフォルダー：${names.join('、')}）` : ''));
        err.needUrl = true;
        throw err;
    }
    // 工番で始まるフォルダー（と「ユニット外注」の直下）にある Excel の一覧
    async function listOdFiles(pn) {
        const root = await findOdRoot();
        const kids = (await graph(`/drives/${root.driveId}/items/${root.id}/children?$top=500`)).value || [];
        const isXlsx = x => x.file && /\.xlsx$/i.test(x.name) && !x.name.startsWith('~$');
        const files = kids.filter(x => isXlsx(x) && x.name.startsWith(pn)).map(x => ({ ...x, folder: '' }));
        for (const f of kids.filter(x => x.folder && x.name.startsWith(pn))) {
            const sub = (await graph(`/drives/${root.driveId}/items/${f.id}/children?$top=500`)).value || [];
            sub.filter(isXlsx).forEach(x => files.push({ ...x, folder: f.name }));
        }
        return files.map(x => ({ id: x.id, driveId: (x.parentReference && x.parentReference.driveId) || root.driveId, name: x.name, folder: x.folder, modified: x.lastModifiedDateTime }))
            .sort((a, b) => a.folder.localeCompare(b.folder, 'ja') || a.name.localeCompare(b.name, 'ja', { numeric: true }));
    }

    // ---- Excel（.xlsx）をブラウザの中で読む（zip を開いて、シートの表を文字の2次元配列にする） ----
    async function unzip(buf) {
        const dv = new DataView(buf), u8 = new Uint8Array(buf);
        let eocd = -1;
        for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('Excel ファイルを開けませんでした（.xlsx ではないか、壊れています）');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const files = {};
        const dec = new TextDecoder();
        for (let n = 0; n < count; n++) {
            const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
            const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
            const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
            files[name] = { method, csize, off };
            p += 46 + nlen + elen + clen;
        }
        return async name => {
            const f = files[name];
            if (!f) return null;
            const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
            const data = u8.subarray(start, start + f.csize);
            if (f.method === 0) return dec.decode(data);
            const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return await new Response(ds).text();
        };
    }
    async function readXlsx(buf) {
        const get = await unzip(buf);
        const parse = s => new DOMParser().parseFromString(s || '', 'application/xml');
        const wb = parse(await get('xl/workbook.xml'));
        const rels = parse(await get('xl/_rels/workbook.xml.rels'));
        const relMap = {};
        [...rels.getElementsByTagName('Relationship')].forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
        const ssDoc = parse(await get('xl/sharedStrings.xml'));
        // 文字（ふりがな＝rPh の中の文字は除く）
        const textOf = el => [...el.getElementsByTagName('t')].filter(t => !(t.parentNode && t.parentNode.nodeName === 'rPh')).map(t => t.textContent).join('');
        const ss = [...ssDoc.getElementsByTagName('si')].map(textOf);
        const sheets = [];
        for (const s of wb.getElementsByTagName('sheet')) {
            const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
            let target = relMap[rid] || '';
            target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
            const doc = parse(await get(target));
            const grid = [];
            for (const row of doc.getElementsByTagName('row')) {
                const ri = Number(row.getAttribute('r')) - 1;
                for (const c of row.getElementsByTagName('c')) {
                    const ref = c.getAttribute('r') || '';
                    const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
                    const t = c.getAttribute('t');
                    const vEl = c.getElementsByTagName('v')[0];
                    let v = vEl ? vEl.textContent : '';
                    if (t === 's') v = ss[Number(v)] || '';
                    else if (t === 'inlineStr') v = textOf(c);
                    if (v === '') continue;
                    (grid[ri] = grid[ri] || [])[col] = v;
                }
            }
            sheets.push({ name: s.getAttribute('name'), grid });
        }
        return sheets;
    }
    // チェック表の Excel → { machined: [...], purchased: [...] }（シート名に「加工」「購入」が入っているシートを読む）
    function rowsFromWorkbook(sheets) {
        const out = { machined: [], purchased: [] };
        sheets.forEach(sh => {
            const kindOf = /加工/.test(sh.name) ? 'machined' : /購入/.test(sh.name) ? 'purchased' : null;
            if (!kindOf) return;
            const text = sh.grid.map(r => (r || []).map(v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
            try { out[kindOf] = parseTable(text).rows; } catch (e) { /* 見出しのないシートは飛ばす */ }
        });
        return out;
    }

    // ---- 読み直したときの比べ方 ----
    const CMP_FIELDS = ['name', 'drawing_no', 'spec', 'material', 'qty', 'maker', 'plan_code', 'weight_material', 'weight_finished', 'seq', 'remark', 'doc_no'];
    const CHANGE_FIELDS = ['name', 'drawing_no', 'spec', 'material', 'qty', 'maker'];   // 変わったら「訂正」にして✓を外す項目（数量・型番など）
    const FIELD_LABEL = { name: '品名', drawing_no: '図面番号', spec: '寸法・型式', material: '材質', qty: '数量', maker: 'メーカー' };
    const norm = v => String(v == null ? '' : v).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    const sameVal = (a, b) => norm(a) === norm(b);
    const syncKey = (k, r) => [k, norm(r.unit_code), k === 'machined' ? norm(r.drawing_no || r.name) : norm(r.name) + '|' + norm(r.spec)].join('#');
    let hasSyncCols = true;   // scripts/gaichu_supply_sync_setup.sql を実行済みか
    // 1つのファイルを、選んでいる外注先のリストに反映する。戻り値：{ added, changed, removed, same, first }
    async function syncFile(file, parsed) {
        const st = GS.state, sheet = st.currentSheet;
        const res = { added: 0, changed: 0, removed: 0, same: 0, first: false };
        const fromFile = items.filter(r => r.sheet_id === sheet.id && r.source_file === file.id);
        res.first = fromFile.length === 0;
        // 貼り付けで作った行（読み込み元が空）も、同じ部品なら引き継ぐ
        const pool = items.filter(r => r.sheet_id === sheet.id && (r.source_file === file.id || !r.source_file));
        const byKey = new Map();
        pool.forEach(r => { const k = syncKey(r.kind, r); if (!byKey.has(k)) byKey.set(k, r); });
        const matched = new Set();
        const inserts = [], updates = [];
        let order = sheetItems(sheet.id).reduce((mx, r) => Math.max(mx, r.sort_order || 0), -1) + 1;
        for (const kind of ['machined', 'purchased']) {
            for (const r of parsed[kind]) {
                const rec = {
                    unit_code: r.unit_code || null, doc_no: r.doc_no || null, seq: r.seq == null ? null : r.seq, drawing_no: r.drawing_no || null,
                    name: String(r.name).trim(), material: r.material || null, spec: r.spec || null, qty: r.qty == null ? null : r.qty,
                    weight_material: r.weight_material == null ? null : r.weight_material, weight_finished: r.weight_finished == null ? null : r.weight_finished,
                    plan_code: r.plan_code || null, maker: r.maker || null, remark: r.remark || null,
                };
                const old = byKey.get(syncKey(kind, rec));
                if (old && !matched.has(old)) {
                    matched.add(old);
                    const diff = CMP_FIELDS.filter(f => !sameVal(old[f], rec[f]));
                    const bigDiff = CHANGE_FIELDS.filter(f => diff.includes(f));
                    const patch = { ...rec, source_file: file.id };
                    if (bigDiff.length) {
                        patch.change_flag = '訂正';
                        patch.prev = Object.fromEntries(bigDiff.map(f => [f, old[f] == null ? null : old[f]]));
                        patch.checked_on = null;
                        res.changed++;
                    } else {
                        if (old.change_flag === '削除') { patch.change_flag = null; patch.prev = null; }   // いったん消えた部品が戻ってきた
                        if (!diff.length && old.source_file === file.id && old.change_flag !== '削除') { res.same++; continue; }
                        res.same++;
                    }
                    updates.push({ id: old.id, patch });
                } else {
                    inserts.push({ ...rec, sheet_id: sheet.id, project_number: st.pn, kind, sort_order: order++, source_file: file.id, change_flag: res.first ? null : '追加' });
                    if (!res.first) res.added++;
                }
            }
        }
        // ファイルからなくなった部品（このファイルから読んだ行だけが対象）
        fromFile.filter(r => !matched.has(r) && r.change_flag !== '削除').forEach(r => { updates.push({ id: r.id, patch: { change_flag: '削除' } }); res.removed++; });
        for (const u of updates) {
            const { data, error } = await db().from('gaichu_supply_items').update(u.patch).eq('id', u.id).select('id');
            if (error) throw error;
            if (!data || !data.length) throw new Error('保存できませんでした（編集の権限がないか、ログインが切れています）');
        }
        if (inserts.length) {
            const { error } = await db().from('gaichu_supply_items').insert(inserts);
            if (error) throw error;
        }
        if (res.first) res.added = inserts.length;
        await db().from('gaichu_supply_docs').insert({ sheet_id: sheet.id, project_number: st.pn, doc_no: null, file_name: (file.folder ? file.folder + '/' : '') + file.name, file_path: file.id, rows_added: inserts.length, source_modified: file.modified || null });
        return res;
    }
    // 読み込んだファイルの記録（どの外注先に・いつ読み込んだか）
    async function loadDocs() {
        const { data } = await db().from('gaichu_supply_docs').select('*').eq('project_number', GS.state.pn).order('uploaded_at', { ascending: false });
        return data || [];
    }
    async function openOdPane(m) {
        const pane = m.el.querySelector('[data-im-pane="od"]');
        const list = pane.querySelector('[data-od-list]');
        if (!hasSyncCols) { list.innerHTML = '<p class="sp-warn">先に Supabase で scripts/gaichu_supply_sync_setup.sql を実行してください。</p>'; return; }
        list.innerHTML = '<p class="sp-busy">OneDrive のファイルを探しています…</p>';
        try {
            const [files, docs] = await Promise.all([listOdFiles(GS.state.pn), loadDocs()]);
            if (!files.length) { list.innerHTML = `<p class="ga-note">「${OD_FOLDER}」フォルダーに、工番 ${esc(GS.state.pn)} で始まるフォルダー・Excel が見つかりませんでした。</p>`; return; }
            const sheet = GS.state.currentSheet;
            const sheetName = id => { const s = GS.state.sheets.find(x => x.id === id); return s ? s.short : '（削除済みの外注先）'; };
            list.innerHTML = `<table class="sp-od"><thead><tr><th></th><th>ファイル</th><th>OneDrive の更新</th><th>読み込み</th></tr></thead><tbody>${files.map(f => {
                const last = docs.find(d => d.file_path === f.id);
                const mine = last && last.sheet_id === sheet.id;
                const updated = last && f.modified && (!last.source_modified || new Date(f.modified) > new Date(last.source_modified));
                const state = !last ? '<span class="sp-od-new">未読み込み</span>'
                    : `${esc(sheetName(last.sheet_id))} に ${ymdJa(String(last.uploaded_at).slice(0, 10))}${updated ? ' <span class="sp-od-upd">更新あり</span>' : ''}`;
                return `<tr${last && !mine ? ' class="is-other"' : ''}><td><input type="checkbox" data-od-file="${esc(f.id)}"${(!last || (mine && updated)) && !(last && !mine) ? ' checked' : ''}></td>
                    <td><b>${esc(f.name)}</b>${f.folder ? `<small>${esc(f.folder)}</small>` : ''}</td><td>${f.modified ? ymdJa(f.modified.slice(0, 10)) : ''}</td><td>${state}</td></tr>`;
            }).join('')}</tbody></table>`;
            pane._files = files;
        } catch (e) {
            list.innerHTML = `<p class="sp-warn">${esc(e.message || String(e))}</p>`
                + (/popup|interaction|redirect|AADSTS/i.test(String(e.message || e)) ? '<p class="ga-note">Microsoft のサインインの画面が開かなかったか、戻り先の設定がまだの可能性があります。もう一度「OneDrive のファイルを表示」を押してください。</p>' : '')
                + (e.needUrl || /登録したリンク/.test(String(e.message)) ? folderUrlForm() : '');
        }
    }
    // フォルダーのリンクの登録（見つからなかったとき・リンクから開けなかったとき）
    function folderUrlForm() {
        return `<div class="sp-od-url">
            <p class="ga-note" style="margin:0 0 6px">OneDrive（ブラウザ）で「${OD_FOLDER}」フォルダーを開き、フォルダーの「…」→「リンクをコピー」で作ったリンク（または、そのフォルダーを開いたときのアドレスバーのURL）を貼り付けてください。一度登録すれば、次からはこのフォルダーを読みます。</p>
            <div class="sp-od-url-row"><input type="url" data-od-url placeholder="https://kemcojp-my.sharepoint.com/..."><button type="button" class="ga-btn ga-btn--primary" data-od-url-save>登録して探す</button></div></div>`;
    }
    async function saveFolderAndRetry(m) {
        const inp = m.el.querySelector('[data-od-url]');
        const raw = inp && inp.value.trim();
        if (!raw) { m.err('フォルダーのリンクを貼り付けてください。'); return; }
        try {
            const root = await resolveFolderUrl(raw);   // 開けることを確かめてから保存する
            await saveFolderUrl(raw);
            odRoot = root;
            m.err('');
            openOdPane(m);
        } catch (e) { m.err(e.message || String(e)); }
    }
    async function runOd(m) {
        const pane = m.el.querySelector('[data-im-pane="od"]');
        const files = (pane._files || []).filter(f => pane.querySelector(`[data-od-file="${CSS.escape(f.id)}"]`)?.checked);
        if (!files.length) { m.err('読み込むファイルにチェックを入れてください。'); return; }
        const btns = [...m.el.querySelectorAll('.ga-foot .ga-btn')];
        btns.forEach(b => { b.disabled = true; });
        m.err('');
        const status = pane.querySelector('[data-od-status]');
        const results = [];
        try {
            for (const f of files) {
                status.textContent = `${f.name} を読み込んでいます…`;
                const buf = await graph(`/drives/${f.driveId}/items/${f.id}/content`, { raw: true });
                const parsed = rowsFromWorkbook(await readXlsx(buf));
                if (!parsed.machined.length && !parsed.purchased.length) { results.push(`${f.name}：加工品・購入品の表が見つかりませんでした`); continue; }
                const r = await syncFile(f, parsed);
                await load(true);   // 次のファイルと比べるときに最新の行を使う
                results.push(r.first ? `${f.name}：${r.added} 行を作成` : `${f.name}：追加 ${r.added}・訂正 ${r.changed}・削除 ${r.removed}・変わらず ${r.same}`);
            }
            m.close();
            alert('読み込みました。\n\n' + results.join('\n') + '\n\n「訂正」「追加」「削除」の印が付いた行を確かめてください。');
        } catch (e) {
            btns.forEach(b => { b.disabled = false; });
            status.textContent = '';
            m.err((results.length ? results.join(' ／ ') + ' ／ ' : '') + (e.message || String(e)));
            load(true);
        }
    }

    // 見出しの名前 → 項目（Excelのチェック表の見出しに合わせる）
    const HEADS = [
        [/^(図面(番号|№|no\.?)|図面番号・品番|drawing)/i, 'drawing_no'], [/^(品名|description)/i, 'name'], [/^(材質|mat)/i, 'material'],
        [/^(品番・規格|寸法・型式|寸法|型式|規格|dimension)/i, 'spec'], [/^(数量|個数|qty)/i, 'qty'], [/^素材重量|^素材/, 'weight_material'],
        [/^仕上重量|^仕上/, 'weight_finished'], [/^(工程計画|plan ?code)/i, 'plan_code'], [/^(メーカー|maker)/i, 'maker'],
        [/^(備考|comment|remark)/i, 'remark'], [/^(通番|no\.?$)/i, 'seq'], [/^(ユニット|機械)$/, 'unit_code'], [/^(企画表|部品表|資料|doc)/i, 'doc_no'],
    ];
    function parseTable(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const split = l => (l.includes('\t') ? l.split('\t') : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map(c => c.replace(/^"|"$/g, '').trim());
        const hi = lines.findIndex(l => split(l).some(c => /^(品名|description)/i.test(c)));
        if (hi < 0) throw new Error('表の見出しの行（「品名」の入った行）が見つかりません。見出しの行ごとコピーして貼り付けてください。');
        const head = split(lines[hi]).map(c => { const h = HEADS.find(([re]) => re.test(c.replace(/\s/g, ''))); return h ? h[1] : null; });
        const rows = lines.slice(hi + 1).map(split).map(cells => {
            const r = {};
            head.forEach((k, i) => { if (k && r[k] == null && cells[i] != null && cells[i] !== '') r[k] = cells[i]; });
            return r;
        }).filter(r => r.name);
        const num = v => (v == null ? null : (Number.isNaN(Number(String(v).replace(/[^\d.\-]/g, ''))) || String(v).replace(/[^\d.\-]/g, '') === '' ? null : Number(String(v).replace(/[^\d.\-]/g, ''))));
        const machined = head.includes('drawing_no') || head.includes('material');
        const units = [...new Set(rows.map(r => r.unit_code).filter(Boolean))];
        const docs = [...new Set(rows.map(r => r.doc_no).filter(Boolean))];
        return {
            doc_type: machined ? 'machined' : head.includes('spec') || head.includes('maker') ? 'purchased' : 'unknown',
            project_number: null, unit_code: units.length === 1 ? units[0] : null, doc_no: docs.length === 1 ? docs[0] : null, note: null,
            rows: rows.map(r => ({
                seq: num(r.seq), drawing_no: r.drawing_no || null, name: r.name, material: r.material || null, spec: r.spec || null, qty: num(r.qty),
                weight_material: num(r.weight_material), weight_finished: num(r.weight_finished), plan_code: r.plan_code || null, schedule_note: null,
                maker: r.maker || null, remark: r.remark || null, unit_code: r.unit_code || null, doc_no: r.doc_no || null,
            })),
        };
    }
    // ===== 操作 =====
    if (bar) bar.addEventListener('click', e => {
        const kb = e.target.closest('[data-sp-kind]');
        if (kb) {
            closePop();
            selected.clear();
            kind = kb.dataset.spKind; render(); return;
        }
        const b = e.target.closest('[data-sp]');
        if (!b) return;
        const act = b.dataset.sp;
        if (act === 'clearview') { views[kind].filters = {}; views[kind].sort = null; render(); }
        else if (act === 'import') openImport();
    });
    // ===== 見出しのメニュー（並べ替え・値で絞り込み） =====
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function openPop(btn) {
        closePop();
        const sheet = GS.state.currentSheet;
        const key = btn.dataset.spCol, col = viewCols(kind).find(c => c[0] === key);
        if (!sheet || !col) return;
        const v = views[kind], type = col[2];
        // 値の一覧：ほかの列の絞り込みをかけた行から（Excelと同じ）
        const others = { ...v.filters }; delete others[key];
        const base = sheetItems(sheet.id, kind).filter(r => viewCols(kind).every(([k2, , t2]) => !others[k2] || others[k2].has(dispOf(r, k2, t2))));
        const counts = new Map();
        base.forEach(r => { const d = dispOf(r, key, type); counts.set(d, (counts.get(d) || 0) + 1); });
        const special = new Set([BLANK, NOT_YET, UNCHECKED, '（なし）']);
        const raw = new Map(base.map(r => [dispOf(r, key, type), r[key]]));
        const values = [...counts.keys()].sort((a, b) => (special.has(a) - special.has(b)) || cmpVal(raw.get(a), raw.get(b), type));
        const cur = v.filters[key];
        pop = document.createElement('div');
        pop.className = 'sp-pop';
        pop.innerHTML = `
            <button type="button" class="sp-pop-sort${v.sort && v.sort.key === key && v.sort.dir === 'asc' ? ' is-on' : ''}" data-pop-sort="asc">▲ 昇順</button>
            <button type="button" class="sp-pop-sort${v.sort && v.sort.key === key && v.sort.dir === 'desc' ? ' is-on' : ''}" data-pop-sort="desc">▼ 降順</button>
            <div class="sp-pop-sep"></div>
            <input type="search" class="sp-pop-q" placeholder="検索" data-pop-q>
            <div class="sp-pop-list">
                <label class="sp-pop-all"><input type="checkbox" data-pop-all><span>（すべて選択）</span></label>
                ${values.map(d => `<label data-pop-item="${esc(d)}"><input type="checkbox" value="${esc(d)}"${!cur || cur.has(d) ? ' checked' : ''}><span>${esc(d)}</span><small>${counts.get(d)}</small></label>`).join('')}
            </div>
            <div class="sp-pop-foot">
                <span class="spec-spacer"></span>
                <button type="button" class="spec-btn" data-pop="cancel">キャンセル</button>
                <button type="button" class="spec-btn spec-btn--primary" data-pop="ok">OK</button>
            </div>`;
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
        // いつも見出しの下に開く。画面の下に入りきらないときは、値の一覧を短くする
        pop.style.top = (r.bottom + 4) + 'px';
        const over = r.bottom + 4 + h - (window.innerHeight - 8);
        if (over > 0) { const list = pop.querySelector('.sp-pop-list'); list.style.maxHeight = Math.max(80, list.offsetHeight - over) + 'px'; }
        const boxes = () => [...pop.querySelectorAll('.sp-pop-list label[data-pop-item]:not([hidden]) input')];
        const all = pop.querySelector('[data-pop-all]');
        const syncAll = () => { const b = boxes(), n = b.filter(x => x.checked).length; all.checked = b.length > 0 && n === b.length; all.indeterminate = n > 0 && n < b.length; };
        syncAll();
        pop.addEventListener('change', e => {
            if (e.target === all) boxes().forEach(x => { x.checked = all.checked; });
            syncAll();
        });
        pop.querySelector('[data-pop-q]').addEventListener('input', e => {
            const q = e.target.value.trim().toLowerCase();
            pop.querySelectorAll('[data-pop-item]').forEach(l => { l.hidden = !!q && !l.dataset.popItem.toLowerCase().includes(q); });
            syncAll();
        });
        pop.addEventListener('click', e => {
            const s = e.target.closest('[data-pop-sort]');
            // 並べ替え：選んでいる方をもう一度押すと解除
            if (s) { v.sort = v.sort && v.sort.key === key && v.sort.dir === s.dataset.popSort ? null : { key, dir: s.dataset.popSort }; closePop(); render(); return; }
            const b = e.target.closest('[data-pop]');
            if (!b) return;
            if (b.dataset.pop === 'cancel') { closePop(); return; }
            if (b.dataset.pop === 'ok') {
                // 検索で隠れている値は選ばない（Excelと同じ）。全部選んだときは絞り込みなし
                const picked = [...pop.querySelectorAll('.sp-pop-list label[data-pop-item]')].filter(l => !l.hidden && l.querySelector('input').checked).map(l => l.dataset.popItem);
                if (!picked.length) { alert('表示する値を1つ以上選んでください。'); return; }
                if (picked.length === values.length) delete v.filters[key]; else v.filters[key] = new Set(picked);
                closePop(); render();
            }
        });
        pop.querySelector('[data-pop-q]').focus();
    }
    document.addEventListener('mousedown', e => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-sp-col]')) closePop(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { e.stopPropagation(); closePop(); } }, true);
    root.addEventListener('scroll', closePop, true);
    // ===== 行の選択と一括入力（いつも使える。入力はすぐ保存） =====
    // 支給日をまとめて保存する（ids の行に value。空なら消す）
    async function saveDates(ids, value) {
        if (!ids.length || !hasSupplyDate) return;
        const { data, error } = await db().from('gaichu_supply_items').update({ supply_date: value || null }).in('id', ids).select('*');
        if (error || !data || !data.length) { alert('保存できませんでした：' + ((error && error.message) || '編集の権限がないか、ログインが切れています')); render(); return; }
        data.forEach(d => { const r = items.find(x => x.id === d.id); if (r) Object.assign(r, d); });
        render();
    }
    root.addEventListener('change', e => {
        const one = e.target.closest('[data-sp-date]');
        if (one) { saveDates([Number(one.dataset.spDate)], one.value); return; }
        // 一括の支給日：日付を選んだらすぐ、クリアしたらすぐ、選んだ行（表示中）に反映
        const bd = e.target.closest('[data-sp-bulkdate]');
        if (bd) { bulkDate = bd.value; saveDates(shownIds().filter(id => selected.has(id)), bd.value); return; }
        const all = e.target.closest('[data-sp-selall]');
        if (all) { shownIds().forEach(id => { if (all.checked) selected.add(id); else selected.delete(id); }); render(); }
    });
    // 選んだ行をまとめて消す（確認してから）
    async function deleteRows(ids) {
        if (!ids.length) return;
        const fromExcel = ids.map(id => items.find(x => x.id === id)).filter(r => r && r.source_file && r.change_flag !== '削除').length;
        if (!confirm(`選んだ ${ids.length} 行を削除します。元に戻せません。`
            + (fromExcel ? `\n\nOneDrive の Excel に残っている部品（${fromExcel} 行）は、次に読み込んだときに「追加」として戻ります。不要な部品は Excel からも消してください。` : '')
            + '\n\n削除しますか？')) return;
        const { data, error } = await db().from('gaichu_supply_items').delete().in('id', ids).select('id');
        if (error || !data || !data.length) { alert('削除できませんでした：' + ((error && error.message) || '編集の権限がないか、ログインが切れています')); return; }
        const gone = new Set(data.map(d => d.id));
        items = items.filter(r => !gone.has(r.id));
        gone.forEach(id => selected.delete(id));
        render();
    }
    // 選択の欄：Shift＋クリックで、起点の行からの範囲をまとめて同じ状態にする
    let selAnchorId = null;
    function clickSel(box, e) {
        const id = Number(box.dataset.spSel), list = shownIds();
        const a = selAnchorId != null ? list.indexOf(selAnchorId) : -1, b = list.indexOf(id);
        const on = box.checked;
        const range = e.shiftKey && a >= 0 && b >= 0 ? list.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
        range.forEach(x => { if (on) selected.add(x); else selected.delete(x); });
        selAnchorId = id;
        render();
    }
    root.addEventListener('click', e => {
        const bk = e.target.closest('[data-sp-bulk]');
        if (bk) {
            const ids = shownIds().filter(id => selected.has(id));
            if (bk.dataset.spBulk === 'clearsel') { selected.clear(); render(); return; }
            if (bk.dataset.spBulk === 'delete') { deleteRows(ids); return; }
            // ✓：1つでも✓なしがあれば全部に付ける、全部✓済みなら全部外す
            const rowsSel = ids.map(id => items.find(x => x.id === id)).filter(Boolean);
            if (rowsSel.length) setChecks(ids, !rowsSel.every(r => r.checked_on));
            return;
        }
        const sb = e.target.closest('[data-sp-sel]');
        if (sb) { clickSel(sb, e); return; }
        const th = e.target.closest('[data-sp-col]');
        if (th) { if (pop && pop.dataset.col === th.dataset.spCol) closePop(); else { openPop(th); if (pop) pop.dataset.col = th.dataset.spCol; } return; }
        const c = e.target.closest('[data-sp-check]');
        if (c) { onCheckClick(Number(c.dataset.spCheck), e); return; }
    });
    document.addEventListener('gaichusheetchange', () => { if (GS.state.ready && loadedPn !== GS.state.pn) load(); else render(); });

    // 動作確認用（Excel の読み取りだけを外から試せるようにする）
    window.GaichuSupplyTest = { readXlsx, rowsFromWorkbook };
    // gaichu-sheet.js の読み込みが終わるのを待つ
    (function wait() {
        if (GS.state.ready) { if (GS.state.loggedIn) load(); else render(); return; }
        render();
        setTimeout(wait, 300);
    })();
})();

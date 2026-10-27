// 外注先用シート：支給品チェックリスト（管理者だけが使う機能。左下の管理者メニューから開く。外注先ごと・加工品／購入品）
//   ・表示だけ。OneDrive の「ユニット外注」フォルダーのチェック表（Excel）を、開くたびに読み込んで表示する（保存はしない）
//   ・✓・支給日を含め、直すのはすべて Excel。Excel を保存してからこのページを開き直す（または「最新を読む」）と反映される
//   ・Excel のファイルと外注先は、ファイル名（工番＋機械記号_外注先の略称_部品リスト支給チェック表.xlsx）の外注先の名前で結び付ける
//   ・PlanCode が S2 の部品は外注先が手配する（支給しない）。灰色の行で出し、チェックの数には入れない
//   ・並び順：加工品は 企画表（C01, C02…）→ 図面№、購入品は 機械 → 通番（見出しのメニューで変えられる）
// 読み込み前に gaichu-sheet.js を読み込み、ページに #supplyRoot・#supplyBar を置いておくこと。
(function () {
    const root = document.getElementById('supplyRoot');
    const bar = document.getElementById('supplyBar');
    const GS = window.GaichuSheet;
    if (!root || !GS) return;
    const db = () => GS.client;

    const KINDS = [['machined', '加工品', '工事企画表'], ['purchased', '購入品', '購入部品表']];
    // 表の列 [key, 見出し, 種類]。Excel のチェック表と同じ並び・見出し
    const COLS = {
        machined: [['unit_code', '機械', 'unit'], ['drawing_no', '図面№', 'text'], ['seq', '通番', 'int'], ['name', '品名', 'text'],
            ['material', '材質', 'text'], ['qty', '数量', 'num'], ['weight_material', '素材重量', 'num'], ['weight_finished', '仕上重量', 'num'], ['plan_code', 'PlanCode', 'text'],
            ['checked', '✓', 'check'], ['supply_date', '支給日', 'date'], ['remark', 'Comment', 'text'], ['doc_no', '企画表', 'doc']],
        purchased: [['unit_code', '機械', 'unit'], ['seq', '通番', 'int'], ['name', '品名', 'text'], ['spec', '品番・規格', 'text'],
            ['qty', '数量', 'num'], ['maker', 'Maker', 'text'], ['checked', '✓', 'check'], ['supply_date', '支給日', 'date'], ['remark', 'Comment', 'text']],
    };
    // 機械の列：先頭に工番が付いていたら外す（2820 の Excel は「2820RVCD」、今後は「RVCD」）
    const unitLabel = v => { const s = String(v || ''), pn = String(GS.state.pn || ''); return pn && s.startsWith(pn) && s.length > pn.length ? s.slice(pn.length) : s; };
    const isS2 = r => r.kind === 'machined' && String(r.plan_code || '').normalize('NFKC').trim().toUpperCase() === 'S2';

    // 読み込んだ内容（工番ごと。ページを開き直すと読み直す）
    //   files：[{ name, folder, modified, sheetId, error }]、rows：[{ ...行, kind, sheetId, file }]
    let data = null, dataPn = null, loading = false, loadError = null, needSignIn = false, loadedAt = null;
    let kind = 'machined';
    // Excelのような列ごとの絞り込み・並べ替え（加工品・購入品ごとに持つ。外注先を切り替えたら解除）
    //   filters[key] = 表示する値の Set（値は画面に出す文字。空欄は「（空白）」、支給日の空欄は「（未入力）」）
    const views = { machined: { filters: {}, sort: null }, purchased: { filters: {}, sort: null } };
    let viewSheetId = null;
    const BLANK = '（空白）', NOT_YET = '（未入力）', CHECKED = '✓ チェック済み', UNCHECKED = '未チェック', OUTSIDE = '外注先手配（S2）';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const md = s => { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${m}/${d}`; };
    const ymdJa = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${y}/${m}/${d}`; };
    const hm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const num = v => (v == null || v === '' ? '' : String(Number(v)));
    // 支給日：Excel の日付（1900年からの日数）は yyyy-mm-dd に、文字（「11/6」など）はそのまま
    function supplyDate(v) {
        if (v == null || String(v).trim() === '') return null;
        const s = String(v).trim();
        if (/^\d+(\.\d+)?$/.test(s)) {
            const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
            return d.toISOString().slice(0, 10);
        }
        return s;
    }
    const dateText = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? md(v) : String(v || ''));
    const viewCols = k => COLS[k];
    function dispOf(r, key, type) {
        const v = r[key];
        if (type === 'check') return isS2(r) ? OUTSIDE : v ? CHECKED : UNCHECKED;
        if (type === 'unit') return unitLabel(v) || BLANK;
        if (type === 'date') return v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? ymdJa(v) : String(v)) : NOT_YET;
        if (v == null || String(v).trim() === '') return BLANK;
        return type === 'num' || type === 'int' ? num(v) : String(v);
    }
    function cmpVal(a, b, type) {
        const blankA = a == null || a === '', blankB = b == null || b === '';
        if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;   // 空欄はいつも最後
        if (type === 'num' || type === 'int') return Number(a) - Number(b);
        if (type === 'check') return (a ? 1 : 0) - (b ? 1 : 0);
        return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
    }
    // 並べ替えを選んでいないときの順：加工品は 企画表（ユニット・C番号）→ 図面№、購入品は 機械 → 通番
    const defaultCmp = k => (a, b) => (k === 'machined'
        ? cmpVal(a.doc_no || unitLabel(a.unit_code), b.doc_no || unitLabel(b.unit_code), 'text') || cmpVal(a.drawing_no, b.drawing_no, 'text')
        : cmpVal(unitLabel(a.unit_code), unitLabel(b.unit_code), 'text') || cmpVal(a.seq, b.seq, 'int'))
        || a.order - b.order;
    function applyView(rows, k) {
        const v = views[k], cols = viewCols(k);
        let out = rows.filter(r => cols.every(([key, , type]) => !v.filters[key] || v.filters[key].has(dispOf(r, key, type))));
        out.sort(defaultCmp(k));
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
    const sheetItems = (sheetId, k) => (data ? data.rows : []).filter(r => r.sheetId === sheetId && (!k || r.kind === k));
    // チェックの進み具合（S2 は数えない）
    const progress = list => { const t = list.filter(r => !isS2(r)); return { done: t.filter(r => r.checked).length, total: t.length }; };

    // ===== ファイル → 外注先 =====
    //   ファイル名「…_大洋金属_部品リスト支給チェック表.xlsx」の外注先の名前と、外注先の正式名・略称を比べる（株式会社・殿などはそろえる）
    const placeKey = s => String(s || '').normalize('NFKC').replace(/殿|様|株式会社|有限会社|\(株\)|\(有\)|\s/g, '');
    function sheetForFile(fileName) {
        const parts = fileName.replace(/\.xlsx$/i, '').split(/[_＿]/).map(placeKey).filter(Boolean);
        const hit = GS.state.sheets.filter(s => [s.name, s.display, s.short].some(n => {
            const nk = placeKey(n);
            return nk && parts.some(p => p === nk || p.includes(nk) || nk.includes(p));
        }));
        if (hit.length === 1) return hit[0].id;
        return GS.state.sheets.length === 1 ? GS.state.sheets[0].id : null;   // 外注先が1社だけならその外注先
    }

    // ===== 読み込み（OneDrive の Excel を全部読む） =====
    async function load(interactive) {
        const st = GS.state;
        if (!st.ready || !st.loggedIn || !st.isAdmin || !st.pn) { render(); return; }
        if (loading) return;
        loading = true; loadError = null; needSignIn = false;
        render();
        try {
            if (!interactive && !(await signedIn())) { needSignIn = true; return; }
            if (interactive) await graphToken();   // サインインの画面は、ボタンを押してすぐに開く（あとで開くとブラウザに止められることがある）
            const files = await listOdFiles(st.pn);
            setData(await Promise.all(files.map(async f => {
                try { return { ...f, buf: await graph(`/drives/${f.driveId}/items/${f.id}/content`, { raw: true }) }; }
                catch (e) { return { ...f, error: e.message || String(e) }; }
            })));
        } catch (e) {
            loadError = e;
            if (/interaction|login_required|consent|AADSTS/i.test(String(e.message || e))) needSignIn = true;
        } finally {
            loading = false;
            render();
        }
    }
    // 読んだファイル（[{ name, folder, modified, buf, error }]）から表示する行を作る
    async function setData(files) {
        const rows = [], list = [];
        let order = 0;
        for (const f of files) {
            const info = { name: f.name, folder: f.folder, modified: f.modified, sheetId: sheetForFile(f.name), error: f.error || null };
            list.push(info);
            if (!f.buf) continue;
            try {
                const parsed = rowsFromWorkbook(await readXlsx(f.buf));
                if (!parsed.machined.length && !parsed.purchased.length) info.error = '加工品・購入品の表が見つかりませんでした';
                for (const k of ['machined', 'purchased']) parsed[k].forEach(r => rows.push({ ...r, supply_date: supplyDate(r.supply_date), kind: k, sheetId: info.sheetId, file: f.name, order: order++ }));
            } catch (e) { info.error = e.message || String(e); }
        }
        data = { files: list, rows };
        dataPn = GS.state.pn;
        loadedAt = new Date().toISOString();
    }
    // サインイン済みで、画面を出さずに OneDrive を読めるか（ページを開いたときに自動で読むのはこのときだけ）
    async function signedIn() {
        try {
            const inst = await loadMsal();
            const acc = inst.getActiveAccount() || inst.getAllAccounts()[0];
            if (!acc) return false;
            await inst.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: acc });
            return true;
        } catch (e) { return false; }
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
        if (!st.loggedIn) { setBar(''); root.innerHTML = '<p class="spec-msg">支給品チェックリストは、社内のアカウントでログインすると表示されます。</p>'; return; }
        if (!st.isAdmin) { setBar(''); root.innerHTML = '<p class="spec-msg">支給品チェックリストは管理者だけが使える機能です。</p>'; return; }
        if (!st.sheets.length) { setBar(''); root.innerHTML = '<p class="spec-msg">この工事には外注先が登録されていません。</p>'; return; }
        const sheet = st.currentSheet;
        const tabs = st.sheets.map(s => `<button type="button" class="vendor-switch-btn${sheet && sheet.id === s.id ? ' active' : ''}" data-v="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.short)}</button>`).join('');
        const reload = `<span class="spec-spacer"></span>${loadedAt && !loading ? `<span class="sp-loaded">${hm(loadedAt)} に読み込み</span>` : ''}<button type="button" class="spec-btn" data-sp="reload"${loading ? ' disabled' : ''} title="OneDrive の Excel をもう一度読みます">最新を読む</button>`;
        if (loading && !data) { setBar(`<div class="spec-tabs">${tabs}${reload}</div>`); root.innerHTML = '<p class="spec-msg">OneDrive のチェック表（Excel）を読んでいます…</p>'; return; }
        if (needSignIn) {
            setBar(`<div class="spec-tabs">${tabs}</div>`);
            root.innerHTML = `<p class="spec-msg">チェック表は OneDrive の Excel から読みます。最初の1回だけ Microsoft のサインインが必要です。</p>
                <p style="text-align:center"><button type="button" class="spec-btn spec-btn--primary" data-sp="signin">Microsoft にサインインして表示</button></p>`;
            return;
        }
        if (loadError) {
            setBar(`<div class="spec-tabs">${tabs}${reload}</div>`);
            root.innerHTML = `<p class="sp-warn">${esc(loadError.message || String(loadError))}</p>${loadError.needUrl || /登録したリンク/.test(String(loadError.message)) ? folderUrlForm() : ''}`;
            return;
        }
        if (!data || dataPn !== st.pn) { setBar(`<div class="spec-tabs">${tabs}${reload}</div>`); root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!sheet) {
            setBar(`<div class="spec-tabs">${tabs}${reload}</div>`);
            root.innerHTML = '<p class="spec-msg">支給品チェックリストは外注先ごとに表示します。上のボタンから外注先を選んでください。</p>' + filesNote(null);
            return;
        }

        if (viewSheetId !== sheet.id) { viewSheetId = sheet.id; Object.values(views).forEach(v => { v.filters = {}; v.sort = null; }); }
        const rows = sheetItems(sheet.id, kind);
        const shown = applyView(rows, kind);
        const kindBtns = KINDS.map(([k, label]) => {
            const p = progress(sheetItems(sheet.id, k));
            return `<button type="button" data-sp-kind="${k}"${k === kind ? ' class="is-on"' : ''}>${label}<small>${p.total ? `${p.done}/${p.total}` : '0'}</small></button>`;
        }).join('');
        const filterSel = !viewActive(kind) ? '' : `<span class="sp-view-note">${shown.length} / ${rows.length} 行を表示</span><button type="button" class="spec-btn" data-sp="clearview">絞り込み・並べ替えを解除</button>`;
        setBar(`<div class="spec-tabs">${tabs}<span class="sp-sep"></span><span class="sp-kinds">${kindBtns}</span>${filterSel}${reload}</div>`);

        const cols = COLS[kind];
        const p = progress(rows);
        const s2 = rows.filter(isS2).length;
        const v = views[kind];
        const th = ([key, label, type]) => {
            const cls = type === 'check' ? ' class="sp-chk-col"' : '';
            const on = !!v.filters[key], s = v.sort && v.sort.key === key ? v.sort.dir : '';
            return `<th${cls}><button type="button" class="sp-th${on || s ? ' is-on' : ''}" data-sp-col="${key}" title="絞り込み・並べ替え">${label}<i>${s === 'asc' ? '▲' : '▼'}</i></button></th>`;
        };
        const cellOf = (r, [k, , t]) => {
            const val = r[k];
            if (t === 'check') return isS2(r) ? '<td class="sp-chk-col"><span class="sp-s2-tag" title="外注先が手配する部品（支給しない）">外注手配</span></td>'
                : `<td class="sp-chk-col">${val ? '<span class="sp-chk is-on">✓</span>' : '<span class="sp-chk"></span>'}</td>`;
            if (t === 'date') return `<td class="sp-date">${esc(dateText(val))}</td>`;
            if (t === 'unit') return `<td>${esc(unitLabel(val))}</td>`;
            if (t === 'doc') return `<td class="sp-doc">${esc(val || '')}</td>`;
            if (t === 'num' || t === 'int') return `<td class="sp-num">${esc(num(val))}</td>`;
            return `<td${k === 'name' ? ' class="sp-name"' : ''}>${esc(val || '')}</td>`;
        };
        const body = shown.map(r => `<tr class="${isS2(r) ? 'is-s2' : r.checked ? 'is-done' : ''}">${cols.map(c => cellOf(r, c)).join('')}</tr>`).join('');
        const kindLabel = KINDS.find(x => x[0] === kind);
        const empty = !rows.length ? `<p class="spec-msg">${esc(kindLabel[1])}の行はありません。OneDrive の「${OD_FOLDER}」＞工番のフォルダー＞「${LIST_FOLDER}」にチェック表（Excel）を置いてください。</p>` : '';
        root.innerHTML = ''
            + (rows.length ? `<div class="sp-bulk"><span class="sp-hint">表示だけです。✓・支給日などは OneDrive の Excel で入力し、保存してからこのページを開き直してください。${s2 ? `　<span class="sp-s2-key"></span>灰色の行（${s2} 行）は PlanCode が S2 の外注先手配の部品で、支給しません。` : ''}</span>
                <span class="sp-prog">チェック済み <b>${p.done}</b> ／ ${p.total}</span></div>` : '')
            + (empty || `<div class="sp-table-wrap"><table class="sp-table"><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="sp-none">この条件の行はありません。</td></tr>`}</tbody></table></div>`)
            + filesNote(sheet.id);
        fitTable();
    }
    // 読み込んだファイルの一覧（どの外注先に当てたか・読めなかったファイル）
    function filesNote(sheetId) {
        if (!data) return '';
        const list = data.files.filter(f => sheetId == null || f.sheetId === sheetId || f.sheetId == null || f.error);
        if (!data.files.length) return `<p class="ga-note">「${OD_FOLDER}」フォルダーの中の、工番 ${esc(GS.state.pn)} で始まるフォルダーに、「${LIST_FOLDER}」フォルダーの Excel が見つかりませんでした。</p>`;
        const name = id => { const s = GS.state.sheets.find(x => x.id === id); return s ? s.short : ''; };
        return `<div class="sp-files">読み込んだファイル：${list.map(f => `<span${f.error || f.sheetId == null ? ' class="is-warn"' : ''}>${esc(f.name)}`
            + `${f.modified ? `（${hm(f.modified)} 更新）` : ''}`
            + `${f.error ? ` … ${esc(f.error)}` : f.sheetId == null ? ' … どの外注先のファイルか分かりません（ファイル名に外注先の名前を入れてください）' : sheetId == null ? ` → ${esc(name(f.sheetId))}` : ''}</span>`).join('')}</div>`;
    }
    // 表は中でスクロールさせ、上の操作の行・見出しは止めておく（表の高さを画面の下までにする）
    function fitTable() {
        const wrap = root.querySelector('.sp-table-wrap');
        if (!wrap) return;
        const panel = root.closest('.sub-panel');
        if (!panel || !panel.classList.contains('open')) return;   // 閉じているときは測れないので、開いたときに合わせる
        const top = wrap.getBoundingClientRect().top + (panel.scrollTop || 0);
        wrap.style.maxHeight = Math.max(240, window.innerHeight - top - 28) + 'px';
    }
    window.addEventListener('resize', fitTable);

    // ===== OneDrive（森村さんの「ユニット外注」フォルダー）のチェック表（Excel）を読む =====
    //   ・サインインとファイルの読み取りは、3Dモデルアプリと同じ Microsoft のアプリの登録（Files.Read.All・委任）を使う
    //   ・「ユニット外注」フォルダーの中の、工番で始まるフォルダー（例：2820RV、2816）の下の「支給品リスト」フォルダーの Excel を読む
    //   ・Excel はブラウザの中だけで読む（社外には送らない・保存もしない）
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
    // チェック表の置き場所：ユニット外注 ＞ 工番のフォルダー（例：2820RV、2816）＞（外注先ごとのフォルダー。なくてもよい）＞「支給品リスト」＞ Excel
    //   「支給品リスト」フォルダーの中の Excel だけを読む（名前は問わない）。工番のフォルダーの下は 3 段まで探す
    const LIST_FOLDER = '支給品リスト';
    async function listOdFiles(pn) {
        const root = await findOdRoot();
        const children = async id => (await graph(`/drives/${root.driveId}/items/${id}/children?$top=500`)).value || [];
        const isXlsx = x => x.file && /\.xlsx$/i.test(x.name) && !x.name.startsWith('~$');
        const kids = await children(root.id);
        const files = [];
        async function walk(folder, path, depth) {
            const sub = await children(folder.id);
            if (folder.name === LIST_FOLDER) sub.filter(isXlsx).forEach(x => files.push({ ...x, folder: path }));
            if (depth < 3) for (const f of sub.filter(x => x.folder)) await walk(f, path + '／' + f.name, depth + 1);
        }
        for (const f of kids.filter(x => x.folder && x.name.startsWith(pn))) await walk(f, f.name, 1);
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
        const ssXml = await get('xl/sharedStrings.xml');   // 文字を各マスに直接持つファイル（Excel 以外で作ったもの）にはない
        const ssDoc = ssXml ? parse(ssXml) : null;
        // 文字（ふりがな＝rPh の中の文字は除く）
        const textOf = el => [...el.getElementsByTagName('t')].filter(t => !(t.parentNode && t.parentNode.nodeName === 'rPh')).map(t => t.textContent).join('');
        const ss = ssDoc ? [...ssDoc.getElementsByTagName('si')].map(textOf) : [];
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

    // 見出しの名前 → 項目（Excelのチェック表の見出しに合わせる）
    const HEADS = [
        [/^(図面(番号|№|no\.?)|図面番号・品番|drawing)/i, 'drawing_no'], [/^(品名|description)/i, 'name'], [/^(材質|mat)/i, 'material'],
        [/^(品番・規格|寸法・型式|寸法|型式|規格|dimension)/i, 'spec'], [/^(数量|個数|qty)/i, 'qty'], [/^素材重量|^素材/, 'weight_material'],
        [/^仕上重量|^仕上/, 'weight_finished'], [/^(工程計画|plan ?code)/i, 'plan_code'], [/^(メーカー|maker)/i, 'maker'],
        [/^(備考|comment|remark)/i, 'remark'], [/^(✓|チェック)$/, 'checked'], [/^支給日/, 'supply_date'], [/^(通番|no\.?$)/i, 'seq'], [/^(ユニット|機械)$/, 'unit_code'], [/^(企画表|部品表|資料|doc)/i, 'doc_no'],
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
                checked: !!(r.checked && String(r.checked).trim()), supply_date: r.supply_date || null,
            })),
        };
    }
    // フォルダーのリンクの登録（「ユニット外注」フォルダーが見つからなかったとき・リンクから開けなかったとき）
    function folderUrlForm() {
        return `<div class="sp-od-url">
            <p class="ga-note" style="margin:0 0 6px">OneDrive（ブラウザ）で「${OD_FOLDER}」フォルダーを開き、フォルダーの「…」→「リンクをコピー」で作ったリンク（または、そのフォルダーを開いたときのアドレスバーのURL）を貼り付けてください。一度登録すれば、次からはこのフォルダーを読みます。</p>
            <div class="sp-od-url-row"><input type="url" data-od-url placeholder="https://kemcojp-my.sharepoint.com/..."><button type="button" class="ga-btn ga-btn--primary" data-od-url-save>登録して読む</button></div></div>`;
    }
    async function saveFolderAndRetry() {
        const inp = root.querySelector('[data-od-url]');
        const raw = inp && inp.value.trim();
        if (!raw) { alert('フォルダーのリンクを貼り付けてください。'); return; }
        try {
            const r = await resolveFolderUrl(raw);   // 開けることを確かめてから保存する
            await saveFolderUrl(raw);
            odRoot = r;
            load(true);
        } catch (e) { alert(e.message || String(e)); }
    }

    // ===== 操作 =====
    if (bar) bar.addEventListener('click', e => {
        const kb = e.target.closest('[data-sp-kind]');
        if (kb) { closePop(); kind = kb.dataset.spKind; render(); return; }
        const b = e.target.closest('[data-sp]');
        if (!b) return;
        if (b.dataset.sp === 'clearview') { views[kind].filters = {}; views[kind].sort = null; render(); }
        else if (b.dataset.sp === 'reload') load(true);
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
    root.addEventListener('click', e => {
        if (e.target.closest('[data-sp="signin"]')) { load(true); return; }   // サインインの画面はボタンを押したときだけ開ける
        if (e.target.closest('[data-od-url-save]')) { saveFolderAndRetry(); return; }
        const th = e.target.closest('[data-sp-col]');
        if (th) { if (pop && pop.dataset.col === th.dataset.spCol) closePop(); else { openPop(th); if (pop) pop.dataset.col = th.dataset.spCol; } }
    });
    // 外注先を切り替えたときは描き直すだけ（工番が変わったときは読み直す）
    document.addEventListener('gaichusheetchange', () => { if (GS.state.ready && dataPn !== GS.state.pn) load(); else render(); });

    // 動作確認用（Excel の読み取りだけを外から試せるようにする）
    //   GaichuSupplyTest.show([{ name, buf }]) で、手元の Excel を OneDrive から読んだときと同じように表示できる
    window.GaichuSupplyTest = { readXlsx, rowsFromWorkbook, sheetForFile, supplyDate, show: async files => { needSignIn = false; loadError = null; await setData(files); render(); } };
    // gaichu-sheet.js の読み込みが終わるのを待ってから、OneDrive の Excel を読む（ページを開くたびに最新を読む）
    (function wait() {
        if (GS.state.ready) { load(); return; }
        render();
        setTimeout(wait, 300);
    })();
})();

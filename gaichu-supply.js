// 外注先用シート：支給品チェックリスト（管理者だけが使う機能。左下の管理者メニューから開く。外注先ごと・加工品／購入品）
//   ・工事企画表（加工品）・購入部品表（購入品）は、デスクトップアプリなどのClaudeで読み取った結果（JSON）か、Excelの表を貼り付けて作る。
//     APIキー（有料）を登録していれば、PDFから自動で読み取ることもできる（Edge Function gaichu-supply-extract。PDFは図面と同じ保存場所に残す）
//     読み取った行は画面で確認・修正してから保存する（gaichu_supply_items・gaichu_supply_docs）
//   ・納品を受けたら行ごとに✓。✓を付けた日が支給日になり、支給日で絞り込める。✓を付けた人はDB側で自動で入る
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
    const BUCKET = 'gaichu-figures';

    const KINDS = [['machined', '加工品', '工事企画表'], ['purchased', '購入品', '購入部品表']];
    // 表の列 [key, 見出し, 入力の種類]（✓・支給日・ユニット・資料は全部の表に付ける）
    const COLS = {
        machined: [['drawing_no', '図面番号', 'text'], ['name', '品名', 'text'], ['material', '材質', 'text'], ['qty', '数量', 'num'],
            ['weight_material', '素材重量', 'num'], ['weight_finished', '仕上重量', 'num'], ['plan_code', '工程計画', 'text'], ['remark', '備考', 'text']],
        purchased: [['seq', '通番', 'int'], ['name', '品名', 'text'], ['spec', '寸法・型式', 'text'], ['qty', '数量', 'num'],
            ['maker', 'メーカー', 'text'], ['remark', '備考', 'text']],
    };
    const FIELDS = ['unit_code', 'doc_no', 'seq', 'drawing_no', 'name', 'material', 'spec', 'qty', 'weight_material', 'weight_finished', 'plan_code', 'maker', 'remark', 'checked_on'];

    let items = [];          // この工番の全外注先の行
    let loadedPn = null, loadError = null, loading = false;
    let kind = 'machined';
    let filter = 'all';      // all / none（未支給）/ YYYY-MM-DD（その日に支給）
    let editing = false, draft = null, removed = [];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const md = s => { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${m}/${d}`; };
    const ymdJa = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${y}/${m}/${d}`; };
    function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    const num = v => (v == null || v === '' ? '' : String(Number(v)));
    const notFoundTable = err => err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|Could not find the table/i.test(err.message || ''));

    // ===== 読み込み =====
    async function load(force) {
        const st = GS.state;
        if (!st.ready || !st.loggedIn || !st.pn) return;
        if (!force && loadedPn === st.pn) return;
        loading = true;
        const { data, error } = await db().from('gaichu_supply_items').select('*').eq('project_number', st.pn).order('sort_order').order('id');
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
        const last = s => { const ds = sheetItems(s.id).map(r => r.checked_on).filter(Boolean).sort(); return ds.length ? ymdJa(ds[ds.length - 1]) : '―'; };
        ovEl.innerHTML = `<table class="sp-ov"><thead><tr><th>外注先</th><th>加工品（支給済み／全数）</th><th>購入品（支給済み／全数）</th><th>最後の支給日</th></tr></thead><tbody>`
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

        const rows = (editing ? draft : sheetItems(sheet.id)).filter(r => r.kind === kind);
        const dates = [...new Set(sheetItems(sheet.id, kind).map(r => r.checked_on).filter(Boolean))].sort();
        if (filter !== 'all' && filter !== 'none' && !dates.includes(filter)) filter = 'all';
        const shown = editing ? rows : rows.filter(r => filter === 'all' || (filter === 'none' ? !r.checked_on : r.checked_on === filter));
        const kindBtns = KINDS.map(([k, label]) => {
            const p = progress(sheetItems(sheet.id, k));
            return `<button type="button" data-sp-kind="${k}"${k === kind ? ' class="is-on"' : ''}>${label}<small>${p.total ? `${p.done}/${p.total}` : '0'}</small></button>`;
        }).join('');
        const filterSel = editing ? '' : `<label class="sp-filter"><span>支給日</span><select data-sp-filter>
                <option value="all"${filter === 'all' ? ' selected' : ''}>すべて（${rows.length}）</option>
                <option value="none"${filter === 'none' ? ' selected' : ''}>未支給（${rows.filter(r => !r.checked_on).length}）</option>
                ${dates.map(d => `<option value="${d}"${filter === d ? ' selected' : ''}>${ymdJa(d)} に支給（${rows.filter(r => r.checked_on === d).length}）</option>`).join('')}
            </select></label>`;
        const tools = !st.isAdmin ? '' : editing
            ? `<span class="spec-spacer"></span><span class="scope-editing-tag">編集中</span><button type="button" class="spec-btn" data-sp="add">＋ 行を追加</button><button type="button" class="spec-btn" data-sp="cancel">キャンセル</button><button type="button" class="spec-btn spec-btn--primary" data-sp="save">保存</button>`
            : `<span class="spec-spacer"></span><button type="button" class="spec-btn spec-btn--primary" data-sp="import">読み込む</button><button type="button" class="spec-btn" data-sp="edit"${rows.length ? '' : ' disabled'}>編集</button>`;
        setBar(`<div class="spec-tabs">${tabs}<span class="sp-sep"></span><span class="sp-kinds">${kindBtns}</span>${filterSel}${tools}</div>`);

        const cols = COLS[kind];
        const p = progress(rows);
        const head = `<tr>${editing ? '<th class="sp-del-col"></th>' : ''}<th class="sp-chk-col">✓</th><th>支給日</th><th>ユニット</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>資料</th></tr>`;
        const cellView = (r, [k, , type]) => {
            const v = r[k];
            if (type === 'num' || type === 'int') return `<td class="sp-num">${esc(num(v))}</td>`;
            return `<td${k === 'name' ? ' class="sp-name"' : ''}>${esc(v || '')}</td>`;
        };
        const cellEdit = (r, i, [k, , type]) => `<td><input class="sp-in sp-in--${k}${type !== 'text' ? ' sp-in--num' : ''}" data-i="${i}" data-k="${k}" value="${esc(type === 'text' ? (r[k] || '') : num(r[k]))}"${type !== 'text' ? ' inputmode="decimal"' : ''}></td>`;
        const body = shown.map(r => {
            const i = editing ? draft.indexOf(r) : -1;
            const chk = editing
                ? `<td class="sp-chk-col"><span class="sp-chk${r.checked_on ? ' is-on' : ''}">${r.checked_on ? '✓' : ''}</span></td><td><input type="date" class="sp-in sp-in--date" data-i="${i}" data-k="checked_on" value="${esc(r.checked_on || '')}"></td>`
                : `<td class="sp-chk-col"><button type="button" class="sp-chk${r.checked_on ? ' is-on' : ''}" data-sp-check="${r.id}"${st.isAdmin ? '' : ' disabled'} title="${r.checked_on ? `${ymdJa(r.checked_on)} 支給${r.checked_by ? '（' + esc(r.checked_by) + '）' : ''}` : '納品を確認したら✓'}">${r.checked_on ? '✓' : ''}</button></td><td class="sp-date">${r.checked_on ? md(r.checked_on) : ''}</td>`;
            return `<tr class="${r.checked_on ? 'is-done' : ''}">${editing ? `<td class="sp-del-col"><button type="button" class="sp-del" data-sp-del="${i}" title="この行を削除">✕</button></td>` : ''}${chk}`
                + (editing ? `<td><input class="sp-in sp-in--unit" data-i="${i}" data-k="unit_code" value="${esc(r.unit_code || '')}"></td>` : `<td>${esc(r.unit_code || '')}</td>`)
                + cols.map(c => editing ? cellEdit(r, i, c) : cellView(r, c)).join('')
                + (editing ? `<td><input class="sp-in sp-in--doc" data-i="${i}" data-k="doc_no" value="${esc(r.doc_no || '')}"></td>` : `<td class="sp-doc">${esc(r.doc_no || '')}</td>`) + `</tr>`;
        }).join('');
        const kindLabel = KINDS.find(x => x[0] === kind);
        const empty = !rows.length
            ? `<p class="spec-msg">${esc(kindLabel[1])}の行はまだありません。${st.isAdmin ? `上の「読み込む」から、${esc(kindLabel[2])}をClaudeで読み取った結果やExcelの表を貼り付けると作成できます。` : ''}</p>` : '';
        root.innerHTML = `<div class="sp-summary"><b>${esc(sheet.display)}</b>　${esc(kindLabel[1])}（${esc(kindLabel[2])}から）`
            + (rows.length ? `<span class="sp-prog">支給済み <b>${p.done}</b> ／ ${p.total}</span>` : '') + `</div>`
            + (empty || `<div class="sp-table-wrap"><table class="sp-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length + 5}" class="sp-none">この条件の行はありません。</td></tr>`}</tbody></table></div>`);
    }

    // ===== ✓ =====
    async function toggleCheck(id) {
        const r = items.find(x => x.id === id);
        if (!r) return;
        if (r.checked_on && !confirm(`「${r.name}」の✓を外しますか？（${ymdJa(r.checked_on)} 支給の記録が消えます）`)) return;
        const value = r.checked_on ? null : todayStr();
        const { data, error } = await db().from('gaichu_supply_items').update({ checked_on: value }).eq('id', id).select('*');
        if (error || !data || !data.length) { alert('保存できませんでした：' + ((error && error.message) || '編集の権限がないか、ログインが切れています')); return; }
        Object.assign(r, data[0]);
        render();
    }

    // ===== 編集（行の修正・削除・追加） =====
    function startEdit() {
        const sheet = GS.state.currentSheet;
        draft = sheetItems(sheet.id).map(r => ({ ...r }));
        removed = [];
        editing = true;
        render();
    }
    function collect() {
        root.querySelectorAll('.sp-in[data-i]').forEach(inp => {
            const r = draft[Number(inp.dataset.i)];
            if (!r) return;
            const k = inp.dataset.k, v = inp.value.trim();
            const type = (COLS[r.kind].find(c => c[0] === k) || [])[2];
            r[k] = v === '' ? null : (type === 'num' ? Number(v.replace(/[^\d.\-]/g, '')) : type === 'int' ? parseInt(v, 10) : v);
            if ((type === 'num' || type === 'int') && Number.isNaN(r[k])) r[k] = null;
        });
    }
    async function saveEdit() {
        collect();
        const sheet = GS.state.currentSheet;
        const bad = draft.find(r => !String(r.name || '').trim());
        if (bad) { alert('品名が空の行があります。品名を入れるか、行を削除してください。'); return; }
        try {
            if (removed.length) {
                const { error } = await db().from('gaichu_supply_items').delete().in('id', removed);
                if (error) throw error;
            }
            const orig = new Map(sheetItems(sheet.id).map(r => [r.id, r]));
            for (const [i, r] of draft.entries()) {
                const rec = { sort_order: i };
                FIELDS.forEach(k => { rec[k] = r[k] == null ? null : r[k]; });
                if (r.id) {
                    const o = orig.get(r.id);
                    if (o && o.sort_order === i && FIELDS.every(k => (o[k] == null ? null : o[k]) == rec[k])) continue;   // 変わっていない行は書かない
                    const { data, error } = await db().from('gaichu_supply_items').update(rec).eq('id', r.id).select('id');
                    if (error) throw error;
                    if (!data || !data.length) throw new Error('編集の権限がないか、ログインが切れています');
                } else {
                    const { error } = await db().from('gaichu_supply_items').insert({ ...rec, sheet_id: sheet.id, project_number: GS.state.pn, kind: r.kind });
                    if (error) throw error;
                }
            }
        } catch (e) {
            alert('保存できませんでした：' + (e.message || e));
            return;
        }
        editing = false; draft = null; removed = [];
        await load(true);
    }

    // ===== 読み込む（貼り付け／PDFの自動読み取り） =====
    //   ふだんは「貼り付け」：デスクトップアプリなどのClaudeにPDFと依頼文を渡し、返ってきたJSONを貼り付ける（費用は今の契約の中）。
    //   Excelのチェック表や表計算からのコピー（見出し行つき）も貼り付けられる。
    //   「PDFから自動で読み取る」は Edge Function（gaichu-supply-extract）を使う。APIキー（有料）を登録したときだけ使える
    const ADM = () => window.GaichuAdmin;
    const CLAUDE_PROMPT = `添付のPDFは、日下部電機の「工事企画表（MANUFACTURING PARTS LIST）」または「購入部品表（COMMERCIAL PARTS LIST）」です。
外注先へ支給する部品のチェックリストを作るため、表の行を読み取り、次の形のJSONだけを \`\`\`json のコードブロックで出力してください（説明の文章は不要です）。

{
  "doc_type": "machined",        // 工事企画表なら "machined"（加工品）、購入部品表なら "purchased"（購入品）
  "project_number": "2820",      // 工事番号
  "unit_code": "RVOF2",          // ORDER No.（工事番号欄の下の段）
  "doc_no": "2820RVOF2-C03",     // 右下の Doc No.
  "rows": [
    { "seq": 1, "drawing_no": "AR1W102N01", "name": "レール", "material": "市販品", "spec": null, "qty": 2,
      "weight_material": null, "weight_finished": null, "plan_code": "A", "schedule_note": "完成品支給 10/30", "maker": null, "remark": "協伸電業" }
  ]
}

読み取りのきまり：
- 工事企画表（加工品）：図面番号・品番 → drawing_no、品名 → name、材質 → material、個数 → qty、単重量（kg）の素材 → weight_material・仕上 → weight_finished（全重量ではない）、工程計画の先頭の記号（A、A1 など）→ plan_code、工程計画の残りの文字 → schedule_note、備考 → remark、表の左の行番号 → seq。spec と maker は null。
- 購入部品表（購入品）：通番 → seq、品名 → name、寸法・型式 → spec、個数 → qty、メーカー → maker（メーカー欄の右の小さな記号「在」「イ」などは読まない）、備考 → remark。drawing_no・material・重量・plan_code・schedule_note は null。
- 部品図（図面）のページは読まない。同じ表が2回入っている（押印や手書きの書き込みがある写しなど）ときは1回分だけにする。
- 表に印字された文字だけを使い、手書きの書き込みや押印は読まない。読めない欄は null にし、推測で埋めない。数字は半角にする。
- 空の行は入れない。行は表の上から順にする。
- JSONの中に // のコメントは入れない。`;

    function openImport() {
        const sheet = GS.state.currentSheet;
        const m = ADM().modal(`支給品を読み込む（${sheet.display}）`, `
            <div class="sp-im-tabs"><button type="button" class="is-on" data-im="paste">貼り付けて読み込む</button><button type="button" data-im="auto">PDFから自動で読み取る</button></div>
            <div data-im-pane="paste">
                <ol class="sp-im-steps">
                    <li>下の「Claudeへの依頼文をコピー」を押します。</li>
                    <li>デスクトップアプリなどのClaudeに、工事企画表または購入部品表のPDFを添付し、コピーした依頼文を貼り付けて送ります。</li>
                    <li>返ってきたJSON（\`\`\`json で始まる部分）をコピーして、下の欄に貼り付け、「読み込む」を押します。</li>
                </ol>
                <p class="ga-note" style="margin:0 0 8px">Excelのチェック表や表計算の表を、見出しの行ごとコピーして貼り付けることもできます。</p>
                <div class="sp-im-copy"><button type="button" class="ga-btn" data-im-copy>Claudeへの依頼文をコピー</button><span data-im-copied></span></div>
                <label class="ga-field"><span>Claudeの結果、またはコピーした表</span><textarea class="sp-im-text" data-im-text rows="9" placeholder='{"doc_type": "machined", "rows": [ ... ] }'></textarea></label>
            </div>
            <div data-im-pane="auto" hidden>
                <p class="ga-note" style="margin:0 0 10px">PDFを選ぶと、AIが表を自動で読み取ります（30秒〜1分ほど）。<b>AnthropicのAPIキー（有料）を Supabase に登録しているときだけ使えます。</b>登録していないときは「貼り付けて読み込む」を使ってください。</p>
                <label class="ga-field"><span>PDFファイル</span><input type="file" accept="application/pdf,.pdf" data-sp-file></label>
            </div>`, [
            { label: 'キャンセル', ghost: true, onClick: () => m.close() },
            { label: '読み込む', primary: true, onClick: () => (m.el.querySelector('[data-im-pane="auto"]').hidden ? runPaste(m) : runExtract(m)) },
        ], 'ga-modal--add');
        m.el.addEventListener('click', async e => {
            const t = e.target.closest('[data-im]');
            if (t) {
                m.el.querySelectorAll('[data-im]').forEach(b => b.classList.toggle('is-on', b === t));
                m.el.querySelectorAll('[data-im-pane]').forEach(p => { p.hidden = p.dataset.imPane !== t.dataset.im; });
                m.err('');
                return;
            }
            if (e.target.closest('[data-im-copy]')) {
                const note = m.el.querySelector('[data-im-copied]');
                try { await navigator.clipboard.writeText(CLAUDE_PROMPT); note.textContent = 'コピーしました。Claudeに貼り付けてください。'; }
                catch (err) { note.textContent = 'コピーできませんでした。'; }
            }
        });
    }
    // 貼り付けた文字を読む：JSON（Claudeの結果）か、見出し行つきの表（タブ区切り。Excel・表計算からのコピー）
    function runPaste(m) {
        const text = m.el.querySelector('[data-im-text]').value.trim();
        if (!text) { m.err('Claudeの結果、またはコピーした表を貼り付けてください。'); return; }
        let result;
        try { result = parseJsonResult(text) || parseTable(text); }
        catch (e) { m.err(e.message || String(e)); return; }
        if (!result || !result.rows.length) { m.err('読み込める行が見つかりませんでした。Claudeの結果（JSON）か、見出しの行がついた表を貼り付けてください。'); return; }
        m.close();
        openPreview(result, { path: null, fileName: null });
    }
    function parseJsonResult(text) {
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        let body = (fence ? fence[1] : text).trim();
        if (!/^[\[{]/.test(body)) {
            const a = body.indexOf('{');
            if (a < 0) return null;
            body = body.slice(a, body.lastIndexOf('}') + 1);
        }
        let obj;
        try { obj = JSON.parse(body); }
        catch (e) {
            // // のコメントが入っていても読めるように外して、もう一度試す
            try { obj = JSON.parse(body.replace(/^\s*\/\/.*$/gm, '').replace(/([^:"'\\])\/\/[^"\n]*$/gm, '$1')); }
            catch (e2) { if (/^\s*[\[{]/.test(text)) throw new Error('JSONの形が正しくありません。Claudeの結果のコードブロックの中身をそのまま貼り付けてください。'); return null; }
        }
        if (Array.isArray(obj)) obj = { rows: obj };
        if (!obj || !Array.isArray(obj.rows)) return null;
        const n = v => (v == null || v === '' ? null : (Number.isNaN(Number(String(v).replace(/[^\d.\-]/g, ''))) ? null : Number(String(v).replace(/[^\d.\-]/g, ''))));
        const s = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
        return {
            doc_type: obj.doc_type === 'purchased' ? 'purchased' : obj.doc_type === 'machined' ? 'machined' : 'unknown',
            project_number: s(obj.project_number), unit_code: s(obj.unit_code), doc_no: s(obj.doc_no), note: s(obj.note),
            rows: obj.rows.filter(r => r && s(r.name)).map(r => ({
                seq: n(r.seq), drawing_no: s(r.drawing_no), name: s(r.name), material: s(r.material), spec: s(r.spec), qty: n(r.qty),
                weight_material: n(r.weight_material), weight_finished: n(r.weight_finished), plan_code: s(r.plan_code),
                schedule_note: s(r.schedule_note), maker: s(r.maker), remark: s(r.remark),
            })),
        };
    }
    // 見出しの名前 → 項目（Excelのチェック表・工事企画表・購入部品表の見出しに合わせる）
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
    async function runExtract(m) {
        const st = GS.state, sheet = st.currentSheet;
        const file = m.el.querySelector('[data-sp-file]').files[0];
        if (!file) { m.err('PDFファイルを選んでください。'); return; }
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { m.err('PDFファイルを選んでください。'); return; }
        if (file.size > 20 * 1024 * 1024) { m.err('PDFが大きすぎます（20MBまで）。'); return; }
        const btns = [...m.el.querySelectorAll('.ga-foot .ga-btn')];
        btns.forEach(b => { b.disabled = true; });
        m.err('');
        const status = document.createElement('p');
        status.className = 'sp-busy';
        status.textContent = 'PDFをアップロードしています…';
        m.el.querySelector('.ga-body').appendChild(status);
        try {
            const path = `${st.pn}/supply/${sheet.id}/${Date.now()}.pdf`;
            const up = await db().storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' });
            if (up.error) throw new Error('アップロードできませんでした：' + up.error.message);
            status.textContent = 'AIで表を読み取っています…（30秒〜1分ほどかかります）';
            const { data, error } = await db().functions.invoke('gaichu-supply-extract', { body: { path } });
            if (error) {
                let msg = error.message;
                try { const body = await error.context.json(); if (body && body.error) msg = body.error; } catch (e) { /* 本文が読めなければそのまま */ }
                throw new Error(msg);
            }
            if (!data || !data.result) throw new Error((data && data.error) || '読み取り結果がありませんでした');
            m.close();
            openPreview(data.result, { path, fileName: file.name });
        } catch (e) {
            status.remove();
            btns.forEach(b => { b.disabled = false; });
            m.err(e.message || String(e));
        }
    }
    // 同じ行がすでにあるか（加工品は図面番号、購入品は品名＋寸法・型式で比べる）
    const keyOf = (k, r) => String(k === 'machined' ? (r.drawing_no || r.name) : `${r.name}|${r.spec || ''}`).normalize('NFKC').replace(/\s/g, '').toUpperCase();
    function openPreview(result, { path, fileName }) {
        const st = GS.state, sheet = st.currentSheet;
        let k = result.doc_type === 'purchased' ? 'purchased' : 'machined';
        const rows = (result.rows || []).map(r => ({
            ...r,
            remark: [r.schedule_note, r.remark].filter(x => x && String(x).trim()).join('／') || null,
            include: true,
        }));
        const unitDefault = result.unit_code || '';
        const docDefault = result.doc_no || '';
        const m = ADM().modal(`読み取り結果を確認（${sheet.display}）`, `<div class="sp-pv"></div>`, [
            { label: 'キャンセル', ghost: true, onClick: () => { if (confirm('読み取った内容を保存せずに閉じますか？')) m.close(); } },
            { label: '保存', primary: true, onClick: () => savePreview() },
        ], 'ga-modal--add sp-modal');
        const box = m.el.querySelector('.sp-pv');
        function draw() {
            const existing = new Set(sheetItems(sheet.id, k).map(r => keyOf(k, r)));
            const cols = COLS[k];
            box.innerHTML = `
                ${result.doc_type === 'unknown' ? '<p class="sp-warn">工事企画表・購入部品表のどちらか判断できませんでした。種類を選んでください。</p>' : ''}
                ${result.project_number && String(result.project_number) !== String(st.pn) ? `<p class="sp-warn">PDFの工事番号（${esc(result.project_number)}）が、この工番（${esc(st.pn)}）と違います。PDFを確かめてください。</p>` : ''}
                <div class="sp-pv-head">
                    <label class="ga-field"><span>種類</span><select data-pv-kind>${KINDS.map(([kk, label, src]) => `<option value="${kk}"${kk === k ? ' selected' : ''}>${label}（${src}）</option>`).join('')}</select></label>
                    <label class="ga-field"><span>ユニット（ORDER No.）</span><input data-pv-unit value="${esc(unitDefault)}"></label>
                    <label class="ga-field"><span>資料の番号（Doc No.）</span><input data-pv-doc value="${esc(docDefault)}"></label>
                </div>
                <p class="ga-note" style="margin:4px 0 8px">読み取った ${rows.length} 行です。PDFと見比べて、違うところは直してください。チェックを外した行は保存しません。${result.note ? `<br>AIからのメモ：${esc(result.note)}` : ''}</p>
                <div class="sp-table-wrap"><table class="sp-table sp-table--pv"><thead><tr><th>保存</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>
                ${rows.map((r, i) => {
                    const dup = existing.has(keyOf(k, r));
                    return `<tr class="${r.include ? '' : 'is-off'}"><td class="sp-chk-col"><input type="checkbox" data-pv-inc="${i}"${r.include ? ' checked' : ''}></td>`
                        + cols.map(([kk, , type]) => `<td><input class="sp-in sp-in--${kk}${type !== 'text' ? ' sp-in--num' : ''}" data-pv-i="${i}" data-pv-k="${kk}" value="${esc(type === 'text' ? (r[kk] || '') : num(r[kk]))}"></td>`).join('')
                        + `<td>${dup ? '<span class="sp-dup" title="同じ行がすでに登録されています">登録済み</span>' : ''}</td></tr>`;
                }).join('')}
                </tbody></table></div>`;
        }
        function collectPv() {
            box.querySelectorAll('[data-pv-i]').forEach(inp => {
                const r = rows[Number(inp.dataset.pvI)], kk = inp.dataset.pvK, v = inp.value.trim();
                const type = (COLS[k].find(c => c[0] === kk) || [])[2];
                r[kk] = v === '' ? null : (type === 'num' ? Number(v.replace(/[^\d.\-]/g, '')) : type === 'int' ? parseInt(v, 10) : v);
                if ((type === 'num' || type === 'int') && Number.isNaN(r[kk])) r[kk] = null;
            });
        }
        // 最初に、すでに登録済みの行はチェックを外しておく（同じPDFを2回読み込んだときなど）
        (() => { const ex = new Set(sheetItems(sheet.id, k).map(r => keyOf(k, r))); rows.forEach(r => { if (ex.has(keyOf(k, r))) r.include = false; }); })();
        draw();
        box.addEventListener('change', e => {
            if (e.target.matches('[data-pv-kind]')) { collectPv(); k = e.target.value; draw(); return; }
            const inc = e.target.closest('[data-pv-inc]');
            if (inc) { rows[Number(inc.dataset.pvInc)].include = inc.checked; inc.closest('tr').classList.toggle('is-off', !inc.checked); }
        });
        async function savePreview() {
            collectPv();
            const unit = box.querySelector('[data-pv-unit]').value.trim() || null;
            const doc = box.querySelector('[data-pv-doc]').value.trim() || null;
            const pick = rows.filter(r => r.include);
            if (!pick.length) { m.err('保存する行がありません。'); return; }
            if (pick.some(r => !String(r.name || '').trim())) { m.err('品名が空の行があります。品名を入れるか、チェックを外してください。'); return; }
            const base = sheetItems(sheet.id).reduce((mx, r) => Math.max(mx, r.sort_order || 0), -1) + 1;
            const recs = pick.map((r, i) => ({
                sheet_id: sheet.id, project_number: st.pn, kind: k, unit_code: r.unit_code || unit, doc_no: r.doc_no || doc, sort_order: base + i,
                seq: r.seq == null ? null : r.seq, drawing_no: r.drawing_no || null, name: String(r.name).trim(),
                material: r.material || null, spec: r.spec || null, qty: r.qty == null ? null : r.qty,
                weight_material: r.weight_material == null ? null : r.weight_material, weight_finished: r.weight_finished == null ? null : r.weight_finished,
                plan_code: r.plan_code || null, maker: r.maker || null, remark: r.remark || null,
            }));
            m.el.querySelectorAll('.ga-foot .ga-btn').forEach(b => { b.disabled = true; });
            const { error } = await db().from('gaichu_supply_items').insert(recs);
            if (error) { m.el.querySelectorAll('.ga-foot .ga-btn').forEach(b => { b.disabled = false; }); m.err('保存できませんでした：' + error.message); return; }
            await db().from('gaichu_supply_docs').insert({ sheet_id: sheet.id, project_number: st.pn, kind: k, doc_no: doc, file_name: fileName || '（貼り付け）', file_path: path, rows_added: recs.length });
            m.close();
            kind = k; filter = 'all';
            await load(true);
        }
    }

    // ===== 操作 =====
    if (bar) bar.addEventListener('click', e => {
        const kb = e.target.closest('[data-sp-kind]');
        if (kb) {
            if (editing) collect();
            kind = kb.dataset.spKind; filter = 'all'; render(); return;
        }
        const b = e.target.closest('[data-sp]');
        if (!b) return;
        const act = b.dataset.sp;
        if (act === 'import') openImport();
        else if (act === 'edit') startEdit();
        else if (act === 'cancel') { editing = false; draft = null; removed = []; render(); }
        else if (act === 'save') saveEdit();
        else if (act === 'add') {
            collect();
            draft.push({ id: null, kind, sheet_id: GS.state.currentSheet.id, name: '', unit_code: (draft.filter(r => r.kind === kind).slice(-1)[0] || {}).unit_code || null });
            render();
            const ins = root.querySelectorAll(`.sp-in[data-k="name"]`);
            if (ins.length) ins[ins.length - 1].focus();
        }
    });
    if (bar) bar.addEventListener('change', e => {
        if (e.target.matches('[data-sp-filter]')) { filter = e.target.value; render(); }
    });
    root.addEventListener('click', e => {
        const c = e.target.closest('[data-sp-check]');
        if (c && !editing) { toggleCheck(Number(c.dataset.spCheck)); return; }
        const d = e.target.closest('[data-sp-del]');
        if (d && editing) {
            collect();
            const r = draft[Number(d.dataset.spDel)];
            if (r.id) removed.push(r.id);
            draft.splice(Number(d.dataset.spDel), 1);
            render();
        }
    });
    // 編集中に外注先を切り替えるときは、破棄の確認をする
    document.addEventListener('click', e => {
        const b = e.target.closest('.vendor-switch-btn');
        if (!b || !editing) return;
        if (!confirm('支給品チェックリストの編集内容を保存していません。破棄して外注先を切り替えますか？')) { e.stopImmediatePropagation(); return; }
        editing = false; draft = null; removed = [];
    }, true);
    document.addEventListener('gaichusheetchange', () => { if (GS.state.ready && loadedPn !== GS.state.pn) load(); else render(); });
    window.addEventListener('beforeunload', e => { if (editing) { e.preventDefault(); e.returnValue = ''; } });

    // gaichu-sheet.js の読み込みが終わるのを待つ
    (function wait() {
        if (GS.state.ready) { if (GS.state.loggedIn) load(); else render(); return; }
        render();
        setTimeout(wait, 300);
    })();
})();

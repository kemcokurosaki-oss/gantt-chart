// 外注先用シート：組立範囲（図面・色分け枠・担当範囲一覧）。工番ごとに1件（gaichu_scopes）
//   ・図面：3Dデータのスクリーンショットなどの画像。Storage（gaichu-figures・非公開）に保存し、表示は署名付きURL
//   ・色分け枠：図面ごとに担当先の枠（位置は画像に対する%）。拡大表示の画面で描く
//   ・担当範囲一覧：列は既定の7列＋工事ごとに追加できる列。担当の列は外注先（外注先マスタのID）と日下部電機（'kusakabe'）を複数選べる
//   ・外注先の切り替え（gaichu-sheet.js）で、その外注先が担当に入っている行と、その外注先・日下部電機の枠だけを表示する
//   編集は体制表の管理者のみ。「画像を編集」（図面・色分け枠）と「担当範囲一覧を編集」は別々に行い、それぞれ「保存」で保存する。
// 読み込み前に gaichu-sheet.js を読み込み、ページに #scopeRoot と拡大表示（#lightbox）を置いておくこと。
(function () {
    const root = document.getElementById('scopeRoot');
    const GS = window.GaichuSheet;
    if (!root || !GS) return;
    const client = GS.client;
    const BUCKET = 'gaichu-figures';
    const KUSAKABE = 'kusakabe';
    const DEFAULT_COLUMNS = [
        { key: 'machine', label: '機械', type: 'text', fixed: true },
        { key: 'unit', label: 'ユニット', type: 'text', fixed: true },
        { key: 'machine_name', label: '機械名', type: 'text', fixed: true },
        { key: 'assembly', label: '機械組立', type: 'party', fixed: true },
        { key: 'electrical', label: '電気艤装', type: 'party', fixed: true },
        { key: 'trial', label: '試運転', type: 'party', fixed: true },
        { key: 'trial_place', label: '試運転場所', type: 'text', fixed: true },
    ];

    let data = { figures: [], rows: [], columns: [] };   // 保存済みの内容
    let urls = {};                                       // Storage のパス → 表示用URL
    let loaded = false;
    let editing = null;                                  // 編集中の対象：null／'fig'（図面・色分け枠）／'table'（担当範囲一覧）
    let draft = null;                                    // 編集中の内容（保存するまでDBには書かない）
    let removedPaths = [];                               // 編集中に削除した図面（保存時に Storage からも消す）
    const ratioOf = {};                                  // 表示用URL → 画像の縦横比（横÷縦）。サムネイルの幅の配分に使う
    const THUMB_H = 400;                                 // サムネイルの行の高さの目安（px）。横長の3D図が広い画面で1行に2枚ほど並ぶ大きさ

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const clone = o => JSON.parse(JSON.stringify(o));
    const current = () => (editing ? draft : data);
    const columnsOf = d => (d.columns && d.columns.length ? d.columns : DEFAULT_COLUMNS);

    // ===== 担当先（外注先＋日下部電機） =====
    function parties() {
        return GS.state.sheets.map(s => ({ key: s.vendor_id, label: s.display, color: s.color }))
            .concat([{ key: KUSAKABE, label: GS.KUSAKABE.name, color: GS.KUSAKABE.color }]);
    }
    function partyInfo(key) {
        return parties().find(p => String(p.key) === String(key)) || { key, label: '（不明な担当）', color: '#95a5a6' };
    }
    const partyChip = key => { const p = partyInfo(key); return GS.chipHtml(p.label, p.color); };
    const vendorFilter = () => (GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null);
    function rowVisible(row, cols) {
        const vid = vendorFilter();
        return vid == null || cols.some(c => c.type === 'party' && (row[c.key] || []).some(k => String(k) === String(vid)));
    }
    function darken(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '#555';
        const n = parseInt(m[1], 16);
        const f = v => Math.round(v * 0.72).toString(16).padStart(2, '0');
        return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
    }

    // ===== 読込 =====
    async function signUrls(paths) {
        const need = paths.filter(p => p && !urls[p]);
        if (!need.length) return;
        const { data: list, error } = await client.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 12);
        if (error) { console.error('図面の表示用URLを作れませんでした', error); return; }
        (list || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    async function load() {
        const st = GS.state;
        if (!st.ready) return;
        if (!st.loggedIn) { loaded = true; render(); return; }
        const { data: rec, error } = await client.from('gaichu_scopes')
            .select('figures, rows, columns').eq('project_number', st.pn).maybeSingle();
        if (error) console.error('組立範囲の取得に失敗しました', error);
        data = {
            figures: (rec && Array.isArray(rec.figures)) ? rec.figures : [],
            rows: (rec && Array.isArray(rec.rows)) ? rec.rows : [],
            columns: (rec && Array.isArray(rec.columns)) ? rec.columns : [],
        };
        await signUrls(data.figures.map(f => f.path));
        loaded = true;
        render();
    }
    const figSrc = f => f.dataUrl || urls[f.path] || '';

    // ===== 描画 =====
    function render() {
        const st = GS.state;
        if (!loaded) { root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!st.loggedIn) { root.innerHTML = '<p class="spec-msg">組立範囲は、社内のアカウントでログインすると表示されます。</p>'; return; }
        const d = current();
        const cols = columnsOf(d);
        const eF = editing === 'fig', eT = editing === 'table';
        const vid = vendorFilter();

        // 見出しと編集ボタン：図面・色分け枠と担当範囲一覧は別々に編集する（同時には編集しない）
        const sectionHead = (title, mode, editLabel, note) => {
            const btns = !st.isAdmin ? '' : editing === mode
                ? `<button type="button" class="spec-btn" data-sc="cancel">キャンセル</button><button type="button" class="spec-btn spec-btn--primary" data-sc="save">保存</button>`
                : `<button type="button" class="spec-btn" data-sc="edit" data-mode="${mode}"${editing ? ' disabled title="もう一方の編集を保存かキャンセルしてから編集してください"' : ''}>${editLabel}</button>`;
            return `<div class="scope-head"><div class="subhead">${title}</div><span class="spec-spacer"></span>${btns}</div>`
                + (editing === mode ? `<p class="spec-editing-note">${note}</p>` : '');
        };
        const filterNote = vid != null && !editing ? `<p class="scope-filter-note">「${esc(st.currentSheet.display)}」が担当に入っている行と、${esc(st.currentSheet.display)}・日下部電機㈱の色分け枠だけを表示しています（全体を見るときは「全体」を選んでください）。</p>` : '';

        // 図面
        // サムネイルは行ごとに高さをそろえ、横幅を縦横比で配分して余白なく並べる（flex-grow＝縦横比、flex-basis＝縦横比×行の高さ）
        const flexOf = f => { const r = ratioOf[figSrc(f)] || 1.6; return `flex:${r} 1 ${Math.round(r * THUMB_H)}px`; };
        const figs = d.figures.map((f, i) => `<div class="figure-card" data-fi="${i}" style="${flexOf(f)}">
                ${figSrc(f) ? `<div class="fig-img-wrap"><img src="${esc(figSrc(f))}" alt="${esc(f.caption || '図面')}" data-open-fig="${i}"><svg class="fig-zones" data-fz="${i}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg></div>` : '<div class="fig-missing">画像を読み込めませんでした</div>'}
                ${eF ? `<input type="text" class="spec-input fig-cap-input" data-cap="${i}" value="${esc(f.caption)}" placeholder="図面の見出し（例：【全体図】ライン全体の俯瞰図）">
                       <div class="fig-edit"><button type="button" data-sc="figleft" data-i="${i}" title="左へ">◀</button><button type="button" data-sc="figright" data-i="${i}" title="右へ">▶</button><button type="button" class="spec-del" data-sc="figdel" data-i="${i}" title="この図面を削除">✕ 削除</button></div>`
                    : `<div class="figure-caption">${esc(f.caption)}</div>`}
                ${figSrc(f) ? `<span class="fig-zoom-hint">🔍 クリックで拡大${eF ? '・色分け枠を編集' : ''}</span>` : ''}
            </div>`).join('');
        const addFig = eF ? `<label class="figure-card figure-add"><input type="file" accept="image/*" multiple data-sc-file hidden><b>＋ 図面を追加</b><small>画像ファイルを選ぶか、Ctrl+V で貼り付け</small></label>` : '';
        const figures = (figs || addFig) ? `<div class="figure-row scope-figs">${figs}${addFig}</div>` : '<p class="spec-msg">図面はまだ登録されていません。</p>';

        // 担当範囲一覧
        const head = cols.map((c, ci) => (eT && !c.fixed)
            ? `<th class="scope-col-edit"><input type="text" class="spec-input" data-colname="${ci}" value="${esc(c.label)}" placeholder="列の名前">
                 <span class="scope-col-btns"><button type="button" data-sc="colleft" data-i="${ci}" title="左へ">◀</button><button type="button" data-sc="colright" data-i="${ci}" title="右へ">▶</button><button type="button" class="spec-del" data-sc="coldel" data-i="${ci}" title="この列を削除">✕</button></span>
                 <small>${c.type === 'party' ? '担当の列' : '文字の列'}</small></th>`
            : `<th>${esc(c.label)}</th>`).join('') + (eT ? '<th style="width:74px;"></th>' : '');
        const rowsShown = d.rows.map((r, ri) => ({ r, ri })).filter(x => eT || rowVisible(x.r, cols));
        const body = rowsShown.length ? rowsShown.map(({ r, ri }) => `<tr>${cols.map(c => {
                if (c.type === 'party') {
                    const ks = r[c.key] || [];
                    const chips = ks.length ? ks.map(partyChip).join('') : (eT ? '' : '―');
                    return eT ? `<td class="party-cell" data-party-cell="${ri}" data-key="${esc(c.key)}" title="クリックで担当を選ぶ">${chips}<span class="party-pick">＋選ぶ</span></td>` : `<td>${chips}</td>`;
                }
                return `<td>${eT ? `<input type="text" class="spec-input" data-cell="${ri}" data-key="${esc(c.key)}" value="${esc(r[c.key])}">` : (esc(r[c.key]) || '―')}</td>`;
            }).join('')}${eT ? `<td class="scope-row-btns"><button type="button" data-sc="rowup" data-i="${ri}" title="上へ">↑</button><button type="button" data-sc="rowdown" data-i="${ri}" title="下へ">↓</button><button type="button" class="spec-del" data-sc="rowdel" data-i="${ri}" title="この行を削除">✕</button></td>` : ''}</tr>`).join('')
            : `<tr><td colspan="${cols.length + (eT ? 1 : 0)}" class="spec-empty">${d.rows.length ? 'この外注先が担当に入っている行はありません' : '（未入力）'}</td></tr>`;
        const tableBtns = eT ? `<div class="scope-table-btns"><button type="button" class="spec-btn" data-sc="addrow">＋ 行を追加</button><button type="button" class="spec-btn" data-sc="addcol">＋ 列を追加</button></div>` : '';

        root.innerHTML = filterNote
            + sectionHead('図面', 'fig', '画像を編集', '図面は「＋図面を追加」か、スクリーンショットを Ctrl+V で貼り付け。図面をクリックすると拡大表示で色分け枠を描けます。終わったら「保存」を押してください。')
            + figures
            + sectionHead('担当範囲一覧', 'table', '担当範囲一覧を編集', '担当のマスをクリックすると会社を選べます（もう一度クリックすると追加・選び直し）。「＋列を追加」で列を増やせます。終わったら「保存」を押してください。')
            + `<table class="data-table scope-table${eT ? ' is-editing' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + tableBtns;
        layoutThumbZones();
    }

    // 色分け枠の座標：保存は画像に対する %（x・幅は横幅の%、y・高さは高さの%）。
    // 描画と操作は「横100・縦100×縦横比」の座標（縦横の1目盛りが同じ長さ）に直して行う。
    // %のまま回転すると、横長の画像では縦横の目盛りの違いで枠が平行四辺形にゆがむため。
    const toU = (z, a) => ({ ...z, y: z.y * a, height: z.height * a });
    // 枠は4つの角（points: [[x%, y%] ×4]）で持ち、角を1つずつ動かして3Dの斜めの図にも沿わせられる。
    // 古い形式（x・y・width・height・rotation の回転できる長方形）は、同じ見た目の4隅に読み替えて扱う
    function cornersU(z, a) {
        if (Array.isArray(z.points) && z.points.length >= 3) return z.points.map(([px, py]) => [px, py * a]);
        const u = toU(z, a);
        const cx = u.x + u.width / 2, cy = u.y + u.height / 2, rot = u.rotation || 0;
        return [[u.x, u.y], [u.x + u.width, u.y], [u.x + u.width, u.y + u.height], [u.x, u.y + u.height]]
            .map(([px, py]) => { const q = rotatePoint(px, py, cx, cy, rot); return [q.x, q.y]; });
    }
    function setCornersU(z, pts, a) {
        Object.keys(z).forEach(k => { if (k !== 'party') delete z[k]; });
        z.points = pts.map(([px, py]) => [Math.round(px * 1000) / 1000, Math.round(py / a * 1000) / 1000]);
    }
    const ptsAttr = pts => pts.map(q => q.join(',')).join(' ');

    // サムネイルの色分け枠：画像は縦横比を保って枠に収めている（object-fit: contain）ため、
    // 実際に画像が描かれている範囲を求めて、そこに拡大表示と同じ座標で枠を重ねる
    function zoneShapes(zones, a) {
        const vid = vendorFilter();
        return (zones || []).filter(z => vid == null || String(z.party) === String(vid) || z.party === KUSAKABE).map(z => {
            const color = partyInfo(z.party).color;
            return `<polygon points="${ptsAttr(cornersU(z, a))}" fill="${esc(color)}" fill-opacity="0.42" stroke="${darken(color)}" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
        }).join('');
    }
    function layoutThumbZones() {
        const figs = current().figures;
        root.querySelectorAll('.fig-zones').forEach(svg => {
            const img = svg.parentElement.querySelector('img');
            const f = figs[Number(svg.dataset.fz)];
            const place = () => {
                if (!img.naturalWidth) return;
                // カードの幅の配分を画像の実際の縦横比に合わせる（描き直した直後は初期値のことがあるため毎回確かめる）。
                // 配分が変わったときは、大きさが決まってから枠を置き直す
                const r = img.naturalWidth / img.naturalHeight;
                ratioOf[figSrc(f || {})] = r;
                const card = img.closest('.figure-card');
                const flex = `${r} 1 ${Math.round(r * THUMB_H)}px`;
                if (card && card.dataset.flex !== flex) {
                    card.dataset.flex = flex;
                    card.style.flex = flex;
                    requestAnimationFrame(layoutThumbZones);
                    return;
                }
                if (!img.clientWidth) return;
                const bw = img.clientWidth, bh = img.clientHeight;
                const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
                const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
                Object.assign(svg.style, { left: img.offsetLeft + (bw - dw) / 2 + 'px', top: img.offsetTop + (bh - dh) / 2 + 'px', width: dw + 'px', height: dh + 'px' });
                const a = img.naturalHeight / img.naturalWidth;
                svg.setAttribute('viewBox', `0 0 100 ${100 * a}`);
                svg.innerHTML = zoneShapes(f && f.zones, a);
            };
            if (img.complete) place(); else img.addEventListener('load', place, { once: true });
        });
    }
    window.addEventListener('resize', () => layoutThumbZones());
    // 組立範囲のタブを開いたとき（非表示中は大きさが0で計算できないため）にも置き直す
    document.addEventListener('click', e => { if (e.target.closest('.view-toggle-btn')) setTimeout(layoutThumbZones, 0); });

    // ===== 編集 =====
    function startEdit(mode) {
        draft = clone(data);
        if (!draft.columns.length) draft.columns = clone(DEFAULT_COLUMNS);
        removedPaths = [];
        editing = mode;
        render();
    }
    function endEdit() { editing = null; draft = null; removedPaths = []; closePicker(); render(); }
    function isDirty() {
        if (!editing) return false;
        const strip = d => JSON.stringify({ figures: d.figures.map(f => ({ path: f.path, caption: f.caption || '', zones: f.zones || [] })), rows: d.rows, columns: columnsOf(d) });
        return strip(draft) !== strip(data) || draft.figures.some(f => f.file);
    }
    function move(list, i, delta) {
        const j = i + delta;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
    }
    function addImageFile(file) {
        if (!file || !/^image\//.test(file.type)) return;
        const reader = new FileReader();
        reader.onload = () => { draft.figures.push({ path: null, caption: '', zones: [], file, dataUrl: reader.result }); render(); };
        reader.readAsDataURL(file);
    }
    function cleanRows(rows, cols) {
        return rows.filter(r => cols.some(c => c.type === 'party' ? (r[c.key] || []).length : String(r[c.key] || '').trim()));
    }
    async function save() {
        const btn = root.querySelector('[data-sc="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) throw new Error('ログインが切れています。再度ログインしてください。');
            const pn = GS.state.pn;
            // 新しい図面を Storage にアップロード
            for (const f of draft.figures) {
                if (f.path || !f.file) continue;
                const ext = ((f.file.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
                const path = `${pn}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const { error } = await client.storage.from(BUCKET).upload(path, f.file, { contentType: f.file.type || 'image/png', upsert: false });
                if (error) throw new Error('図面のアップロードに失敗しました：' + error.message);
                f.path = path;
                f.file = null;
                urls[path] = f.dataUrl;   // 署名付きURLを取り直すまでは手元の画像で表示する
            }
            const cols = draft.columns.length ? draft.columns : DEFAULT_COLUMNS;
            const rec = {
                project_number: pn,
                figures: draft.figures.map(f => ({ path: f.path, caption: (f.caption || '').trim(), zones: f.zones || [] })),
                rows: cleanRows(draft.rows, cols),
                columns: cols,
                updated_at: new Date().toISOString(),
                updated_by: session.user.email,
            };
            const { data: res, error } = await client.from('gaichu_scopes').upsert(rec, { onConflict: 'project_number' }).select('project_number');
            if (error) throw error;
            if (!res || !res.length) throw new Error('保存できませんでした（編集の権限がないか、ログインが切れています）');
            if (removedPaths.length) {
                const { error: rmErr } = await client.storage.from(BUCKET).remove(removedPaths);
                if (rmErr) console.warn('削除した図面のファイルを消せませんでした', rmErr);
            }
            data = { figures: rec.figures, rows: rec.rows, columns: rec.columns };
            endEdit();
        } catch (err) {
            console.error('組立範囲の保存に失敗しました', err);
            alert('保存に失敗しました：' + (err.message || err));
            if (btn) { btn.disabled = false; btn.textContent = '保存'; }
        }
    }

    // 担当の選択（マスをクリックすると出る小さな選択欄）
    let picker = null;
    function closePicker() { if (picker) { picker.remove(); picker = null; } }
    function openPicker(cell) {
        closePicker();
        const ri = Number(cell.dataset.partyCell), key = cell.dataset.key;
        const cur = (draft.rows[ri][key] || []).map(String);
        picker = document.createElement('div');
        picker.className = 'party-picker';
        picker.innerHTML = parties().map(p => `<button type="button" class="party-opt${cur.includes(String(p.key)) ? ' is-on' : ''}" data-pk="${esc(p.key)}"><span class="party-opt-mark">${cur.includes(String(p.key)) ? '✓' : ''}</span><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</button>`).join('')
            + `<button type="button" class="party-opt party-opt--clear" data-pk="">（担当なしにする）</button>`
            + `<p class="party-picker-note">選んである会社を選ぶと外れます</p>`;
        document.body.appendChild(picker);
        const r = cell.getBoundingClientRect();
        picker.style.left = Math.min(r.left, window.innerWidth - picker.offsetWidth - 8) + 'px';
        picker.style.top = (r.bottom + 4 + picker.offsetHeight > window.innerHeight ? r.top - picker.offsetHeight - 4 : r.bottom + 4) + 'px';
        picker.addEventListener('click', ev => {
            const opt = ev.target.closest('[data-pk]');
            if (!opt) return;
            const v = opt.dataset.pk;
            const list = draft.rows[ri][key] || [];
            if (v === '') draft.rows[ri][key] = [];
            else {
                const k = v === KUSAKABE ? KUSAKABE : Number(v);
                draft.rows[ri][key] = list.some(x => String(x) === v) ? list.filter(x => String(x) !== v) : list.concat([k]);
            }
            closePicker();
            render();
        });
    }
    document.addEventListener('mousedown', e => {
        if (picker && !picker.contains(e.target) && !e.target.closest('.party-cell')) closePicker();
    });

    // 列の追加（名前と種類を選ぶ小さな画面）
    function addColumnDialog() {
        const bg = document.createElement('div');
        bg.className = 'oc-modal-bg';
        bg.innerHTML = `<div class="oc-modal"><div class="oc-modal-head">列を追加</div>
            <div class="oc-modal-body">
                <label class="oc-field"><span>列の名前</span><input type="text" name="label" placeholder="例：据付＆レベル出し"></label>
                <div class="oc-type"><label><input type="radio" name="type" value="party" checked> 担当の列（外注先・日下部電機から選ぶ）</label></div>
                <div class="oc-type"><label><input type="radio" name="type" value="text"> 文字の列（自由に入力）</label></div>
                <div class="oc-err"></div></div>
            <div class="oc-modal-foot"><button type="button" class="oc-btn oc-btn--ghost" data-x>キャンセル</button><button type="button" class="oc-btn oc-btn--primary" data-ok>追加</button></div></div>`;
        document.body.appendChild(bg);
        const label = bg.querySelector('[name=label]');
        label.focus();
        const close = () => bg.remove();
        bg.querySelector('[data-x]').addEventListener('click', close);
        const ok = () => {
            const name = label.value.trim();
            if (!name) { bg.querySelector('.oc-err').textContent = '列の名前を入力してください。'; return; }
            const type = bg.querySelector('[name=type]:checked').value;
            draft.columns.push({ key: 'c' + Date.now().toString(36), label: name, type, fixed: false });
            close();
            render();
        };
        bg.querySelector('[data-ok]').addEventListener('click', ok);
        label.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    }

    root.addEventListener('click', e => {
        const img = e.target.closest('[data-open-fig]');
        if (img) { openLightbox(Number(img.dataset.openFig)); return; }
        const b = e.target.closest('[data-sc]');
        if (b) {
            const i = Number(b.dataset.i);
            switch (b.dataset.sc) {
                case 'edit': startEdit(b.dataset.mode); return;
                case 'cancel': if (!isDirty() || confirm('編集内容を破棄して元に戻しますか？')) endEdit(); return;
                case 'save': save(); return;
                case 'figleft': move(draft.figures, i, -1); break;
                case 'figright': move(draft.figures, i, 1); break;
                case 'figdel':
                    if (!confirm('この図面を削除しますか？（「保存」を押すまでは元に戻せます）')) return;
                    if (draft.figures[i].path) removedPaths.push(draft.figures[i].path);
                    draft.figures.splice(i, 1);
                    break;
                case 'addrow': draft.rows.push({}); break;
                case 'rowup': move(draft.rows, i, -1); break;
                case 'rowdown': move(draft.rows, i, 1); break;
                case 'rowdel': draft.rows.splice(i, 1); break;
                case 'addcol': addColumnDialog(); return;
                case 'colleft': move(draft.columns, i, -1); break;
                case 'colright': move(draft.columns, i, 1); break;
                case 'coldel':
                    if (!confirm(`「${draft.columns[i].label}」の列を削除しますか？（この列に入力した内容も消えます）`)) return;
                    draft.columns.splice(i, 1);
                    break;
                default: return;
            }
            render();
            return;
        }
        const cell = editing === 'table' && e.target.closest('.party-cell');
        if (cell) openPicker(cell);
    });
    root.addEventListener('input', e => {
        if (!editing) return;
        const t = e.target;
        if (t.dataset.cap != null) draft.figures[Number(t.dataset.cap)].caption = t.value;
        else if (t.dataset.colname != null) draft.columns[Number(t.dataset.colname)].label = t.value;
        else if (t.dataset.cell != null) draft.rows[Number(t.dataset.cell)][t.dataset.key] = t.value;
    });
    root.addEventListener('change', e => {
        if (e.target.matches('[data-sc-file]')) { [...e.target.files].forEach(addImageFile); e.target.value = ''; }
    });
    // スクリーンショットの貼り付け（図面の編集中で、入力欄以外にカーソルがあるとき）
    document.addEventListener('paste', e => {
        if (editing !== 'fig' || !root.offsetParent) return;
        const files = [...(e.clipboardData && e.clipboardData.items || [])].filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile());
        if (!files.length) return;
        e.preventDefault();
        files.forEach(addImageFile);
    });
    // 外注先の切り替え：編集中は全行を表示しているので描き直すだけ（表示の絞り込みは閲覧時のみ）
    document.addEventListener('gaichusheetchange', () => { if (!loaded) load(); else render(); });
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

    // ===== 拡大表示＋色分け枠 =====
    const lb = document.getElementById('lightbox');
    const stage = document.getElementById('lbStage');
    const lbImg = document.getElementById('lbImg');
    const overlay = document.getElementById('lbOverlay');
    const zoomLabel = document.getElementById('lbZoom');
    const editBtn = document.getElementById('lbEditBtn');
    const undoBtn = document.getElementById('lbUndo');
    const clearBtn = document.getElementById('lbClear');
    const editHint = document.getElementById('lbEditHint');
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => { const el = document.createElementNS(SVG_NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
    function rotatePoint(px, py, cx, cy, deg) {
        const rad = deg * Math.PI / 180, dx = px - cx, dy = py - cy;
        return { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) };
    }
    let scale = 1, x = 0, y = 0, fitScale = 1;
    // tool: 'rect'（ドラッグで四角形→角を動かす）／'poly'（クリックで頂点を打つ多角形）
    const zs = { fi: null, editMode: false, dragStart: null, dragCurrent: null, selected: null, handleOp: null, pendingPts: null,
                 tool: 'rect', polyPts: [], polyHover: null };
    const toolBox = document.getElementById('lbTools');
    const zonesOf = () => { const f = zs.fi != null && current().figures[zs.fi]; return f ? (f.zones = f.zones || []) : []; };
    function visibleZones() {
        const vid = vendorFilter();
        return zonesOf().map((z, idx) => ({ z, idx })).filter(({ z }) => zs.editMode || vid == null || String(z.party) === String(vid) || z.party === KUSAKABE);
    }

    const apply = () => {
        const t = `translate(${x}px, ${y}px) scale(${scale})`;
        lbImg.style.transform = t;
        overlay.style.transform = t;
        zoomLabel.textContent = Math.round(scale / fitScale * 100) + '%';
    };
    const fit = () => {
        const r = stage.getBoundingClientRect();
        fitScale = scale = Math.min(r.width / lbImg.naturalWidth, r.height / lbImg.naturalHeight) * 0.96;
        x = (r.width - lbImg.naturalWidth * scale) / 2;
        y = (r.height - lbImg.naturalHeight * scale) / 2;
        overlay.setAttribute('width', lbImg.naturalWidth);
        overlay.setAttribute('height', lbImg.naturalHeight);
        overlay.style.width = lbImg.naturalWidth + 'px';
        overlay.style.height = lbImg.naturalHeight + 'px';
        overlay.setAttribute('viewBox', `0 0 100 ${100 * aspect()}`);
        apply();
        renderZones();
    };
    const aspect = () => (lbImg.naturalWidth ? lbImg.naturalHeight / lbImg.naturalWidth : 1);
    const zoomAt = (factor, cx, cy) => {
        const next = Math.min(Math.max(scale * factor, fitScale * 0.5), fitScale * 8);
        const k = next / scale;
        x = cx - (cx - x) * k; y = cy - (cy - y) * k; scale = next; apply();
    };
    const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    function openLightbox(fi) {
        const f = current().figures[fi];
        if (!f || !figSrc(f)) return;
        zs.fi = fi;
        setEditMode(false);
        // 色分け枠の編集は「画像を編集」の最中だけ
        const canZone = editing === 'fig';
        [editBtn, undoBtn, clearBtn].forEach(b => { if (b) b.style.display = canZone ? '' : 'none'; });
        if (editHint) editHint.textContent = canZone ? '描いた枠は、閉じたあと図面の「保存」で保存されます' : '';
        lb.classList.toggle('lb-readonly', !canZone);
        lbImg.onload = fit;
        lbImg.src = figSrc(f);
        document.getElementById('lbCaption').textContent = f.caption || '';
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (lbImg.complete && lbImg.naturalWidth) fit();
        renderZones();
    }
    const closeLightbox = () => { lb.classList.remove('active'); document.body.style.overflow = ''; setEditMode(false); zs.fi = null; render(); };
    lb.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => {
        if (zs.editMode) return;   // 枠の編集中は拡大・縮小しない（全体表示のまま描く）
        if (b.dataset.z === 'fit') return fit();
        zoomAt(b.dataset.z === 'in' ? 1.25 : 0.8, ...center());
    }));
    document.getElementById('lbClose').addEventListener('click', closeLightbox);
    stage.addEventListener('wheel', e => {
        e.preventDefault();
        if (zs.editMode) return;
        const r = stage.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.15 : 0.87, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('dblclick', e => {
        if (zs.editMode) return;
        const r = stage.getBoundingClientRect();
        zoomAt(2, e.clientX - r.left, e.clientY - r.top);
    });
    let drag = null;
    stage.addEventListener('pointerdown', e => {
        if (zs.editMode) return;
        drag = { sx: e.clientX, sy: e.clientY, x, y };
        stage.setPointerCapture(e.pointerId); stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', e => {
        if (!drag) return;
        x = drag.x + e.clientX - drag.sx; y = drag.y + e.clientY - drag.sy; apply();
    });
    const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => { if (lb.classList.contains('active')) fit(); });
    document.addEventListener('keydown', e => {
        if (!lb.classList.contains('active')) return;
        if (zs.polyPts.length) {
            if (e.key === 'Escape') { e.preventDefault(); cancelPoly(); }
            else if (e.key === 'Enter') { e.preventDefault(); finishPoly(); }
            return;
        }
        if (e.key === 'Escape' && !zs.pendingPts) closeLightbox();
    });

    function renderZones() {
        overlay.innerHTML = '';
        if (zs.fi == null) return;
        const a = aspect();
        visibleZones().forEach(({ z, idx }) => {
            const pts = cornersU(z, a);
            const color = partyInfo(z.party).color;
            overlay.appendChild(svgEl('polygon', {
                points: ptsAttr(pts), fill: color, 'fill-opacity': '0.42', stroke: darken(color), 'stroke-width': '0.5',
                'stroke-linejoin': 'round', class: 'zone-rect', 'data-idx': idx,
            }));
            if (zs.selected === idx) {
                overlay.appendChild(svgEl('polygon', { points: ptsAttr(pts), class: 'zone-select-outline' }));
                // 角のつまみ：ドラッグするとその角だけが動く
                pts.forEach((q, pi) => overlay.appendChild(svgEl('circle', { cx: q[0], cy: q[1], r: '1.1', class: 'zone-handle corner-handle', 'data-idx': idx, 'data-pi': pi })));
            }
        });
        if (zs.dragStart && zs.dragCurrent) {
            overlay.appendChild(svgEl('rect', {
                x: Math.min(zs.dragStart.x, zs.dragCurrent.x), y: Math.min(zs.dragStart.y, zs.dragCurrent.y),
                width: Math.abs(zs.dragCurrent.x - zs.dragStart.x), height: Math.abs(zs.dragCurrent.y - zs.dragStart.y), class: 'draft-rect',
            }));
        }
        if (zs.polyPts.length) {
            const line = zs.polyPts.concat(zs.polyHover ? [[zs.polyHover.x, zs.polyHover.y]] : []);
            overlay.appendChild(svgEl('polyline', { points: ptsAttr(line), class: 'draft-poly' }));
            zs.polyPts.forEach((q, i) => overlay.appendChild(svgEl('circle', { cx: q[0], cy: q[1], r: i === 0 ? '1.4' : '0.8', class: i === 0 ? 'draft-vertex draft-vertex--first' : 'draft-vertex' })));
        }
        if (zs.pendingPts) overlay.appendChild(svgEl('polygon', { points: ptsAttr(zs.pendingPts), class: 'draft-rect' }));
    }
    function showZonePicker(ptsU, clickX, clickY) {
        zs.pendingPts = ptsU;
        renderZones();
        const pk = document.createElement('div');
        pk.className = 'zone-picker';
        pk.style.left = clickX + 'px';
        pk.style.top = clickY + 'px';
        pk.innerHTML = parties().map(p => `<button data-party="${esc(p.key)}"><span class="dot" style="background:${esc(p.color)};"></span>${esc(p.label)}</button>`).join('')
            + `<button data-party="__cancel">キャンセル</button>`;
        stage.appendChild(pk);
        pk.addEventListener('click', ev => {
            const btn = ev.target.closest('button');
            if (!btn) return;
            const party = btn.dataset.party;
            if (party !== '__cancel') {
                const zones = zonesOf();
                const nz = { party: party === KUSAKABE ? KUSAKABE : Number(party) };
                setCornersU(nz, ptsU, aspect());
                zones.push(nz);
                zs.selected = zones.length - 1;
            }
            zs.pendingPts = null;
            pk.remove();
            renderZones();
        });
    }
    // 多角形を閉じて会社を選ぶ（同じ場所の連続クリック＝ダブルクリック分の点は除く）
    function finishPoly(clientX, clientY) {
        const pts = zs.polyPts.filter((q, i, arr) => i === 0 || Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) > 0.3);
        zs.polyPts = []; zs.polyHover = null;
        if (pts.length < 3) { renderZones(); return; }
        const sr = stage.getBoundingClientRect();
        showZonePicker(pts, clientX != null ? clientX - sr.left : sr.width / 2, clientY != null ? clientY - sr.top : sr.height / 2);
    }
    function cancelPoly() { zs.polyPts = []; zs.polyHover = null; renderZones(); }
    function setTool(tool) {
        zs.tool = tool;
        cancelPoly();
        if (toolBox) toolBox.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        if (editHint && zs.editMode) editHint.textContent = tool === 'poly'
            ? '多角形：クリックで頂点を追加／最初の点・ダブルクリック・Enter で閉じる／Esc で取り消し'
            : '四角形：ドラッグで作成／枠をクリックして角のつまみで形を整える';
    }
    if (toolBox) toolBox.addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });

    function setEditMode(on) {
        const entering = on && editing === 'fig' && !zs.editMode;
        zs.editMode = on && editing === 'fig';
        if (entering && lbImg.naturalWidth) fit();
        lb.classList.toggle('edit-mode', zs.editMode);
        if (editBtn) { editBtn.classList.toggle('active', zs.editMode); editBtn.textContent = zs.editMode ? '枠の編集を終了' : '✏️ 色分け枠を編集'; }
        lb.querySelectorAll('[data-z]').forEach(b => { b.disabled = zs.editMode; b.title = zs.editMode ? '枠の編集中は拡大・縮小できません' : ''; });
        zs.dragStart = zs.dragCurrent = zs.handleOp = null;
        zs.selected = null;
        if (toolBox) toolBox.style.display = zs.editMode ? '' : 'none';
        if (zs.editMode) setTool(zs.tool);
        else { zs.polyPts = []; zs.polyHover = null; if (editHint && editing === 'fig') editHint.textContent = '描いた枠は、閉じたあと図面の「保存」で保存されます'; }
        renderZones();
    }
    if (editBtn) editBtn.addEventListener('click', () => setEditMode(!zs.editMode));
    if (undoBtn) undoBtn.addEventListener('click', () => { zonesOf().pop(); zs.selected = null; renderZones(); });
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (!zonesOf().length || !confirm('この図面の色分け枠をすべて消しますか？')) return;
        zonesOf().length = 0; zs.selected = null; renderZones();
    });
    document.addEventListener('keydown', e => {
        if (!zs.editMode || zs.selected == null || !lb.classList.contains('active')) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { zonesOf().splice(zs.selected, 1); zs.selected = null; renderZones(); }
    });
    // マウスの位置（縦横をそろえた座標）
    function overlayToU(e) {
        const rect = overlay.getBoundingClientRect();
        return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 * aspect() };
    }
    overlay.addEventListener('mousedown', e => {
        if (!zs.editMode || zs.pendingPts) return;   // 会社を選んでいる間は描かない
        const t = e.target;
        const zones = zonesOf();
        const idx = parseInt(t.dataset && t.dataset.idx, 10);
        const a = aspect();
        const onZone = t.classList.contains('corner-handle') || t.classList.contains('zone-rect');
        if (zs.tool === 'poly' && (zs.polyPts.length || !onZone)) {
            const q = overlayToU(e);
            const first = zs.polyPts[0];
            if (zs.polyPts.length >= 3 && Math.hypot(q.x - first[0], q.y - first[1]) < 2) { finishPoly(e.clientX, e.clientY); return; }
            zs.polyPts.push([q.x, q.y]);
            zs.selected = null;
            renderZones();
            return;
        }
        if (t.classList.contains('corner-handle')) {
            zs.handleOp = { type: 'corner', idx, pi: Number(t.dataset.pi), start: overlayToU(e), startPts: cornersU(zones[idx], a) };
            return;
        }
        if (t.classList.contains('zone-rect')) {
            zs.handleOp = { type: 'move', idx, start: overlayToU(e), startPts: cornersU(zones[idx], a) };
            zs.selected = idx; renderZones(); return;
        }
        zs.selected = null;
        zs.dragStart = zs.dragCurrent = overlayToU(e);
        renderZones();
    });
    overlay.addEventListener('mousemove', e => {
        if (!zs.editMode) return;
        if (zs.polyPts.length) { zs.polyHover = overlayToU(e); renderZones(); return; }
        if (zs.handleOp) {
            const op = zs.handleOp;
            const zone = zonesOf()[op.idx];
            if (!zone) return;
            const cur = overlayToU(e);
            const dx = cur.x - op.start.x, dy = cur.y - op.start.y;
            const pts = op.startPts.map(q => q.slice());
            if (op.type === 'move') pts.forEach(q => { q[0] += dx; q[1] += dy; });
            else if (op.type === 'corner') { pts[op.pi][0] += dx; pts[op.pi][1] += dy; }
            setCornersU(zone, pts, aspect());
            renderZones();
            return;
        }
        if (!zs.dragStart) return;
        zs.dragCurrent = overlayToU(e);
        renderZones();
    });
    overlay.addEventListener('mouseup', e => {
        if (!zs.editMode) return;
        if (zs.handleOp) { zs.handleOp = null; return; }
        if (!zs.dragStart) return;
        const start = zs.dragStart, end = overlayToU(e);
        zs.dragStart = zs.dragCurrent = null;
        if (Math.abs(end.x - start.x) < 1 && Math.abs(end.y - start.y) < 1) { renderZones(); return; }
        const sr = stage.getBoundingClientRect();
        const zx = Math.min(start.x, end.x), zy = Math.min(start.y, end.y), zw = Math.abs(end.x - start.x), zh = Math.abs(end.y - start.y);
        showZonePicker([[zx, zy], [zx + zw, zy], [zx + zw, zy + zh], [zx, zy + zh]], e.clientX - sr.left, e.clientY - sr.top);
    });
    overlay.addEventListener('dblclick', e => {
        if (zs.editMode && zs.tool === 'poly' && zs.polyPts.length >= 3) finishPoly(e.clientX, e.clientY);
    });
    overlay.addEventListener('mouseleave', () => {
        if (zs.dragStart) { zs.dragStart = zs.dragCurrent = null; renderZones(); }
        zs.handleOp = null;
    });

    // 工程表（後の作業）などから担当範囲一覧を参照できるようにする
    window.GaichuScope = { get rows() { return data.rows; }, get columns() { return columnsOf(data); }, KUSAKABE };

    render();
})();

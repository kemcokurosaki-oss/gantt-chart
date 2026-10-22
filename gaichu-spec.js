// 外注先用シート：組立発注仕様書（外注先ごと）
//   共通の枠（塗装色11項目・ユーティリティ8項目・発注範囲23項目）はここで固定で持ち、
//   外注先シート（gaichu_sheets.spec）には工事×外注先ごとの入力値だけを保存する。
//   工事番号・工事名称・出荷納期は工程表から、貴社名は外注先マスタから自動表示する（gaichu-sheet.js）。
//   編集できるのは体制表の管理者（org_chart_admins）のみ。
// 読み込み前に gaichu-sheet.js を読み込み、ページに #specRoot を置いておくこと。
(function () {
    const root = document.getElementById('specRoot');
    const contactsEl = document.getElementById('specContacts');
    const GS = window.GaichuSheet;
    if (!root || !GS) return;

    const PAINT_COLS = ['機械色', '安全色', '安全柵', '空圧配管', '油配管', 'ミスト配管', 'ソリブル配管', '水配管', 'ガス配管', '電気配管', 'ダクト配管'];
    const UTILITY = [
        { group: '動力電源', cols: [['power_v', '電圧(V)'], ['power_kva', '容量(kVA)']] },
        { group: '補助電源', cols: [['aux_v', '電圧(V)'], ['aux_kva', '容量(kVA)']] },
        { group: '圧縮空気', cols: [['air', '(kg/cm2)']] },
        { group: '冷却水', cols: [['water', '圧力(kPa)']] },
        { group: 'クレーン', cols: [['crane_t', '重量(t)×基'], ['crane_m', '揚程(m)']] },
    ];
    const UTILITY_KEYS = UTILITY.flatMap(g => g.cols.map(c => c[0]));
    // 発注範囲：全外注先共通の23項目（項目名は固定。甲〇・乙〇・備考・該当なしだけを入力する）
    const SCOPE_ITEMS = [
        '機械設計（部品図及び組立図・据付図・出荷荷姿図の作成）', '電気設計', '制御設計', '各種盤製作', '部品製作',
        '完成購入品調達', '締結部品調達', '塗料調達', '塗装', '横持ちの運搬車両',
        '機械組立', '据付及びレベル出し', '油圧配管工事', 'エアー配管工事', '機内配線のための艤装部品の取り付け',
        '機内配線（中継箱～各機器）', 'テスト配線（中継箱～制御盤～分電盤）', '試運転', '試運転補助作業', '出荷準備（解体・養生・梱包）',
        '梱包用資材', '車両への積込', '出荷用車両手配',
    ];
    const MACHINE_COLS = [['machine', '機械'], ['unit', 'ユニット'], ['name', '装置名称'], ['qty', '数量'], ['note', '備考']];

    let editing = false;
    let draft = null;     // 編集中の入力値（保存するまでDBには書かない）
    let revNote = '', revSkip = false;   // 今回の改訂内容・「改訂として記録しない」（仕様書の中身ではないので draft とは分けて持つ）
    let draftSheetId = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const dash = v => (v == null || String(v).trim() === '') ? '―' : esc(v);
    function fmtDate(s) {
        if (!s) return '―';
        const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
        return `${y}/${m}/${d}`;
    }
    function normalize(spec) {
        const s = JSON.parse(JSON.stringify(spec || {}));
        s.contact = s.contact || '';
        s.revision = s.revision || '';
        s.revision_note = s.revision_note || '';
        s.revisions = Array.isArray(s.revisions) ? s.revisions : [];   // 改訂の履歴 [{ rev, date, note }]
        s.machines = Array.isArray(s.machines) ? s.machines : [];
        s.paint = s.paint || {};
        s.utility = s.utility || {};
        s.scope = s.scope || {};
        SCOPE_ITEMS.forEach((_, i) => {
            const k = String(i + 1);
            s.scope[k] = Object.assign({ kou: false, otsu: false, note: '', na: false }, s.scope[k] || {});
        });
        return s;
    }
    const input = (path, value, extra) => `<input type="text" class="spec-input" data-path="${path}" value="${esc(value)}"${extra || ''}>`;
    // 編集中に、工程表・外注先マスタから自動で表示している項目に付ける目印
    const autoTag = (e, text) => e ? `<span class="spec-auto">${text}</span>` : '';

    // ===== 改訂 =====
    // 次の改訂番号：未発行なら「初版」、初版の次は R1、R2 の次は R3
    function nextRev(rev) {
        const m = /R\s*(\d+)/i.exec(rev || '');
        if (m) return 'R' + (Number(m[1]) + 1);
        return String(rev || '').trim() ? 'R1' : '初版';
    }
    const today = () => { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
    // 改訂の番号・日付・内容を除いた仕様書の中身（変更があったかどうかの判定に使う）
    const body = s => JSON.stringify(Object.assign({}, s, { revision: '', revision_note: '', revisions: [] }));

    // ===== 描画 =====
    // 2-4) 弊社担当（全工番共通・外注先用シートの設定から）。1人目は青、2人目以降は灰色の帯
    function renderContacts() {
        if (!contactsEl) return;
        const list = GS.state.loggedIn ? GS.state.contacts : [];
        contactsEl.innerHTML = list.length ? `<div class="subhead">2-4) 弊社担当（問い合わせ窓口）</div><div class="contact-grid">${list.map((c, i) => `<div class="contact-card">
                <span class="role"${i ? ' style="background:#95a5a6;"' : ''}>${esc([c.dept, c.title].filter(Boolean).join(' '))}</span>
                <div class="name">${esc(c.name)}</div>
                ${c.tel ? `<span class="tel">TEL ${esc(c.tel)}</span>` : ''}
                ${c.email ? `<span class="tel">Email ${esc(c.email)}</span>` : ''}
            </div>`).join('')}</div>` : '';
    }

    function render() {
        renderContacts();
        const st = GS.state;
        if (!st.ready) { root.innerHTML = '<p class="spec-msg">読込中…</p>'; return; }
        if (!st.loggedIn) { root.innerHTML = '<p class="spec-msg">組立発注仕様書は、社内のアカウントでログインすると表示されます。</p>'; return; }
        if (!st.sheets.length) { root.innerHTML = '<p class="spec-msg">この工事には外注先が登録されていません。</p>'; return; }

        const sheet = st.currentSheet;
        const tabs = `<div class="spec-tabs">${st.sheets.map(s => `<button type="button" class="vendor-switch-btn${sheet && sheet.id === s.id ? ' active' : ''}" data-v="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.short)}</button>`).join('')}`
            + (sheet && st.isAdmin ? (editing
                ? `<span class="spec-spacer"></span><button type="button" class="spec-btn" data-spec="cancel">キャンセル</button><button type="button" class="spec-btn spec-btn--primary" data-spec="save">保存</button>`
                : `<span class="spec-spacer"></span><button type="button" class="spec-btn" data-spec="edit">仕様書を編集</button>`) : '')
            + `</div>`;
        if (!sheet) {
            root.innerHTML = tabs + '<p class="spec-msg">組立発注仕様書は外注先ごとに作成します。上のボタンから外注先を選んでください。</p>';
            return;
        }
        const s = editing ? draft : normalize(sheet.spec);
        const e = editing;
        const p = st.project;

        const info = `<div class="info-grid">
            <div class="info-item"><div class="k">1-1) 工事番号</div><div class="v">${esc(st.pn)}${autoTag(e, '自動')}</div></div>
            <div class="info-item"><div class="k">1-2) 工事名称</div><div class="v">${dash(p.name)}${autoTag(e, '工程表から自動表示')}</div></div>
            <div class="info-item"><div class="k">1-3) 貴社名</div><div class="v">${dash(sheet.name)}${autoTag(e, '外注先マスタから自動表示')}</div></div>
            <div class="info-item"><div class="k">1-4) ご担当者</div><div class="v">${e
                ? input('contact', s.contact, ` placeholder="${esc(GS.repLabel(sheet) ? `空欄なら代表者（${GS.repLabel(sheet)}）` : '例：取締役工場長　山田 太郎 様')}"`)
                  + `<small>空欄のときは、外注先マスタの代表者を自動表示します</small>`
                : dash(s.contact || GS.repLabel(sheet))}</div></div>
            <div class="info-item"><div class="k">1-5) 出荷納期</div><div class="v">${fmtDate(p.shipDate)}${autoTag(e, '工程表から自動表示')}</div></div>
            <div class="info-item"><div class="k">改訂</div><div class="v">${e
                ? `${dash(s.revision)}${s.revision_note ? `<small>${esc(s.revision_note)}</small>` : ''}`
                  + `<div class="spec-rev"><small>内容を変更して保存すると「<b>${esc(nextRev(s.revision))}（${today()}）</b>」になります</small>`
                  + `<input type="text" class="spec-rev-note" value="${esc(revNote)}" placeholder="今回の改訂内容（例：塗装色を変更）"${revSkip ? ' disabled' : ''}>`
                  + `<label class="spec-rev-skip"><input type="checkbox" class="spec-rev-skip-cb"${revSkip ? ' checked' : ''}>改訂として記録しない（誤字の修正など）</label></div>`
                : `${dash(s.revision)}${s.revision_note ? `<small>${esc(s.revision_note)}</small>` : ''}`}</div></div>
        </div>`;

        const machines = `<div class="subhead">1-6) 発注機械</div>
            <table class="data-table">
                <thead><tr>${MACHINE_COLS.map(c => `<th>${c[1]}</th>`).join('')}${e ? '<th style="width:40px;"></th>' : ''}</tr></thead>
                <tbody>${s.machines.length ? s.machines.map((m, i) => `<tr>${MACHINE_COLS.map(c => `<td>${e ? input(`machines.${i}.${c[0]}`, m[c[0]]) : dash(m[c[0]])}</td>`).join('')}${e ? `<td><button type="button" class="spec-del" data-spec="delrow" data-i="${i}" title="この行を削除">✕</button></td>` : ''}</tr>`).join('')
                    : `<tr><td colspan="${MACHINE_COLS.length + (e ? 1 : 0)}" class="spec-empty">（未入力）</td></tr>`}</tbody>
            </table>${e ? '<button type="button" class="spec-btn spec-addrow" data-spec="addrow">＋ 行を追加</button>' : ''}`;

        const paint = `<div class="subhead">1-7) 塗装色</div>
            ${e ? '<p class="spec-paste-hint">社内製作仕様書の「8)塗装色」の行（項目名の行と色の行、または色の行だけ）を Excel でコピーし、下のどれかの欄に貼り付けると、11項目にまとめて入ります。<span class="spec-paste-msg" aria-live="polite"></span></p>' : ''}
            <table class="data-table">
                <thead><tr>${PAINT_COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody><tr>${PAINT_COLS.map(c => `<td>${e ? input(`paint.${c}`, s.paint[c]) : dash(s.paint[c])}</td>`).join('')}</tr></tbody>
            </table>`;

        const utility = `<div class="subhead">1-8) ユーティリティ</div>
            <table class="data-table">
                <thead>
                    <tr>${UTILITY.map(g => `<th${g.cols.length > 1 ? ` colspan="${g.cols.length}"` : ''}>${g.group}</th>`).join('')}</tr>
                    <tr>${UTILITY.flatMap(g => g.cols).map(c => `<th>${c[1]}</th>`).join('')}</tr>
                </thead>
                <tbody><tr>${UTILITY_KEYS.map(k => `<td>${e ? input(`utility.${k}`, s.utility[k]) : dash(s.utility[k])}</td>`).join('')}</tr></tbody>
            </table>`;

        const mark = (on, na) => na ? '―' : (on ? '〇' : '');
        const scope = `<div class="subhead">1-9) 発注範囲（甲＝日下部電機㈱／乙＝請負者）</div>
            <table class="data-table${e ? ' editable-scope' : ' scope-view'}">
                <thead><tr><th style="width:30px;">No.</th><th style="text-align:left;">項目</th><th style="width:38px;">甲</th><th style="width:38px;">乙</th><th style="text-align:left;">備考</th><th style="width:70px;">該当なし</th></tr></thead>
                <tbody>${SCOPE_ITEMS.map((label, i) => {
                    const k = String(i + 1), r = s.scope[k];
                    return `<tr${r.na ? ' class="na"' : ''}><td>${k}</td><td style="text-align:left;">${esc(label)}</td>
                        <td class="cell-toggle" data-scope="${k}" data-side="kou">${mark(r.kou, r.na)}</td>
                        <td class="cell-toggle" data-scope="${k}" data-side="otsu">${mark(r.otsu, r.na)}</td>
                        <td style="text-align:left;">${e ? input(`scope.${k}.note`, r.note) : esc(r.note)}</td>
                        <td class="na-cell">${e ? `<input type="checkbox" class="na-checkbox" data-na="${k}"${r.na ? ' checked' : ''}>` : (r.na ? '✓' : '')}</td></tr>`;
                }).join('')}</tbody>
            </table>`;

        root.innerHTML = tabs + (e ? '<p class="spec-editing-note">編集中です。入力が終わったら「保存」を押してください（甲・乙の欄はクリックで〇を付け外しします）。</p>' : '')
            + info + machines + paint + utility + scope;
    }

    // ===== 編集 =====
    function setPath(obj, path, value) {
        const keys = path.split('.');
        let o = obj;
        keys.slice(0, -1).forEach(k => { o = o[k]; });
        o[keys[keys.length - 1]] = value;
    }
    function collect() {
        root.querySelectorAll('.spec-input').forEach(el => setPath(draft, el.dataset.path, el.value));
    }
    function startEdit() {
        const sheet = GS.state.currentSheet;
        if (!sheet) return;
        draft = normalize(sheet.spec);
        draftSheetId = sheet.id;
        revNote = ''; revSkip = false;
        editing = true;
        render();
    }
    function endEdit() { editing = false; draft = null; draftSheetId = null; revNote = ''; revSkip = false; render(); }
    root.addEventListener('input', e => { if (e.target.classList.contains('spec-rev-note')) revNote = e.target.value; });

    // ===== 塗装色の貼り付け =====
    // 社内製作仕様書（Excel）の「8)塗装色」は1項目が3列の結合セルなので、コピーすると「値・空・空」の並びになる。
    // 項目名の行もコピーしてあれば項目名で突き合わせ、色の行だけなら3列ごと（または空でない値が11個ならその順）に当てはめる
    const normName = s => String(s || '').normalize('NFKC').replace(/\s/g, '');
    function parsePaint(text) {
        const rows = String(text).replace(/\r/g, '').split('\n').map(l => l.split('\t').map(c => c.trim().replace(/^"|"$/g, '').trim())).filter(r => r.some(c => c));
        if (!rows.length) return null;
        const names = PAINT_COLS.map(normName);
        const hi = rows.findIndex(r => r.filter(c => names.includes(normName(c))).length >= 3);
        const out = {};
        if (hi >= 0 && rows[hi + 1]) {
            rows[hi].forEach((c, i) => { const k = names.indexOf(normName(c)); if (k >= 0) out[PAINT_COLS[k]] = rows[hi + 1][i] || ''; });
            return Object.keys(out).length ? out : null;
        }
        const r = rows[hi >= 0 ? hi : 0].filter(c => !/^\d+\)\s*塗装色$/.test(normName(c)));
        const filled = r.filter(c => c);
        if (filled.length === PAINT_COLS.length) { PAINT_COLS.forEach((k, i) => { out[k] = filled[i]; }); return out; }
        const start = r.findIndex(c => c);
        const every3 = r.slice(start).filter((_, i) => i % 3 === 0);
        if (every3.length >= PAINT_COLS.length - 1 && every3.length <= PAINT_COLS.length) { PAINT_COLS.forEach((k, i) => { out[k] = every3[i] || ''; }); return out; }
        return null;
    }
    root.addEventListener('paste', e => {
        const inp = e.target.closest && e.target.closest('.spec-input[data-path^="paint."]');
        if (!inp || !editing) return;
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\t\n]/.test(text)) return;   // 1つの値だけなら普通に貼り付ける
        e.preventDefault();
        const msg = root.querySelector('.spec-paste-msg');
        const vals = parsePaint(text);
        if (!vals) { if (msg) msg.textContent = '　貼り付けた内容から塗装色を読み取れませんでした。「8)塗装色」の行をコピーしてください。'; return; }
        let n = 0;
        PAINT_COLS.forEach(k => {
            if (!(k in vals)) return;
            const el = root.querySelector(`.spec-input[data-path="paint.${k}"]`);
            if (el) { el.value = vals[k]; el.classList.add('spec-pasted'); n++; }
        });
        if (msg) msg.textContent = `　${n}項目を貼り付けました（保存するまで確定しません）。`;
        setTimeout(() => root.querySelectorAll('.spec-pasted').forEach(el => el.classList.remove('spec-pasted')), 1600);
    });
    root.addEventListener('change', e => {
        if (!e.target.classList.contains('spec-rev-skip-cb')) return;
        revSkip = e.target.checked;
        const note = root.querySelector('.spec-rev-note');
        if (note) note.disabled = revSkip;
    });
    function isDirty() {
        if (!editing) return false;
        collect();
        const sheet = GS.sheetById(draftSheetId);
        return !!revNote.trim() || JSON.stringify(draft) !== JSON.stringify(normalize(sheet && sheet.spec));
    }
    async function save() {
        collect();
        // 空の行（すべて空欄）は保存しない
        draft.machines = draft.machines.filter(m => MACHINE_COLS.some(c => String(m[c[0]] || '').trim()));
        // 中身を変更したときは、改訂番号と日付を自動で進め、改訂内容を履歴に残す（「改訂として記録しない」のときはそのまま）
        const orig = normalize((GS.sheetById(draftSheetId) || {}).spec);
        if (!revSkip && body(draft) !== body(orig)) {
            if (!revNote.trim() && !confirm('「今回の改訂内容」が空欄です。このまま保存しますか？')) return;
            const rev = nextRev(orig.revision), date = today();
            if (!draft.revisions.length && orig.revision) draft.revisions.push({ rev: orig.revision, date: '', note: orig.revision_note });
            draft.revisions.push({ rev, date, note: revNote.trim() });
            draft.revision = `${rev}（${date}）`;
            draft.revision_note = revNote.trim();
        }
        const btn = root.querySelector('[data-spec="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
        try {
            await GS.saveSheet(draftSheetId, { spec: draft });
            endEdit();
        } catch (err) {
            console.error('仕様書の保存に失敗しました', err);
            alert('保存に失敗しました：' + (err.message || err));
            if (btn) { btn.disabled = false; btn.textContent = '保存'; }
        }
    }

    root.addEventListener('click', e => {
        const b = e.target.closest('[data-spec]');
        if (b) {
            const act = b.dataset.spec;
            if (act === 'edit') startEdit();
            else if (act === 'cancel') { if (!isDirty() || confirm('編集内容を破棄して元に戻しますか？')) endEdit(); }
            else if (act === 'save') save();
            else if (act === 'addrow') { collect(); draft.machines.push({}); render(); }
            else if (act === 'delrow') { collect(); draft.machines.splice(Number(b.dataset.i), 1); render(); }
            return;
        }
        if (!editing) return;
        const cell = e.target.closest('.cell-toggle[data-scope]');
        if (cell) {
            collect();
            const r = draft.scope[cell.dataset.scope];
            if (r.na) return;
            r[cell.dataset.side] = !r[cell.dataset.side];
            render();
        }
    }, true);
    root.addEventListener('change', e => {
        const cb = e.target.closest('.na-checkbox[data-na]');
        if (!cb || !editing) return;
        collect();
        draft.scope[cb.dataset.na].na = cb.checked;
        render();
    });

    // 外注先の切り替え：編集中なら破棄の確認をしてから切り替える
    document.addEventListener('click', e => {
        const b = e.target.closest('.vendor-switch-btn');
        if (!b || !editing) return;
        if (String(b.dataset.v) === String(draftSheetId)) { e.stopImmediatePropagation(); return; }
        if (isDirty() && !confirm('仕様書の編集内容を保存していません。破棄して外注先を切り替えますか？')) { e.stopImmediatePropagation(); return; }
        editing = false; draft = null; draftSheetId = null;
    }, true);
    document.addEventListener('gaichusheetchange', render);
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

    render();
})();

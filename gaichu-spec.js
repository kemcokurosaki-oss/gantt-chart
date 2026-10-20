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
        const tabs = `<div class="spec-tabs">${st.sheets.map(s => `<button type="button" class="vendor-switch-btn${sheet && sheet.id === s.id ? ' active' : ''}" data-v="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.display)}</button>`).join('')}`
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
            <div class="info-item"><div class="k">1-1) 工事番号</div><div class="v">${esc(st.pn)}</div></div>
            <div class="info-item"><div class="k">1-2) 工事名称</div><div class="v">${dash(p.name)}</div></div>
            <div class="info-item"><div class="k">1-3) 貴社名</div><div class="v">${dash(sheet.name)}</div></div>
            <div class="info-item"><div class="k">1-4) ご担当者</div><div class="v">${e ? input('contact', s.contact, ' placeholder="例：取締役工場長　山田 太郎 様"') : dash(s.contact)}</div></div>
            <div class="info-item"><div class="k">1-5) 出荷納期</div><div class="v">${fmtDate(p.shipDate)}</div></div>
            <div class="info-item"><div class="k">改訂</div><div class="v">${e
                ? input('revision', s.revision, ' placeholder="例：R2（2026/9/2）"') + input('revision_note', s.revision_note, ' placeholder="例：初版：2026/6/18／改訂内容"')
                : `${dash(s.revision)}${s.revision_note ? `<small>${esc(s.revision_note)}</small>` : ''}`}</div></div>
        </div>`;

        const machines = `<div class="subhead">1-6) 発注機械</div>
            <table class="data-table">
                <thead><tr>${MACHINE_COLS.map(c => `<th>${c[1]}</th>`).join('')}${e ? '<th style="width:40px;"></th>' : ''}</tr></thead>
                <tbody>${s.machines.length ? s.machines.map((m, i) => `<tr>${MACHINE_COLS.map(c => `<td>${e ? input(`machines.${i}.${c[0]}`, m[c[0]]) : dash(m[c[0]])}</td>`).join('')}${e ? `<td><button type="button" class="spec-del" data-spec="delrow" data-i="${i}" title="この行を削除">✕</button></td>` : ''}</tr>`).join('')
                    : `<tr><td colspan="${MACHINE_COLS.length + (e ? 1 : 0)}" class="spec-empty">（未入力）</td></tr>`}</tbody>
            </table>${e ? '<button type="button" class="spec-btn spec-addrow" data-spec="addrow">＋ 行を追加</button>' : ''}`;

        const paint = `<div class="subhead">1-7) 塗装色</div>
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
        editing = true;
        render();
    }
    function endEdit() { editing = false; draft = null; draftSheetId = null; render(); }
    function isDirty() {
        if (!editing) return false;
        collect();
        const sheet = GS.sheetById(draftSheetId);
        return JSON.stringify(draft) !== JSON.stringify(normalize(sheet && sheet.spec));
    }
    async function save() {
        collect();
        // 空の行（すべて空欄）は保存しない
        draft.machines = draft.machines.filter(m => MACHINE_COLS.some(c => String(m[c[0]] || '').trim()));
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

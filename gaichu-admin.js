// 外注先用シートの管理画面（工事一覧・工事詳細シートの両方から使う。管理者のみ）
//   GaichuAdmin.openAdd({ pn, onDone })     … 外注先シートの追加（pn を渡すとその工番に固定）
//   GaichuAdmin.openManage({ pn, onDone })  … その工番の外注先シートの一覧・削除・追加
//   GaichuAdmin.openVendors({ onDone })     … 外注先マスタの管理
//   同じ外注先はどの工番でも同じ色（ほかの工番で使っている色に固定）。削除すると仕様書・体制表も消える（体制表は FK の cascade）。
// 読み込み前に supabase.min.js と S_URL / S_KEY を用意しておくこと。
(function () {
    const PALETTE = ['#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#16a085', '#d35400', '#2980b9', '#7f8c8d'];
    const BUCKET = 'gaichu-figures';
    let client = null;
    const db = () => (client = client || supabase.createClient(S_URL, S_KEY));

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function chipStyle(color) {
        const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
        if (!m) return 'background:#f3f3f1;color:#2b2f36';
        const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
        const hex = arr => '#' + arr.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
        return `background:${hex(ch.map(c => c + (255 - c) * 0.88))};color:${hex(ch.map(c => c * 0.68))}`;
    }
    const chip = (label, color) => `<span class="ga-chip" style="${chipStyle(color)}"><span class="ga-dot" style="background:${esc(color)}"></span>${esc(label)}</span>`;
    const vendorName = v => v.display_name || v.name;

    // 画面の見た目（どのページでも同じになるよう、ここで用意する）
    function addStyle() {
        if (document.getElementById('gaichuAdminStyle')) return;
        const st = document.createElement('style');
        st.id = 'gaichuAdminStyle';
        st.textContent = `
.ga-bg { position: fixed; inset: 0; z-index: 3000; background: rgba(25,27,31,0.45); display: flex; align-items: center; justify-content: center; font-family: 'Noto Sans JP', sans-serif; }
.ga-modal { background: #fff; border-radius: 10px; width: min(560px, 94vw); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.25); color: #2b2f36; }
.ga-head { padding: 14px 20px; font-weight: 700; border-bottom: 1px solid #e4e3df; font-size: 15px; }
.ga-body { padding: 14px 20px; overflow-y: auto; font-size: 13px; }
.ga-foot { padding: 12px 20px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid #e4e3df; }
.ga-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #2b2f36; background: #fff; color: #2b2f36; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.ga-btn:hover { background: #eceef1; }
.ga-btn--primary { background: #2b2f36; color: #fff; }
.ga-btn--primary:hover { background: #16191d; }
.ga-btn--danger { border-color: #e74c3c; color: #c0392b; }
.ga-btn--danger:hover { background: #fdecea; }
.ga-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.ga-field > span { font-size: 12px; color: #5b6068; font-weight: 700; }
.ga-field input, .ga-field select, .ga-table input[type=text], .ga-table input[type=number] { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid #cfd0cc; border-radius: 4px; width: 100%; box-sizing: border-box; }
.ga-field input[type=color] { width: 60px; height: 32px; padding: 2px; }
.ga-field input[type=color]:disabled { opacity: .8; cursor: not-allowed; }
.ga-note { font-size: 12px; color: #6b7079; margin: -4px 0 10px; }
.ga-err { color: #c0392b; font-size: 12.5px; min-height: 1em; }
.ga-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.ga-table th { font-size: 12px; color: #5b6068; text-align: left; padding: 4px; }
.ga-table td { padding: 4px; border-bottom: 1px solid #efefec; }
.ga-num { width: 64px !important; }
.ga-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
.ga-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ga-combo { position: relative; }
.ga-combo-list { position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 2; max-height: 260px; overflow-y: auto; background: #fff; border: 1px solid #cfd0cc; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,0.15); }
.ga-combo-item { display: grid; grid-template-columns: 44px minmax(0, 11em) minmax(0, 1fr); gap: 10px; align-items: baseline; width: 100%; padding: 7px 10px; border: 0; background: none; text-align: left; font: inherit; font-size: 13px; cursor: pointer; color: #2b2f36; }
.ga-combo-item b { color: #2b2f36; }
.ga-combo-item small { color: #5b6068; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-combo-item:hover, .ga-combo-item.is-active { background: #eceef1; }
.ga-combo-empty { padding: 8px 10px; color: #6b7079; font-size: 12.5px; }
.ga-table tr.ga-vrow td { border-bottom: 0; padding-bottom: 2px; }
.ga-table tr.ga-reprow td { padding-top: 0; padding-bottom: 8px; }
.ga-rep { display: grid; grid-template-columns: 52px 1fr 1fr 1fr 1.4fr; gap: 6px; align-items: center; }
.ga-rep > span { font-size: 11.5px; color: #6b7079; font-weight: 700; }`;
        document.head.appendChild(st);
    }

    function modal(title, body, buttons) {
        addStyle();
        const bg = document.createElement('div');
        bg.className = 'ga-bg';
        bg.innerHTML = `<div class="ga-modal"><div class="ga-head">${esc(title)}</div><div class="ga-body">${body}<div class="ga-err"></div></div><div class="ga-foot"></div></div>`;
        const foot = bg.querySelector('.ga-foot');
        buttons.forEach(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'ga-btn' + (b.primary ? ' ga-btn--primary' : '');
            el.textContent = b.label;
            el.addEventListener('click', b.onClick);
            foot.appendChild(el);
        });
        document.body.appendChild(bg);
        return { el: bg, close: () => bg.remove(), err: msg => { bg.querySelector('.ga-err').textContent = msg; } };
    }

    // 最新の外注先シートと外注先マスタを読み込む
    async function context() {
        const [sheets, vendors] = await Promise.all([
            db().from('gaichu_sheets').select('id, project_number, vendor_id, color, sort_order, gaichu_vendors(name, display_name)').order('sort_order').order('id'),
            db().from('gaichu_vendors').select('id, name, display_name, sort_order, active').order('sort_order').order('name'),
        ]);
        if (sheets.error) throw sheets.error;
        if (vendors.error) throw vendors.error;
        return {
            sheets: (sheets.data || []).map(r => ({ id: r.id, pn: String(r.project_number), vendor_id: r.vendor_id, color: r.color || '#7f8c8d', display: (r.gaichu_vendors && vendorName(r.gaichu_vendors)) || '' })),
            vendors: vendors.data || [],
        };
    }
    const vendorColor = (ctx, vid) => (ctx.sheets.find(s => s.vendor_id === vid && s.color) || {}).color || null;

    // 工番の候補一覧（ブラウザの入力候補ではなく、ページの中に出す）
    function combo(input, items) {
        const list = document.createElement('div');
        list.className = 'ga-combo-list';
        list.hidden = true;
        input.parentElement.appendChild(list);
        let active = -1, shown = [];
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            shown = items.filter(it => !q || [it.pn, it.customer, it.name].some(s => (s || '').toLowerCase().includes(q))).slice(0, 100);
            active = Math.min(active, shown.length - 1);
            list.innerHTML = shown.length
                ? shown.map((it, i) => `<button type="button" class="ga-combo-item${i === active ? ' is-active' : ''}" data-i="${i}"><b>${esc(it.pn)}</b><small title="${esc(it.customer || '')}">${esc(it.customer || '')}</small><small title="${esc(it.name || '')}">${esc(it.name || '')}</small></button>`).join('')
                : '<div class="ga-combo-empty">該当する工番がありません（直接入力もできます）</div>';
            list.hidden = false;
        };
        const pick = i => { if (shown[i]) { input.value = shown[i].pn; list.hidden = true; input.dispatchEvent(new Event('change')); } };
        // 一覧はクリックか入力で開く（画面を開いたときの自動の選択では開かない）。↓キーでも開ける
        input.addEventListener('click', draw);
        input.addEventListener('input', () => { active = -1; draw(); });
        input.addEventListener('keydown', e => {
            if (list.hidden) { if (e.key === 'ArrowDown') { e.preventDefault(); active = 0; draw(); } return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); draw(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
            else if (e.key === 'Escape') { list.hidden = true; }
        });
        list.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(Number(b.dataset.i)); } });
        input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    }

    // ===== 外注先シートの追加 =====
    async function openAdd({ pn: fixedPn, onDone } = {}) {
        let ctx;
        try { ctx = await context(); } catch (e) { alert('読み込めませんでした：' + (e.message || e)); return; }
        // 候補：工程表で担当に「外注」が入っているタスクがあり、まだ外注先シートがない工番（並びは工程表の工事一覧と同じ）
        const { data: jobs } = await db().from('tasks').select('project_number, project_details, customer_name').ilike('owner', '%外注%').limit(5000);
        const jobMap = new Map();
        (jobs || []).forEach(j => {
            const pn = String(j.project_number || '').trim();
            if (!pn) return;
            const cur = jobMap.get(pn) || { name: '', customer: '' };
            jobMap.set(pn, { name: cur.name || j.project_details || '', customer: cur.customer || j.customer_name || '' });
        });
        const usedPns = new Set(ctx.sheets.map(s => s.pn));
        const candidates = [...jobMap.keys()].filter(pn => !usedPns.has(pn)).sort().map(pn => ({ pn, ...jobMap.get(pn) }));
        const usedColors = new Set(ctx.sheets.map(s => s.color));
        const freeColor = PALETTE.find(c => !usedColors.has(c)) || PALETTE[0];
        const here = fixedPn ? ctx.sheets.filter(s => s.pn === fixedPn).map(s => s.vendor_id) : [];
        const m = modal(fixedPn ? `${fixedPn} に外注先を追加` : '外注先シートを追加', `
            <div class="ga-field"><span>工番</span><div class="ga-combo">
                <input type="text" data-f="pn" autocomplete="off" spellcheck="false" placeholder="工番を入力するか、候補から選ぶ"${fixedPn ? ` value="${esc(fixedPn)}" readonly` : ''}></div></div>
            ${fixedPn ? '' : '<p class="ga-note">候補は、工程表で担当に「外注」が入っているタスクがあり、まだ外注先シートがない工番です（工程表と同じ順）。すでにシートがある工番に外注先を足すときは、その工番の「外注先の追加・削除」から追加してください。</p>'}
            <label class="ga-field"><span>外注先</span><select data-f="vendor">
                <option value="">― 選んでください ―</option>
                ${ctx.vendors.filter(v => v.active !== false && !here.includes(v.id)).map(v => `<option value="${v.id}">${esc(vendorName(v))}</option>`).join('')}
                <option value="__new">＋ 新しい外注先を登録する</option></select></label>
            <div class="ga-new-vendor" hidden>
                <label class="ga-field"><span>正式社名</span><input type="text" data-f="vname" autocomplete="off" placeholder="例：株式会社〇〇工業"></label>
                <label class="ga-field"><span>表示名（殿などを付けた呼び方）</span><input type="text" data-f="vdisp" autocomplete="off" placeholder="例：〇〇工業㈱殿"></label>
            </div>
            <label class="ga-field"><span>色分けの色</span><input type="color" data-f="color" value="${freeColor}"></label>
            <p class="ga-note ga-color-note" hidden>この外注先は、ほかの工番と同じ色を使います（色は外注先ごとに固定）。</p>`, [
            { label: 'キャンセル', onClick: () => m.close() },
            { label: '追加', primary: true, onClick: async () => {
                const f = n => m.el.querySelector(`[data-f=${n}]`);
                const pn = f('pn').value.trim();
                if (!pn) return m.err('工番を入力してください。');
                let vid = f('vendor').value;
                if (!vid) return m.err('外注先を選んでください。');
                try {
                    if (vid === '__new') {
                        const name = f('vname').value.trim(), disp = f('vdisp').value.trim();
                        if (!name) return m.err('新しい外注先の正式社名を入力してください。');
                        const { data, error } = await db().from('gaichu_vendors')
                            .insert({ name, display_name: disp || null, sort_order: (ctx.vendors.length + 1) * 10 }).select('id').single();
                        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'この正式社名の外注先はすでに登録されています。一覧から選んでください。' : error.message);
                        vid = data.id;
                    }
                    const count = ctx.sheets.filter(s => s.pn === pn).length;
                    const { error } = await db().from('gaichu_sheets')
                        .insert({ project_number: pn, vendor_id: Number(vid), color: f('color').value, sort_order: (count + 1) * 10 }).select('id').single();
                    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'この工番には、その外注先のシートがすでにあります。' : error.message);
                } catch (e) { return m.err('追加できませんでした：' + (e.message || e)); }
                m.close();
                if (onDone) onDone();
            } },
        ]);
        const pnInput = m.el.querySelector('[data-f=pn]');
        if (!fixedPn) combo(pnInput, candidates);
        // すでにほかの工番で使っている外注先は、その色に固定する（同じ会社はどの工番でも同じ色にそろえる）
        const colorInput = m.el.querySelector('[data-f=color]');
        const colorNote = m.el.querySelector('.ga-color-note');
        m.el.querySelector('[data-f=vendor]').addEventListener('change', e => {
            const v = e.target.value;
            m.el.querySelector('.ga-new-vendor').hidden = v !== '__new';
            const fixed = v && v !== '__new' ? vendorColor(ctx, Number(v)) : null;
            colorInput.value = fixed || freeColor;
            colorInput.disabled = !!fixed;
            colorNote.hidden = !fixed;
        });
        (fixedPn ? m.el.querySelector('[data-f=vendor]') : pnInput).focus();
    }

    // ===== その工番の外注先シートの管理（一覧・削除・追加） =====
    async function openManage({ pn, onDone } = {}) {
        let ctx;
        try { ctx = await context(); } catch (e) { alert('読み込めませんでした：' + (e.message || e)); return; }
        const sheets = ctx.sheets.filter(s => s.pn === String(pn));
        const m = modal(`${pn} の外注先`, `
            ${sheets.length ? `<table class="ga-table"><tbody>${sheets.map(s => `<tr>
                <td>${chip(s.display, s.color)}</td>
                <td style="text-align:right"><button type="button" class="ga-btn ga-btn--danger" data-del-sheet="${s.id}">削除</button></td></tr>`).join('')}</tbody></table>`
                : '<p class="ga-note" style="margin:0 0 10px">この工番には外注先シートがありません。</p>'}
            <button type="button" class="ga-btn" data-add-here>＋ この工番に外注先を追加</button>
            <p class="ga-note" style="margin-top:10px">削除すると、その外注先の組立発注仕様書と体制表も削除されます（元に戻せません）。組立範囲（図面・担当範囲一覧）は工番ごとなので、最後の1社を削除するときに残すか選べます。</p>`, [
            { label: '閉じる', onClick: () => m.close() },
        ]);
        m.el.querySelector('[data-add-here]').addEventListener('click', () => { m.close(); openAdd({ pn: String(pn), onDone }); });
        m.el.querySelectorAll('[data-del-sheet]').forEach(btn => btn.addEventListener('click', async () => {
            const sheet = sheets.find(s => String(s.id) === btn.dataset.delSheet);
            if (!confirm(`「${sheet.display}」の外注先シート（工番 ${pn}）を削除します。\nこの外注先の組立発注仕様書と体制表も削除され、元に戻せません。よろしいですか？`)) return;
            const dropScope = sheets.length === 1 && confirm(`工番 ${pn} の外注先シートがなくなります。\n組立範囲（図面の画像・色分け枠・担当範囲一覧）も削除しますか？\n［OK］削除する　［キャンセル］残す（あとで外注先を追加すると、そのまま使えます）`);
            try {
                const { data, error } = await db().from('gaichu_sheets').delete().eq('id', sheet.id).select('id');
                if (error) throw error;
                if (!data || !data.length) throw new Error('削除できませんでした（編集の権限がないか、ログインが切れています）');
                if (dropScope) {
                    const { data: sc } = await db().from('gaichu_scopes').select('figures').eq('project_number', String(pn)).maybeSingle();
                    const paths = ((sc && sc.figures) || []).map(f => f.path).filter(Boolean);
                    if (paths.length) {
                        const { error: rmErr } = await db().storage.from(BUCKET).remove(paths);
                        if (rmErr) console.warn('図面の画像を削除できませんでした', rmErr);
                    }
                    const { error: scErr } = await db().from('gaichu_scopes').delete().eq('project_number', String(pn));
                    if (scErr) throw scErr;
                }
            } catch (e) { return m.err('削除できませんでした：' + (e.message || e)); }
            m.close();
            if (onDone) onDone();
        }));
    }

    // ===== 外注先マスタの管理（社名・表示名・並び順・使用・代表者の変更と追加。使っている外注先があるため削除はしない） =====
    //   代表者は個人情報なので別テーブル gaichu_vendor_contacts に持つ。仕様書のご担当者（工事ごとの入力が空欄のとき）と体制表のカードの選択肢に使う
    const REP_FIELDS = ['title', 'name', 'tel', 'email'];
    async function openVendors({ onDone } = {}) {
        let ctx, reps;
        try {
            ctx = await context();
            const r = await db().from('gaichu_vendor_contacts').select('vendor_id, title, name, tel, email');
            if (r.error) console.warn('外注先の代表者の取得に失敗しました', r.error);
            reps = new Map((r.data || []).map(x => [x.vendor_id, x]));
        } catch (e) { alert('読み込めませんでした：' + (e.message || e)); return; }
        const rows = ctx.vendors.map(v => {
            const rep = reps.get(v.id) || {};
            return { ...v, hadRep: reps.has(v.id), ...Object.fromEntries(REP_FIELDS.map(k => ['rep_' + k, rep[k] || ''])) };
        });
        const m = modal('外注先マスタの管理', `
            <p class="ga-note">「使用」を外すと、外注先シートを追加するときの選択肢に出なくなります（登録済みのシートはそのまま）。<br>代表者は、仕様書の「ご担当者」（工事ごとに入力していないとき）に役職と氏名を表示し、体制表のカードを追加するときの選択肢にも出ます。</p>
            <table class="ga-table"><thead><tr><th>正式社名</th><th>表示名</th><th>順</th><th>使用</th></tr></thead><tbody></tbody></table>
            <button type="button" class="ga-btn" data-addv>＋ 行を追加</button>`, [
            { label: '閉じる', onClick: () => m.close() },
            { label: '保存', primary: true, onClick: async () => {
                collect();
                if (rows.some(r => !String(r.name || '').trim())) return m.err('正式社名が空欄の行があります。');
                try {
                    for (const r of rows) {
                        const rec = { name: r.name.trim(), display_name: String(r.display_name || '').trim() || null, sort_order: Number(r.sort_order) || 0, active: !!r.active, updated_at: new Date().toISOString() };
                        const q = r.id ? db().from('gaichu_vendors').update(rec).eq('id', r.id) : db().from('gaichu_vendors').insert(rec);
                        const { data, error } = await q.select('id');
                        if (error) throw error;
                        if (!data || !data.length) throw new Error('保存できませんでした（編集の権限がないか、ログインが切れています）');
                        // 代表者：どれか入っていれば登録・更新、全部空欄なら登録を消す
                        const rep = Object.fromEntries(REP_FIELDS.map(k => [k, String(r['rep_' + k] || '').trim() || null]));
                        const vendorId = data[0].id;
                        if (REP_FIELDS.some(k => rep[k])) {
                            const { data: rd, error: re } = await db().from('gaichu_vendor_contacts')
                                .upsert({ vendor_id: vendorId, ...rep, updated_at: new Date().toISOString() }, { onConflict: 'vendor_id' }).select('vendor_id');
                            if (re) throw re;
                            if (!rd || !rd.length) throw new Error('代表者を保存できませんでした（編集の権限がないか、ログインが切れています）');
                        } else if (r.hadRep) {
                            const { error: re } = await db().from('gaichu_vendor_contacts').delete().eq('vendor_id', vendorId);
                            if (re) throw re;
                        }
                    }
                } catch (e) { return m.err('保存できませんでした：' + (e.message || e)); }
                m.close();
                if (onDone) onDone();
            } },
        ]);
        const tbody = m.el.querySelector('tbody');
        const draw = () => {
            tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="ga-vrow">
                <td><input type="text" data-f="name" autocomplete="off" value="${esc(r.name)}"></td>
                <td><input type="text" data-f="display_name" autocomplete="off" value="${esc(r.display_name)}"></td>
                <td><input type="number" data-f="sort_order" value="${esc(r.sort_order)}" class="ga-num"></td>
                <td style="text-align:center"><input type="checkbox" data-f="active"${r.active !== false ? ' checked' : ''}></td></tr>
                <tr data-i="${i}" class="ga-reprow"><td colspan="4"><div class="ga-rep"><span>代表者</span>
                    <input type="text" data-f="rep_title" autocomplete="off" value="${esc(r.rep_title)}" placeholder="役職（例：代表取締役）">
                    <input type="text" data-f="rep_name" autocomplete="off" value="${esc(r.rep_name)}" placeholder="氏名">
                    <input type="text" data-f="rep_tel" autocomplete="off" value="${esc(r.rep_tel)}" placeholder="電話" inputmode="tel">
                    <input type="text" data-f="rep_email" autocomplete="off" value="${esc(r.rep_email)}" placeholder="メール" inputmode="email"></div></td></tr>`).join('');
        };
        const collect = () => tbody.querySelectorAll('tr').forEach(tr => {
            const r = rows[tr.dataset.i];
            tr.querySelectorAll('[data-f]').forEach(inp => { r[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value; });
        });
        m.el.querySelector('[data-addv]').addEventListener('click', () => { collect(); rows.push({ id: null, name: '', display_name: '', sort_order: (rows.length + 1) * 10, active: true, hadRep: false, rep_title: '', rep_name: '', rep_tel: '', rep_email: '' }); draw(); });
        m.el.querySelector('.ga-modal').style.width = 'min(780px, 94vw)';
        draw();
    }

    window.GaichuAdmin = { openAdd, openManage, openVendors };
})();

// 外注先用シートの管理画面（工事一覧・工事詳細シートの両方から使う。管理者のみ）
//   GaichuAdmin.openAdd({ pn, onDone })     … 外注先シートの追加（pn を渡すとその工番に固定）
//   GaichuAdmin.openManage({ pn, onDone })  … その工番の外注先シートの一覧・削除・追加
//   GaichuAdmin.openVendors({ onDone })     … 外注先マスタの管理
//   同じ外注先はどの工番でも同じ色（ほかの工番で使っている色に固定）。削除すると仕様書・体制表も消える（体制表は FK の cascade）。
//   見た目は体制表の「カードの入力画面」「社内名簿の管理」にそろえる（薄いグレーの地＋白い区画、角丸6pxの入力欄、スイッチ）
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
    const vendorName = v => v.name || v.display_name;   // 正式社名（display_name は略称）
    const autoShort = name => String(name || '').replace(/株式会社|有限会社|合同会社|（株）|\(株\)|（有）|\(有\)/g, '').trim();

    // 画面の見た目（どのページでも同じになるよう、ここで用意する）
    function addStyle() {
        if (document.getElementById('gaichuAdminStyle')) return;
        const st = document.createElement('style');
        st.id = 'gaichuAdminStyle';
        st.textContent = `
.ga-bg { position: fixed; inset: 0; z-index: 3000; background: rgba(25,27,31,0.45); display: flex; align-items: center; justify-content: center; font-family: 'Noto Sans JP', sans-serif; }
.ga-modal { background: #fff; border-radius: 10px; width: min(560px, 94vw); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.25); color: #2b2f36; overflow: hidden; }
.ga-head { padding: 14px 20px; font-weight: 700; border-bottom: 1px solid #e4e3df; font-size: 15px; display: flex; align-items: baseline; gap: 14px; }
.ga-head-count { font-size: 12.5px; font-weight: 400; color: #5b6068; }
.ga-body { padding: 14px 20px; overflow-y: auto; font-size: 13px; }
.ga-foot { padding: 12px 20px; display: flex; gap: 8px; justify-content: flex-end; align-items: center; border-top: 1px solid #e4e3df; }
.ga-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #2b2f36; background: #fff; color: #2b2f36; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.ga-btn:hover { background: #eceef1; }
.ga-btn--ghost { border-color: #cfd0cc; color: #5b6068; }
.ga-btn--primary { background: #2b2f36; color: #fff; padding: 6px 18px; }
.ga-btn--primary:hover { background: #16191d; }
.ga-btn--danger { border-color: #e74c3c; color: #c0392b; }
.ga-btn--danger:hover { background: #fdecea; }
.ga-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.ga-field > span { font-size: 12px; color: #5b6068; font-weight: 700; }
.ga-field input, .ga-field select, .ga-table input[type=text], .ga-table input[type=number] { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid #cfd0cc; border-radius: 4px; width: 100%; box-sizing: border-box; }
.ga-note { font-size: 12px; color: #6b7079; margin: -4px 0 10px; }
.ga-err { color: #c0392b; font-size: 12.5px; min-height: 1em; }
.ga-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.ga-table th { font-size: 12px; color: #5b6068; text-align: left; padding: 4px; }
.ga-table td { padding: 4px; border-bottom: 1px solid #efefec; }
.ga-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
.ga-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
/* 入力画面（外注先シートの追加・外注先マスタの管理） */
.ga-modal--form .ga-body { background: #fafaf8; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.ga-modal--form .ga-body > * { flex-shrink: 0; }
.ga-modal--form .ga-err:empty { display: none; }
.ga-modal--wide { width: min(780px, 94vw); }
.ga-modal--form input[type=text], .ga-modal--form input[type=number], .ga-modal--form select { font: inherit; font-size: 14px; padding: 7px 10px; border: 1px solid #cfd0cc; border-radius: 6px; background: #fff; color: #2b2f36; width: 100%; min-width: 0; box-sizing: border-box; }
.ga-modal--form input:focus, .ga-modal--form select:focus { outline: none; border-color: #2b2f36; box-shadow: 0 0 0 3px rgba(43,47,54,.18); }
.ga-modal--form input[readonly] { background: #f3f3f1; }
.ga-modal--form input::placeholder { color: #a3a6ab; }
.ga-modal--form select { cursor: pointer; }
.ga-modal--form .ga-field { margin-bottom: 0; min-width: 0; }
.ga-field em { color: #c0392b; font-style: normal; }
.ga-sec { background: #fff; border: 1px solid #e4e3df; border-radius: 8px; padding: 12px 14px; }
.ga-sechead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ga-sechead b { font-size: 13px; color: #2b2f36; }
.ga-sechead small { font-size: 11.5px; color: #6b7079; }
.ga-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: #5b6068; }
.ga-grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.ga-new-vendor { margin-top: 12px; padding-top: 12px; border-top: 1px solid #efefec; }
.ga-new-vendor[hidden] { display: none; }   /* .ga-grid2 の display より優先して隠す */
.ga-pn { font-weight: 700; }
/* 工番の候補一覧 */
.ga-combo { position: relative; }
.ga-combo-list { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 2; max-height: 260px; overflow-y: auto; background: #fff; border: 1px solid #cfd0cc; border-radius: 8px; box-shadow: 0 8px 28px rgba(25,27,31,.22); }
.ga-combo-head { position: sticky; top: 0; padding: 6px 12px; font-size: 11.5px; font-weight: 700; color: #6b7079; background: #f7f7f5; border-bottom: 1px solid #e4e3df; }
.ga-combo-item { display: grid; grid-template-columns: 52px minmax(0, 11em) minmax(0, 1fr); gap: 10px; align-items: baseline; width: 100%; padding: 8px 12px; border: 0; border-bottom: 1px solid #efefec; background: none; text-align: left; font: inherit; font-size: 13px; cursor: pointer; color: #2b2f36; }
.ga-combo-item b { color: #2b2f36; font-size: 14px; font-variant-numeric: tabular-nums; }
.ga-combo-item small { color: #5b6068; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-combo-item:hover, .ga-combo-item.is-active { background: #f5f5f3; }
.ga-combo-empty { padding: 16px 12px; text-align: center; color: #6b7079; font-size: 12.5px; }
/* 外注先のプルダウン（体制表の担当者のプルダウンと同じ見た目） */
.ga-vpick { position: relative; }
.ga-pick { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; text-align: left; font: inherit; font-size: 14px; padding: 7px 10px; border: 1px solid #cfd0cc; border-radius: 6px; background: #fff; color: #2b2f36; cursor: pointer; }
.ga-pick:hover { border-color: #2b2f36; }
.ga-pick:focus, .ga-pick.is-open { outline: none; border-color: #2b2f36; box-shadow: 0 0 0 3px rgba(43,47,54,.18); }
.ga-pick-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; white-space: nowrap; }
.ga-pick-main b { font-size: 14px; }
.ga-pick-main small { font-size: 12px; color: #5b6068; overflow: hidden; text-overflow: ellipsis; }
.ga-pick-empty { color: #6b7079; }
.ga-pick > i { flex: none; width: 8px; height: 8px; border-right: 2px solid #5b6068; border-bottom: 2px solid #5b6068; transform: translateY(-2px) rotate(45deg); transition: transform .12s; }
.ga-pick.is-open > i { transform: translateY(2px) rotate(-135deg); }
.ga-pop { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 3; display: flex; flex-direction: column; max-height: 300px; background: #fff; border: 1px solid #cfd0cc; border-radius: 8px; box-shadow: 0 8px 28px rgba(25,27,31,.22); overflow: hidden; }
.ga-pop[hidden] { display: none; }
.ga-pop-head { flex: none; padding: 6px 12px; font-size: 11.5px; font-weight: 700; color: #6b7079; background: #f7f7f5; border-bottom: 1px solid #e4e3df; }
.ga-pop-list { position: relative; overflow-y: auto; min-height: 0; }
.ga-pop-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border: 0; border-bottom: 1px solid #efefec; background: none; text-align: left; font: inherit; color: #2b2f36; cursor: pointer; }
.ga-pop-item b { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-pop-item small { flex: none; font-size: 12px; color: #5b6068; }
.ga-pop-item .ga-dot { width: 10px; height: 10px; }
.ga-pop-item .ga-dot.is-none { background: transparent; border: 1px dashed #aaadb1; box-sizing: border-box; }
.ga-pop-item:hover, .ga-pop-item.is-hi { background: #f5f5f3; }
.ga-pop-item.is-sel { background: #eceef1; box-shadow: inset 3px 0 0 #2b2f36; }
.ga-pop-new { flex: none; border-top: 1px solid #e4e3df; border-bottom: 0; font-size: 13.5px; font-weight: 700; }
.ga-pop-empty { padding: 16px 12px; text-align: center; font-size: 12.5px; color: #6b7079; }
/* 色分けの色 */
.ga-colors { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ga-swatches { display: flex; gap: 8px; align-items: center; }
.ga-swatches.is-fixed { opacity: .35; }
.ga-sw { width: 26px; height: 26px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.ga-sw.is-on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2b2f36; }
.ga-swatches.is-fixed .ga-sw, .ga-swatches.is-fixed .ga-sw-custom { cursor: not-allowed; }
.ga-sw-custom { position: relative; width: 26px; height: 26px; border-radius: 50%; border: 1px dashed #aaadb1; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #5b6068; overflow: hidden; }
.ga-sw-custom.is-on { border: 0; color: transparent; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2b2f36; }
.ga-sw-custom input { position: absolute; inset: 0; opacity: 0; cursor: inherit; width: 100%; height: 100%; padding: 0; border: 0; }
.ga-colors .ga-chip { margin-left: auto; }
.ga-fixnote { margin-top: 10px; padding: 7px 10px; background: #f7f7f5; border-radius: 6px; font-size: 12px; color: #5b6068; }
/* 外注先マスタの管理 */
.ga-caution { background: #fff8e1; border: 1px solid #f0d58a; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.ga-caution-head { display: flex; align-items: center; gap: 8px; }
.ga-caution-head span { font-size: 11.5px; font-weight: 700; color: #fff; background: #b07800; padding: 1px 8px; border-radius: 3px; }
.ga-caution-head b { font-size: 12.5px; color: #6b4a00; }
.ga-caution ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; line-height: 1.6; color: #5b4a1f; }
.ga-vlist { display: flex; flex-direction: column; gap: 10px; }
.ga-vcard { background: #fff; border: 1px solid #e4e3df; border-radius: 8px; overflow: hidden; }
.ga-vcard-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #efefec; }
.ga-vcard-no { font-size: 12px; font-weight: 700; color: #6b7079; font-variant-numeric: tabular-nums; }
.ga-vcard-title { font-size: 14px; color: #2b2f36; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ga-vcard-tag { flex: none; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 3px; background: #eceef1; color: #2b2f36; }
.ga-vcard-color { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #5b6068; }
.ga-vcard-color i { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.12); }
.ga-vcard-color i.is-none { border-style: dashed; }
.ga-vcard-toggle { margin-left: auto; flex: none; display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #5b6068; }
.ga-vcard-main { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 76px; gap: 12px; padding: 12px 14px; }
.ga-vcard-main .ga-field small { font-weight: 400; color: #6b7079; }
.ga-vcard input.ga-vname { font-size: 14.5px; font-weight: 700; }
.ga-vcard input.ga-vname.is-err { border-color: #e74c3c; }
.ga-vcard input[type=number] { padding: 7px 8px; font-variant-numeric: tabular-nums; }
.ga-rep { margin: 0 14px 14px; padding: 10px 12px 12px; background: #f7f7f5; border-radius: 6px; }
.ga-rep .ga-sechead { margin-bottom: 6px; }
.ga-rep .ga-sechead b { font-size: 12.5px; }
.ga-rep-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ga-rep .ga-field > span { font-size: 11.5px; color: #6b7079; }
.ga-modal--form .ga-rep input[type=text] { font-size: 13.5px; padding: 6px 10px; }
.ga-vcard.is-off .ga-vcard-head { background: #efefec; }
.ga-vcard.is-off { background: #f3f3f1; }
.ga-vcard.is-off .ga-vcard-title { color: #6b7079; }
.ga-vcard.is-off .ga-vcard-tag { background: #e4e3df; color: #6b7079; }
.ga-switch { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 40px; height: 22px; margin: 0; border-radius: 999px; background: #cfd0cc; cursor: pointer; transition: background .15s; }
.ga-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .15s; }
.ga-switch:checked { background: #2b2f36; }
.ga-switch:checked::after { left: 20px; }
.ga-switch:focus-visible { outline: 2px solid #2b2f36; outline-offset: 2px; }
.ga-addrow { font: inherit; font-size: 13px; font-weight: 700; padding: 10px; border-radius: 8px; border: 1px dashed #aaadb1; background: transparent; color: #2b2f36; cursor: pointer; }
.ga-addrow:hover { background: #fff; border-color: #2b2f36; }
.ga-status { margin-right: auto; display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #2b2f36; }
.ga-status i { width: 8px; height: 8px; border-radius: 50%; background: #f0a500; }
.ga-status[hidden] { display: none; }
@media (max-width: 640px) {
    .ga-vcard-main { grid-template-columns: minmax(0, 1fr) 76px; }
    .ga-vcard-main > :first-child { grid-column: 1 / -1; }
    .ga-rep-grid, .ga-grid2 { grid-template-columns: minmax(0, 1fr); }
}`;
        document.head.appendChild(st);
    }

    function modal(title, body, buttons, extraClass) {
        addStyle();
        const bg = document.createElement('div');
        bg.className = 'ga-bg';
        bg.innerHTML = `<div class="ga-modal ${extraClass || ''}"><div class="ga-head">${esc(title)}</div><div class="ga-body">${body}<div class="ga-err"></div></div><div class="ga-foot"></div></div>`;
        const foot = bg.querySelector('.ga-foot');
        buttons.forEach(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'ga-btn' + (b.primary ? ' ga-btn--primary' : '') + (b.ghost ? ' ga-btn--ghost' : '');
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
            db().from('gaichu_vendors').select('*').order('sort_order').order('name'),
        ]);
        if (sheets.error) throw sheets.error;
        if (vendors.error) throw vendors.error;
        return {
            sheets: (sheets.data || []).map(r => ({ id: r.id, pn: String(r.project_number), vendor_id: r.vendor_id, color: r.color || '#7f8c8d', display: (r.gaichu_vendors && vendorName(r.gaichu_vendors)) || '' })),
            vendors: vendors.data || [],
        };
    }
    // 外注先の色：外注先マスタの色（なければ、その外注先の外注先シートの色）
    const vendorColor = (ctx, vid) => {
        const v = ctx.vendors.find(x => x.id === vid);
        return (v && v.color) || (ctx.sheets.find(s => s.vendor_id === vid && s.color) || {}).color || null;
    };
    // 新しい外注先の色：ほかの外注先がまだ使っていないパレットの色。全部使っていたら、色相をずらして作る
    function nextVendorColor(ctx) {
        const used = new Set(ctx.vendors.map(v => vendorColor(ctx, v.id)).filter(Boolean).map(c => c.toLowerCase()));
        const free = PALETTE.find(c => !used.has(c.toLowerCase()));
        if (free) return free;
        const h = (used.size * 137.508) % 360, s = 0.55, l = 0.45;
        const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
        return '#' + f(0) + f(8) + f(4);
    }
    const hasColorColumn = ctx => !ctx.vendors.length || 'color' in ctx.vendors[0];   // SQL（color 列の追加）を実行済みか

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
            list.innerHTML = '<div class="ga-combo-head">外注のタスクがあり、シートがまだない工番（工程表と同じ順）</div>' + (shown.length
                ? shown.map((it, i) => `<button type="button" class="ga-combo-item${i === active ? ' is-active' : ''}" data-i="${i}"><b>${esc(it.pn)}</b><small title="${esc(it.customer || '')}">${esc(it.customer || '')}</small><small title="${esc(it.name || '')}">${esc(it.name || '')}</small></button>`).join('')
                : '<div class="ga-combo-empty">該当する工番がありません（直接入力もできます）</div>');
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
        const here = fixedPn ? ctx.sheets.filter(s => s.pn === fixedPn).map(s => s.vendor_id) : [];
        const vendorOpts = ctx.vendors.filter(v => v.active !== false && !here.includes(v.id));
        const m = modal(fixedPn ? `${fixedPn} に外注先を追加` : '外注先シートを追加', `
            <div class="ga-sec">
                <div class="ga-sechead"><b>工番</b><small>${fixedPn ? 'この工番に追加します' : '入力するか、候補から選びます'}</small></div>
                <div class="ga-combo"><input type="text" class="ga-pn" data-f="pn" autocomplete="off" spellcheck="false" placeholder="例：2830"${fixedPn ? ` value="${esc(fixedPn)}" readonly` : ''}></div>
                ${fixedPn ? '' : '<p class="ga-hint">すでにシートがある工番に外注先を足すときは、その工番の「外注先の追加・削除」から追加してください。</p>'}
            </div>
            <div class="ga-sec">
                <div class="ga-sechead"><b>外注先</b><small>外注先マスタで「使用」になっている会社が出ます</small></div>
                <div class="ga-vpick">
                    <input type="hidden" data-f="vendor" value="">
                    <button type="button" class="ga-pick" aria-haspopup="listbox"><span class="ga-pick-main"></span><i></i></button>
                    <div class="ga-pop" hidden>
                        <div class="ga-pop-head">外注先（並びは外注先マスタの順）</div>
                        <div class="ga-pop-list" role="listbox">${vendorOpts.length
                            ? vendorOpts.map(v => { const c = vendorColor(ctx, v.id); return `<button type="button" class="ga-pop-item" data-v="${v.id}" role="option"><span class="ga-dot${c ? '' : ' is-none'}"${c ? ` style="background:${esc(c)}"` : ''}></span><b>${esc(vendorName(v))}</b><small>${c ? '色は登録済み' : ''}</small></button>`; }).join('')
                            : '<div class="ga-pop-empty">選べる外注先がありません</div>'}</div>
                        <button type="button" class="ga-pop-item ga-pop-new" data-v="__new" role="option">＋ 新しい外注先を登録する</button>
                    </div>
                </div>
                <div class="ga-new-vendor ga-grid2" hidden>
                    <label class="ga-field"><span>正式社名 <em>*</em></span><input type="text" data-f="vname" autocomplete="off" placeholder="例：株式会社〇〇工業"></label>
                    <label class="ga-field"><span>略称</span><input type="text" data-f="vdisp" autocomplete="off" placeholder="空欄なら自動（〇〇工業）"></label>
                </div>
            </div>
            <p class="ga-hint">色分けの色は外注先ごとに決まっています（新しい外注先は自動で決め、外注先マスタの管理で確認できます）。</p>`, [
            { label: 'キャンセル', ghost: true, onClick: () => m.close() },
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
                        const rec = { name, display_name: disp || null, sort_order: (ctx.vendors.length + 1) * 10 };
                        if (hasColorColumn(ctx)) rec.color = nextVendorColor(ctx);   // 色は自動で決めて外注先マスタに入れる
                        const { data, error } = await db().from('gaichu_vendors').insert(rec).select('*').single();
                        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'この正式社名の外注先はすでに登録されています。一覧から選んでください。' : error.message);
                        vid = data.id;
                        ctx.vendors.push(data);
                    }
                    // 外注先マスタに色がまだない外注先（色の列を足す前に登録した会社など）は、ここで決めてマスタに入れる
                    let color = vendorColor(ctx, Number(vid));
                    if (!color) {
                        color = nextVendorColor(ctx);
                        if (hasColorColumn(ctx)) await db().from('gaichu_vendors').update({ color }).eq('id', Number(vid));
                    }
                    const count = ctx.sheets.filter(s => s.pn === pn).length;
                    const { error } = await db().from('gaichu_sheets')
                        .insert({ project_number: pn, vendor_id: Number(vid), color, sort_order: (count + 1) * 10 }).select('id').single();
                    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'この工番には、その外注先のシートがすでにあります。' : error.message);
                } catch (e) { return m.err('追加できませんでした：' + (e.message || e)); }
                m.close();
                if (onDone) onDone();
            } },
        ], 'ga-modal--form');
        const pnInput = m.el.querySelector('[data-f=pn]');
        if (!fixedPn) combo(pnInput, candidates);
        pnInput.addEventListener('input', () => m.err(''));

        // 外注先を選んだとき：新しい外注先の入力欄の開閉（色は外注先マスタの色を使うので、ここでは選ばない）
        const vendorSel = m.el.querySelector('[data-f=vendor]');
        vendorSel.addEventListener('change', () => {
            m.el.querySelector('.ga-new-vendor').hidden = vendorSel.value !== '__new';
            m.err('');
        });

        // 外注先のプルダウン（ブラウザ標準の選択肢ではなく、ページの中に出す）。↑↓・Enter・Esc でも操作できる
        const pickBtn = m.el.querySelector('.ga-pick');
        const pickMain = m.el.querySelector('.ga-pick-main');
        const pop = m.el.querySelector('.ga-pop');
        const items = [...pop.querySelectorAll('.ga-pop-item')];
        let hi = -1;
        const drawPick = () => {
            const v = vendorSel.value, vendor = ctx.vendors.find(x => String(x.id) === v);
            pickMain.innerHTML = vendor
                ? `<b>${esc(vendorName(vendor))}</b>${vendor.display_name ? `<small>${esc(vendor.display_name)}</small>` : ''}`
                : v === '__new' ? '<b>＋ 新しい外注先を登録する</b>' : '<span class="ga-pick-empty">― 選んでください ―</span>';
            items.forEach(b => b.classList.toggle('is-sel', b.dataset.v === v));
        };
        const setHi = i => { hi = i; items.forEach((b, j) => b.classList.toggle('is-hi', j === hi));
            const el = items[hi], box = pop.querySelector('.ga-pop-list');
            if (el && box.contains(el)) { if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop; else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight; }
        };
        const openPop = () => { pop.hidden = false; pickBtn.classList.add('is-open'); setHi(Math.max(0, items.findIndex(b => b.dataset.v === vendorSel.value))); };
        const closePop = () => { pop.hidden = true; pickBtn.classList.remove('is-open'); };
        const choose = v => { vendorSel.value = v; closePop(); drawPick(); vendorSel.dispatchEvent(new Event('change')); pickBtn.focus(); };
        pickBtn.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));
        pickBtn.addEventListener('keydown', e => {
            if (pop.hidden) { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop(); } return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (items[hi]) choose(items[hi].dataset.v); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
            else if (e.key === 'Tab') closePop();
        });
        items.forEach((b, i) => {
            b.addEventListener('mousedown', e => e.preventDefault());
            b.addEventListener('mouseenter', () => setHi(i));
            b.addEventListener('click', () => choose(b.dataset.v));
        });
        m.el.addEventListener('mousedown', e => { if (!pop.hidden && !e.target.closest('.ga-vpick')) closePop(); });
        drawPick();
        (fixedPn ? pickBtn : pnInput).focus();
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

    // ===== 外注先マスタの管理（正式社名・略称・並び順・使用・代表者の変更と追加。使っている外注先があるため削除はしない） =====
    //   略称は DB の display_name 列に入れる（空欄なら正式社名から「株式会社」などを外して自動で作る）
    //   代表者は個人情報なので別テーブル gaichu_vendor_contacts に持つ。仕様書のご担当者（工事ごとの入力が空欄のとき）と体制表のカードの選択肢に使う
    const REP_FIELDS = ['title', 'name', 'tel'];
    async function openVendors({ onDone } = {}) {
        let ctx, reps;
        try {
            ctx = await context();
            const r = await db().from('gaichu_vendor_contacts').select('vendor_id, title, name, tel');
            if (r.error) console.warn('外注先の代表者の取得に失敗しました', r.error);
            reps = new Map((r.data || []).map(x => [x.vendor_id, x]));
        } catch (e) { alert('読み込めませんでした：' + (e.message || e)); return; }
        const rows = ctx.vendors.map(v => {
            const rep = reps.get(v.id) || {};
            return { ...v, hadRep: reps.has(v.id), ...Object.fromEntries(REP_FIELDS.map(k => ['rep_' + k, rep[k] || ''])) };
        });
        const m = modal('外注先マスタの管理', `
            <div class="ga-caution">
                <div class="ga-caution-head"><span>注意</span><b>保存する前に確認してください</b></div>
                <ul>
                    <li><b>「使用」をオフ</b>にすると、外注先シートを追加するときの選択肢に出なくなります。登録済みのシートはそのまま残ります。</li>
                    <li><b>代表者</b>は、仕様書の「ご担当者」（工事ごとに入力していないとき）に役職と氏名が表示され、体制表のカードを追加するときの選択肢にも出ます。</li>
                </ul>
            </div>
            <div class="ga-vlist"></div>
            <button type="button" class="ga-addrow" data-addv>＋ 外注先を追加</button>`, [
            { label: '閉じる', ghost: true, onClick: () => m.close() },
            { label: '保存', primary: true, onClick: async () => {
                collect();
                if (rows.some(r => !String(r.name || '').trim())) {
                    list.querySelectorAll('.ga-vname').forEach(i => i.classList.toggle('is-err', !i.value.trim()));
                    return m.err('正式社名が空欄の外注先があります。');
                }
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
        ], 'ga-modal--form ga-modal--wide');
        const list = m.el.querySelector('.ga-vlist');
        const head = m.el.querySelector('.ga-head');
        const count = document.createElement('span');
        count.className = 'ga-head-count';
        head.appendChild(count);
        const status = document.createElement('div');
        status.className = 'ga-status';
        status.hidden = true;
        status.innerHTML = '<i></i><span>保存していない変更があります</span>';
        m.el.querySelector('.ga-foot').prepend(status);
        const drawCount = () => { count.textContent = `${rows.length}社（使用 ${rows.filter(r => r.active !== false).length}社）`; };
        const titleOf = r => String(r.display_name || '').trim() || autoShort(r.name) || String(r.name || '').trim() || '（新しい外注先）';
        const dispPh = r => autoShort(r.name) ? `空欄なら「${autoShort(r.name)}」` : '空欄なら自動';
        const card = (r, i) => {
            const on = r.active !== false;
            return `<div class="ga-vcard${on ? '' : ' is-off'}" data-i="${i}">
                <div class="ga-vcard-head">
                    <span class="ga-vcard-no">${String(i + 1).padStart(2, '0')}</span>
                    <b class="ga-vcard-title">${esc(titleOf(r))}</b>
                    ${(() => { const c = r.id ? vendorColor(ctx, r.id) : null; return `<span class="ga-vcard-color" title="${c ? '色分けの色 ' + esc(c) : '色は外注先シートを追加するときに自動で決まります'}"><i style="background:${esc(c || '#fff')}"${c ? '' : ' class="is-none"'}></i>${c ? '色' : '色 未設定'}</span>`; })()}
                    <span class="ga-vcard-tag">${on ? '使用中' : '使用しない'}</span>
                    <label class="ga-vcard-toggle"><span>選択肢に出す</span><input type="checkbox" class="ga-switch" data-f="active"${on ? ' checked' : ''}></label>
                </div>
                <div class="ga-vcard-main">
                    <label class="ga-field"><span>正式社名 <em>*</em></span><input type="text" class="ga-vname" data-f="name" autocomplete="off" value="${esc(r.name)}" placeholder="例：株式会社〇〇工業"></label>
                    <label class="ga-field"><span>略称 <small>表など狭いところに表示</small></span><input type="text" data-f="display_name" autocomplete="off" value="${esc(r.display_name)}" placeholder="${esc(dispPh(r))}"></label>
                    <label class="ga-field"><span>並び順</span><input type="number" data-f="sort_order" value="${esc(r.sort_order)}"></label>
                </div>
                <div class="ga-rep">
                    <div class="ga-sechead"><b>代表者</b><small>任意</small></div>
                    <div class="ga-rep-grid">
                        <label class="ga-field"><span>役職</span><input type="text" data-f="rep_title" autocomplete="off" value="${esc(r.rep_title)}" placeholder="例：代表取締役"></label>
                        <label class="ga-field"><span>氏名</span><input type="text" data-f="rep_name" autocomplete="off" value="${esc(r.rep_name)}" placeholder="例：山田 太郎"></label>
                        <label class="ga-field"><span>電話</span><input type="text" data-f="rep_tel" autocomplete="off" value="${esc(r.rep_tel)}" placeholder="090-xxxx-xxxx" inputmode="tel"></label>
                    </div>
                </div></div>`;
        };
        const draw = () => { list.innerHTML = rows.map(card).join(''); drawCount(); };
        const collect = () => list.querySelectorAll('.ga-vcard').forEach(el => {
            const r = rows[el.dataset.i];
            el.querySelectorAll('[data-f]').forEach(inp => { r[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value; });
        });
        // 入力に合わせて、カードの見出し・使用の表示・件数・未保存の表示を更新する
        list.addEventListener('input', e => {
            const el = e.target.closest('.ga-vcard');
            if (!el) return;
            collect();
            const r = rows[el.dataset.i];
            el.querySelector('.ga-vcard-title').textContent = titleOf(r);
            if (e.target.dataset.f === 'name') {
                el.querySelector('[data-f=display_name]').placeholder = dispPh(r);
                if (e.target.value.trim()) e.target.classList.remove('is-err');
            }
            if (e.target.dataset.f === 'active') {
                el.classList.toggle('is-off', !r.active);
                el.querySelector('.ga-vcard-tag').textContent = r.active ? '使用中' : '使用しない';
                drawCount();
            }
            status.hidden = false;
            m.err('');
        });
        m.el.querySelector('[data-addv]').addEventListener('click', () => {
            collect();
            rows.push({ id: null, name: '', display_name: '', sort_order: (rows.length + 1) * 10, active: true, hadRep: false, rep_title: '', rep_name: '', rep_tel: '' });
            draw();
            status.hidden = false;
            const last = list.lastElementChild;
            last.querySelector('[data-f=name]').focus();
            const body = m.el.querySelector('.ga-body');
            body.scrollTop = body.scrollHeight;
        });
        draw();
    }

    window.GaichuAdmin = { openAdd, openManage, openVendors };
})();

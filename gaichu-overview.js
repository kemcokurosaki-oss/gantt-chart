// 外注先用シート：最初のページ（概要）
//   ・先頭の要約（工場出荷日・外注先企業・外注先担当者・組立発注仕様書・当社担当）と、4つの章（組立範囲・工程表・組立発注仕様書・体制表）の簡易表示を作る
//   ・各章の「詳しく見る →」で、ページの上に詳細（今までの全画面の資料）を重ねて開く（開閉はページ側の openDoc）
//   ・外注先を選んでいるときは、その外注先に関係する分だけを表示する。「全体」のときは外注先ごとの一覧にする
// 読み込み前に gaichu-sheet.js を読み込み、ページに #ovBand / #ovScope / #ovSchedule / #ovSpec / #ovTrial を置いておくこと。
(function () {
    const GS = window.GaichuSheet;
    if (!GS) return;
    const client = GS.client;
    const $ = id => document.getElementById(id);
    const el = { band: $('ovBand'), scope: $('ovScope'), schedule: $('ovSchedule'), spec: $('ovSpec'), trial: $('ovTrial') };
    if (!el.scope) return;
    const KUSAKABE = 'kusakabe';
    const DAY = 86400000;
    const DEFAULT_COLUMNS = [
        { key: 'machine', label: '機械', type: 'text' }, { key: 'unit', label: 'ユニット', type: 'text' },
        { key: 'machine_name', label: '機械名', type: 'text' }, { key: 'assembly', label: '機械組立', type: 'party' },
        { key: 'electrical', label: '電気艤装', type: 'party' }, { key: 'trial', label: '試運転', type: 'party' },
        { key: 'trial_place', label: '試運転場所', type: 'text' },
    ];

    let scope = null;          // { figures, rows, columns }
    let figUrls = {};         // 図面の path → 表示用の署名付きURL
    let orgBySheet = null;     // sheet_id → 最初の系統のツリー
    let tasks = null;
    let allTasks = [];         // 工程表のタスク（試運転のタスクも含めたすべて）

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const toDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
    const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
    const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
    const ymd = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const days = (a, b) => Math.round((b - a) / DAY) + 1;
    const muted = t => `<p class="ov-muted">${t}</p>`;
    // 色を白（t>0）・黒（t<0）に寄せる。工程表のバーの背景・枠線・文字の色に使う
    function mix(hex, t) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return hex;
        const n = parseInt(m[1], 16);
        return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)).toString(16).padStart(2, '0')).join('');
    }

    // ===== 読み込み（工番ごとに1回） =====
    async function loadAll() {
        const st = GS.state;
        const [sc, oc, tk] = await Promise.all([
            client.from('gaichu_scopes').select('figures, rows, columns').eq('project_number', st.pn).maybeSingle(),
            st.sheets.length ? client.from('org_charts').select('sheet_id, sort_order, tree').in('sheet_id', st.sheets.map(s => s.id)).order('sort_order') : Promise.resolve({ data: [] }),
            GS.loadTasks(),
        ]);
        if (sc.error) console.error('組立範囲の取得に失敗しました', sc.error);
        if (oc.error) console.error('体制表の取得に失敗しました', oc.error);
        const r = sc.data || {};
        scope = { figures: Array.isArray(r.figures) ? r.figures : [], rows: Array.isArray(r.rows) ? r.rows : [], columns: Array.isArray(r.columns) && r.columns.length ? r.columns : DEFAULT_COLUMNS };
        orgBySheet = new Map();
        (oc.data || []).forEach(c => { if (!orgBySheet.has(c.sheet_id)) orgBySheet.set(c.sheet_id, Array.isArray(c.tree) ? c.tree : []); });
        allTasks = tk || [];
        tasks = (tk || []).filter(t => GS.isOutsource(t.owner) && t.start_date && t.end_date)
            .map(t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) })).sort((a, b) => a.start - b.start);
        // 外注先によって概要に出す図面が変わるので、図面の表示用URLはまとめて作っておく
        const paths = scope.figures.map(f => f.path).filter(Boolean);
        if (paths.length) {
            const { data, error } = await client.storage.from('gaichu-figures').createSignedUrls(paths, 60 * 60 * 12);
            if (error) console.error('図面の表示用URLを作れませんでした', error);
            figUrls = {};
            (data || []).forEach(d => { if (d.signedUrl) figUrls[d.path] = d.signedUrl; });
        }
    }

    // ===== 担当先 =====
    function party(key) {
        if (key === KUSAKABE) return { label: GS.KUSAKABE.name, short: GS.shortName(GS.KUSAKABE.name), color: GS.KUSAKABE.color };
        const s = GS.state.sheets.find(x => String(x.vendor_id) === String(key));
        return s ? { label: s.display, short: s.short, color: s.color } : { label: '（不明）', short: '（不明）', color: '#95a5a6' };
    }
    const vendorOf = t => GS.state.sheets.find(s => s.vendor_id === t.vendor_id) || null;

    // ===== 先頭の要約 =====
    function nextTasks(list) {
        const t0 = today();
        const rest = list.filter(t => t.end >= t0);
        return [rest[0] || null, rest[1] || null];
    }
    const taskCard = (label, t, color) => `<div class="ov-card" style="border-top-color:${esc(color)}"><span class="ov-k">${label}</span>`
        + (t ? `<b>${esc(t.text)}</b><span>${ymd(t.start)} ～ ${ymd(t.end)}（${days(t.start, t.end)}日）</span><small>${esc([t.machine, t.unit].filter(Boolean).join(' '))}</small>`
             : `<b>―</b><small>予定はありません</small>`) + `</div>`;
    // 当社経由のとき、管理者にだけ：外注先企業が未入力の外注タスクがあれば注意（マウスを乗せると該当タスクの一覧）
    function shipWarn(st, si) {
        if (!st.isAdmin || si.route !== 'via') return '';
        const list = GS.unsetVendorTasks();
        if (!list.length) return '';
        const tip = '工程表で外注先企業を入れると、当社への出荷日の計算に入ります\n'
            + list.map(t => `・${[t.text, t.machine, t.unit].filter(Boolean).join(' ')}（${ymd(toDate(t.start_date || t.end_date))} ～ ${ymd(toDate(t.end_date))}）`).join('\n');
        return `<small class="ov-ship-warn" title="${esc(tip)}">⚠ 外注先企業が未入力の外注タスクが${list.length}件あります</small>`;
    }
    async function renderBand() {
        const st = GS.state, sh = st.currentSheet;
        // 出荷日：外注先を選んでいて「当社経由」なら「当社への出荷日」（その外注先の最後の作業の終了日）。工場出荷の日付は下に小さく
        const si = GS.shipInfo(sh);
        const ship = si.date ? toDate(si.date) : null;
        const factory = si.factory ? toDate(si.factory) : null;
        const left = ship ? Math.round((ship - today()) / DAY) : null;
        const W = '日月火水木金土';
        // 工場出荷日：年は小さく、月日を大きく、残りの日数は下にバッジで
        const shipCard = `<div class="ov-ship"><span class="ov-k">${si.label}</span>`
            + (ship ? `<div class="ov-ship-date"><small>${ship.getFullYear()}年</small><b>${ship.getMonth() + 1}/${ship.getDate()}<em>(${W[ship.getDay()]})</em></b></div>`
                    + `<span class="ov-ship-left">${left < 0 ? '出荷済み' : left === 0 ? '本日出荷' : `${si.route === 'via' ? '当社への出荷' : '工場出荷'}まで ${left}日`}</span>${si.route === 'via' && factory ? `<small class="ov-ship-sub">工場出荷 ${ymd(factory)}</small>` : ''}`
                    : `<div class="ov-ship-date"><b>未定</b></div><span class="ov-ship-left">${si.route === 'via' && factory ? `工場出荷 ${ymd(factory)}` : '出荷日未定'}</span>`)
            + shipWarn(st, si) + `</div>`;
        const telLink = t => t ? `<a href="tel:${esc(t)}">${esc(t)}</a>` : '';
        const repOf = s => s && s.rep && (s.rep.name || s.rep.title || s.rep.tel) ? s.rep : null;
        const revOf = s => (s.spec && s.spec.revision) ? '改訂 ' + esc(s.spec.revision) : '改訂 未入力';
        const c = st.contacts[0];
        const contact = `<div class="ov-card ov-contact" style="border-top-color:#7b8088"><span class="ov-k">当社担当（問い合わせ）</span>`
            + (c ? `<b class="ov-name">${esc(c.name)}</b><small>${esc([c.dept, c.title].filter(Boolean).join(' '))}</small><div class="ov-foot">${telLink(c.tel)}</div>` : '<b>―</b>') + `</div>`;
        if (!sh) {
            // 全体：外注先ごとに、社名・住所・代表電話・担当者名だけの小さなカードを並べる
            const cards = st.sheets.map(s => {
                const r = repOf(s);
                return `<div class="ov-card ov-vcard" style="border-top-color:${esc(s.color)}"><span class="ov-k">外注先企業</span><b class="ov-name">${esc(s.display)}</b>`
                    + `<small>${esc(s.address) || '<span class="ov-none">住所 未登録</span>'}</small>`
                    + `<div class="ov-vfoot"><div class="ov-line">`
                    + (s.tel ? `<span><span class="ov-k">代表</span>${telLink(s.tel)}</span>` : '')
                    + `<span><span class="ov-k">担当</span>${r && r.name ? `<b>${esc(r.name)}</b>` : '<span class="ov-none">未登録</span>'}</span></div>`
                    + `<button type="button" class="ov-spec-btn ov-spec-btn--sm" data-ov-spec="${s.id}" title="${esc(s.display)}の組立発注仕様書を開く（${revOf(s)}）"><span>仕様書を開く</span>→</button></div></div>`;
            }).join('');
            el.band.innerHTML = `<div class="ov-band ov-band--all">${shipCard}${cards || `<div class="ov-card">${muted('外注先が登録されていません。')}</div>`}${contact}</div>`;
            return;
        }
        const vendorCard = `<div class="ov-card ov-vendor" style="border-top-color:${esc(sh.color)}"><span class="ov-k">外注先企業</span><b class="ov-name">${esc(sh.display)}</b>`
            + `<small>${esc(sh.address) || '住所 未登録'}</small>${sh.tel ? `<div class="ov-line ov-foot"><span class="ov-k">代表</span>${telLink(sh.tel)}</div>` : ''}</div>`;
        const r = repOf(sh);
        const repCard = `<div class="ov-card" style="border-top-color:${esc(sh.color)}"><span class="ov-k">外注先担当者</span>`
            + (r ? `<b class="ov-name">${esc(r.name || '―')}</b><small>${esc(r.title || '')}</small><div class="ov-foot">${telLink(r.tel)}</div>` : '<b>―</b><small>外注先マスタの管理で登録できます</small>') + `</div>`;
        const specCard = `<div class="ov-card ov-speccard" style="border-top-color:${esc(sh.color)}"><span class="ov-k">組立発注仕様書</span><b>${revOf(sh)}</b>`
            + `<div class="ov-spec-wrap"><button type="button" class="ov-spec-btn ov-spec-btn--primary" data-ov-spec="${sh.id}"><span>仕様書を開く</span>→</button></div></div>`;
        el.band.innerHTML = `<div class="ov-band">${shipCard}${vendorCard}${repCard}${specCard}${contact}</div>`;
    }

    // ===== 1 組立範囲 =====
    // 図面の色分け枠と表の担当バッジは担当先でつながっている。バッジ・行・枠にマウスを乗せると、同じ担当先の枠とバッジを強調する
    function zonePoints(z) {
        if (Array.isArray(z.points) && z.points.length >= 3) return z.points;
        const x = +z.x || 0, y = +z.y || 0, w = +z.width || 0, h = +z.height || 0, rot = (+z.rotation || 0) * Math.PI / 180;
        const cx = x + w / 2, cy = y + h / 2;
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => {
            const dx = px - cx, dy = py - cy;
            return [cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot)];
        });
    }
    function renderScope() {
        const sh = GS.state.currentSheet;
        const vid = sh ? sh.vendor_id : null;
        // 概要の表は 機械組立・電気艤装・据付（列があれば）だけ。試運転・試運転場所などは詳細の担当範囲一覧で見る
        const cols = scope.columns, pcols = cols.filter(c => c.type === 'party' && (c.key === 'assembly' || c.key === 'electrical' || /据付/.test(c.label || '')));
        const rows = scope.rows.filter(r => vid == null || pcols.some(c => (r[c.key] || []).some(k => String(k) === String(vid))));
        // 概要に出す図面：全体のときは先頭の図面。外注先を選んでいるときは、その外注先の色分け枠が入っている最初の図面（なければ先頭）
        const figs = scope.figures.filter(f => f.path);
        const f0 = (vid != null && figs.find(f => (f.zones || []).some(z => String(z.party) === String(vid)))) || figs[0] || {};
        const figUrl = figUrls[f0.path] || '';
        const zones = (f0.zones || []).filter(z => vid == null || String(z.party) === String(vid) || z.party === KUSAKABE);
        const svg = zones.map(z => {
            const p = party(z.party);
            return `<polygon data-party="${esc(z.party)}" points="${zonePoints(z).map(q => q.join(',')).join(' ')}" fill="${esc(p.color)}" stroke="${esc(p.color)}" vector-effect="non-scaling-stroke"></polygon>`;
        }).join('');
        const fig = figUrl ? `<div class="ov-fig"><div class="ov-fig-img"><img src="${esc(figUrl)}" alt="図面"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg></div><span>${esc(f0.caption || '')}${figs.length > 1 ? `　ほか${figs.length - 1}枚` : ''}</span></div>`
            : `<div class="ov-fig ov-fig--empty">図面はまだ登録されていません</div>`;
        // 列に分けた表：（機械）｜ユニット｜機械名｜担当の列（機械組立・電気艤装・据付）。機械の列は、どこかの行に機械が入っているときだけ出す
        const filled = v => !!String(v || '').trim() && String(v).trim() !== '―';
        const hasMachine = rows.some(r => filled(r.machine));
        const tpl = `style="grid-template-columns:${hasMachine ? '56px ' : ''}112px minmax(110px,1.4fr) repeat(${pcols.length}, minmax(84px, 1fr))"`;
        const list = rows.length ? `<div class="ov-table"><div class="ov-trow ov-thead" ${tpl}>${hasMachine ? '<span>機械</span>' : ''}<span>ユニット</span><span>機械名</span>${pcols.map(c => `<span>${esc(c.label)}</span>`).join('')}</div>` + rows.map(r => {
            const keys = [...new Set(pcols.flatMap(c => (r[c.key] || []).map(String)))];
            const out = keys.filter(k => k !== KUSAKABE);
            return `<div class="ov-unit ov-trow" ${tpl} data-parties="${esc((out.length ? out : keys).join(' '))}">${hasMachine ? `<span>${filled(r.machine) ? esc(r.machine) : '<span class="ov-none">―</span>'}</span>` : ''}<span><b>${esc(hasMachine ? (r.unit || '') : (r.unit || r.machine || ''))}</b></span><span>${esc(r.machine_name || '')}</span>${pcols.map(c => `<span class="ov-tcell">${(r[c.key] || []).map(k => {
                const p = party(k);
                return `<span class="ov-chip" data-party="${esc(k)}" style="${GS.chipStyle(p.color)}">${esc(p.short || GS.shortName(p.label))}</span>`;
            }).join('') || '<span class="ov-none">―</span>'}</span>`).join('')}</div>`;
        }).join('') + `</div>`
            : muted(scope.rows.length ? 'この外注先が担当に入っている行はありません。' : '担当範囲一覧はまだ入力されていません。');
        el.scope.innerHTML = `<div class="ov-scope">${fig}<div class="ov-units"><span class="ov-k">${sh ? esc(sh.display) + 'の担当' : '担当範囲（全体）'}　<span class="ov-hint">バッジや図面の枠にマウスを乗せると、同じ担当先を強調します</span></span>${list}</div></div>`;
    }
    function highlight(keys) {
        const on = keys && keys.length ? new Set(keys.map(String)) : null;
        el.scope.classList.toggle('is-hl', !!on);
        el.scope.querySelectorAll('[data-party]').forEach(n => n.classList.toggle('hl', !!on && on.has(n.dataset.party)));
        el.scope.querySelectorAll('.ov-unit').forEach(n => n.classList.toggle('hl', !!on && n.dataset.parties.split(' ').some(k => on.has(k))));
    }
    el.scope.addEventListener('mouseover', e => {
        const chip = e.target.closest('.ov-chip, polygon');
        if (chip) { highlight([chip.dataset.party]); return; }
        const row = e.target.closest('.ov-unit');
        highlight(row ? row.dataset.parties.split(' ') : null);
    });
    el.scope.addEventListener('mouseleave', () => highlight(null));

    // バーの文字：まずバーの中（先頭）に置き、バーの幅に入りきらないときだけバーの右に出す。
    //   実際の幅で測るので、表示したあと・画面の大きさが変わったとき（資料を開いたときも含む）に合わせ直す
    function fitLabels(box) {
        if (!box) return;
        box.querySelectorAll('[data-lbl-out]').forEach(t => {
            const bar = t.previousElementSibling;
            if (!bar || !bar.offsetWidth) return;   // 隠れていて測れないときはそのまま（開いたときに合わせ直す）
            const out = t.offsetWidth + 18 > bar.offsetWidth;
            t.style.left = out ? t.dataset.lblOut : t.dataset.lblIn;
            t.classList.toggle('is-out', out);
        });
    }

    window.addEventListener('resize', () => fitLabels(el.schedule));
    // ===== 2 工程表 =====
    // 月単位の短い工程表（工程ごと・会社ごとに1本のバー、今日は紺の線）。期間は最初の工程の月の初めから最後の工程の翌月末まで
    // バーは会社の色の薄い背景＋左端の濃い帯。文字（工程名 開始日〜終了日）はいつもバーの右。1日だけの行事は縦線＋文字（詳細の工程表と同じ）
    function renderSchedule() {
        const sh = GS.state.currentSheet;
        const conv = t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) });
        const trials = GS.trialTasksFor(allTasks, sh ? sh.vendor_id : null).filter(t => t.start_date && t.end_date).map(t => ({ ...conv(t), _kusakabe: true }));
        // 当社経由の外注先は「当社への出荷」の日を◆で出す
        const viaMarks = (sh ? [sh] : GS.state.sheets).map(s => ({ s, si: GS.shipInfo(s) })).filter(x => x.si.route === 'via' && x.si.date)
            .map(x => ({ text: '当社への出荷', start: toDate(x.si.date), end: toDate(x.si.date), _via: x.s }));
        const list = (sh ? tasks.filter(t => t.vendor_id === sh.vendor_id) : tasks).concat(trials, viaMarks);
        if (!list.length) { el.schedule.innerHTML = muted('担当が「外注」のタスクが見つかりませんでした。'); return; }
        const t0 = today();
        const lo = new Date(Math.min(t0, ...list.map(t => t.start))), hi = new Date(Math.max(...list.map(t => t.end)));
        const min = new Date(lo.getFullYear(), lo.getMonth(), 1), max = new Date(hi.getFullYear(), hi.getMonth() + 2, 0);
        const span = max - min + DAY;
        const pct = d => (d - min) / span * 100;
        const pos = d => pct(d).toFixed(2) + '%';
        const months = [];
        for (let d = new Date(min); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
            months.push({ d, label: (months.length === 0 || d.getMonth() === 0 ? `${d.getFullYear()}年` : '') + `${d.getMonth() + 1}月` });
        }
        // 月ごとに背景を交互に塗る。今日は紺の線
        const bands = months.map((m, i) => { const nx = i + 1 < months.length ? months[i + 1].d : new Date(max.getTime() + DAY);
            return `<i class="ov-gt-band" style="left:${pos(m.d)};width:${(pct(nx) - pct(m.d)).toFixed(2)}%;background:${i % 2 ? '#f8f8f6' : 'transparent'}"></i>`; }).join('');
        const showNow = t0 >= min && t0 <= max;
        const now = showNow ? `<i class="ov-gt-now" style="left:${pos(t0)}"></i>` : '';
        const head = `<div class="ov-gt-head"><div class="ov-gt-lab">工程</div><div class="ov-gt-scale">${months.map(m => `<span style="left:${pos(m.d)}">${m.label}</span>`).join('')}</div></div>`;
        // 場所だけ借りる電気艤装・試運転・出荷準備のタスクは、場所に入っている会社の色（入っていなければ未定）
        const sheetOf = t => t._via || (t._kusakabe ? GS.sheetByPlace(t.test_run_location) : vendorOf(t));
        const colorOf = t => sheetOf(t) ? sheetOf(t).color : '#7b8088';
        const nameOf = t => sheetOf(t) ? (sheetOf(t).short || sheetOf(t).display) : '未定';
        // 凡例：表に出ている会社の色
        const legendItems = [...new Map(list.map(t => [nameOf(t), colorOf(t)])).entries()]
            .map(([n, c]) => `<span><i style="background:${esc(c)}"></i>${esc(n)}</span>`).join('');
        const legend = `<div class="ov-legend">${legendItems}</div>`;
        const LANE = 22;   // 1社ぶんの段の高さ（px）
        const rowsHtml = GS.processGroups(list).map(g => {
            // 同じ工程を複数の会社が担当するときは、会社ごとにバーを1本ずつ（最初の作業の開始〜最後の作業の終了）
            const by = new Map();
            g.tasks.forEach(t => { const s = sheetOf(t), k = s ? s.id : '_none';
                if (!by.has(k)) by.set(k, { name: nameOf(t), color: colorOf(t), ts: [] });
                by.get(k).ts.push(t); });
            const lanes = [...by.values()].map((v, i) => {
                const s = new Date(Math.min(...v.ts.map(t => t.start))), e = new Date(Math.max(...v.ts.map(t => t.end))), n = days(s, e), top = 5 + i * LANE;
                // 機械・ユニット名（同じ会社で複数あるときは「、」でつなぐ）
                const where = [...new Set(v.ts.map(t => [t.machine, t.unit].filter(Boolean).join(' ')).filter(Boolean))].join('、');
                const title = `${g.name}${where ? '（' + where + '）' : ''} ${v.name} ${md(s)}〜${md(e)}（${n}日）`;
                // 終わった工程（終了日が今日より前）は薄く出す
                const done = e < t0 ? ' is-done' : '';
                // 大事な日（1日だけの出荷・外観検査・客先立会）は◆
                const ink = mix(v.color, -0.45);
                if (n === 1 && v.ts.every(t => /出荷|検査|立会/.test(t.text))) return `<span class="ov-gt-mile${done}" style="left:${pos(s)};top:${top}px;color:${esc(ink)}" title="${esc(title)}"><i style="background:${esc(v.color)}"></i><b>${esc(v.ts[0].text)} ${md(s)}</b></span>`;
                const l = pct(s), w = Math.max(0.8, n * DAY / span * 100);
                const label = n === 1 ? md(s) : `${md(s)}〜${md(e)}`;
                // 文字はバーの中。入りきらないときだけバーの右（fitLabels）
                return `<span class="ov-gt-bar${done}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;top:${top}px;background:${esc(mix(v.color, 0.86))};border-color:${esc(mix(v.color, 0.55))};box-shadow:inset 4px 0 0 ${esc(v.color)}" title="${esc(title)}"></span>`
                    + `<span class="ov-gt-text${done}" data-lbl-in="calc(${l.toFixed(2)}% + 9px)" data-lbl-out="calc(${(l + w).toFixed(2)}% + 6px)" style="left:calc(${l.toFixed(2)}% + 9px);top:${top}px;color:${esc(ink)}" title="${esc(title)}"><b>${esc(g.name)}</b>${label}</span>`;
            }).join('');
            return `<div class="ov-gt-row"><div class="ov-gt-lab"><b>${esc(g.name)}</b></div><div class="ov-gt-track" style="height:${by.size * LANE + 6}px">${lanes}</div></div>`;
        }).join('');
        el.schedule.innerHTML = `${legend}<div class="ov-gt">${head}<div class="ov-gt-body"><div class="ov-gt-bg">${bands}${now}</div>${rowsHtml}</div></div>`;
        fitLabels(el.schedule);
    }


    // ===== 3 組立発注仕様書 =====
    function renderSpec() {
        if (!el.spec) return;   // 概要の仕様書の章は廃止（先頭のカードの「仕様書を開く」から開く）
        const st = GS.state, sh = st.currentSheet;
        if (!sh) {
            el.spec.innerHTML = st.sheets.length ? `<div class="ov-vlist">${st.sheets.map(s => `<div><span class="ov-vname"><i style="background:${esc(s.color)}"></i>${esc(s.display)}</span><span class="ov-sub">改訂 ${esc((s.spec && s.spec.revision) || '未入力')}</span></div>`).join('')}</div>`
                : muted('この工事には外注先が登録されていません。');
            return;
        }
        const s = sh.spec || {};
        const machines = (Array.isArray(s.machines) ? s.machines : []).map(m => [m.machine, m.unit].filter(Boolean).join(' ')).filter(Boolean);
        const u = s.utility || {}, p = s.paint || {};
        // ご担当者は、仕様書で入力していなければ外注先マスタの担当者（仕様書の詳細と同じ）
        const facts = [
            ['改訂', s.revision], ['ご担当者', s.contact || GS.repLabel(sh)], ['発注機械', machines.join(' / ')],
            ['機械色', p['機械色']], ['動力電源', [u.power_v, u.power_kva].filter(Boolean).join('　')], ['圧縮空気', u.air],
        ];
        // 項目名は常に出し、未入力の項目は「―」にする（入力漏れに気づけるように）
        const val = v => (v && String(v).trim()) ? esc(v) : '<span class="ov-none">―</span>';
        el.spec.innerHTML = `<div class="ov-facts">${facts.map(([k, v]) => `<div><span class="ov-k">${k}</span>${val(v)}</div>`).join('')}</div>`;
    }

    // ===== 4 体制表 =====
    function flatten(nodes, out) { (nodes || []).forEach(n => { if (n.type !== 'label') out.push(n); flatten(n.children, out); }); return out; }
    async function renderTrial() {
        const st = GS.state, sh = st.currentSheet;
        if (!sh) {
            el.trial.innerHTML = st.sheets.length ? `<div class="ov-vlist">${st.sheets.map(s => `<div><span class="ov-vname"><i style="background:${esc(s.color)}"></i>${esc(s.display)}</span><span class="ov-sub">体制表 ${orgBySheet.has(s.id) && orgBySheet.get(s.id).length ? '作成済み' : '未作成'}</span></div>`).join('')}</div>`
                : muted('この工事には外注先が登録されていません。');
            return;
        }
        const people = flatten(orgBySheet.get(sh.id), []);
        const top = people[0];
        const others = people.slice(1);
        el.trial.innerHTML = `<div class="ov-facts">`
            + `<div id="ovTrialPeriod"><span class="ov-k">試運転期間</span>計算中…</div>`
            + `<div><span class="ov-k">責任者</span>${top ? `${esc(top.name || '')}${top.tel ? `　<a href="tel:${esc(top.tel)}">${esc(top.tel)}</a>` : ''}` : '―'}</div>`
            + `<div><span class="ov-k">メンバー</span>${others.length ? esc(others.slice(0, 4).map(n => n.name).filter(Boolean).join('・')) + (others.length > 4 ? ' ほか' : '') + `（${others.length}名）` : '―'}</div>`
            + `</div>` + (people.length ? '' : muted('この外注先の体制表はまだ作成されていません。'));
        const r = await GS.trialPeriod(sh);
        const box = $('ovTrialPeriod');
        if (box && GS.state.currentSheet === sh) box.innerHTML = `<span class="ov-k">試運転期間</span>${r && r.start ? `${ymd(toDate(r.start))} ～ ${ymd(toDate(r.end))}` : '―'}`;
    }

    // ===== 描画 =====
    let loading = null;
    async function render() {
        const st = GS.state;
        if (!st.ready) return;
        if (!st.loggedIn) { Object.values(el).forEach(x => { if (x) x.innerHTML = ''; }); return; }
        if (!loading) loading = loadAll();
        await loading;
        renderScope();
        renderSchedule();
        renderSpec();
        renderBand();
        renderTrial();
    }
    document.addEventListener('gaichusheetchange', render);
    // 詳細ページで組立範囲（図面・色分け枠・担当範囲一覧）を保存したら、概要の組立範囲もすぐ描き直す
    document.addEventListener('gaichuscopechange', async e => {
        const r = e.detail || {};
        scope = { figures: Array.isArray(r.figures) ? r.figures : [], rows: Array.isArray(r.rows) ? r.rows : [], columns: Array.isArray(r.columns) && r.columns.length ? r.columns : DEFAULT_COLUMNS };
        // 新しく足した図面は表示用URLがまだないので作る
        const paths = scope.figures.map(f => f.path).filter(p => p && !(figUrls && figUrls[p]));
        if (paths.length) {
            const { data, error } = await client.storage.from('gaichu-figures').createSignedUrls(paths, 60 * 60 * 12);
            if (error) console.error('図面の表示用URLを作れませんでした', error);
            figUrls = figUrls || {};
            (data || []).forEach(d => { if (d.signedUrl) figUrls[d.path] = d.signedUrl; });
        }
        renderScope();
    });
    el.band.addEventListener('click', e => {
        const b = e.target.closest('[data-ov-spec]');
        if (!b) return;
        if (String(GS.state.current) !== String(b.dataset.ovSpec)) GS.select(b.dataset.ovSpec);
        if (typeof window.openDoc === 'function') window.openDoc('order-spec', true);
    });
})();

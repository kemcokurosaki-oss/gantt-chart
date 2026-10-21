// 外注先用シート：最初のページ（概要）
//   ・先頭の要約（工場出荷までの日数・次の作業・その次・試運転・弊社担当）と、4つの章（組立範囲・工程表・組立発注仕様書・体制表）の簡易表示を作る
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
    let figUrl = '';
    let orgBySheet = null;     // sheet_id → 最初の系統のツリー
    let tasks = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const toDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
    const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
    const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
    const ymd = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const days = (a, b) => Math.round((b - a) / DAY) + 1;
    const muted = t => `<p class="ov-muted">${t}</p>`;

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
        tasks = (tk || []).filter(t => GS.isOutsource(t.owner) && t.start_date && t.end_date)
            .map(t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) })).sort((a, b) => a.start - b.start);
        const first = scope.figures.find(f => f.path);
        if (first) {
            const { data, error } = await client.storage.from('gaichu-figures').createSignedUrls([first.path], 60 * 60 * 12);
            if (error) console.error('図面の表示用URLを作れませんでした', error);
            figUrl = (data && data[0] && data[0].signedUrl) || '';
        }
    }

    // ===== 担当先 =====
    function party(key) {
        if (key === KUSAKABE) return { label: GS.KUSAKABE.name, color: GS.KUSAKABE.color };
        const s = GS.state.sheets.find(x => String(x.vendor_id) === String(key));
        return s ? { label: s.display, color: s.color } : { label: '（不明）', color: '#95a5a6' };
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
    async function renderBand() {
        const st = GS.state, sh = st.currentSheet;
        const ship = st.project.shipDate ? toDate(st.project.shipDate) : null;
        const left = ship ? Math.round((ship - today()) / DAY) : null;
        const shipCard = `<div class="ov-ship"><span class="ov-k">工場出荷まで</span>`
            + (left == null ? `<b>―</b><small>出荷日未定</small>` : left < 0 ? `<b>出荷済み</b><small>${ymd(ship)}</small>` : `<b>${left}<em>日</em></b><small>${ymd(ship)} 出荷</small>`) + `</div>`;
        if (!sh) {
            const rows = st.sheets.map(s => {
                const [n1, n2] = nextTasks(tasks.filter(t => t.vendor_id === s.vendor_id));
                const fmt = t => t ? `${esc(t.text)}　${md(t.start)}〜${md(t.end)}` : '―';
                return `<div class="ov-allrow"><span class="ov-vname"><i style="background:${esc(s.color)}"></i>${esc(s.display)}</span><span><span class="ov-k">次</span>${fmt(n1)}</span><span class="ov-sub"><span class="ov-k">その次</span>${fmt(n2)}</span></div>`;
            }).join('');
            el.band.innerHTML = `<div class="ov-band ov-band--all">${shipCard}<div class="ov-card ov-alllist">${rows || muted('外注先が登録されていません。')}</div></div>`;
            return;
        }
        const [n1, n2] = nextTasks(tasks.filter(t => t.vendor_id === sh.vendor_id));
        const c = st.contacts[0];
        const contact = `<div class="ov-card"><span class="ov-k">弊社担当（問い合わせ）</span>${c ? `<b class="ov-name">${esc(c.name)}</b><small>${esc([c.dept, c.title].filter(Boolean).join(' '))}</small>${c.tel ? `<a href="tel:${esc(c.tel)}">${esc(c.tel)}</a>` : ''}` : '<b>―</b>'}</div>`;
        const trialSlot = `<div class="ov-card" id="ovTrialCard" style="border-top-color:${esc(GS.KUSAKABE.color)}"><span class="ov-k">試運転（${esc(GS.KUSAKABE.name)}）</span><b>計算中…</b></div>`;
        el.band.innerHTML = `<div class="ov-band">${shipCard}${taskCard('次の作業', n1, sh.color)}${taskCard('その次', n2, sh.color)}${trialSlot}${contact}</div>`;
        const r = await GS.trialPeriod(sh);
        const box = $('ovTrialCard');
        if (!box || GS.state.currentSheet !== sh) return;
        box.innerHTML = `<span class="ov-k">試運転（${esc(GS.KUSAKABE.name)}）</span>` + (r && r.start
            ? `<b>${md(toDate(r.start))} ～ ${md(toDate(r.end))}</b><span>${ymd(toDate(r.start))} ～ ${ymd(toDate(r.end))}</span>`
            : `<b>―</b><small>工程表に試運転の予定がありません</small>`);
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
        const cols = scope.columns, pcols = cols.filter(c => c.type === 'party');
        const rows = scope.rows.filter(r => vid == null || pcols.some(c => (r[c.key] || []).some(k => String(k) === String(vid))));
        const f0 = scope.figures.find(f => f.path) || {};
        const zones = (f0.zones || []).filter(z => vid == null || String(z.party) === String(vid) || z.party === KUSAKABE);
        const svg = zones.map(z => {
            const p = party(z.party);
            return `<polygon data-party="${esc(z.party)}" points="${zonePoints(z).map(q => q.join(',')).join(' ')}" fill="${esc(p.color)}" stroke="${esc(p.color)}" vector-effect="non-scaling-stroke"></polygon>`;
        }).join('');
        const fig = figUrl ? `<div class="ov-fig"><div class="ov-fig-img"><img src="${esc(figUrl)}" alt="図面"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg></div><span>${esc(f0.caption || '')}${scope.figures.length > 1 ? `　ほか${scope.figures.length - 1}枚` : ''}</span></div>`
            : `<div class="ov-fig ov-fig--empty">図面はまだ登録されていません</div>`;
        // 列に分けた表：ユニット｜機械名｜担当の列（機械組立・電気艤装・試運転など）
        const tpl = `style="grid-template-columns:112px minmax(110px,1.4fr) repeat(${pcols.length}, minmax(84px, 1fr))"`;
        const list = rows.length ? `<div class="ov-table"><div class="ov-trow ov-thead" ${tpl}><span>ユニット</span><span>機械名</span>${pcols.map(c => `<span>${esc(c.label)}</span>`).join('')}</div>` + rows.map(r => {
            const keys = [...new Set(pcols.flatMap(c => (r[c.key] || []).map(String)))];
            const out = keys.filter(k => k !== KUSAKABE);
            return `<div class="ov-unit ov-trow" ${tpl} data-parties="${esc((out.length ? out : keys).join(' '))}"><span><b>${esc(r.unit || r.machine || '')}</b></span><span>${esc(r.machine_name || '')}</span>${pcols.map(c => `<span class="ov-tcell">${(r[c.key] || []).map(k => {
                const p = party(k);
                return `<span class="ov-chip" data-party="${esc(k)}" style="${GS.chipStyle(p.color)}">${esc(p.label.replace(/殿$/, ''))}</span>`;
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

    // ===== 2 工程表 =====
    // 月の目盛り（縦の線）と今日の線を入れた短い工程表。期間は最初の工程の月の初めから最後の工程の翌月末まで
    function renderSchedule() {
        const sh = GS.state.currentSheet;
        const list = (sh ? tasks.filter(t => t.vendor_id === sh.vendor_id) : tasks).slice(0, 8);
        if (!list.length) { el.schedule.innerHTML = muted('担当が「外注」のタスクが見つかりませんでした。'); return; }
        const t0 = today();
        const lo = new Date(Math.min(t0, ...list.map(t => t.start))), hi = new Date(Math.max(...list.map(t => t.end)));
        const min = new Date(lo.getFullYear(), lo.getMonth(), 1), max = new Date(hi.getFullYear(), hi.getMonth() + 2, 0);
        const span = max - min + DAY;
        const pos = d => ((d - min) / span * 100).toFixed(2) + '%';
        const months = [];
        for (let d = new Date(min); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
            months.push({ d, label: (months.length === 0 || d.getMonth() === 0 ? `${d.getFullYear()}年` : '') + `${d.getMonth() + 1}月` });
        }
        const grid = months.map(m => `<i class="ov-mline" style="left:${pos(m.d)}"></i>`).join('');
        const showNow = t0 >= min && t0 <= max;
        const now = showNow ? `<i class="ov-now" style="left:${pos(t0)}"></i>` : '';
        const head = `<div class="ov-grow ov-ghead"><span></span><span class="ov-gmonths">${months.map(m => `<span style="left:${pos(m.d)}">${m.label}</span>`).join('')}${showNow ? `<b class="ov-today" style="left:${pos(t0)}">今日</b>` : ''}</span></div>`;
        el.schedule.innerHTML = `<div class="ov-gantt">${head}${list.map(t => {
            const v = vendorOf(t), color = v ? v.color : '#7b8088';
            const n = days(t.start, t.end);
            const label = `<span class="ov-glabel"><b>${esc(t.text)}</b><span>${esc([t.machine, t.unit].filter(Boolean).join(' '))}</span></span>`;
            // 工場出荷など1日だけの出荷の予定は、詳細の工程表と同じひし形の印にする
            if (n === 1 && /出荷/.test(t.text)) {
                return `<div class="ov-grow">${label}<span class="ov-gtrack">${grid}${now}<span class="ov-gmile" style="left:${pos(t.start)}"><i></i><b>${esc(t.text)} ${md(t.start)}</b></span></span></div>`;
            }
            const w = Math.max(0.8, n * DAY / span * 100).toFixed(2);
            return `<div class="ov-grow">${label}`
                + `<span class="ov-gtrack">${grid}${now}<i class="ov-gbar" style="left:${pos(t.start)};width:${w}%;background:${esc(color)}"></i>`
                + `<span class="ov-gtext" style="left:calc(${pos(t.start)} + ${w}%)">${esc(t.text)}　${md(t.start)}〜${md(t.end)}（${n}日）</span></span></div>`;
        }).join('')}</div>`;
    }

    // ===== 3 組立発注仕様書 =====
    function renderSpec() {
        const st = GS.state, sh = st.currentSheet;
        if (!sh) {
            el.spec.innerHTML = st.sheets.length ? `<div class="ov-vlist">${st.sheets.map(s => `<div><span class="ov-vname"><i style="background:${esc(s.color)}"></i>${esc(s.display)}</span><span class="ov-sub">改訂 ${esc((s.spec && s.spec.revision) || '未入力')}</span></div>`).join('')}</div>`
                : muted('この工事には外注先が登録されていません。');
            return;
        }
        const s = sh.spec || {};
        const machines = (Array.isArray(s.machines) ? s.machines : []).map(m => [m.machine, m.unit].filter(Boolean).join(' ')).filter(Boolean);
        const u = s.utility || {}, p = s.paint || {};
        const facts = [
            ['改訂', s.revision], ['ご担当者', s.contact], ['発注機械', machines.join(' / ')],
            ['機械色', p['機械色']], ['動力電源', [u.power_v, u.power_kva].filter(Boolean).join('　')], ['圧縮空気', u.air],
        ].filter(f => f[1] && String(f[1]).trim());
        el.spec.innerHTML = facts.length ? `<div class="ov-facts">${facts.map(([k, v]) => `<div><span class="ov-k">${k}</span>${esc(v)}</div>`).join('')}</div>`
            : muted('この外注先の仕様書はまだ入力されていません。');
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
})();

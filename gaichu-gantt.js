// 外注先用シート：工程表（工程表の「外注」タスクを外注先ごとに表示）
//   ・外注先の判定は工程表の「外注先企業」（tasks.vendor_id）。未入力のタスクは「外注先未設定」にまとめる
//   ・「全体」は外注先ごとのまとまりで並べる。外注先を選ぶと、その外注先→未設定の順に表示し、ほかの外注先は灰色の参考（開閉できる）
//   ・色は外注先シートの色を使う
//   ・バーは外注先の色の薄い背景＋左端の濃い帯。文字（工程名 機械・ユニット 開始日〜終了日）は、バーの長さにかかわらずいつもバーの右に出す
//   ・1日だけの出荷・検査・立会は、外注先の色の縦線＋右に文字（文字は外注先の色を濃くした色）
// 読み込み前に gaichu-sheet.js を読み込み、ページに #miniGantt と .gantt-unit-btn（週単位・日単位）、#ganttLegend を置いておくこと。
(function () {
    const container = document.getElementById('miniGantt');
    const GS = window.GaichuSheet;
    if (!container || !GS) return;

    const SHOW_OTHER_VENDORS = true;     // 外注先を選んだとき、ほかの外注先の工程を参考表示するか
    const UNSET = { color: '#7b8088', tint: '#ebebe8', ink: '#3a3f47' };
    const GREY = { color: '#b4b7bb', tint: '#f1f1ee', ink: '#6b7079' };
    const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
    const DAY_MS = 86400000;
    const LABEL_W = 360;
    // 印刷のとき：A4横の印刷幅（約1047px）から枠の余白を引いた幅に収める。左の工程名の列も細くする（ページ側の印刷用CSSと合わせる）
    const PRINT_W = 930, PRINT_LABEL_W = 260;
    // 週単位（画面）：横スクロールなしで枠の幅に収める。左の列を細くし、週の列幅は枠の幅から割り出す（細くなりすぎるときだけスクロール）
    const WEEK_LABEL_W = 250, WEEK_MIN_COL_W = 22;
    let fitW = 0;            // 週単位で表示したときの枠の幅（画面の大きさが変わったら描き直す）
    let printing = false;

    let tasks = [];          // [{ ...task, start: Date, end: Date }]（外注のタスク＋それにかかる試運転のタスク）
    let allTasks = [];
    // 表示するタスク：外注のタスクすべてと、外注先の機械・ユニットにかかる試運転のタスク（外注先を選んでいるときはその外注先の分）
    function pickTasks() {
        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        const withDate = t => t.start_date && t.end_date;
        const conv = t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) });
        // 外注先を選んでいるときは、その外注先のバーだけ出す（ほかの外注先・外注先企業が未入力のタスクは出さない）
        tasks = allTasks.filter(t => GS.isOutsource(t.owner) && withDate(t) && (vid == null || t.vendor_id === vid)).map(conv)
            .concat(GS.trialTasksFor(allTasks, vid).filter(withDate).map(t => ({ ...conv(t), _kusakabe: true })))
            .sort((a, b) => a.start - b.start);
    }
    let loaded = false;
    let unit = 'week';
    let otherOpen = true;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const mdStr = d => `${d.getMonth() + 1}/${d.getDate()}`;
    function startOfWeekMon(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const day = d.getDay();
        d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
        return d;
    }
    const toDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
    const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
    function mix(hex, t) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return hex;
        const n = parseInt(m[1], 16);
        return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)).toString(16).padStart(2, '0')).join('');
    }
    // 外注先の表示情報（外注先シートから）。short はバーに書く短い名前。tint＝バーの背景、edge＝枠線、ink＝バーの文字
    function vendorLooks() {
        const map = new Map();
        GS.state.sheets.forEach(s => map.set(s.vendor_id, {
            name: s.display,
            short: s.short || s.display,
            color: s.color, tint: mix(s.color, 0.86), edge: mix(s.color, 0.55), ink: mix(s.color, -0.45),
        }));
        return map;
    }
    const withEdge = l => ({ ...l, edge: l.edge || mix(l.color, 0.55) });

    async function load() {
        if (!GS.state.ready) return;
        allTasks = await GS.loadTasks();
        pickTasks();
        loaded = true;
        render();
    }

    // バーの色：外注先の色。外注先を選んでいるときは、ほかの外注先は灰色（参考）。外注先企業が未入力は「未定」、場所だけ借りる電気艤装・試運転・出荷準備は場所の会社
    function lookFor(looks, vid) {
        return function lookOf(t) {
            const key = t._kusakabe ? (GS.sheetByPlace(t.test_run_location) || {}).vendor_id : t.vendor_id;
            if (!looks.has(key)) return withEdge({ ...UNSET, name: t._kusakabe ? '場所 未定' : '外注先未設定', short: '未定' });
            const l = looks.get(key);
            return vid != null && key !== vid ? withEdge({ ...GREY, name: l.name, short: l.short, grey: true }) : l;
        };
    }
    // バー：薄い背景＋枠線＋左端の濃い帯（文字はバーの右に別に出す）
    const barStyle = look => `background:${look.tint};border-color:${look.edge};box-shadow:inset 4px 0 0 ${look.color};color:${look.ink}`;
    // 1日だけの行事：縦線＋文字
    const mileHtml = (cls, style, look, label, title) =>
        `<div class="${cls}" style="${style};color:${look.ink}" title="${esc(title)}"><i style="background:${look.color}"></i><b>${esc(label)}</b></div>`;

    // 凡例（表に出ている会社の色）
    function renderLegend(lookOf) {
        const box = document.getElementById('ganttLegend');
        if (!box) return;
        const items = [...new Map(tasks.map(t => { const l = lookOf(t); return [l.short || l.name, l.color]; })).entries()];
        box.innerHTML = items.map(([n, c]) => `<span><i style="background:${esc(c)}"></i>${esc(n)}</span>`).join('');
    }

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

    function render() {
        container.className = 'gt' + (unit === 'day' ? ' is-day' : printing ? '' : ' is-week');
        if (!loaded) { container.innerHTML = '<div class="gt-empty">読込中…</div>'; return; }
        if (!tasks.length) { container.innerHTML = '<div class="gt-empty">担当が「外注」のタスクが見つかりませんでした。</div>'; return; }
        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        const lookOf = lookFor(vendorLooks(), vid);
        renderLegend(lookOf);
        renderGantt(lookOf);
    }

    // ===== ガントチャート =====
    function renderGantt(lookOf) {
        const minStart = new Date(Math.min(...tasks.map(t => t.start)));
        const maxEnd = new Date(Math.max(...tasks.map(t => t.end)));
        // 右端の文字（工場出荷など）が目盛りの外に出ないよう、終わりに余白を足す（印刷は列が細いので多めに）
        let start, end, colW;
        const cols = [];
        if (unit === 'day') {
            start = new Date(minStart); end = new Date(maxEnd); end.setDate(end.getDate() + (printing ? 21 : 14)); colW = 28;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cols.push(new Date(d));
        } else {
            start = startOfWeekMon(minStart); end = startOfWeekMon(maxEnd); end.setDate(end.getDate() + (printing ? 49 : 34)); colW = 70;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) cols.push(new Date(d));
        }
        const weekFit = unit === 'week' && !printing;
        const labW = printing ? PRINT_LABEL_W : weekFit ? WEEK_LABEL_W : LABEL_W;
        if (printing) colW = (PRINT_W - labW) / cols.length;
        let fits = false;
        if (weekFit) {
            fitW = container.clientWidth;
            const fit = (fitW - labW) / cols.length;
            fits = fit >= WEEK_MIN_COL_W;
            colW = fits ? fit : WEEK_MIN_COL_W;
        }
        container.classList.toggle('is-fit', fits);
        // 列が細くて目盛りの日付が重なるときは、何列かおきに表示する
        const step = Math.max(1, Math.ceil((unit === 'day' ? 20 : 36) / colW));
        const T = Math.round((end - start) / DAY_MS) + 1;
        const pct = d => Math.round((d - start) / DAY_MS) / T * 100;

        // 見出し（年月・週／日）
        const months = [];
        cols.forEach((d, i) => {
            const k = d.getFullYear() * 12 + d.getMonth();
            const last = months[months.length - 1];
            if (last && last.k === k) last.span++; else months.push({ k, span: 1, i, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
        });
        const head = `<div class="gt-head">
            <div class="gt-label">工程 ／ 機械・ユニット</div>
            <div class="gt-scale">
                <div class="gt-months">${months.map(m => `<div style="flex:${m.span} 0 0">${m.label}</div>`).join('')}</div>
                <div class="gt-cols">${cols.map((d, i) => {
                    if (i % step) return '<div></div>';
                    if (unit === 'week') return `<div>${mdStr(d)}</div>`;
                    const we = d.getDay() === 0 || d.getDay() === 6;
                    return `<div class="${we ? 'is-we' : ''}">${d.getDate()}<small>${WEEKDAY_JA[d.getDay()]}</small></div>`;
                }).join('')}</div>
            </div></div>`;
        // 背景：週単位は1週おきに薄く塗る。日単位は土日を灰色。今日は列ごと薄い紺
        const bands = unit === 'day'
            ? cols.filter(d => d.getDay() % 6 === 0).map(d => `<div class="gt-we" style="left:${pct(d)}%;width:${100 / T}%"></div>`).join('')
            : cols.map((d, i) => i % 2 ? `<div class="gt-band" style="left:${pct(d)}%;width:${7 / T * 100}%"></div>` : '').join('');
        const t0 = today();
        const now = t0 >= start && t0 <= end ? `<div class="gt-now" style="left:${pct(t0)}%;width:${100 / T}%"></div>` : '';

        function rowHtml(t, gname) {
            const look = lookOf(t);
            const days = Math.round((t.end - t.start) / DAY_MS) + 1;
            const left = pct(t.start), width = days / T * 100;
            const period = `${mdStr(t.start)}〜${mdStr(t.end)}`;
            const where = [t.machine, t.unit].filter(Boolean).join(' ');
            const title = `${t.text}${where ? '（' + where + '）' : ''} ${look.name} ${period}（${days}日）`;
            const done = t.end < t0 ? ' is-done' : '';
            const body = days === 1 && /出荷|検査|立会/.test(t.text)
                ? mileHtml('gt-mile' + done, `left:${left}%`, look, `${t.text} ${mdStr(t.start)}`, title)
                : `<div class="gt-bar${done}" style="left:${left}%;width:${width}%;${barStyle(look)}" title="${esc(title)}"></div>`
                  + `<div class="gt-text${done}" data-lbl-in="calc(${left}% + 10px)" data-lbl-out="calc(${left + width}% + 8px)" style="left:calc(${left}% + 10px);color:${look.ink}" title="${esc(title)}"><b>${esc(gname)}</b><span>${esc(where)}${where ? '　' : ''}${period}</span></div>`;
            return `<div class="gt-row${look.grey ? ' is-grey' : ''}">
                <div class="gt-label" title="${esc(where)}"><b>${esc(t.machine || '')}</b><span>${esc(t.unit || '')}</span></div>
                <div class="gt-track">${body}</div></div>`;
        }
        // 工程ごとのまとまり：工程名を左の列にまとめ、その右に機械・ユニットの行
        const groups = GS.processGroups(tasks);
        const groupHtml = g => `<div class="gt-group"><div class="gt-gname" title="${esc(g.name)}">${esc(g.name)}</div><div class="gt-grows">${g.tasks.map(t => rowHtml(t, g.name)).join('')}</div></div>`;

        container.innerHTML = `<div class="gt-inner" style="min-width:${printing || fits ? 0 : labW + cols.length * colW}px">${head}
            <div class="gt-body"><div class="gt-bg" style="left:${labW}px">${bands}${now}</div>${groups.map(groupHtml).join('')}</div></div>`;
        fitLabels(container);
    }

    container.addEventListener('click', e => {
        if (!e.target.closest('[data-gt-toggle]')) return;
        otherOpen = !otherOpen;
        render();
    });
    document.querySelectorAll('.gantt-unit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.gantt-unit-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            unit = btn.dataset.unit;
            render();
        });
    });
    document.addEventListener('gaichusheetchange', () => { if (!loaded) load(); else { pickTasks(); render(); } });
    // 週単位は枠の幅で列幅が変わるので描き直す（資料を開いたときも resize が来る）
    window.addEventListener('resize', () => {
        if (loaded && tasks.length && unit === 'week' && !printing && container.clientWidth !== fitW) render();
        else fitLabels(container);
    });
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); });

    render();
})();

// 外注先用シート：工程表（工程表の「外注」タスクを外注先ごとに表示）
//   ・外注先の判定は工程表の「外注先企業」（tasks.vendor_id）。未入力のタスクは「外注先未設定」にまとめる
//   ・「全体」は外注先ごとのまとまりで並べる。外注先を選ぶと、その外注先→未設定の順に表示し、ほかの外注先は灰色の参考（開閉できる）
//   ・色は外注先シートの色を使う
//   ・表示は「ガントチャート」と「カレンダー」を切り替えられる（最初はガントチャート。選んだ表示はブラウザに覚えておく）
//   ・バーは外注先の色の薄い背景＋左端の濃い帯。バーの先頭に「工程名 機械・ユニット 開始日〜終了日」
//   ・1日だけの出荷・検査・立会は、外注先の色の縦線＋文字（文字は外注先の色を濃くした色）
// 読み込み前に gaichu-sheet.js を読み込み、ページに #miniGantt と .gantt-unit-btn（週単位・日単位）、
// .gantt-view-btn（ガントチャート・カレンダー）、#ganttCalNav（月の切り替え）、#ganttLegend を置いておくこと。
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
    const VIEW_KEY = 'gaichu-schedule-view';
    // 印刷のとき：A4横の印刷幅（約1047px）から枠の余白を引いた幅に収める。左の工程名の列も細くする（ページ側の印刷用CSSと合わせる）
    const PRINT_W = 930, PRINT_LABEL_W = 260;
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
    let view = 'gantt';
    try { const v = localStorage.getItem(VIEW_KEY); if (v === 'gantt' || v === 'calendar') view = v; } catch (e) { /* 保存できない環境は最初の表示のまま */ }
    let calMonth = null;     // カレンダーで選んだ月（年*12+月）。null は今日の月
    let shownMonth = null;   // 実際に表示している月（工程のある月の範囲に収めたもの）

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
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const diffDays = (a, b) => Math.round((b - a) / DAY_MS);
    const monthIdx = d => d.getFullYear() * 12 + d.getMonth();
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
    const isMileTask = t => Math.round((t.end - t.start) / DAY_MS) === 0 && /出荷|検査|立会/.test(t.text);

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
    // バー：薄い背景＋枠線＋左端の濃い帯。先頭に工程名・機械ユニット・期間
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

    // 表示の切り替えに合わせて、週単位・日単位のボタンと月の切り替えを出し分ける
    function syncToolbar() {
        document.querySelectorAll('.gantt-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        document.querySelectorAll('.gantt-unit-toggle').forEach(n => { n.hidden = view !== 'gantt'; });
        const nav = document.getElementById('ganttCalNav');
        if (nav) nav.hidden = view !== 'calendar';
    }

    function render() {
        syncToolbar();
        container.className = view === 'calendar' ? 'gt gt--cal' : 'gt' + (unit === 'day' ? ' is-day' : '');
        if (!loaded) { container.innerHTML = '<div class="gt-empty">読込中…</div>'; return; }
        if (!tasks.length) { container.innerHTML = '<div class="gt-empty">担当が「外注」のタスクが見つかりませんでした。</div>'; return; }
        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        const lookOf = lookFor(vendorLooks(), vid);
        renderLegend(lookOf);
        if (view === 'calendar') renderCalendar(lookOf); else renderGantt(lookOf);
    }

    // ===== ガントチャート =====
    function renderGantt(lookOf) {
        const minStart = new Date(Math.min(...tasks.map(t => t.start)));
        const maxEnd = new Date(Math.max(...tasks.map(t => t.end)));
        // 右端の文字（工場出荷など）が目盛りの外に出ないよう、終わりに余白を足す（印刷は列が細いので多めに）
        let start, end, colW;
        const cols = [];
        if (unit === 'day') {
            start = new Date(minStart); end = new Date(maxEnd); end.setDate(end.getDate() + (printing ? 14 : 7)); colW = 28;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cols.push(new Date(d));
        } else {
            start = startOfWeekMon(minStart); end = startOfWeekMon(maxEnd); end.setDate(end.getDate() + (printing ? 41 : 20)); colW = 70;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) cols.push(new Date(d));
        }
        const labW = printing ? PRINT_LABEL_W : LABEL_W;
        if (printing) colW = (PRINT_W - labW) / cols.length;
        // 列が細くて目盛りの日付が重なるときは、何列かおきに表示する
        const step = Math.max(1, Math.ceil((unit === 'day' ? 20 : 40) / colW));
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
                : `<div class="gt-bar${done}" style="left:${left}%;width:${width}%;${barStyle(look)}" title="${esc(title)}"><b>${esc(gname)}</b><span>${esc(where)}${where ? '　' : ''}${period}</span></div>`;
            return `<div class="gt-row${look.grey ? ' is-grey' : ''}">
                <div class="gt-label"><b>${esc(t.machine || '')}</b><span>${esc(t.unit || '')}</span></div>
                <div class="gt-track">${body}</div></div>`;
        }
        // 工程ごとのまとまり：工程名を左の列にまとめ、その右に機械・ユニットの行
        const groups = GS.processGroups(tasks);
        const groupHtml = g => `<div class="gt-group"><div class="gt-gname">${esc(g.name)}</div><div class="gt-grows">${g.tasks.map(t => rowHtml(t, g.name)).join('')}</div></div>`;

        container.innerHTML = `<div class="gt-inner" style="min-width:${printing ? 0 : labW + cols.length * colW}px">${head}
            <div class="gt-body"><div class="gt-bg" style="left:${labW}px">${bands}${now}</div>${groups.map(groupHtml).join('')}</div></div>`;
    }

    // ===== カレンダー（1か月・日曜始まり） =====
    //   ・期間をまたぐバーは週ごとに段へ詰めて並べる
    //   ・文字はバーの始まりの段だけ（週をまたぐときは「〜終了日」）。前の月から続くバーは、終わりの段に「開始日〜」を右寄せで出す
    function renderCalendar(lookOf) {
        const t0 = today();
        const minM = Math.min(...tasks.map(t => monthIdx(t.start))), maxM = Math.max(...tasks.map(t => monthIdx(t.end)));
        const mi = Math.max(minM, Math.min(maxM, calMonth == null ? monthIdx(t0) : calMonth));
        calMonth = calMonth == null ? null : mi;
        shownMonth = mi;
        const y = Math.floor(mi / 12), m = mi % 12;
        const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
        const g0 = addDays(first, -first.getDay());

        // 月の切り替え（見出しの月名と、端の月では ‹ › を押せなくする）
        const nav = document.getElementById('ganttCalNav');
        if (nav) {
            const title = nav.querySelector('[data-cal-title]');
            if (title) title.textContent = `${y}年${m + 1}月`;
            const prev = nav.querySelector('[data-cal="prev"]'), next = nav.querySelector('[data-cal="next"]');
            if (prev) prev.disabled = mi <= minM;
            if (next) next.disabled = mi >= maxM;
        }

        const items = [];
        GS.processGroups(tasks).forEach(g => g.tasks.forEach(t => items.push({ t, g: g.name, look: lookOf(t) })));
        const HEAD = 34, LANE = 28;
        const head = `<div class="gc-head">${WEEKDAY_JA.map((w, i) => `<div class="${i % 6 === 0 ? 'is-we' : ''}">${w}</div>`).join('')}</div>`;
        let weeksHtml = '';
        for (let w = g0; w <= last; w = addDays(w, 7)) {
            const we = addDays(w, 6);
            let days = '';
            for (let i = 0; i < 7; i++) {
                const d = addDays(w, i), cls = [d.getMonth() !== m ? 'is-other' : '', i % 6 === 0 ? 'is-we' : '', +d === +t0 ? 'is-today' : ''].filter(Boolean).join(' ');
                days += `<div class="gc-day ${cls}"><span>${d.getDate() === 1 && d.getMonth() !== m ? `${d.getMonth() + 1}/1` : d.getDate()}</span></div>`;
            }
            const hits = items.filter(x => x.t.start <= we && x.t.end >= w)
                .sort((a, b) => a.t.start - b.t.start || (b.t.end - b.t.start) - (a.t.end - a.t.start));
            const lanes = [];
            let segs = '';
            hits.forEach(({ t, g, look }) => {
                const s = t.start < w ? w : t.start, e = t.end > we ? we : t.end;
                const c0 = diffDays(w, s), c1 = diffDays(w, e);
                const mile = isMileTask(t);
                let li = lanes.findIndex(x => x < c0);
                if (li < 0) { li = lanes.length; lanes.push(-1); }
                lanes[li] = mile ? c1 + 1 : c1;
                const top = HEAD + li * LANE, left = (c0 / 7 * 100).toFixed(3) + '%';
                const where = [t.machine, t.unit].filter(Boolean).join(' ');
                const days = diffDays(t.start, t.end) + 1;
                const title = `${t.text}${where ? '（' + where + '）' : ''} ${look.name} ${mdStr(t.start)}〜${mdStr(t.end)}（${days}日）`;
                const done = t.end < t0 ? ' is-done' : '';
                if (mile) { segs += mileHtml('gc-mile' + done, `top:${top}px;left:${left}`, look, `${t.text} ${mdStr(t.start)}`, title); return; }
                const isHead = t.start >= w, isTail = t.start < g0 && t.end <= we;
                const period = isHead ? (t.end > we ? `〜${mdStr(t.end)}` : `${mdStr(t.start)}〜${mdStr(t.end)}`) : isTail ? `${mdStr(t.start)}〜` : '';
                const text = isHead || isTail ? `<b>${esc(g)}</b><span>${esc(where)}${where ? '　' : ''}${period}</span>` : '';
                const r = (a, b) => `${a ? 5 : 0}px ${b ? 5 : 0}px ${b ? 5 : 0}px ${a ? 5 : 0}px`;
                segs += `<div class="gc-bar${done}${isTail ? ' is-tail' : ''}" title="${esc(title)}" style="top:${top}px;left:${left};width:calc(${((c1 - c0 + 1) / 7 * 100).toFixed(3)}% - 8px);`
                    + `background:${look.tint};border-color:${look.edge};color:${look.ink};box-shadow:${isHead ? `inset 4px 0 0 ${look.color}` : 'none'};border-radius:${r(isHead, t.end <= we)}">${text}</div>`;
            });
            weeksHtml += `<div class="gc-week" style="height:${HEAD + Math.max(2, lanes.length) * LANE + 6}px">${days}${segs}</div>`;
        }
        container.innerHTML = `<div class="gc">${head}${weeksHtml}</div>`;
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
    document.querySelectorAll('.gantt-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            view = btn.dataset.view;
            try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* 保存できなくても切り替えはする */ }
            render();
        });
    });
    const calNav = document.getElementById('ganttCalNav');
    if (calNav) calNav.addEventListener('click', e => {
        const b = e.target.closest('[data-cal]');
        if (!b || b.disabled) return;
        const cur = shownMonth == null ? monthIdx(today()) : shownMonth;
        calMonth = b.dataset.cal === 'today' ? null : cur + (b.dataset.cal === 'next' ? 1 : -1);
        render();
    });
    document.addEventListener('gaichusheetchange', () => { calMonth = null; if (!loaded) load(); else { pickTasks(); render(); } });
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); });

    render();
})();

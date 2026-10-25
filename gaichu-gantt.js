// 外注先用シート：工程表（工程表の「外注」タスクを外注先ごとに表示）
//   ・外注先の判定は工程表の「外注先企業」（tasks.vendor_id）。未入力のタスクは「外注先未設定」にまとめる
//   ・「全体」は外注先ごとのまとまりで並べる。外注先を選ぶと、その外注先→未設定の順に表示し、ほかの外注先は灰色の参考（開閉できる）
//   ・色は外注先シートの色を使う
// 読み込み前に gaichu-sheet.js を読み込み、ページに #miniGantt と .gantt-unit-btn（週単位・日単位）を置いておくこと。
(function () {
    const container = document.getElementById('miniGantt');
    const GS = window.GaichuSheet;
    if (!container || !GS) return;

    const SHOW_OTHER_VENDORS = true;     // 外注先を選んだとき、ほかの外注先の工程を参考表示するか
    const UNSET = { color: '#7b8088', tint: '#ebebe8', ink: '#3a3f47' };
    const GREY = { color: '#b4b7bb', tint: '#f1f1ee', ink: '#6b7079' };
    const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
    const DAY_MS = 86400000;
    const LABEL_W = 250;
    // 印刷のとき：A4横の印刷幅（約1047px）から枠の余白を引いた幅に収める。左の工程名の列も細くする（ページ側の印刷用CSSと合わせる）
    const PRINT_W = 930, PRINT_LABEL_W = 180;
    let printing = false;

    let tasks = [];          // [{ ...task, start: Date, end: Date }]（外注のタスク＋それにかかる試運転のタスク）
    let allTasks = [];
    // 表示するタスク：外注のタスクすべてと、外注先の機械・ユニットにかかる試運転のタスク（外注先を選んでいるときはその外注先の分）
    function pickTasks() {
        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        const withDate = t => t.start_date && t.end_date;
        const conv = t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) });
        tasks = allTasks.filter(t => GS.isOutsource(t.owner) && withDate(t)).map(conv)
            .concat(GS.trialTasksFor(allTasks, null).filter(withDate).map(t => ({ ...conv(t), _kusakabe: true })))
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
    function mix(hex, t) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return hex;
        const n = parseInt(m[1], 16);
        return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)).toString(16).padStart(2, '0')).join('');
    }
    // 外注先の表示情報（外注先シートから）。short はバーに書く短い名前
    function vendorLooks() {
        const map = new Map();
        GS.state.sheets.forEach(s => map.set(s.vendor_id, {
            name: s.display,
            short: s.short || s.display,
            color: s.color, tint: mix(s.color, 0.88), ink: mix(s.color, -0.32),
        }));
        return map;
    }

    async function load() {
        if (!GS.state.ready) return;
        allTasks = await GS.loadTasks();
        pickTasks();
        loaded = true;
        render();
    }

    function render() {
        container.className = 'gt';
        if (!loaded) { container.innerHTML = '<div class="gt-empty">読込中…</div>'; return; }
        if (!tasks.length) { container.innerHTML = '<div class="gt-empty">担当が「外注」のタスクが見つかりませんでした。</div>'; return; }
        const looks = vendorLooks();
        const minStart = new Date(Math.min(...tasks.map(t => t.start)));
        const maxEnd = new Date(Math.max(...tasks.map(t => t.end)));
        // 右端の文字（期間・工場出荷など）が目盛りの外に出ないよう、終わりに余白を足す（印刷は列が細いので多めに）
        let start, end, colW;
        const cols = [];
        if (unit === 'day') {
            start = new Date(minStart); end = new Date(maxEnd); end.setDate(end.getDate() + (printing ? 14 : 7)); colW = 26;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cols.push(new Date(d));
        } else {
            start = startOfWeekMon(minStart); end = startOfWeekMon(maxEnd); end.setDate(end.getDate() + (printing ? 41 : 20)); colW = 58;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) cols.push(new Date(d));
        }
        if (printing) colW = (PRINT_W - PRINT_LABEL_W) / cols.length;
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
            <div class="gt-label"></div>
            <div class="gt-scale">
                <div class="gt-months">${months.map(m => `<div style="flex:${m.span} 0 0">${m.label}</div>`).join('')}</div>
                <div class="gt-cols">${cols.map((d, i) => {
                    if (i % step) return '<div></div>';
                    if (unit === 'week') return `<div>${mdStr(d)}</div>`;
                    const we = d.getDay() === 0 || d.getDay() === 6;
                    return `<div class="${we ? 'is-we' : ''}">${d.getDate()}<small>${WEEKDAY_JA[d.getDay()]}</small></div>`;
                }).join('')}</div>
            </div></div>`;
        const lines = months.slice(1).map(m => `<div class="gt-mline" style="left:${m.i / cols.length * 100}%"></div>`).join('');
        const weekends = unit === 'day'
            ? cols.filter(d => d.getDay() % 6 === 0).map(d => `<div class="gt-we" style="left:${pct(d)}%;width:${100 / T}%"></div>`).join('') : '';

        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        // バーの色：外注先の色。外注先を選んでいるときは、ほかの外注先は灰色（参考）。外注先企業が未入力は「未定」、場所だけ借りる電気艤装・試運転・出荷準備は場所の会社
        function lookOf(t) {
            // 場所だけ借りる電気艤装・試運転・出荷準備：場所に入っている会社の色（入っていなければ未定）
            const key = t._kusakabe ? (GS.sheetByPlace(t.test_run_location) || {}).vendor_id : t.vendor_id;
            if (!looks.has(key)) return { ...UNSET, name: t._kusakabe ? '場所 未定' : '外注先未設定', short: '未定' };
            const l = looks.get(key);
            return vid != null && key !== vid ? { ...GREY, name: l.name, short: l.short, grey: true } : l;
        }
        function rowHtml(t) {
            const look = lookOf(t);
            const days = Math.round((t.end - t.start) / DAY_MS) + 1;
            const left = pct(t.start), width = days / T * 100;
            const period = `${mdStr(t.start)}〜${mdStr(t.end)}（${days}日）`;
            const where = [t.machine, t.unit].filter(Boolean).join(' ');
            const title = `${t.text}${where ? '（' + where + '）' : ''} ${look.name} ${period}`;
            let body;
            if (days === 1 && /出荷/.test(t.text)) {
                body = `<div class="gt-mile${look.grey ? ' is-grey' : ''}" style="left:${left}%" title="${esc(title)}"><i></i><b>${mdStr(t.start)}</b></div>`;
            } else {
                // 外注先名＋期間が入りきらないときは、期間をバーの右外に出す
                const fits = width / 100 * cols.length * colW >= [...look.short].length * 12.5 + [...period].length * 7 + 40;
                body = `<div class="gt-bar" style="left:${left}%;width:${width}%;background:${look.tint};border-color:${look.color};color:${look.ink}" title="${esc(title)}">
                        <b>${esc(look.short)}</b>${fits ? `<span>${period}</span>` : ''}</div>
                    ${fits ? '' : `<div class="gt-period" style="left:calc(${left + width}% + 8px)">${period}</div>`}`;
            }
            return `<div class="gt-row${look.grey ? ' is-grey' : ''}">
                <div class="gt-label"><b>${esc(t.machine || '')}</b><span>${esc(t.unit || '')}</span></div>
                <div class="gt-track">${body}</div></div>`;
        }
        // 工程ごとのまとまり（見出しに、その工程に入っている会社の色の印）
        const groups = GS.processGroups(tasks);
        const groupHtml = g => {
            const dots = [...new Map(g.tasks.map(t => { const l = lookOf(t); return [l.short, l]; })).values()]
                .map(l => `<span class="gt-gdot"><i style="background:${l.color}"></i>${esc(l.short)}</span>`).join('');
            return `<div class="gt-group">
                <div class="gt-ghead" style="background:#eeeeeb;color:#2b2f36"><div class="gt-gname">${esc(g.name)}<small class="gt-gdots">${dots}</small></div></div>
                ${g.tasks.map(rowHtml).join('')}</div>`;
        };

        container.innerHTML = `<div class="gt-inner" style="min-width:${printing ? 0 : LABEL_W + cols.length * colW}px">${head}
            <div class="gt-body"><div class="gt-bg">${weekends}${lines}</div>${groups.map(groupHtml).join('')}</div></div>`;
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
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); });

    render();
})();

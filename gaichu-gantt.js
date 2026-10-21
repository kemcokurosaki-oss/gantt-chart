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

    let tasks = [];          // [{ ...task, start: Date, end: Date }]
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
            short: s.display.replace(/殿$/, '').replace(/^株式会社|株式会社$|㈱/g, '').trim() || s.display,
            color: s.color, tint: mix(s.color, 0.88), ink: mix(s.color, -0.32),
        }));
        return map;
    }

    async function load() {
        if (!GS.state.ready) return;
        const all = await GS.loadTasks();
        tasks = all.filter(t => GS.isOutsource(t.owner) && t.start_date && t.end_date)
            .map(t => ({ ...t, start: toDate(t.start_date), end: toDate(t.end_date) }))
            .sort((a, b) => a.start - b.start);
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

        const rows = tasks.map(t => {
            const days = Math.round((t.end - t.start) / DAY_MS) + 1;
            return { t, key: looks.has(t.vendor_id) ? t.vendor_id : null, days, left: pct(t.start), width: days / T * 100, mile: days === 1 && /出荷/.test(t.text) };
        });
        function rowHtml(r, grey) {
            const look = r.key != null ? looks.get(r.key) : { ...UNSET, name: '外注先未設定', short: '外注（外注先未設定）' };
            const v = grey ? { ...GREY, short: look.short } : look;
            const name = look.short;
            const period = `${mdStr(r.t.start)}〜${mdStr(r.t.end)}（${r.days}日）`;
            const where = [r.t.machine, r.t.unit].filter(Boolean).join(' ');
            const title = `${r.t.text}${where ? '（' + where + '）' : ''} ${look.name} ${period}`;
            let body;
            if (r.mile) {
                body = `<div class="gt-mile${grey ? ' is-grey' : ''}" style="left:${r.left}%" title="${esc(title)}"><i></i><b>${esc(r.t.text)} ${mdStr(r.t.start)}</b></div>`;
            } else {
                // 外注先名＋期間が入りきらないときは、期間をバーの右外に出す
                const fits = r.width / 100 * cols.length * colW >= [...name].length * 12.5 + [...period].length * 7 + 40;
                body = `<div class="gt-bar" style="left:${r.left}%;width:${r.width}%;background:${v.tint};border-color:${v.color};color:${v.ink}" title="${esc(title)}">
                        <b>${esc(name)}</b>${fits ? `<span>${period}</span>` : ''}</div>
                    ${fits ? '' : `<div class="gt-period" style="left:calc(${r.left + r.width}% + 8px)">${period}</div>`}`;
            }
            return `<div class="gt-row${grey ? ' is-grey' : ''}">
                <div class="gt-label"><b>${esc(r.t.text)}</b><span>${esc(where)}</span></div>
                <div class="gt-track">${body}</div></div>`;
        }
        function groupHtml(g) {
            const toggle = g.toggle ? ` data-gt-toggle="1"` : '';
            return `<div class="gt-group">
                <div class="gt-ghead${g.toggle ? ' is-toggle' : ''}" style="background:${g.tint};color:${g.ink}"${toggle}>
                    <div class="gt-gname">${g.toggle ? `<span class="gt-caret">${g.open ? '▼' : '▶'}</span>` : ''}<i style="background:${g.color}"></i>${esc(g.name)}<small>${g.note}</small></div>
                </div>
                ${g.open ? g.rows.map(r => rowHtml(r, g.grey)).join('') : ''}</div>`;
        }

        const byKey = k => rows.filter(r => r.key === k);
        const unset = byKey(null);
        // 振り分けの方法（工程表の編集画面の案内）は管理者だけに出す。外注先には「調整中」とだけ見せる
        const unsetNote = GS.state.isAdmin ? `${unset.length}工程（工程表の編集画面で「外注先企業」を入れると振り分けられます）` : `${unset.length}工程（担当は調整中です）`;
        const unsetGroup = unset.length ? [{ name: GS.state.isAdmin ? '外注先未設定' : '担当未定', note: unsetNote, ...UNSET, tint: '#eeeeeb', ink: '#2b2f36', rows: unset, open: true }] : [];
        const vid = GS.state.currentSheet ? GS.state.currentSheet.vendor_id : null;
        const groups = [];
        if (vid != null && looks.has(vid)) {
            const me = looks.get(vid);
            groups.push({ name: me.name, note: `${byKey(vid).length}工程`, ...me, rows: byKey(vid), open: true });
            groups.push(...unsetGroup);
            if (SHOW_OTHER_VENDORS) [...looks.keys()].filter(k => k !== vid && byKey(k).length).forEach(k => groups.push({
                name: looks.get(k).name, note: `参考・${byKey(k).length}工程（クリックで${otherOpen ? '閉じる' : '開く'}）`,
                color: GREY.color, tint: '#f5f5f3', ink: '#5b6068', rows: byKey(k), open: otherOpen, toggle: true, grey: true,
            }));
        } else {
            [...looks.keys()].filter(k => byKey(k).length).forEach(k => groups.push({ name: looks.get(k).name, note: `${byKey(k).length}工程`, ...looks.get(k), rows: byKey(k), open: true }));
            groups.push(...unsetGroup);
        }

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
    document.addEventListener('gaichusheetchange', () => { if (!loaded) load(); else render(); });
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); });

    render();
})();

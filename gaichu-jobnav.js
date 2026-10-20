// 外注先用シート：左の工事番号一覧
//   ・外注先シート（gaichu_sheets＋gaichu_vendors）が登録されている工番を並べ、選ぶとその工番のシートを右側に表示する（?pn= を変えて読み込み直す）
//   ・工事名称・出荷納期（工場出荷）は工程表（tasks）から。出荷済みの工番は下にまとめて、たためる
//   ・管理者（org_chart_admins）には外注先シートの追加と外注先マスタの管理のボタンを出す（画面は gaichu-admin.js）
//   ・?pn= なしで開いたときは、前回見ていた工番（なければ一覧の先頭）を開く
//   ・一覧は折りたためる（工番だけの細い列になる）。開閉の状態はブラウザに覚えておく
// 読み込み前に gaichu-sheet.js（と gaichu-admin.js）を読み込み、ページに #jobNav を置いておくこと。
(function () {
    const GS = window.GaichuSheet;
    const nav = document.getElementById('jobNav');
    if (!GS || !nav) return;
    const client = GS.client;
    const list = document.getElementById('jobNavList');
    const admin = document.getElementById('jobNavAdmin');
    const input = document.getElementById('jobNavSearch');
    const LAST_KEY = 'gaichu_last_pn', COLLAPSE_KEY = 'gaichu_nav_collapsed', DONE_KEY = 'gaichu_nav_done_open';
    const cur = GS.state.pn;
    if (cur) localStorage.setItem(LAST_KEY, cur);

    let projects = [];
    let isAdmin = false;
    let doneOpen = localStorage.getItem(DONE_KEY) === '1';

    // 社内公開の切り替え（管理者のみ。DBの閲覧の制限が切り替わる。元は一覧ページにあったもの）
    async function togglePublic() {
        const next = !GS.state.isPublic;
        if (!confirm(next
            ? '外注先用シートを社内に公開します。\n社内でログインしている人全員が、各シートを見られるようになります。よろしいですか？'
            : '社内公開をオフにします。\n管理者以外の人は、各シートを見られなくなります。よろしいですか？')) return;
        const { data: { session } } = await client.auth.getSession();
        const { data, error } = await client.from('gaichu_settings')
            .update({ value: { public: next }, updated_at: new Date().toISOString(), updated_by: session && session.user.email })
            .eq('key', 'visibility').select('key');
        if (error || !data || !data.length) { alert('切り替えられませんでした：' + ((error && error.message) || '権限がないか、公開スイッチの設定がまだありません')); return; }
        location.reload();
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const md = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${y}/${m}/${d}`; };
    function isDone(p) {
        if (!p.shipDate) return false;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const [y, m, d] = p.shipDate.split('-').map(Number);
        return new Date(y, m - 1, d) < today;
    }
    // 工番を切り替えるときは、メインのタブ（&tab=）だけ引き継ぐ
    function hrefFor(pn) {
        const u = new URL(location.href);
        ['v', 'doc', 'solo'].forEach(k => u.searchParams.delete(k));
        u.searchParams.set('pn', pn);
        return u.pathname + u.search;
    }

    // ===== 折りたたみ =====
    function setCollapsed(on) {
        document.body.classList.toggle('nav-collapsed', on);
        localStorage.setItem(COLLAPSE_KEY, on ? '1' : '');
        const t = document.getElementById('jobNavToggle');
        if (t) t.title = on ? '工事の一覧を開く' : '工事の一覧をたたむ';
        window.dispatchEvent(new Event('resize'));   // 図面の枠・工程表・体制表の大きさを合わせ直す
    }
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    document.getElementById('jobNavToggle').addEventListener('click', () => setCollapsed(!document.body.classList.contains('nav-collapsed')));

    // ===== 読み込み =====
    async function load() {
        const { data: { session } } = await client.auth.getSession();
        if (!session) { list.innerHTML = '<p class="jn-msg">社内のアカウントでログインすると、工事の一覧が表示されます。</p>'; return; }
        const [sheetsRes, adminRes] = await Promise.all([
            client.from('gaichu_sheets').select('id, project_number, vendor_id, color, sort_order, gaichu_vendors(name, display_name)').order('sort_order').order('id'),
            client.rpc('is_org_chart_admin'),
        ]);
        if (sheetsRes.error) console.error('外注先シートの取得に失敗しました', sheetsRes.error);
        isAdmin = !adminRes.error && adminRes.data === true;
        const byPn = new Map();
        (sheetsRes.data || []).forEach(r => {
            const pn = String(r.project_number);
            if (!byPn.has(pn)) byPn.set(pn, { pn, name: '', shipDate: null, sheets: [] });
            const v = r.gaichu_vendors || {};
            byPn.get(pn).sheets.push({ display: v.display_name || v.name || '', color: r.color || '#7f8c8d' });
        });
        projects = [...byPn.values()].sort((a, b) => a.pn.localeCompare(b.pn, 'ja', { numeric: true }));
        if (projects.length) {
            const { data: tasks, error } = await client.from('tasks')
                .select('project_number, project_details, text, end_date')
                .in('project_number', projects.map(p => p.pn));
            if (error) console.error('工事情報の取得に失敗しました', error);
            (tasks || []).forEach(t => {
                const p = byPn.get(String(t.project_number));
                if (!p) return;
                if (!p.name && t.project_details) p.name = t.project_details;
                if (String(t.text || '').trim() === '工場出荷' && t.end_date && (!p.shipDate || t.end_date > p.shipDate)) p.shipDate = t.end_date;
            });
        }
        // 工番の指定がないときは、前回見ていた工番（なければ出荷前の先頭）を開く
        if (!cur) {
            const last = localStorage.getItem(LAST_KEY);
            const target = projects.find(p => p.pn === last) || projects.find(p => !isDone(p)) || projects[0];
            if (target) { location.replace(hrefFor(target.pn)); return; }
        }
        loaded = true;
        render();
    }
    let loaded = false;
    // 社内公開の状態は gaichu-sheet.js が読み込むので、読み込み後に管理者メニューを描き直す
    document.addEventListener('gaichusheetchange', () => { if (loaded) render(); });

    // ===== 表示 =====
    function itemHtml(p) {
        const search = [p.pn, p.name, ...p.sheets.map(s => s.display)].join(' ');
        return `<a class="jn-item${p.pn === cur ? ' active' : ''}" href="${esc(hrefFor(p.pn))}" data-search="${esc(search)}" title="${esc(p.pn + ' ' + (p.name || ''))}">
            <span class="jn-pn">${esc(p.pn)}</span>
            <span class="jn-name">${esc(p.name) || '（工事名称未登録）'}</span>
            <span class="jn-vendors">${p.sheets.map(s => `<span class="jn-vendor"><i style="background:${esc(s.color)}"></i>${esc(s.display)}</span>`).join('')}</span>
        </a>`;
    }
    function render() {
        const pub = GS.state.isPublic;
        admin.innerHTML = isAdmin && window.GaichuAdmin
            ? `<span class="jn-foot-label">管理者メニュー</span><button type="button" class="jn-btn" data-jn="add">＋ 外注先シートを追加</button><button type="button" class="jn-btn" data-jn="vendors">外注先マスタの管理</button>`
              + `<button type="button" class="jn-btn jn-public${pub ? ' on' : ''}" data-jn="public" title="押すと社内公開のオン／オフを切り替えます"><i></i>社内公開：${pub ? 'オン' : 'オフ（管理者のみ）'}</button>`
            : '';
        if (!projects.length) {
            list.innerHTML = `<p class="jn-msg">外注先シートはまだ登録されていません。${isAdmin ? '「＋ 外注先シートを追加」から登録してください。' : ''}</p>`;
            return;
        }
        const active = projects.filter(p => !isDone(p)), done = projects.filter(isDone);
        // 表示中の工番が出荷済みなら、出荷済みのまとまりを開いておく
        const open = doneOpen || done.some(p => p.pn === cur);
        list.innerHTML = active.map(itemHtml).join('')
            + (done.length ? `<button type="button" class="jn-group" data-jn="done" aria-expanded="${open}">${open ? '▾' : '▸'} 出荷済み（${done.length}）</button>`
                + `<div class="jn-done"${open ? '' : ' hidden'}>${done.map(itemHtml).join('')}</div>` : '');
        applySearch();
    }
    // 検索中は出荷済みも含めて探す
    function applySearch() {
        const q = input.value.trim().toLowerCase();
        list.classList.toggle('is-searching', !!q);
        list.querySelectorAll('.jn-item').forEach(a => {
            a.hidden = !!q && !(a.dataset.search || '').toLowerCase().includes(q);
        });
    }
    input.addEventListener('input', applySearch);

    nav.addEventListener('click', e => {
        const b = e.target.closest('[data-jn]');
        if (!b) return;
        const act = b.dataset.jn;
        if (act === 'done') { doneOpen = !(b.getAttribute('aria-expanded') === 'true'); localStorage.setItem(DONE_KEY, doneOpen ? '1' : ''); render(); }
        else if (act === 'add') GaichuAdmin.openAdd({ onDone: () => location.reload() });
        else if (act === 'vendors') GaichuAdmin.openVendors({ onDone: () => location.reload() });
        else if (act === 'public') togglePublic();
    });

    load();
})();

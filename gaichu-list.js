// 外注先用シートの工事一覧
//   ・外注先シート（gaichu_sheets＋gaichu_vendors）が登録されている工番ごとにカードを作る
//   ・工事名称・客先・出荷納期（工場出荷）は工程表（tasks）から自動表示。カードから 外注業者_工事詳細シート.html?pn=工番 を開く
//   ・管理者（org_chart_admins）は外注先シートの追加・削除と、外注先マスタの管理ができる（画面は gaichu-admin.js）
//   ・外注先シートは社内ログイン者しか読めないため、未ログインのときはサインインの案内を出す
// ページには会社名などのデータを書かない（すべてDBから読む）。読み込み前に S_URL / S_KEY を定義しておくこと。
(function () {
    const SHEET_PAGE = '外注業者_工事詳細シート.html';
    const client = supabase.createClient(S_URL, S_KEY);
    const grid = document.getElementById('cardGrid');
    const tools = document.getElementById('listTools');
    const note = document.getElementById('listLoginNote');
    const input = document.getElementById('jobSearch');
    const countLabel = document.getElementById('countLabel');

    let loggedIn = false, isAdmin = false;
    let isPublic = true;  // 社内公開スイッチ（オフの間は管理者しか中身を読めない）。確認できないときは公開中として扱う
    let projects = [];    // [{ pn, name, customer, shipDate, sheets: [{ id, vendor_id, display, color }] }]

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const fmtDate = s => { if (!s) return '―'; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${y}/${m}/${d}`; };
    function chipStyle(color) {
        const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
        if (!m) return 'background:#f4f6f9;color:#2c3e50';
        const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
        const hex = arr => '#' + arr.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
        return `background:${hex(ch.map(c => c + (255 - c) * 0.88))};color:${hex(ch.map(c => c * 0.68))}`;
    }

    // ===== 読み込み =====
    async function load() {
        const { data: { session } } = await client.auth.getSession();
        loggedIn = !!session;
        renderNote();
        if (!loggedIn) { projects = []; render(); return; }
        const [sheetsRes, adminRes, publicRes] = await Promise.all([
            client.from('gaichu_sheets').select('id, project_number, vendor_id, color, sort_order, gaichu_vendors(name, display_name)').order('sort_order').order('id'),
            client.rpc('is_org_chart_admin'),
            client.rpc('gaichu_is_public'),
        ]);
        isPublic = publicRes.error ? true : publicRes.data === true;
        if (sheetsRes.error) console.error('外注先シートの取得に失敗しました', sheetsRes.error);
        isAdmin = !adminRes.error && adminRes.data === true;
        const byPn = new Map();
        (sheetsRes.data || []).forEach(r => {
            const pn = String(r.project_number);
            if (!byPn.has(pn)) byPn.set(pn, { pn, name: '', customer: '', shipDate: null, sheets: [] });
            const v = r.gaichu_vendors || {};
            byPn.get(pn).sheets.push({ id: r.id, vendor_id: r.vendor_id, display: v.display_name || v.name || '', color: r.color || '#7f8c8d' });
        });
        projects = [...byPn.values()].sort((a, b) => a.pn.localeCompare(b.pn, 'ja', { numeric: true }));
        // 工事名称・客先・工場出荷日を工程表から（工番ごとに最初に値が入っているもの／工場出荷は最も遅い日）
        if (projects.length) {
            const { data: tasks, error } = await client.from('tasks')
                .select('project_number, project_details, customer_name, text, end_date')
                .in('project_number', projects.map(p => p.pn));
            if (error) console.error('工事情報の取得に失敗しました', error);
            (tasks || []).forEach(t => {
                const p = byPn.get(String(t.project_number));
                if (!p) return;
                if (!p.name && t.project_details) p.name = t.project_details;
                if (!p.customer && t.customer_name) p.customer = t.customer_name;
                if (String(t.text || '').trim() === '工場出荷' && t.end_date && (!p.shipDate || t.end_date > p.shipDate)) p.shipDate = t.end_date;
            });
        }
        render();
    }

    // ===== 表示 =====
    function renderNote() {
        if (loggedIn) { note.hidden = true; note.innerHTML = ''; return; }
        note.hidden = false;
        note.innerHTML = `<span>工事一覧は、社内のアカウントでログインすると表示されます。</span>`
            + `<button type="button" class="sheet-login-btn" data-login>Microsoftでサインイン</button><span class="sheet-login-err"></span>`;
    }
    function status(p) {
        if (!p.shipDate) return { cls: 'status-pill--upcoming', label: '出荷日未定' };
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const [y, m, d] = p.shipDate.split('-').map(Number);
        return new Date(y, m - 1, d) < today ? { cls: 'status-pill--done', label: '出荷済み' } : { cls: 'status-pill--active', label: '進行中' };
    }
    function render() {
        tools.innerHTML = isAdmin
            ? `<button type="button" class="list-btn list-public${isPublic ? ' is-on' : ''}" data-act="public" title="社内でログインしている人に見せるかどうかを切り替えます">${isPublic ? '社内公開：オン（社内の人が閲覧できる）' : '社内公開：オフ（管理者のみ閲覧）'}</button>`
              + `<span class="list-spacer"></span><button type="button" class="list-btn list-btn--primary" data-act="add">＋ 外注先シートを追加</button><button type="button" class="list-btn" data-act="vendors">外注先マスタの管理</button>`
            : '';
        if (!loggedIn) { grid.innerHTML = ''; countLabel.textContent = ''; return; }
        if (!isAdmin && !isPublic) {
            grid.innerHTML = '<p class="list-empty">外注先用シートは準備中です。公開されるまでお待ちください。</p>';
            countLabel.textContent = '';
            return;
        }
        if (!projects.length) {
            grid.innerHTML = `<p class="list-empty">外注先シートはまだ登録されていません。${isAdmin ? '「＋ 外注先シートを追加」から登録してください。' : ''}</p>`;
            countLabel.textContent = '全 0 件';
            return;
        }
        grid.innerHTML = projects.map(p => {
            const st = status(p);
            const search = [p.pn, p.name, p.customer, ...p.sheets.map(s => s.display)].join(' ');
            return `<a class="job-card" href="${SHEET_PAGE}?pn=${encodeURIComponent(p.pn)}" data-search="${esc(search)}">
                <div class="job-card__head"><span class="job-card__no">${esc(p.pn)}</span><span class="status-pill ${st.cls}">${st.label}</span></div>
                <div class="job-card__body">
                    <div class="job-card__title">${esc(p.name) || '（工事名称未登録）'}</div>
                    <div class="job-card__meta">
                        <div class="row"><span class="k">客先</span><span>${esc(p.customer) || '―'}</span></div>
                        <div class="row"><span class="k">出荷納期</span><span>${fmtDate(p.shipDate)}</span></div>
                    </div>
                    <div class="job-card__vendors">${p.sheets.map(s => `<span class="vendor-chip" style="${chipStyle(s.color)}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.display)}</span>`).join('')}</div>
                </div>
                <div class="job-card__foot">${isAdmin ? `<button type="button" class="list-btn list-btn--small" data-manage="${esc(p.pn)}">外注先の追加・削除</button>` : ''}<span>詳細を見る →</span></div>
            </a>`;
        }).join('');
        applySearch();
    }
    function applySearch() {
        const q = input.value.trim().toLowerCase();
        const cards = [...grid.querySelectorAll('.job-card')];
        let n = 0;
        cards.forEach(c => {
            const ok = !q || (c.dataset.search || '').toLowerCase().includes(q);
            c.style.display = ok ? '' : 'none';
            if (ok) n++;
        });
        countLabel.textContent = q ? `${n} 件 一致` : `全 ${cards.length} 件`;
    }
    input.addEventListener('input', applySearch);

    document.addEventListener('click', async e => {
        const mg = e.target.closest('[data-manage]');
        if (mg) { e.preventDefault(); e.stopPropagation(); GaichuAdmin.openManage({ pn: mg.dataset.manage, onDone: load }); return; }
        const a = e.target.closest('[data-act]');
        if (a) {
            if (a.dataset.act === 'public') { togglePublic(); return; }
            if (a.dataset.act === 'add') GaichuAdmin.openAdd({ onDone: load }); else GaichuAdmin.openVendors({ onDone: load });
            return;
        }
        if (e.target.closest('[data-login]')) {
            const err = document.querySelector('.sheet-login-err');
            if (location.protocol === 'file:') { err.textContent = '「体制表を開く.bat」から開いてください（ファイルを直接開いた状態ではログインできません）。'; return; }
            localStorage.setItem('m365_return_to', location.origin + location.pathname);
            const { error } = await client.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'openid profile email', redirectTo: location.origin + location.pathname } });
            if (error) err.textContent = 'Microsoftでのログインを開始できませんでした：' + error.message;
        }
    });

    // 社内公開の切り替え（管理者のみ。DBの閲覧の制限が切り替わる）
    async function togglePublic() {
        const next = !isPublic;
        if (!confirm(next
            ? '外注先用シートを社内に公開します。\n社内でログインしている人全員が、工事一覧と各シートを見られるようになります。よろしいですか？'
            : '社内公開をオフにします。\n管理者以外の人は、工事一覧と各シートを見られなくなります。よろしいですか？')) return;
        const { data: { session } } = await client.auth.getSession();
        const { data, error } = await client.from('gaichu_settings')
            .update({ value: { public: next }, updated_at: new Date().toISOString(), updated_by: session && session.user.email })
            .eq('key', 'visibility').select('key');
        if (error || !data || !data.length) { alert('切り替えられませんでした：' + ((error && error.message) || '権限がないか、公開スイッチの設定がまだありません')); return; }
        load();
    }

    load();
})();

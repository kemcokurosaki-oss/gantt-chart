-- 外注先用シートの設定（全工番共通。例：仕様書の「弊社担当」の2名）
-- シートのページ自体を GitHub Pages で公開するため、ページに直接書いていた個人情報をここへ移す。
-- 閲覧は社内ログイン者（外注先アカウントは除く）、変更は体制表の管理者（org_chart_admins）のみ。
-- Supabase の SQL Editor で1回だけ実行してください（値の登録はあとで行う）。

create table public.gaichu_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.gaichu_settings is '外注先用シートの全工番共通の設定。key=company_contacts は仕様書の弊社担当 [{dept, title, name, tel, email}]（先頭の人をヘッダーの弊社担当に表示）。';

alter table public.gaichu_settings enable row level security;
create policy contractor_default_deny on public.gaichu_settings as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_settings_select on public.gaichu_settings for select to authenticated using (true);
create policy gaichu_settings_write on public.gaichu_settings for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());

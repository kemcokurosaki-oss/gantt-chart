-- 外注先用シートの「社内公開」を工番ごとに切り替える（全体のスイッチは廃止）
--   工番ごとの公開の状態は gaichu_projects（project_number, is_public）。行がない工番はオフ
--   オフの工番：外注先シート・組立範囲・体制表・図面は、体制表の管理者（org_chart_admins）だけが閲覧できる
--   オンの工番：社内でログインしている人全員が閲覧できる（外注先アカウントは除く）
--   弊社担当など全工番共通の設定（gaichu_settings）は、オンの工番が1つでもあれば社内の人に見せる
--   切り替えはシートのページの左の工事番号一覧（管理者メニュー）で行う
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

create table public.gaichu_projects (
  project_number text primary key,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.gaichu_projects is '外注先用シートの工番ごとの設定。is_public=true の工番だけ社内（管理者以外）に公開する。行がない工番はオフ。';
alter table public.gaichu_projects enable row level security;
create policy contractor_default_deny on public.gaichu_projects as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_projects_select on public.gaichu_projects for select to authenticated using (true);
create policy gaichu_projects_write on public.gaichu_projects for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());

-- その工番が社内公開されているか
create or replace function public.gaichu_pn_public(pn text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from gaichu_projects where project_number = pn and is_public);
$$;

-- その工番の外注先用シートを見てよいか：管理者、またはその工番が社内公開されている
create or replace function public.gaichu_can_view_pn(pn text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select is_org_chart_admin() or gaichu_pn_public(pn);
$$;

-- 社内公開されている工番が1つでもあるか（全工番共通の設定の閲覧に使う）
create or replace function public.gaichu_any_public()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from gaichu_projects where is_public);
$$;

-- これまでの全体のスイッチの関数は、工番ごとの設定に合わせて中身を置き換える
create or replace function public.gaichu_is_public()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select gaichu_any_public();
$$;
create or replace function public.gaichu_can_view()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select is_org_chart_admin() or gaichu_any_public();
$$;

-- 閲覧の制限を工番ごとの判定に差し替える（外注先アカウントを除く制限 contractor_default_deny はそのまま）
drop policy gaichu_sheets_select on public.gaichu_sheets;
create policy gaichu_sheets_select on public.gaichu_sheets for select to authenticated using (gaichu_can_view_pn(project_number));

drop policy gaichu_scopes_select on public.gaichu_scopes;
create policy gaichu_scopes_select on public.gaichu_scopes for select to authenticated using (gaichu_can_view_pn(project_number));

drop policy org_charts_select on public.org_charts;
create policy org_charts_select on public.org_charts for select to authenticated using (gaichu_can_view_pn(project_number));

-- 図面の画像は「工番/ファイル名」で保存しているので、先頭のフォルダー名で工番を判定する
drop policy gaichu_figures_select on storage.objects;
create policy gaichu_figures_select on storage.objects for select to authenticated
  using (bucket_id = 'gaichu-figures' and not is_contractor() and gaichu_can_view_pn(split_part(name, '/', 1)));

-- gaichu_settings の閲覧（gaichu_can_view()）はそのまま：管理者か、公開中の工番が1つでもあれば読める

-- 全体のスイッチは廃止
delete from public.gaichu_settings where key = 'visibility';

commit;

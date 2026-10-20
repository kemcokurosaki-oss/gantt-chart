-- 外注先用シートの「社内公開」スイッチ
--   オフ（初期値）：外注先シート・組立範囲・体制表・図面・弊社担当は、体制表の管理者（org_chart_admins）だけが閲覧できる
--   オン        ：社内でログインしている人全員が閲覧できる（外注先アカウントは除く。これまでどおり）
--   切り替えは工事一覧ページの管理者用ボタンで行う（gaichu_settings の key=visibility, value={"public": true/false}）
--   ※ 外注先マスタ（gaichu_vendors）は工程表の編集画面のプルダウンで使うため、制限しない
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

-- スイッチの初期値（オフ）
insert into public.gaichu_settings (key, value, updated_by) values ('visibility', '{"public": false}'::jsonb, 'setup')
on conflict (key) do nothing;

-- 社内公開がオンか（ログインしている人なら誰でも呼べる。中身はスイッチの値だけ）
create or replace function public.gaichu_is_public()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select (value->>'public')::boolean from gaichu_settings where key = 'visibility'), false);
$$;

-- 外注先用シートを見てよいか：管理者、または社内公開がオン
create or replace function public.gaichu_can_view()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select is_org_chart_admin() or gaichu_is_public();
$$;

-- 閲覧の制限を差し替える（外注先アカウントを除く制限 contractor_default_deny はそのまま）
drop policy gaichu_sheets_select on public.gaichu_sheets;
create policy gaichu_sheets_select on public.gaichu_sheets for select to authenticated using (gaichu_can_view());

drop policy gaichu_scopes_select on public.gaichu_scopes;
create policy gaichu_scopes_select on public.gaichu_scopes for select to authenticated using (gaichu_can_view());

drop policy org_charts_select on public.org_charts;
create policy org_charts_select on public.org_charts for select to authenticated using (gaichu_can_view());

drop policy gaichu_settings_select on public.gaichu_settings;
create policy gaichu_settings_select on public.gaichu_settings for select to authenticated using (gaichu_can_view());

drop policy gaichu_figures_select on storage.objects;
create policy gaichu_figures_select on storage.objects for select to authenticated
  using (bucket_id = 'gaichu-figures' and not is_contractor() and gaichu_can_view());

commit;

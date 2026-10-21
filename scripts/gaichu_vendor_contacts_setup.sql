-- 外注先マスタの代表者（役職・氏名・電話・メール）
--   外注先マスタの管理画面で入力し、仕様書の「ご担当者」（工事ごとの入力が空欄のとき）と、体制表のカードの担当者の選択肢に使う
--   個人情報なので gaichu_vendors（工程表のプルダウン用に社内の全員が読める）とは分けて、別のテーブルに持つ
--   閲覧：管理者、またはその外注先のシートがある工番が社内公開されているとき（外注先アカウントは除く）
--   変更：体制表の管理者（org_chart_admins）のみ
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

create table public.gaichu_vendor_contacts (
  vendor_id bigint primary key references public.gaichu_vendors(id) on delete cascade,
  title text,
  name text,
  tel text,
  email text,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.gaichu_vendor_contacts is '外注先マスタの代表者。仕様書のご担当者（工事ごとの入力が空欄のとき）と体制表のカードの選択肢に使う。';

alter table public.gaichu_vendor_contacts enable row level security;
create policy contractor_default_deny on public.gaichu_vendor_contacts as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_vendor_contacts_select on public.gaichu_vendor_contacts for select to authenticated
  using (is_org_chart_admin() or exists (
    select 1 from public.gaichu_sheets s where s.vendor_id = gaichu_vendor_contacts.vendor_id and gaichu_pn_public(s.project_number)
  ));
create policy gaichu_vendor_contacts_write on public.gaichu_vendor_contacts for all to authenticated
  using (is_org_chart_admin()) with check (is_org_chart_admin());

commit;

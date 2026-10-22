-- 外注先マスタに「色分けの色」を持たせる（これまでは外注先シートごとに持っていた色を、外注先ごとに1つにする）
--   新しい外注先を登録するときに自動で色を決めてここに入れ、外注先シートを追加するときはこの色を使う
--   外注先マスタの管理画面で確認できる
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

alter table public.gaichu_vendors add column if not exists color text;
comment on column public.gaichu_vendors.color is '色分けの色（#rrggbb）。外注先シートを追加するときにこの色を使う';

-- いまある外注先は、最初に作った外注先シートの色を引き継ぐ
update public.gaichu_vendors v
   set color = s.color
  from (select distinct on (vendor_id) vendor_id, color from public.gaichu_sheets where color is not null order by vendor_id, id) s
 where s.vendor_id = v.id and v.color is null;

commit;

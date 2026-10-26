-- 支給品チェックリスト：支給日を✓（事前チェック）と分けて持つ
--   ・checked_on / checked_by …… ✓を付けた日と人（支給日より前の事前チェック。自動で入る）
--   ・supply_date ……………………… 支給日（編集画面で入力する）
-- Supabase の SQL Editor で1回だけ実行してください（gaichu_supply_setup.sql を実行したあと）。

alter table public.gaichu_supply_items add column if not exists supply_date date;
comment on column public.gaichu_supply_items.supply_date is '支給日（編集画面で入力）。✓を付けた日（checked_on）とは別';
comment on column public.gaichu_supply_items.checked_on is '✓を付けた日（支給日より前の事前チェック）';

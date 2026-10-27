-- 支給品チェックリスト：OneDrive のチェック表（Excel）を読み直したときに、前の内容と比べて反映するための列
--   ・source_file …… どのファイルから読み込んだ行か（OneDrive のファイルのID。貼り付けで作った行は空）
--   ・change_flag …… 読み直したときの変化（訂正／追加／削除。確認したら空に戻す）
--   ・prev ………………… 訂正の前の値（例：{"qty": 2}）。画面で「数量 2→3」のように出す
-- Supabase の SQL Editor で1回だけ実行してください（gaichu_supply_setup.sql を実行したあと）。

alter table public.gaichu_supply_items add column if not exists source_file text;
alter table public.gaichu_supply_items add column if not exists change_flag text check (change_flag in ('訂正', '追加', '削除'));
alter table public.gaichu_supply_items add column if not exists prev jsonb;
create index if not exists gaichu_supply_items_source on public.gaichu_supply_items (sheet_id, source_file);

-- 読み込んだファイルの記録に、ファイルの更新日時を残す（OneDrive 側が更新されたら「更新あり」と出すため）
alter table public.gaichu_supply_docs add column if not exists source_modified timestamptz;

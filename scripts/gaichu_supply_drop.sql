-- 支給品チェックリスト：使わなくなったテーブルの削除（2026-10-28 適用済み）
-- 外注先用シートの支給品チェックリストは、開くたびに OneDrive のチェック表（Excel）を直接読む閲覧専用になった。
-- ✓・支給日も Excel で入力するので、行や読み込みの記録を DB に持たなくなった。
-- OneDrive のフォルダーのリンク（gaichu_settings の key = 'supply_onedrive_folder'）は今も使うので残す。
drop table if exists public.gaichu_supply_items;
drop table if exists public.gaichu_supply_docs;
drop function if exists public.gaichu_supply_touch();

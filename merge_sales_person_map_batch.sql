-- app_settings.sales_person_map に工事番号→営業担当をマージする（既存キーは上書き）
-- Supabase ダッシュボード → SQL Editor で実行（RLS をバイパスする postgres 権限）
-- 対象: 3C54 展久, 4760/4761 銭, 4C95 原田, 4C04 銭, 3183 麻生

INSERT INTO public.app_settings (key, value)
VALUES ('sales_person_map', '{}')
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings
SET value = (
  CASE
    WHEN value IS NULL OR btrim(value) = '' THEN '{}'::jsonb
    ELSE value::jsonb
  END
  || jsonb_build_object(
    '3C54', '展久',
    '4760', '銭',
    '4761', '銭',
    '4C95', '原田',
    '4C04', '銭',
    '3183', '麻生'
  )
)::text
WHERE key = 'sales_person_map';

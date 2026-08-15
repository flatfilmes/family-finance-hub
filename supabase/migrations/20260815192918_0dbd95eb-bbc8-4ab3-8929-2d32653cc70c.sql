ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS mes_referencia integer NOT NULL DEFAULT EXTRACT(MONTH FROM now())::int,
  ADD COLUMN IF NOT EXISTS ano_referencia integer NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int;

ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_family_category_periodo_key;
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_family_id_category_id_periodo_key;

CREATE UNIQUE INDEX IF NOT EXISTS budgets_family_category_month_key
  ON public.budgets (family_id, category_id, mes_referencia, ano_referencia);

CREATE INDEX IF NOT EXISTS budgets_family_month_idx
  ON public.budgets (family_id, ano_referencia, mes_referencia);
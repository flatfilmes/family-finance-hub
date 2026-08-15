ALTER TABLE public.families ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.demo_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_settings TO authenticated;
GRANT ALL ON public.demo_settings TO service_role;

ALTER TABLE public.demo_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demo_settings_select" ON public.demo_settings
  FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));

CREATE POLICY "demo_settings_insert" ON public.demo_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));

CREATE POLICY "demo_settings_update" ON public.demo_settings
  FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));

CREATE POLICY "demo_settings_delete" ON public.demo_settings
  FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER demo_settings_updated_at
  BEFORE UPDATE ON public.demo_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.delete_demo_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  demo_ids uuid[];
  removidas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  SELECT array_agg(f.id) INTO demo_ids
  FROM public.families f
  WHERE f.is_demo = true
    AND public.is_family_admin(f.id, auth.uid());

  IF demo_ids IS NULL OR array_length(demo_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.purchase_items WHERE purchase_id IN (SELECT id FROM public.purchases WHERE family_id = ANY(demo_ids));
  DELETE FROM public.transactions WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expense_installments WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.purchases WHERE family_id = ANY(demo_ids);
  DELETE FROM public.card_invoices WHERE family_id = ANY(demo_ids);
  DELETE FROM public.credit_cards WHERE family_id = ANY(demo_ids);
  DELETE FROM public.bank_accounts WHERE family_id = ANY(demo_ids);
  DELETE FROM public.budgets WHERE family_id = ANY(demo_ids);
  DELETE FROM public.fixed_expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.incomes WHERE family_id = ANY(demo_ids);
  DELETE FROM public.member_financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.demo_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.family_members WHERE family_id = ANY(demo_ids);
  DELETE FROM public.families WHERE id = ANY(demo_ids);

  GET DIAGNOSTICS removidas = ROW_COUNT;
  RETURN removidas;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_demo_data() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_demo_data() TO authenticated;
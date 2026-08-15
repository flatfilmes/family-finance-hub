CREATE TYPE public.budget_period AS ENUM ('MENSAL');

CREATE TABLE public.budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  category_id uuid REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  valor_planejado numeric NOT NULL DEFAULT 0,
  periodo public.budget_period NOT NULL DEFAULT 'MENSAL',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX budgets_family_category_periodo_key ON public.budgets (family_id, category_id, periodo);
CREATE INDEX budgets_family_id_idx ON public.budgets (family_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_select ON public.budgets FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY budgets_insert_admin ON public.budgets FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY budgets_update_admin ON public.budgets FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY budgets_delete_admin ON public.budgets FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
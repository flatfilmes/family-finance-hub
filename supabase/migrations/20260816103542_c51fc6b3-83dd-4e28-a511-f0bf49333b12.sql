CREATE TYPE public.category_rule_match AS ENUM ('EXACT_PRODUCT','PRODUCT_CONTAINS','EXACT_MERCHANT','MERCHANT_CONTAINS');

CREATE TABLE public.category_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  match_type public.category_rule_match not null,
  match_value text not null,
  category_id uuid not null references public.expense_categories(id),
  source text not null default 'USER',
  priority integer not null default 100,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, match_type, match_value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_rules TO authenticated;
GRANT ALL ON public.category_rules TO service_role;

ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view category rules" ON public.category_rules
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can create category rules" ON public.category_rules
  FOR INSERT TO authenticated WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can update category rules" ON public.category_rules
  FOR UPDATE TO authenticated USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can delete category rules" ON public.category_rules
  FOR DELETE TO authenticated USING (public.is_family_member(family_id, auth.uid()));

CREATE TRIGGER update_category_rules_updated_at BEFORE UPDATE ON public.category_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX category_rules_family_idx ON public.category_rules(family_id) WHERE active;

ALTER TABLE public.purchases ADD COLUMN categoria_id uuid REFERENCES public.expense_categories(id);
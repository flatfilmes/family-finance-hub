ALTER TABLE public.card_statement_items
  ADD COLUMN IF NOT EXISTS tipo_revisado text,
  ADD COLUMN IF NOT EXISTS tipo_regra_origem text;

CREATE TABLE public.statement_type_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  match_value text not null,
  tipo text not null,
  credit_card_id uuid references public.credit_cards(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, match_value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_type_rules TO authenticated;
GRANT ALL ON public.statement_type_rules TO service_role;

ALTER TABLE public.statement_type_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view statement type rules" ON public.statement_type_rules
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can create statement type rules" ON public.statement_type_rules
  FOR INSERT TO authenticated WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can update statement type rules" ON public.statement_type_rules
  FOR UPDATE TO authenticated USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Family members can delete statement type rules" ON public.statement_type_rules
  FOR DELETE TO authenticated USING (public.is_family_member(family_id, auth.uid()));

CREATE TRIGGER update_statement_type_rules_updated_at BEFORE UPDATE ON public.statement_type_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX statement_type_rules_family_idx ON public.statement_type_rules(family_id) WHERE active;
CREATE TYPE public.income_type AS ENUM ('FIXA', 'VARIAVEL');
CREATE TYPE public.income_frequency AS ENUM ('MENSAL', 'SEMANAL', 'QUINZENAL', 'ANUAL', 'EVENTUAL');
CREATE TYPE public.expense_category AS ENUM ('ENERGIA', 'AGUA', 'INTERNET', 'ALUGUEL', 'FINANCIAMENTO', 'ASSINATURAS', 'TELEFONE', 'EDUCACAO', 'SAUDE', 'TRANSPORTE', 'OUTROS');
CREATE TYPE public.expense_recurrence AS ENUM ('MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');

CREATE TABLE public.incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo public.income_type NOT NULL DEFAULT 'FIXA',
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  frequencia public.income_frequency NOT NULL DEFAULT 'MENSAL',
  data_recebimento date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incomes TO authenticated;
GRANT ALL ON public.incomes TO service_role;
ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY incomes_select ON public.incomes FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY incomes_insert_admin ON public.incomes FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY incomes_update_admin ON public.incomes FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY incomes_delete_admin ON public.incomes FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));
CREATE TRIGGER incomes_updated_at BEFORE UPDATE ON public.incomes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX incomes_family_idx ON public.incomes(family_id);

CREATE TABLE public.fixed_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  categoria public.expense_category NOT NULL DEFAULT 'OUTROS',
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  vencimento integer NOT NULL DEFAULT 1 CHECK (vencimento BETWEEN 1 AND 31),
  recorrencia public.expense_recurrence NOT NULL DEFAULT 'MENSAL',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_expenses TO authenticated;
GRANT ALL ON public.fixed_expenses TO service_role;
ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_expenses_select ON public.fixed_expenses FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY fixed_expenses_insert_admin ON public.fixed_expenses FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY fixed_expenses_update_admin ON public.fixed_expenses FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY fixed_expenses_delete_admin ON public.fixed_expenses FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));
CREATE TRIGGER fixed_expenses_updated_at BEFORE UPDATE ON public.fixed_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX fixed_expenses_family_idx ON public.fixed_expenses(family_id);

CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  banco text NOT NULL,
  nome_cartao text NOT NULL,
  limite numeric(14,2) NOT NULL DEFAULT 0,
  dia_fechamento integer NOT NULL DEFAULT 1 CHECK (dia_fechamento BETWEEN 1 AND 31),
  dia_vencimento integer NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 31),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_cards TO authenticated;
GRANT ALL ON public.credit_cards TO service_role;
ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_cards_select ON public.credit_cards FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY credit_cards_insert_admin ON public.credit_cards FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY credit_cards_update_admin ON public.credit_cards FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY credit_cards_delete_admin ON public.credit_cards FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));
CREATE TRIGGER credit_cards_updated_at BEFORE UPDATE ON public.credit_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX credit_cards_family_idx ON public.credit_cards(family_id);
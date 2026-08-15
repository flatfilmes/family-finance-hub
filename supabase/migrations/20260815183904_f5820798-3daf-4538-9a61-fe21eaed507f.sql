CREATE TYPE public.purchase_type AS ENUM ('A_VISTA', 'CARTAO_CREDITO', 'PARCELADO');
CREATE TYPE public.payment_method AS ENUM ('DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO');

CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  icone text NOT NULL DEFAULT 'Circle',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_categories_select ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE TRIGGER expense_categories_updated_at BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.expense_categories (nome, icone) VALUES
  ('Casa', 'Home'),
  ('Alimentação', 'UtensilsCrossed'),
  ('Saúde', 'HeartPulse'),
  ('Transporte', 'Car'),
  ('Família', 'Users'),
  ('Educação', 'GraduationCap'),
  ('Lazer', 'Palmtree'),
  ('Compras', 'ShoppingBag'),
  ('Outros', 'Circle');

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  data_compra date NOT NULL DEFAULT CURRENT_DATE,
  forma_pagamento payment_method NOT NULL DEFAULT 'DINHEIRO',
  categoria_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  tipo_compra purchase_type NOT NULL DEFAULT 'A_VISTA',
  cartao_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  parcelas_total integer NOT NULL DEFAULT 1,
  parcela_atual integer NOT NULL DEFAULT 1,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY expenses_insert_admin ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY expenses_update_admin ON public.expenses FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY expenses_delete_admin ON public.expenses FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_expenses_family_data ON public.expenses (family_id, data_compra DESC);
CREATE INDEX idx_expenses_categoria ON public.expenses (categoria_id);
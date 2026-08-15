CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  estabelecimento text NOT NULL,
  data_compra date NOT NULL DEFAULT CURRENT_DATE,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  forma_pagamento public.payment_method NOT NULL DEFAULT 'DINHEIRO',
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  observacao text,
  nota_fiscal_url text,
  nota_fiscal_tipo text,
  ocr_status text NOT NULL DEFAULT 'NAO_PROCESSADO',
  ocr_dados jsonb,
  ocr_processado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_family_idx ON public.purchases(family_id, data_compra DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchases_select ON public.purchases FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));
CREATE POLICY purchases_insert ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY purchases_update ON public.purchases FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY purchases_delete ON public.purchases FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE TRIGGER purchases_updated_at BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  categoria_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  unidade_medida text NOT NULL DEFAULT 'UN',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated USING (true);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.products (nome, unidade_medida, categoria_id)
SELECT v.nome, v.un, (SELECT id FROM public.expense_categories WHERE nome = v.cat LIMIT 1)
FROM (VALUES
  ('Arroz','KG','Alimentação'),
  ('Feijão','KG','Alimentação'),
  ('Café','KG','Alimentação'),
  ('Carne','KG','Alimentação'),
  ('Leite','L','Alimentação'),
  ('Pão','UN','Alimentação'),
  ('Ovos','DZ','Alimentação'),
  ('Detergente','UN','Casa'),
  ('Sabão em pó','KG','Casa'),
  ('Papel higiênico','UN','Casa')
) AS v(nome, un, cat)
ON CONFLICT (nome) DO NOTHING;

CREATE TABLE public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  descricao_produto text NOT NULL,
  quantidade numeric(12,3) NOT NULL DEFAULT 1,
  unidade text NOT NULL DEFAULT 'UN',
  valor_unitario numeric(12,2) NOT NULL DEFAULT 0,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  categoria_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_items_purchase_idx ON public.purchase_items(purchase_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_items_select ON public.purchase_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id
    AND public.can_view_member_record(p.family_id, p.member_id, auth.uid())));
CREATE POLICY purchase_items_insert ON public.purchase_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id
    AND public.can_manage_member_record(p.family_id, p.member_id, auth.uid())));
CREATE POLICY purchase_items_update ON public.purchase_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id
    AND public.can_manage_member_record(p.family_id, p.member_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id
    AND public.can_manage_member_record(p.family_id, p.member_id, auth.uid())));
CREATE POLICY purchase_items_delete ON public.purchase_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id
    AND public.can_manage_member_record(p.family_id, p.member_id, auth.uid())));

ALTER TABLE public.expenses
  ADD COLUMN purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL;
CREATE TABLE public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  estabelecimento text,
  data_compra date,
  valor_total numeric NOT NULL DEFAULT 0,
  forma_pagamento public.payment_method,
  dados_brutos_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_extractions_document_idx ON public.document_extractions(document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_extractions TO authenticated;
GRANT ALL ON public.document_extractions TO service_role;

ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extractions_select" ON public.document_extractions
  FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "extractions_insert" ON public.document_extractions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "extractions_update" ON public.document_extractions
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "extractions_delete" ON public.document_extractions
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER document_extractions_updated_at
  BEFORE UPDATE ON public.document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.document_extraction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.document_extractions(id) ON DELETE CASCADE,
  descricao_produto text NOT NULL,
  quantidade numeric NOT NULL DEFAULT 1,
  unidade text NOT NULL DEFAULT 'UN',
  valor_unitario numeric NOT NULL DEFAULT 0,
  valor_total numeric NOT NULL DEFAULT 0,
  categoria_sugerida uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_extraction_items_extraction_idx ON public.document_extraction_items(extraction_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_extraction_items TO authenticated;
GRANT ALL ON public.document_extraction_items TO service_role;

ALTER TABLE public.document_extraction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extraction_items_select" ON public.document_extraction_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_extractions e
    WHERE e.id = extraction_id
      AND public.can_view_member_record(e.family_id, e.member_id, auth.uid())
  ));

CREATE POLICY "extraction_items_insert" ON public.document_extraction_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.document_extractions e
    WHERE e.id = extraction_id
      AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
  ));

CREATE POLICY "extraction_items_update" ON public.document_extraction_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_extractions e
    WHERE e.id = extraction_id
      AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.document_extractions e
    WHERE e.id = extraction_id
      AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
  ));

CREATE POLICY "extraction_items_delete" ON public.document_extraction_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_extractions e
    WHERE e.id = extraction_id
      AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
  ));
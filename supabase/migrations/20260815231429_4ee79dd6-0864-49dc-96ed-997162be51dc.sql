CREATE TYPE public.document_type AS ENUM ('NOTA_FISCAL','QR_CODE','PDF_FATURA','COMPROVANTE','OUTRO');
CREATE TYPE public.document_status AS ENUM ('ENVIADO','PROCESSANDO','PROCESSADO','CONFIRMADO','ERRO');
CREATE TYPE public.purchase_import_status AS ENUM ('PENDENTE_APROVACAO','APROVADO','REJEITADO');

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  tipo_documento public.document_type NOT NULL DEFAULT 'NOTA_FISCAL',
  nome_arquivo text NOT NULL DEFAULT '',
  url_arquivo text,
  tamanho bigint,
  status public.document_status NOT NULL DEFAULT 'ENVIADO',
  codigo_externo text,
  chave_documento text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON public.documents FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "documents_insert" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "documents_update" ON public.documents FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "documents_delete" ON public.documents FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX documents_family_idx ON public.documents(family_id);
CREATE INDEX documents_purchase_idx ON public.documents(purchase_id);

CREATE TABLE public.purchase_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  estabelecimento text NOT NULL DEFAULT '',
  data_compra date,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  dados_extraidos_json jsonb,
  status public.purchase_import_status NOT NULL DEFAULT 'PENDENTE_APROVACAO',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_imports TO authenticated;
GRANT ALL ON public.purchase_imports TO service_role;
ALTER TABLE public.purchase_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_imports_select" ON public.purchase_imports FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "purchase_imports_insert" ON public.purchase_imports FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "purchase_imports_update" ON public.purchase_imports FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "purchase_imports_delete" ON public.purchase_imports FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER purchase_imports_updated_at BEFORE UPDATE ON public.purchase_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX purchase_imports_family_idx ON public.purchase_imports(family_id);
CREATE INDEX purchase_imports_document_idx ON public.purchase_imports(document_id);

CREATE TABLE public.purchase_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_import_id uuid NOT NULL REFERENCES public.purchase_imports(id) ON DELETE CASCADE,
  descricao_produto text NOT NULL DEFAULT '',
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  unidade text NOT NULL DEFAULT 'UN',
  valor_unitario numeric(14,2) NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  categoria_sugerida uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_import_items TO authenticated;
GRANT ALL ON public.purchase_import_items TO service_role;
ALTER TABLE public.purchase_import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_import_items_select" ON public.purchase_import_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_imports pi
    WHERE pi.id = purchase_import_id
      AND public.can_view_member_record(pi.family_id, pi.member_id, auth.uid())));
CREATE POLICY "purchase_import_items_insert" ON public.purchase_import_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_imports pi
    WHERE pi.id = purchase_import_id
      AND public.can_manage_member_record(pi.family_id, pi.member_id, auth.uid())));
CREATE POLICY "purchase_import_items_update" ON public.purchase_import_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_imports pi
    WHERE pi.id = purchase_import_id
      AND public.can_manage_member_record(pi.family_id, pi.member_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_imports pi
    WHERE pi.id = purchase_import_id
      AND public.can_manage_member_record(pi.family_id, pi.member_id, auth.uid())));
CREATE POLICY "purchase_import_items_delete" ON public.purchase_import_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_imports pi
    WHERE pi.id = purchase_import_id
      AND public.can_manage_member_record(pi.family_id, pi.member_id, auth.uid())));

CREATE INDEX purchase_import_items_import_idx ON public.purchase_import_items(purchase_import_id);
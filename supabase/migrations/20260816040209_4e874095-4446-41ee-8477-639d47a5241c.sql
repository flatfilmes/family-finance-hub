CREATE TYPE public.card_statement_status AS ENUM ('UPLOADED','PROCESSING','READY_FOR_REVIEW','CONFIRMED','CANCELLED','ERROR');
CREATE TYPE public.statement_match_status AS ENUM ('MATCHED','UNMATCHED','DIVERGENT','POSSIBLE_MATCH','IGNORED','CONFIRMED_NEW');
CREATE TYPE public.statement_item_kind AS ENUM ('COMPRA','PAGAMENTO','ESTORNO','JUROS','TAXA','AJUSTE','OUTRO');
CREATE TYPE public.statement_item_action AS ENUM ('PENDENTE','PROCESSANDO','CONCLUIDO','ERRO');
CREATE TYPE public.reconciliation_status AS ENUM ('PENDENTE','CONFIRMADA','DESFEITA');

CREATE TABLE public.card_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  nome_arquivo text NOT NULL,
  emissor text,
  final_cartao text,
  titular text,
  periodo_inicio date,
  periodo_fim date,
  data_fechamento date,
  data_vencimento date,
  valor_total_fatura numeric(14,2) NOT NULL DEFAULT 0,
  total_extraido numeric(14,2) NOT NULL DEFAULT 0,
  quantidade_lancamentos integer NOT NULL DEFAULT 0,
  parser text NOT NULL DEFAULT 'GENERIC_PDF',
  status public.card_statement_status NOT NULL DEFAULT 'UPLOADED',
  fingerprint text,
  dados_brutos_json jsonb,
  erro_mensagem text,
  confirmado_em timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_statement_imports TO authenticated;
GRANT ALL ON public.card_statement_imports TO service_role;
ALTER TABLE public.card_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_statement_imports_select ON public.card_statement_imports FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));
CREATE POLICY card_statement_imports_insert ON public.card_statement_imports FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_member_record(family_id, member_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = credit_card_id AND c.family_id = card_statement_imports.family_id)
  );
CREATE POLICY card_statement_imports_update ON public.card_statement_imports FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY card_statement_imports_delete ON public.card_statement_imports FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE INDEX idx_csi_family ON public.card_statement_imports(family_id, credit_card_id);
CREATE INDEX idx_csi_fingerprint ON public.card_statement_imports(family_id, fingerprint);
CREATE TRIGGER update_card_statement_imports_updated_at BEFORE UPDATE ON public.card_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.card_statement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.card_statement_imports(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  data_lancamento date,
  descricao_original text NOT NULL,
  descricao_normalizada text NOT NULL DEFAULT '',
  estabelecimento_sugerido text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  parcela_atual integer,
  total_parcelas integer,
  tipo_sugerido public.statement_item_kind NOT NULL DEFAULT 'COMPRA',
  categoria_sugerida_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  purchase_id_matched uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  installment_id_matched uuid REFERENCES public.expense_installments(id) ON DELETE SET NULL,
  recurring_expense_id_matched uuid REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  match_status public.statement_match_status NOT NULL DEFAULT 'UNMATCHED',
  confidence_score numeric(5,2),
  diferenca numeric(14,2),
  user_action public.statement_item_action NOT NULL DEFAULT 'PENDENTE',
  decisao text,
  erro_mensagem text,
  purchase_id_criada uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_statement_items TO authenticated;
GRANT ALL ON public.card_statement_items TO service_role;
ALTER TABLE public.card_statement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_statement_items_select ON public.card_statement_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.card_statement_imports i WHERE i.id = import_id AND public.can_view_member_record(i.family_id, i.member_id, auth.uid())));
CREATE POLICY card_statement_items_insert ON public.card_statement_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.card_statement_imports i WHERE i.id = import_id AND public.can_manage_member_record(i.family_id, i.member_id, auth.uid())));
CREATE POLICY card_statement_items_update ON public.card_statement_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.card_statement_imports i WHERE i.id = import_id AND public.can_manage_member_record(i.family_id, i.member_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.card_statement_imports i WHERE i.id = import_id AND public.can_manage_member_record(i.family_id, i.member_id, auth.uid())));
CREATE POLICY card_statement_items_delete ON public.card_statement_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.card_statement_imports i WHERE i.id = import_id AND public.can_manage_member_record(i.family_id, i.member_id, auth.uid())));
CREATE INDEX idx_csit_import ON public.card_statement_items(import_id, ordem);
CREATE TRIGGER update_card_statement_items_updated_at BEFORE UPDATE ON public.card_statement_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  status public.reconciliation_status NOT NULL DEFAULT 'CONFIRMADA',
  confidence_score numeric(5,2),
  observacao text,
  reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliations TO authenticated;
GRANT ALL ON public.reconciliations TO service_role;
ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliations_select ON public.reconciliations FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY reconciliations_insert ON public.reconciliations FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY reconciliations_update ON public.reconciliations FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY reconciliations_delete ON public.reconciliations FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));
CREATE INDEX idx_reconciliations_source ON public.reconciliations(source_type, source_id);
CREATE INDEX idx_reconciliations_target ON public.reconciliations(target_type, target_id);

CREATE TABLE public.reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  entidade text NOT NULL,
  entidade_id uuid NOT NULL,
  campo text NOT NULL,
  valor_anterior text,
  valor_novo text,
  origem text NOT NULL DEFAULT 'IMPORTACAO_FATURA',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reconciliation_audit TO authenticated;
GRANT ALL ON public.reconciliation_audit TO service_role;
ALTER TABLE public.reconciliation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_audit_select ON public.reconciliation_audit FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY reconciliation_audit_insert ON public.reconciliation_audit FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
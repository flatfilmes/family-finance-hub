CREATE TYPE public.evidence_source_type AS ENUM (
  'BANK_STATEMENT_PDF','CREDIT_CARD_STATEMENT_PDF','BANK_SCREENSHOT','CARD_SCREENSHOT','RECEIPT_IMAGE','PURCHASE_IMAGE'
);
CREATE TYPE public.evidence_import_status AS ENUM (
  'UPLOADED','EXTRACTING','EXTRACTED','REVIEWED','CONFIRMED','FAILED','PROVIDER_NOT_CONFIGURED'
);
CREATE TYPE public.evidence_match_status AS ENUM (
  'EXACT_MATCH','STRONG_MATCH','POSSIBLE_MATCH','NEW_ITEM','NEW_IN_OVERLAP','CONFLICT','IGNORED'
);

CREATE TABLE public.financial_evidence_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  source_type public.evidence_source_type NOT NULL,
  institution_id uuid REFERENCES public.financial_institutions(id),
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  file_hash text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_name text,
  status public.evidence_import_status NOT NULL DEFAULT 'UPLOADED',
  extraction_provider text,
  extraction_version text,
  raw_text text,
  observacao text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_evidence_imports_context_hash_key
  ON public.financial_evidence_imports (
    family_id, source_type, file_hash,
    COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(credit_card_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX financial_evidence_imports_family_idx ON public.financial_evidence_imports (family_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_evidence_imports TO authenticated;
GRANT ALL ON public.financial_evidence_imports TO service_role;
ALTER TABLE public.financial_evidence_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence imports visiveis para a familia" ON public.financial_evidence_imports
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence imports criados pela familia" ON public.financial_evidence_imports
  FOR INSERT TO authenticated WITH CHECK (public.is_family_member(family_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "evidence imports editados pelo autor ou admin" ON public.financial_evidence_imports
  FOR UPDATE TO authenticated
  USING (public.is_family_member(family_id, auth.uid()) AND (created_by = auth.uid() OR public.is_family_admin(family_id, auth.uid())))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence imports removidos pelo autor ou admin" ON public.financial_evidence_imports
  FOR DELETE TO authenticated
  USING (public.is_family_member(family_id, auth.uid()) AND (created_by = auth.uid() OR public.is_family_admin(family_id, auth.uid())));

CREATE TABLE public.financial_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_import_id uuid NOT NULL REFERENCES public.financial_evidence_imports(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  source_item_key text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  event_date date,
  posting_date date,
  description text NOT NULL,
  normalized_description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  direction text CHECK (direction IN ('IN','OUT')),
  economic_kind text,
  card_last4 text,
  installment_current integer,
  installment_total integer,
  raw_text text,
  extraction_confidence numeric(5,2) NOT NULL DEFAULT 0,
  source_confidence text NOT NULL DEFAULT 'MEDIUM',
  match_status public.evidence_match_status NOT NULL DEFAULT 'NEW_ITEM',
  match_reason text,
  match_score numeric(6,2) NOT NULL DEFAULT 0,
  matched_purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  matched_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  matched_card_statement_item_id uuid REFERENCES public.card_statement_items(id) ON DELETE SET NULL,
  matched_bank_statement_item_id uuid REFERENCES public.bank_statement_items(id) ON DELETE SET NULL,
  review_action text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_import_id, source_item_key)
);
CREATE INDEX financial_evidence_items_family_idx ON public.financial_evidence_items (family_id);
CREATE INDEX financial_evidence_items_purchase_idx ON public.financial_evidence_items (matched_purchase_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_evidence_items TO authenticated;
GRANT ALL ON public.financial_evidence_items TO service_role;
ALTER TABLE public.financial_evidence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence items visiveis para a familia" ON public.financial_evidence_items
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence items criados pela familia" ON public.financial_evidence_items
  FOR INSERT TO authenticated WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence items editados pela familia" ON public.financial_evidence_items
  FOR UPDATE TO authenticated USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence items removidos por admin" ON public.financial_evidence_items
  FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));

CREATE TABLE public.purchase_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES public.financial_evidence_items(id) ON DELETE CASCADE,
  card_statement_item_id uuid REFERENCES public.card_statement_items(id) ON DELETE CASCADE,
  bank_statement_item_id uuid REFERENCES public.bank_statement_items(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  source_type public.evidence_source_type NOT NULL,
  observacao text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_evidence_links_alvo_unico CHECK (
    (evidence_item_id IS NOT NULL)::int + (card_statement_item_id IS NOT NULL)::int
    + (bank_statement_item_id IS NOT NULL)::int + (document_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX purchase_evidence_links_evidence_key ON public.purchase_evidence_links (purchase_id, evidence_item_id) WHERE evidence_item_id IS NOT NULL;
CREATE UNIQUE INDEX purchase_evidence_links_card_key ON public.purchase_evidence_links (purchase_id, card_statement_item_id) WHERE card_statement_item_id IS NOT NULL;
CREATE UNIQUE INDEX purchase_evidence_links_bank_key ON public.purchase_evidence_links (purchase_id, bank_statement_item_id) WHERE bank_statement_item_id IS NOT NULL;
CREATE UNIQUE INDEX purchase_evidence_links_document_key ON public.purchase_evidence_links (purchase_id, document_id) WHERE document_id IS NOT NULL;
CREATE INDEX purchase_evidence_links_purchase_idx ON public.purchase_evidence_links (purchase_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_evidence_links TO authenticated;
GRANT ALL ON public.purchase_evidence_links TO service_role;
ALTER TABLE public.purchase_evidence_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence links visiveis para a familia" ON public.purchase_evidence_links
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "evidence links criados pela familia" ON public.purchase_evidence_links
  FOR INSERT TO authenticated WITH CHECK (public.is_family_member(family_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "evidence links removidos pelo autor ou admin" ON public.purchase_evidence_links
  FOR DELETE TO authenticated
  USING (public.is_family_member(family_id, auth.uid()) AND (created_by = auth.uid() OR public.is_family_admin(family_id, auth.uid())));

CREATE TRIGGER trg_financial_evidence_imports_updated_at BEFORE UPDATE ON public.financial_evidence_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_financial_evidence_items_updated_at BEFORE UPDATE ON public.financial_evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
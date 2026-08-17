ALTER TABLE public.financial_evidence_items
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS confirmation_id uuid,
  ADD COLUMN IF NOT EXISTS created_purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_of_status text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid;

CREATE TABLE IF NOT EXISTS public.financial_evidence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  evidence_import_id uuid NOT NULL REFERENCES public.financial_evidence_imports(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES public.financial_evidence_items(id) ON DELETE SET NULL,
  candidate_key text NOT NULL,
  source_type public.evidence_source_type NOT NULL,
  original_status public.evidence_match_status NOT NULL,
  action text NOT NULL,
  matched_entity_kind text,
  matched_entity_id uuid,
  created_entity_kind text,
  created_entity_id uuid,
  confirmation_id uuid,
  observacao text,
  reviewed_by uuid NOT NULL DEFAULT auth.uid(),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_evidence_reviews_confirmation_uidx
  ON public.financial_evidence_reviews (evidence_import_id, candidate_key, confirmation_id)
  WHERE confirmation_id IS NOT NULL;

GRANT SELECT, INSERT ON public.financial_evidence_reviews TO authenticated;
GRANT ALL ON public.financial_evidence_reviews TO service_role;

ALTER TABLE public.financial_evidence_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_select_family" ON public.financial_evidence_reviews
  FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));

CREATE POLICY "reviews_insert_family" ON public.financial_evidence_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_id, auth.uid()) AND reviewed_by = auth.uid());
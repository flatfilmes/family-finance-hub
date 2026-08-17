CREATE TABLE public.financial_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  official_name text NOT NULL,
  short_name text,
  country_code text NOT NULL DEFAULT 'BR',
  institution_type text NOT NULL DEFAULT 'BANK',
  supports_bank_account boolean NOT NULL DEFAULT true,
  supports_credit_card boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.financial_institutions TO authenticated;
GRANT ALL ON public.financial_institutions TO service_role;

ALTER TABLE public.financial_institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instituicoes sao visiveis para usuarios autenticados"
ON public.financial_institutions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_financial_institutions_updated_at
BEFORE UPDATE ON public.financial_institutions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.financial_institutions (code, official_name, short_name, institution_type, supports_bank_account, supports_credit_card) VALUES
  ('BANCO_DO_BRASIL', 'Banco do Brasil S.A.', 'Banco do Brasil', 'BANK', true, true),
  ('ITAU', 'Itaú Unibanco S.A.', 'Itaú', 'BANK', true, true),
  ('NUBANK', 'Nu Pagamentos S.A.', 'Nubank', 'BANK', true, true),
  ('SANTANDER', 'Banco Santander (Brasil) S.A.', 'Santander', 'BANK', true, true);

ALTER TABLE public.bank_accounts
  ADD COLUMN institution_id uuid REFERENCES public.financial_institutions(id),
  ADD COLUMN institution_mapping_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.credit_cards
  ADD COLUMN issuer_institution_id uuid REFERENCES public.financial_institutions(id),
  ADD COLUMN institution_mapping_required boolean NOT NULL DEFAULT false,
  ADD COLUMN bandeira text,
  ADD COLUMN final_cartao text;

CREATE INDEX idx_bank_accounts_institution ON public.bank_accounts(institution_id);
CREATE INDEX idx_credit_cards_issuer_institution ON public.credit_cards(issuer_institution_id);

CREATE OR REPLACE FUNCTION public.match_financial_institution(_texto text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT i.id FROM public.financial_institutions i
  WHERE i.code = CASE
    WHEN translate(lower(coalesce(_texto, '')), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') ~ '(^|[^a-z])(itau|itau unibanco|banco itau)([^a-z]|$)' THEN 'ITAU'
    WHEN translate(lower(coalesce(_texto, '')), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') ~ '(^|[^a-z])(bb|banco do brasil)([^a-z]|$)' THEN 'BANCO_DO_BRASIL'
    WHEN translate(lower(coalesce(_texto, '')), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') ~ '(nubank|nu pagamentos|^nu$)' THEN 'NUBANK'
    WHEN translate(lower(coalesce(_texto, '')), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') ~ '(santander)' THEN 'SANTANDER'
    ELSE NULL
  END
  LIMIT 1
$$;

UPDATE public.bank_accounts
SET institution_id = public.match_financial_institution(banco)
WHERE institution_id IS NULL;

UPDATE public.bank_accounts
SET institution_mapping_required = true
WHERE institution_id IS NULL;

UPDATE public.credit_cards
SET issuer_institution_id = public.match_financial_institution(banco)
WHERE issuer_institution_id IS NULL;

UPDATE public.credit_cards
SET institution_mapping_required = true
WHERE issuer_institution_id IS NULL;
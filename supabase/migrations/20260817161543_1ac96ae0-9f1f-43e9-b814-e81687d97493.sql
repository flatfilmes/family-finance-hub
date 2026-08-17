CREATE OR REPLACE FUNCTION public.match_financial_institution(_texto text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id
  FROM public.financial_institutions i
  WHERE _texto IS NOT NULL
    AND (
      (i.code = 'BANCO_DO_BRASIL' AND lower(_texto) ~ '(banco do brasil|^bb$|\mbb\M|001)')
      OR (i.code = 'ITAU' AND lower(_texto) ~ 'ita(u|ú)')
      OR (i.code = 'NUBANK' AND lower(_texto) ~ '(nubank|nu pagamentos|^nu$)')
      OR (i.code = 'SANTANDER' AND lower(_texto) ~ 'santander')
    )
  LIMIT 1
$$;

UPDATE public.credit_cards c
SET issuer_institution_id = public.match_financial_institution(c.banco),
    institution_mapping_required = false
WHERE c.institution_mapping_required
  AND public.match_financial_institution(c.banco) IS NOT NULL;

UPDATE public.bank_accounts a
SET institution_id = public.match_financial_institution(a.banco),
    institution_mapping_required = false
WHERE a.institution_mapping_required
  AND public.match_financial_institution(a.banco) IS NOT NULL;
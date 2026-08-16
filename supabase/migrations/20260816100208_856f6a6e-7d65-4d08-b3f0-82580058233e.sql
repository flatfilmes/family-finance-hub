CREATE OR REPLACE FUNCTION public.block_duplicate_confirmed_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'CONFIRMED'::card_statement_status)
     AND NEW.fingerprint IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.card_statement_imports o
       WHERE o.id <> NEW.id
         AND o.credit_card_id = NEW.credit_card_id
         AND o.fingerprint = NEW.fingerprint
         AND o.status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'Esta fatura já foi importada e confirmada neste cartão. Desfaça a importação anterior para substituí-la.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
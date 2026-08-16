CREATE OR REPLACE FUNCTION public.validate_statement_card_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family uuid;
BEGIN
  SELECT family_id INTO v_family FROM public.credit_cards WHERE id = NEW.credit_card_id;
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'Cartão informado não existe.';
  END IF;
  IF v_family <> NEW.family_id THEN
    RAISE EXCEPTION 'O cartão selecionado pertence a outra família.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_card_family ON public.card_statement_imports;
CREATE TRIGGER validate_card_family
BEFORE INSERT OR UPDATE OF credit_card_id, family_id ON public.card_statement_imports
FOR EACH ROW EXECUTE FUNCTION public.validate_statement_card_family();

DROP TRIGGER IF EXISTS validate_card_family ON public.card_statement_items;
CREATE TRIGGER validate_card_family
BEFORE INSERT OR UPDATE OF credit_card_id, family_id ON public.card_statement_items
FOR EACH ROW EXECUTE FUNCTION public.validate_statement_card_family();

CREATE INDEX IF NOT EXISTS card_statement_imports_card_idx
  ON public.card_statement_imports (credit_card_id, created_at DESC);
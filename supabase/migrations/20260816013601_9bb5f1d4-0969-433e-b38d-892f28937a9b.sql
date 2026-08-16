ALTER TABLE public.expense_installments
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.family_members(id),
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES public.credit_cards(id),
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchases(id);

ALTER TABLE public.recurring_expenses
  ADD COLUMN IF NOT EXISTS data_inicio date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS data_cancelamento date;

-- Fatura do cartão correspondente a uma data de vencimento (cria se ainda não existir)
CREATE OR REPLACE FUNCTION public.ensure_invoice_for_due(_card_id uuid, _venc date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  card public.credit_cards%ROWTYPE;
  fech_dia int;
  venc_dia int;
  fechamento date;
  inicio date;
  inv_id uuid;
BEGIN
  SELECT * INTO card FROM public.credit_cards WHERE id = _card_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  fech_dia := LEAST(28, GREATEST(1, COALESCE(card.dia_fechamento, 1)));
  venc_dia := LEAST(28, GREATEST(1, COALESCE(card.dia_vencimento, 10)));

  IF venc_dia > fech_dia THEN
    fechamento := make_date(EXTRACT(YEAR FROM _venc)::int, EXTRACT(MONTH FROM _venc)::int, fech_dia);
  ELSE
    fechamento := (make_date(EXTRACT(YEAR FROM _venc)::int, EXTRACT(MONTH FROM _venc)::int, 1) - interval '1 month')::date;
    fechamento := make_date(EXTRACT(YEAR FROM fechamento)::int, EXTRACT(MONTH FROM fechamento)::int, fech_dia);
  END IF;

  inicio := (fechamento - interval '1 month')::date + 1;

  SELECT id INTO inv_id FROM public.card_invoices
   WHERE credit_card_id = _card_id AND data_fechamento = fechamento;
  IF inv_id IS NOT NULL THEN RETURN inv_id; END IF;

  INSERT INTO public.card_invoices (family_id, credit_card_id, data_inicio_ciclo, data_fechamento, data_vencimento)
  VALUES (card.family_id, _card_id, inicio, fechamento, _venc)
  RETURNING id INTO inv_id;

  RETURN inv_id;
END;
$$;

-- Liga parcelas soltas às faturas corretas e recalcula os totais das faturas
CREATE OR REPLACE FUNCTION public.sync_installment_invoices(_family_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  inv uuid;
  vinculadas int := 0;
BEGIN
  FOR r IN
    SELECT i.id, i.data_vencimento, COALESCE(i.credit_card_id, e.cartao_id) AS card_id
      FROM public.expense_installments i
      JOIN public.expenses e ON e.id = i.expense_id
     WHERE i.card_invoice_id IS NULL
       AND (_family_id IS NULL OR i.family_id = _family_id)
  LOOP
    IF r.card_id IS NULL THEN CONTINUE; END IF;
    inv := public.ensure_invoice_for_due(r.card_id, r.data_vencimento);
    IF inv IS NOT NULL THEN
      UPDATE public.expense_installments SET card_invoice_id = inv WHERE id = r.id;
      vinculadas := vinculadas + 1;
    END IF;
  END LOOP;

  UPDATE public.card_invoices ci
     SET valor_total = COALESCE(t.total, 0)
    FROM (
      SELECT card_invoice_id, SUM(valor_parcela) AS total
        FROM public.expense_installments
       WHERE card_invoice_id IS NOT NULL
       GROUP BY card_invoice_id
    ) t
   WHERE ci.id = t.card_invoice_id
     AND ci.status <> 'PAGA'
     AND (_family_id IS NULL OR ci.family_id = _family_id);

  RETURN vinculadas;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_invoice_for_due(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_installment_invoices(uuid) TO authenticated;

-- Preenche pessoa/cartão/compra nas parcelas já existentes
UPDATE public.expense_installments i
   SET member_id = COALESCE(i.member_id, e.member_id),
       credit_card_id = COALESCE(i.credit_card_id, e.cartao_id),
       purchase_id = COALESCE(i.purchase_id, e.purchase_id)
  FROM public.expenses e
 WHERE e.id = i.expense_id;

SELECT public.sync_installment_invoices(NULL);

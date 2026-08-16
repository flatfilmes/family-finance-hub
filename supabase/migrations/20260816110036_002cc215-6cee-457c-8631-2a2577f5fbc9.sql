DO $$
DECLARE
  r RECORD;
  v_invoice uuid;
  v_fechamento date;
BEGIN
  FOR r IN
    SELECT si.purchase_id_criada AS purchase_id,
           imp.data_vencimento AS venc_import,
           cc.id AS card_id
    FROM public.card_statement_items si
    JOIN public.card_statement_imports imp ON imp.id = si.import_id
    JOIN public.credit_cards cc ON cc.id = si.credit_card_id
    WHERE imp.status = 'CONFIRMED'
      AND si.data_lancamento IS NULL
      AND si.purchase_id_criada IS NOT NULL
      AND imp.data_vencimento IS NOT NULL
  LOOP
    SELECT id, data_fechamento INTO v_invoice, v_fechamento
      FROM public.card_invoices
     WHERE credit_card_id = r.card_id AND data_vencimento = r.venc_import
     LIMIT 1;
    IF v_invoice IS NULL THEN CONTINUE; END IF;

    UPDATE public.expense_installments
       SET card_invoice_id = v_invoice, data_vencimento = r.venc_import
     WHERE purchase_id = r.purchase_id AND card_invoice_id IS DISTINCT FROM v_invoice;

    UPDATE public.purchases SET data_compra = v_fechamento
     WHERE id = r.purchase_id AND v_fechamento IS NOT NULL AND data_compra > v_fechamento;

    UPDATE public.expenses SET data_compra = v_fechamento
     WHERE purchase_id = r.purchase_id AND v_fechamento IS NOT NULL AND data_compra > v_fechamento;
  END LOOP;
END $$;

UPDATE public.card_invoices ci
   SET valor_total = COALESCE((
        SELECT SUM(ei.valor_parcela) FROM public.expense_installments ei
         WHERE ei.card_invoice_id = ci.id), 0),
       updated_at = now()
 WHERE ci.status <> 'PAGA';
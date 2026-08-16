CREATE OR REPLACE FUNCTION public.merge_duplicate_purchase(p_principal uuid, p_duplicada uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_principal public.purchases%ROWTYPE;
  v_dup public.purchases%ROWTYPE;
  v_relatorio jsonb;
  v_parcelas int := 0;
  v_expenses int := 0;
  v_itens_fatura int := 0;
  v_conciliacoes int := 0;
  v_dup_parcelas int := 0;
  v_substituidas int := 0;
BEGIN
  v_relatorio := public.inspect_purchase_merge(p_principal, p_duplicada);
  IF NOT (v_relatorio->>'pode_mesclar')::boolean THEN
    RAISE EXCEPTION '%', COALESCE((v_relatorio->'bloqueios'->>0), 'Não é possível mesclar estas compras.');
  END IF;

  SELECT * INTO v_principal FROM public.purchases WHERE id = p_principal FOR UPDATE;
  SELECT * INTO v_dup FROM public.purchases WHERE id = p_duplicada FOR UPDATE;

  SELECT count(*) INTO v_dup_parcelas FROM public.expense_installments WHERE purchase_id = p_duplicada;

  -- A cobrança única antiga da compra principal é substituída pelo parcelamento
  -- real trazido pela fatura: o mesmo evento não pode ser cobrado duas vezes.
  IF v_dup_parcelas > 1 THEN
    DELETE FROM public.expense_installments
     WHERE purchase_id = p_principal AND status <> 'PAGO' AND total_parcelas <= 1;
    GET DIAGNOSTICS v_substituidas = ROW_COUNT;
    DELETE FROM public.expenses e
     WHERE e.purchase_id = p_principal
       AND e.parcelas_total <= 1
       AND NOT EXISTS (SELECT 1 FROM public.expense_installments i WHERE i.expense_id = e.id);
  END IF;

  UPDATE public.expense_installments
     SET purchase_id = p_principal, updated_at = now()
   WHERE purchase_id = p_duplicada;
  GET DIAGNOSTICS v_parcelas = ROW_COUNT;

  UPDATE public.expenses
     SET purchase_id = p_principal,
         descricao = v_principal.estabelecimento,
         updated_at = now()
   WHERE purchase_id = p_duplicada;
  GET DIAGNOSTICS v_expenses = ROW_COUNT;

  UPDATE public.card_statement_items
     SET purchase_id_criada = p_principal, updated_at = now()
   WHERE purchase_id_criada = p_duplicada;
  GET DIAGNOSTICS v_itens_fatura = ROW_COUNT;
  UPDATE public.card_statement_items
     SET purchase_id_matched = p_principal, updated_at = now()
   WHERE purchase_id_matched = p_duplicada;

  UPDATE public.bank_statement_items SET purchase_id_criada = p_principal WHERE purchase_id_criada = p_duplicada;
  UPDATE public.bank_statement_items SET purchase_id_matched = p_principal WHERE purchase_id_matched = p_duplicada;

  UPDATE public.reconciliations SET target_id = p_principal
   WHERE target_type = 'purchase' AND target_id = p_duplicada;
  GET DIAGNOSTICS v_conciliacoes = ROW_COUNT;
  UPDATE public.reconciliations SET source_id = p_principal
   WHERE source_type = 'purchase' AND source_id = p_duplicada;
  UPDATE public.documents SET purchase_id = p_principal WHERE purchase_id = p_duplicada;
  UPDATE public.recurring_expenses SET purchase_id = p_principal WHERE purchase_id = p_duplicada;

  UPDATE public.purchases
     SET credit_card_id = COALESCE(v_dup.credit_card_id, v_principal.credit_card_id),
         forma_pagamento = CASE
           WHEN v_dup.credit_card_id IS NOT NULL THEN 'CREDITO'::payment_method
           WHEN v_principal.forma_pagamento = 'A_DEFINIR' THEN v_dup.forma_pagamento
           ELSE v_principal.forma_pagamento END,
         tipo_compra = CASE
           WHEN v_dup_parcelas > 1 OR v_dup.tipo_compra = 'COMPRA_PARCELADA'
             THEN 'COMPRA_PARCELADA'::purchase_type
           ELSE v_principal.tipo_compra END,
         status_pagamento = CASE
           WHEN v_principal.status_pagamento IN ('PENDENTE_PAGAMENTO', 'PENDENTE')
                AND v_dup.credit_card_id IS NOT NULL THEN 'COMPROMETIDO'::purchase_payment_status
           ELSE v_principal.status_pagamento END,
         observacao = trim(both ' ' from COALESCE(v_principal.observacao, '') ||
           ' Cobrança identificada na fatura como "' || v_dup.estabelecimento || '".'),
         updated_at = now()
   WHERE id = p_principal;

  DELETE FROM public.purchase_items WHERE purchase_id = p_duplicada;
  DELETE FROM public.purchases WHERE id = p_duplicada;

  INSERT INTO public.reconciliation_audit
    (family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by)
  VALUES (v_principal.family_id, 'purchase', p_principal, 'merge',
          p_duplicada::text, p_principal::text, 'MESCLAGEM_COMPRAS', auth.uid());

  RETURN jsonb_build_object(
    'purchase_id', p_principal,
    'parcelas_transferidas', v_parcelas,
    'parcelas_substituidas', v_substituidas,
    'despesas_transferidas', v_expenses,
    'itens_fatura_transferidos', v_itens_fatura,
    'conciliacoes_transferidas', v_conciliacoes
  );
END;
$$;
-- Mesclagem de compras duplicadas: nota fiscal (compra) + fatura do cartão (cobrança)

CREATE OR REPLACE FUNCTION public.inspect_purchase_merge(p_principal uuid, p_duplicada uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_principal public.purchases%ROWTYPE;
  v_dup public.purchases%ROWTYPE;
  v_bloqueios text[] := '{}';
  v_parcelas int;
  v_parcelas_pagas int;
  v_expenses int;
  v_itens_fatura int;
  v_conciliacoes int;
  v_transactions int;
  v_itens_dup int;
BEGIN
  SELECT * INTO v_principal FROM public.purchases WHERE id = p_principal;
  SELECT * INTO v_dup FROM public.purchases WHERE id = p_duplicada;
  IF v_principal.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'Compra não encontrada.';
  END IF;
  IF v_principal.family_id <> v_dup.family_id THEN
    RAISE EXCEPTION 'As compras pertencem a famílias diferentes.';
  END IF;
  IF NOT public.is_family_member(v_principal.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para mesclar compras desta família.';
  END IF;
  IF p_principal = p_duplicada THEN
    RAISE EXCEPTION 'Selecione duas compras diferentes.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'PAGO')
    INTO v_parcelas, v_parcelas_pagas
    FROM public.expense_installments WHERE purchase_id = p_duplicada;
  SELECT count(*) INTO v_expenses FROM public.expenses WHERE purchase_id = p_duplicada;
  SELECT count(*) INTO v_itens_fatura FROM public.card_statement_items
    WHERE purchase_id_criada = p_duplicada OR purchase_id_matched = p_duplicada;
  SELECT count(*) INTO v_conciliacoes FROM public.reconciliations
    WHERE (target_type = 'purchase' AND target_id = p_duplicada)
       OR (source_type = 'purchase' AND source_id = p_duplicada);
  SELECT count(*) INTO v_transactions FROM public.transactions WHERE purchase_id = p_duplicada;
  SELECT count(*) INTO v_itens_dup FROM public.purchase_items WHERE purchase_id = p_duplicada;

  IF v_transactions > 0 THEN
    v_bloqueios := v_bloqueios || 'A compra duplicada já possui movimentação bancária registrada.';
  END IF;
  IF v_dup.status_pagamento = 'PAGO' THEN
    v_bloqueios := v_bloqueios || 'A compra duplicada já está paga.';
  END IF;

  RETURN jsonb_build_object(
    'principal', jsonb_build_object(
      'id', v_principal.id, 'estabelecimento', v_principal.estabelecimento,
      'valor_total', v_principal.valor_total, 'data_compra', v_principal.data_compra,
      'itens', (SELECT count(*) FROM public.purchase_items WHERE purchase_id = p_principal),
      'parcelas', (SELECT count(*) FROM public.expense_installments WHERE purchase_id = p_principal)),
    'duplicada', jsonb_build_object(
      'id', v_dup.id, 'estabelecimento', v_dup.estabelecimento,
      'valor_total', v_dup.valor_total, 'data_compra', v_dup.data_compra,
      'itens', v_itens_dup, 'parcelas', v_parcelas, 'parcelas_pagas', v_parcelas_pagas,
      'expenses', v_expenses, 'itens_fatura', v_itens_fatura,
      'conciliacoes', v_conciliacoes, 'transactions', v_transactions),
    'pode_mesclar', (array_length(v_bloqueios, 1) IS NULL),
    'bloqueios', to_jsonb(v_bloqueios)
  );
END;
$$;

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
BEGIN
  v_relatorio := public.inspect_purchase_merge(p_principal, p_duplicada);
  IF NOT (v_relatorio->>'pode_mesclar')::boolean THEN
    RAISE EXCEPTION '%', COALESCE((v_relatorio->'bloqueios'->>0), 'Não é possível mesclar estas compras.');
  END IF;

  SELECT * INTO v_principal FROM public.purchases WHERE id = p_principal FOR UPDATE;
  SELECT * INTO v_dup FROM public.purchases WHERE id = p_duplicada FOR UPDATE;

  -- 1) Parcelamento passa a pertencer à compra principal.
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

  -- 2) Evidência da cobrança na fatura passa a apontar para a compra principal.
  UPDATE public.card_statement_items
     SET purchase_id_criada = p_principal, updated_at = now()
   WHERE purchase_id_criada = p_duplicada;
  GET DIAGNOSTICS v_itens_fatura = ROW_COUNT;
  UPDATE public.card_statement_items
     SET purchase_id_matched = p_principal, updated_at = now()
   WHERE purchase_id_matched = p_duplicada;

  UPDATE public.bank_statement_items SET purchase_id_criada = p_principal WHERE purchase_id_criada = p_duplicada;
  UPDATE public.bank_statement_items SET purchase_id_matched = p_principal WHERE purchase_id_matched = p_duplicada;

  -- 3) Conciliações e documentos seguem a compra principal.
  UPDATE public.reconciliations SET target_id = p_principal
   WHERE target_type = 'purchase' AND target_id = p_duplicada;
  GET DIAGNOSTICS v_conciliacoes = ROW_COUNT;
  UPDATE public.reconciliations SET source_id = p_principal
   WHERE source_type = 'purchase' AND source_id = p_duplicada;
  UPDATE public.documents SET purchase_id = p_principal WHERE purchase_id = p_duplicada;
  UPDATE public.recurring_expenses SET purchase_id = p_principal WHERE purchase_id = p_duplicada;

  -- 4) Metadados de pagamento vindos da fatura enriquecem a compra da nota fiscal,
  --    sem alterar o valor total nem os itens reais da nota.
  UPDATE public.purchases
     SET credit_card_id = COALESCE(v_dup.credit_card_id, v_principal.credit_card_id),
         forma_pagamento = CASE
           WHEN v_dup.credit_card_id IS NOT NULL THEN 'CREDITO'::payment_method
           WHEN v_principal.forma_pagamento = 'A_DEFINIR' THEN v_dup.forma_pagamento
           ELSE v_principal.forma_pagamento END,
         tipo_compra = CASE
           WHEN v_dup.tipo_compra = 'COMPRA_PARCELADA' THEN 'COMPRA_PARCELADA'::purchase_type
           ELSE v_principal.tipo_compra END,
         status_pagamento = CASE
           WHEN v_principal.status_pagamento IN ('PENDENTE_PAGAMENTO', 'PENDENTE')
                AND v_dup.credit_card_id IS NOT NULL THEN 'COMPROMETIDO'::purchase_payment_status
           ELSE v_principal.status_pagamento END,
         observacao = trim(both ' ' from COALESCE(v_principal.observacao, '') ||
           ' Cobrança identificada na fatura como "' || v_dup.estabelecimento || '".'),
         updated_at = now()
   WHERE id = p_principal;

  -- 5) A duplicada sai do sistema sem levar nada consigo.
  DELETE FROM public.purchase_items WHERE purchase_id = p_duplicada;
  DELETE FROM public.purchases WHERE id = p_duplicada;

  INSERT INTO public.reconciliation_audit
    (family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by)
  VALUES (v_principal.family_id, 'purchase', p_principal, 'merge',
          p_duplicada::text, p_principal::text, 'MESCLAGEM_COMPRAS', auth.uid());

  RETURN jsonb_build_object(
    'purchase_id', p_principal,
    'parcelas_transferidas', v_parcelas,
    'despesas_transferidas', v_expenses,
    'itens_fatura_transferidos', v_itens_fatura,
    'conciliacoes_transferidas', v_conciliacoes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_purchase_merge(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.merge_duplicate_purchase(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.inspect_purchase_merge(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_purchase(uuid, uuid) TO authenticated;
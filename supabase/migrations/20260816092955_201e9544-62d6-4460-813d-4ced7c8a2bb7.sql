-- A transação de uma compra é uma PROJEÇÃO mantida por purchase_transaction_sync:
-- ela é recriada a cada update e removida junto com a compra. Só é histórico real
-- quando confirmada (compra paga) ou lançada manualmente.

CREATE OR REPLACE FUNCTION public.inspect_purchase_deletion(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p public.purchases%ROWTYPE;
  v_items int; v_parcelas int; v_parcelas_pagas int; v_transactions int;
  v_tx_reais int;
  v_reconc int; v_faturas int; v_card_items int; v_bank_items int;
  v_docs int; v_snapshot int; v_recorrencias int;
  v_bloqueios text[] := ARRAY[]::text[];
  v_dup jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra não encontrada'; END IF;
  IF NOT public.is_family_member(v_p.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta compra';
  END IF;

  SELECT count(*) INTO v_items FROM public.purchase_items WHERE purchase_id = v_p.id;
  SELECT count(*) INTO v_parcelas FROM public.expense_installments WHERE purchase_id = v_p.id;
  SELECT count(*) INTO v_parcelas_pagas FROM public.expense_installments
    WHERE purchase_id = v_p.id AND status = 'PAGO';
  SELECT count(*) INTO v_transactions FROM public.transactions WHERE purchase_id = v_p.id;
  SELECT count(*) INTO v_tx_reais FROM public.transactions
    WHERE purchase_id = v_p.id AND (manual OR status = 'CONFIRMADA');
  SELECT count(*) INTO v_reconc FROM public.reconciliations
    WHERE (source_type = 'purchase' AND source_id = v_p.id)
       OR (target_type = 'purchase' AND target_id = v_p.id);
  SELECT count(DISTINCT i.card_invoice_id) INTO v_faturas
    FROM public.expense_installments i WHERE i.purchase_id = v_p.id AND i.card_invoice_id IS NOT NULL;
  SELECT count(*) INTO v_card_items FROM public.card_statement_items
    WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
  SELECT count(*) INTO v_bank_items FROM public.bank_statement_items
    WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
  SELECT count(*) INTO v_docs FROM public.documents WHERE purchase_id = v_p.id;
  SELECT count(*) INTO v_recorrencias FROM public.recurring_expenses WHERE purchase_id = v_p.id;
  SELECT count(*) INTO v_snapshot FROM public.monthly_snapshots s
    WHERE s.family_id = v_p.family_id AND s.fechado
      AND s.ano = EXTRACT(YEAR FROM v_p.data_compra)::int
      AND s.mes = EXTRACT(MONTH FROM v_p.data_compra)::int;

  IF v_p.status_pagamento = 'PAGO' OR v_p.data_pagamento_real IS NOT NULL THEN
    v_bloqueios := array_append(v_bloqueios, 'Compra já paga'::text);
  END IF;
  IF v_tx_reais > 0 THEN
    v_bloqueios := array_append(v_bloqueios, 'Movimentação bancária confirmada vinculada'::text);
  END IF;
  IF v_parcelas_pagas > 0 THEN
    v_bloqueios := array_append(v_bloqueios, 'Parcela já paga'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.expense_installments i
    JOIN public.card_invoices f ON f.id = i.card_invoice_id
    WHERE i.purchase_id = v_p.id AND f.status IN ('FECHADA','PAGA')
  ) THEN
    v_bloqueios := array_append(v_bloqueios, 'Fatura fechada ou paga vinculada'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reconciliations r
    WHERE r.status = 'CONFIRMADA'
      AND ((r.source_type = 'purchase' AND r.source_id = v_p.id)
        OR (r.target_type = 'purchase' AND r.target_id = v_p.id))
  ) THEN
    v_bloqueios := array_append(v_bloqueios, 'Conciliação confirmada'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.card_statement_items ci
    JOIN public.card_statement_imports im ON im.id = ci.import_id
    WHERE (ci.purchase_id_matched = v_p.id OR ci.purchase_id_criada = v_p.id)
      AND im.status = 'CONFIRMED'
  ) THEN
    v_bloqueios := array_append(v_bloqueios, 'Fatura importada já confirmada'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bank_statement_items bi
    JOIN public.bank_statement_imports im ON im.id = bi.import_id
    WHERE (bi.purchase_id_matched = v_p.id OR bi.purchase_id_criada = v_p.id)
      AND im.status = 'CONFIRMED'
  ) THEN
    v_bloqueios := array_append(v_bloqueios, 'Extrato importado já confirmado'::text);
  END IF;
  IF v_snapshot > 0 THEN
    v_bloqueios := array_append(v_bloqueios, 'Mês já fechado no histórico'::text);
  END IF;

  v_dup := public.find_purchase_duplicate(v_p.id);

  RETURN jsonb_build_object(
    'purchase_id', v_p.id,
    'estabelecimento', v_p.estabelecimento,
    'valor_total', v_p.valor_total,
    'itens', v_items,
    'parcelas', v_parcelas,
    'parcelas_pagas', v_parcelas_pagas,
    'transactions', v_transactions,
    'transactions_confirmadas', v_tx_reais,
    'conciliacoes', v_reconc,
    'faturas', v_faturas,
    'itens_fatura_importada', v_card_items,
    'itens_extrato_importado', v_bank_items,
    'documentos', v_docs,
    'recorrencias', v_recorrencias,
    'pode_excluir', array_length(v_bloqueios, 1) IS NULL,
    'bloqueios', to_jsonb(v_bloqueios),
    'duplicada_de', v_dup
  );
END;
$$;

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
  v_bloqueios text[] := ARRAY[]::text[];
  v_parcelas int;
  v_parcelas_pagas int;
  v_expenses int;
  v_itens_fatura int;
  v_conciliacoes int;
  v_transactions int;
  v_tx_reais_dup int;
  v_tx_reais_principal int;
  v_transactions_principal int;
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
  SELECT count(*) INTO v_transactions_principal FROM public.transactions WHERE purchase_id = p_principal;
  SELECT count(*) INTO v_tx_reais_dup FROM public.transactions
    WHERE purchase_id = p_duplicada AND (manual OR status = 'CONFIRMADA');
  SELECT count(*) INTO v_tx_reais_principal FROM public.transactions
    WHERE purchase_id = p_principal AND (manual OR status = 'CONFIRMADA');
  SELECT count(*) INTO v_itens_dup FROM public.purchase_items WHERE purchase_id = p_duplicada;

  -- Mesclar não é excluir: vínculos são reapontados para a principal.
  -- Só bloqueia quando as duas já têm pagamento real registrado (risco de dobra).
  IF v_tx_reais_dup > 0 AND v_tx_reais_principal > 0 THEN
    v_bloqueios := array_append(v_bloqueios,
      'As duas compras já têm movimentação bancária confirmada; estorne uma delas antes de mesclar.'::text);
  END IF;
  IF v_dup.status_pagamento = 'PAGO' AND v_principal.status_pagamento = 'PAGO' THEN
    v_bloqueios := array_append(v_bloqueios, 'As duas compras já estão pagas.'::text);
  END IF;

  RETURN jsonb_build_object(
    'principal', jsonb_build_object(
      'id', v_principal.id, 'estabelecimento', v_principal.estabelecimento,
      'valor_total', v_principal.valor_total, 'data_compra', v_principal.data_compra,
      'itens', (SELECT count(*) FROM public.purchase_items WHERE purchase_id = p_principal),
      'parcelas', (SELECT count(*) FROM public.expense_installments WHERE purchase_id = p_principal),
      'transactions', v_transactions_principal),
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
  v_motivos text;
  v_parcelas int := 0;
  v_expenses int := 0;
  v_itens_fatura int := 0;
  v_conciliacoes int := 0;
  v_transacoes int := 0;
  v_dup_parcelas int := 0;
  v_substituidas int := 0;
BEGIN
  v_relatorio := public.inspect_purchase_merge(p_principal, p_duplicada);
  IF NOT (v_relatorio->>'pode_mesclar')::boolean THEN
    SELECT string_agg(m, '; ') INTO v_motivos
      FROM jsonb_array_elements_text(v_relatorio->'bloqueios') AS t(m);
    RAISE EXCEPTION '%', COALESCE(v_motivos, 'Não é possível mesclar estas compras.');
  END IF;

  SELECT * INTO v_principal FROM public.purchases WHERE id = p_principal FOR UPDATE;
  SELECT * INTO v_dup FROM public.purchases WHERE id = p_duplicada FOR UPDATE;

  SELECT count(*) INTO v_dup_parcelas FROM public.expense_installments WHERE purchase_id = p_duplicada;

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

  -- Movimentação real (confirmada ou manual) é preservada e reapontada.
  -- A projeção pendente da duplicada é descartada com ela pelo próprio trigger,
  -- evitando contar o mesmo evento duas vezes.
  UPDATE public.transactions
     SET purchase_id = p_principal, updated_at = now()
   WHERE purchase_id = p_duplicada AND (manual OR status = 'CONFIRMADA');
  GET DIAGNOSTICS v_transacoes = ROW_COUNT;

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
           WHEN v_dup.status_pagamento = 'PAGO' THEN 'PAGO'::purchase_payment_status
           WHEN v_principal.status_pagamento IN ('PENDENTE_PAGAMENTO', 'PENDENTE')
                AND v_dup.credit_card_id IS NOT NULL THEN 'COMPROMETIDO'::purchase_payment_status
           ELSE v_principal.status_pagamento END,
         data_pagamento_real = COALESCE(v_principal.data_pagamento_real, v_dup.data_pagamento_real),
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
    'movimentacoes_transferidas', v_transacoes,
    'itens_fatura_transferidos', v_itens_fatura,
    'conciliacoes_transferidas', v_conciliacoes
  );
END;
$$;
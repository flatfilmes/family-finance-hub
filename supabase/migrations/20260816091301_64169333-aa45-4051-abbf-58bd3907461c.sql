-- Relatório de impacto da exclusão de uma compra
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

  -- Motivos de bloqueio (histórico financeiro real)
  IF v_p.status_pagamento = 'PAGO' OR v_p.data_pagamento_real IS NOT NULL THEN
    v_bloqueios := v_bloqueios || 'Compra já paga';
  END IF;
  IF v_transactions > 0 THEN
    v_bloqueios := v_bloqueios || 'Movimentação bancária vinculada';
  END IF;
  IF v_parcelas_pagas > 0 THEN
    v_bloqueios := v_bloqueios || 'Parcela já paga';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.expense_installments i
    JOIN public.card_invoices f ON f.id = i.card_invoice_id
    WHERE i.purchase_id = v_p.id AND f.status IN ('FECHADA','PAGA')
  ) THEN
    v_bloqueios := v_bloqueios || 'Fatura fechada ou paga vinculada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reconciliations r
    WHERE r.status = 'CONFIRMADA'
      AND ((r.source_type = 'purchase' AND r.source_id = v_p.id)
        OR (r.target_type = 'purchase' AND r.target_id = v_p.id))
  ) THEN
    v_bloqueios := v_bloqueios || 'Conciliação confirmada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.card_statement_items ci
    JOIN public.card_statement_imports im ON im.id = ci.import_id
    WHERE (ci.purchase_id_matched = v_p.id OR ci.purchase_id_criada = v_p.id)
      AND im.status = 'CONFIRMED'
  ) THEN
    v_bloqueios := v_bloqueios || 'Fatura importada já confirmada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bank_statement_items bi
    JOIN public.bank_statement_imports im ON im.id = bi.import_id
    WHERE (bi.purchase_id_matched = v_p.id OR bi.purchase_id_criada = v_p.id)
      AND im.status = 'CONFIRMED'
  ) THEN
    v_bloqueios := v_bloqueios || 'Extrato importado já confirmado';
  END IF;
  IF v_snapshot > 0 THEN
    v_bloqueios := v_bloqueios || 'Mês já fechado no histórico';
  END IF;

  -- Possível duplicidade: mesmo valor total, mesma família, período próximo
  SELECT to_jsonb(d) INTO v_dup FROM (
    SELECT o.id, o.estabelecimento, o.valor_total, o.data_compra, o.tipo_compra
    FROM public.purchases o
    WHERE o.family_id = v_p.family_id
      AND o.id <> v_p.id
      AND abs(o.valor_total - v_p.valor_total) < 0.01
      AND o.data_compra BETWEEN v_p.data_compra - 45 AND v_p.data_compra + 45
    ORDER BY abs(o.data_compra - v_p.data_compra)
    LIMIT 1
  ) d;

  RETURN jsonb_build_object(
    'purchase_id', v_p.id,
    'estabelecimento', v_p.estabelecimento,
    'valor_total', v_p.valor_total,
    'itens', v_items,
    'parcelas', v_parcelas,
    'parcelas_pagas', v_parcelas_pagas,
    'transactions', v_transactions,
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

-- Exclusão segura e atômica de uma compra e suas dependências exclusivas
CREATE OR REPLACE FUNCTION public.delete_purchase_safely(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p public.purchases%ROWTYPE;
  v_report jsonb;
  v_removidos jsonb;
  v_itens int; v_parcelas int; v_despesas int; v_recorrencias int;
  v_faturas uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra não encontrada'; END IF;
  IF NOT public.is_family_member(v_p.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta compra';
  END IF;
  IF NOT (public.is_family_admin(v_p.family_id, auth.uid())
          OR public.can_manage_member_record(v_p.family_id, v_p.member_id, auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para excluir esta compra';
  END IF;

  v_report := public.inspect_purchase_deletion(p_purchase_id);
  IF NOT (v_report->>'pode_excluir')::boolean THEN
    RAISE EXCEPTION 'Esta compra possui histórico financeiro vinculado e não pode ser excluída diretamente.';
  END IF;

  SELECT array_agg(DISTINCT card_invoice_id) INTO v_faturas
    FROM public.expense_installments
    WHERE purchase_id = v_p.id AND card_invoice_id IS NOT NULL;

  -- Soltar vínculos de importação (não apaga o extrato/fatura importados)
  UPDATE public.card_statement_items
     SET purchase_id_matched = NULL, purchase_id_criada = NULL,
         match_status = 'UNMATCHED', user_action = 'PENDENTE'
   WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
  UPDATE public.bank_statement_items
     SET purchase_id_matched = NULL, purchase_id_criada = NULL, match_status = 'NEW'
   WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
  UPDATE public.documents SET purchase_id = NULL WHERE purchase_id = v_p.id;
  DELETE FROM public.reconciliations
   WHERE (source_type = 'purchase' AND source_id = v_p.id)
      OR (target_type = 'purchase' AND target_id = v_p.id);

  DELETE FROM public.expense_installments WHERE purchase_id = v_p.id;
  GET DIAGNOSTICS v_parcelas = ROW_COUNT;
  DELETE FROM public.recurring_expenses WHERE purchase_id = v_p.id;
  GET DIAGNOSTICS v_recorrencias = ROW_COUNT;
  DELETE FROM public.expense_installments
   WHERE expense_id IN (SELECT id FROM public.expenses WHERE purchase_id = v_p.id);
  DELETE FROM public.expenses WHERE purchase_id = v_p.id;
  GET DIAGNOSTICS v_despesas = ROW_COUNT;
  DELETE FROM public.purchase_items WHERE purchase_id = v_p.id;
  GET DIAGNOSTICS v_itens = ROW_COUNT;
  DELETE FROM public.purchases WHERE id = v_p.id;

  -- Recalcular o total das faturas abertas afetadas
  IF v_faturas IS NOT NULL THEN
    UPDATE public.card_invoices f
       SET valor_total = COALESCE((
             SELECT sum(i.valor_parcela) FROM public.expense_installments i
              WHERE i.card_invoice_id = f.id), 0),
           updated_at = now()
     WHERE f.id = ANY(v_faturas);
  END IF;

  v_removidos := jsonb_build_object(
    'itens', v_itens, 'parcelas', v_parcelas,
    'despesas', v_despesas, 'recorrencias', v_recorrencias
  );
  RETURN jsonb_build_object('ok', true, 'removidos', v_removidos, 'relatorio', v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_purchase_deletion(uuid) FROM public;
REVOKE ALL ON FUNCTION public.delete_purchase_safely(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.inspect_purchase_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_purchase_safely(uuid) TO authenticated;
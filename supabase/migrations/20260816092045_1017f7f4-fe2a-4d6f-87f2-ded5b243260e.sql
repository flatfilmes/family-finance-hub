CREATE OR REPLACE FUNCTION public.find_purchase_duplicate(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (SELECT * FROM public.purchases WHERE id = p_purchase_id),
  candidatas AS (
    SELECT o.id, o.estabelecimento, o.valor_total, o.data_compra, o.tipo_compra,
           abs(o.valor_total - a.valor_total) AS delta,
           abs(o.data_compra - a.data_compra) AS dias
      FROM public.purchases o, alvo a
     WHERE o.family_id = a.family_id
       AND o.id <> a.id
       AND o.data_compra BETWEEN a.data_compra - 45 AND a.data_compra + 45
       -- Tolerância de arredondamento: a soma das parcelas raramente fecha
       -- exatamente com o total da nota fiscal.
       AND abs(o.valor_total - a.valor_total) <= greatest(2.00, a.valor_total * 0.01)
  )
  SELECT to_jsonb(c) FROM (
    SELECT id, estabelecimento, valor_total, data_compra, tipo_compra
      FROM candidatas ORDER BY delta, dias LIMIT 1
  ) c;
$$;

REVOKE ALL ON FUNCTION public.find_purchase_duplicate(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.find_purchase_duplicate(uuid) TO authenticated;

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

  v_dup := public.find_purchase_duplicate(v_p.id);

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
CREATE OR REPLACE FUNCTION public.apply_statement_posting_dates(_import_id uuid, _correcoes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family uuid;
  v_conta uuid;
  r record;
  v_itens int := 0;
  v_tx int := 0;
  v_compras int := 0;
  v_afetados int;
BEGIN
  SELECT family_id, bank_account_id INTO v_family, v_conta
  FROM bank_statement_imports WHERE id = _import_id;

  IF v_family IS NULL THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF NOT public.is_family_member(v_family, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  FOR r IN
    SELECT (x->>'item_id')::uuid AS item_id, (x->>'data')::date AS nova
    FROM jsonb_array_elements(coalesce(_correcoes, '[]'::jsonb)) x
  LOOP
    CONTINUE WHEN r.item_id IS NULL OR r.nova IS NULL;

    -- movimentações já existentes: só a DATA muda (valor e vínculo intactos)
    UPDATE transactions t
       SET data_movimento = r.nova, updated_at = now()
      FROM bank_statement_items i
     WHERE i.id = r.item_id
       AND i.import_id = _import_id
       AND t.bank_account_id = v_conta
       AND (
         t.id = i.transaction_id_criada
         OR t.id = i.transaction_id_matched
         OR (i.purchase_id_criada IS NOT NULL AND t.purchase_id = i.purchase_id_criada)
         OR (i.purchase_id_matched IS NOT NULL AND t.purchase_id = i.purchase_id_matched)
       )
       AND t.data_movimento IS DISTINCT FROM r.nova;
    GET DIAGNOSTICS v_afetados = ROW_COUNT;
    v_tx := v_tx + v_afetados;

    UPDATE purchases p
       SET data_compra = r.nova, updated_at = now()
      FROM bank_statement_items i
     WHERE i.id = r.item_id
       AND i.import_id = _import_id
       AND p.id IN (i.purchase_id_criada, i.purchase_id_matched)
       AND p.data_compra IS DISTINCT FROM r.nova;
    GET DIAGNOSTICS v_afetados = ROW_COUNT;
    v_compras := v_compras + v_afetados;

    UPDATE bank_statement_items i
       SET data_movimento = r.nova, updated_at = now()
     WHERE i.id = r.item_id
       AND i.import_id = _import_id
       AND i.data_movimento IS DISTINCT FROM r.nova;
    GET DIAGNOSTICS v_afetados = ROW_COUNT;
    v_itens := v_itens + v_afetados;
  END LOOP;

  RETURN jsonb_build_object(
    'import_id', _import_id,
    'itens_corrigidos', v_itens,
    'transactions_corrigidas', v_tx,
    'compras_corrigidas', v_compras
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_statement_posting_dates(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_statement_posting_dates(uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.apply_financial_ledger_repair(
  _account_id uuid,
  _remove_id uuid,
  _fix_ids uuid[],
  _canonical_import_id uuid,
  _expected_before_count integer,
  _expected_before_balance numeric,
  _expected_after_count integer,
  _expected_after_balance numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family uuid;
  v_remove public.transactions%ROWTYPE;
  v_bb public.transactions%ROWTYPE;
  v_fix public.transactions%ROWTYPE;
  v_id uuid;
  v_count_before integer;
  v_balance_before numeric;
  v_count_after integer;
  v_balance_after numeric;
  v_checkpoints jsonb;
  v_pass integer;
  v_total integer;
  v_residual numeric;
  v_closing numeric;
  v_log uuid;
  v_before jsonb;
  v_corrected jsonb;
  v_removed jsonb;
  v_bb_json jsonb;
  v_group uuid;
BEGIN
  SELECT family_id INTO v_family FROM public.bank_accounts WHERE id = _account_id;
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: conta inexistente';
  END IF;
  IF NOT public.is_family_admin(v_family, auth.uid()) THEN
    RAISE EXCEPTION 'REPAIR_FORBIDDEN: apenas administradores da família podem aplicar reparo';
  END IF;

  SELECT count(*) FILTER (WHERE tipo <> 'ABERTURA_SALDO'),
         coalesce(sum(CASE
           WHEN tipo = 'ENTRADA' THEN abs(valor)
           WHEN tipo IN ('SAIDA','PAGAMENTO_CARTAO') THEN -abs(valor)
           WHEN tipo = 'TRANSFERENCIA' THEN CASE WHEN transfer_role = 'ENTRADA' THEN abs(valor) ELSE -abs(valor) END
           ELSE valor END), 0)
    INTO v_count_before, v_balance_before
  FROM public.transactions
  WHERE bank_account_id = _account_id AND status <> 'CANCELADA';

  v_balance_before := round(v_balance_before, 2);

  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = _remove_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.transactions
       WHERE id = ANY(_fix_ids) AND tipo <> 'ENTRADA'
     )
     AND v_count_before = _expected_after_count
     AND v_balance_before = round(_expected_after_balance, 2)
  THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_REPAIRED',
      'ledger', jsonb_build_object('transactionCount', v_count_before, 'balance', v_balance_before)
    );
  END IF;

  IF v_count_before <> _expected_before_count OR v_balance_before <> round(_expected_before_balance, 2) THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: ledger atual % / % difere do dry run % / %',
      v_count_before, v_balance_before, _expected_before_count, _expected_before_balance;
  END IF;

  SELECT * INTO v_remove FROM public.transactions WHERE id = _remove_id FOR UPDATE;
  IF v_remove.id IS NULL OR v_remove.bank_account_id <> _account_id THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: contrapartida artificial não encontrada nesta conta';
  END IF;
  IF v_remove.source_id IS NOT NULL OR v_remove.statement_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: a transação tem lastro em extrato e não pode ser removida';
  END IF;
  IF v_remove.tipo <> 'TRANSFERENCIA' OR v_remove.transfer_role <> 'ENTRADA' THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: a transação não é contrapartida de entrada';
  END IF;

  v_group := v_remove.transfer_group_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: sem transfer_group_id, impossível provar o lado preservado';
  END IF;

  SELECT * INTO v_bb FROM public.transactions
  WHERE transfer_group_id = v_group AND id <> _remove_id AND status <> 'CANCELADA'
  ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_bb.id IS NULL OR v_bb.bank_account_id = _account_id THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: transação original do outro banco não localizada';
  END IF;

  v_removed := jsonb_build_object(
    'transactionId', v_remove.id, 'date', v_remove.data_movimento, 'amount', v_remove.valor,
    'direction', 'IN', 'descricao', v_remove.descricao, 'reason', 'ARTIFICIAL_COUNTERPART');
  v_bb_json := jsonb_build_object(
    'transactionId', v_bb.id, 'accountId', v_bb.bank_account_id, 'date', v_bb.data_movimento,
    'amount', v_bb.valor, 'tipoAntes', v_bb.tipo, 'transferRoleAntes', v_bb.transfer_role,
    'descricao', v_bb.descricao);
  v_before := jsonb_build_object('transactionCount', v_count_before, 'balance', v_balance_before);
  v_corrected := '[]'::jsonb;

  FOREACH v_id IN ARRAY _fix_ids LOOP
    SELECT * INTO v_fix FROM public.transactions WHERE id = v_id FOR UPDATE;
    IF v_fix.id IS NULL OR v_fix.bank_account_id <> _account_id THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: movimento % não encontrado nesta conta', v_id;
    END IF;
    IF v_fix.tipo <> 'SAIDA' THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: movimento % não está como saída', v_id;
    END IF;
    v_corrected := v_corrected || jsonb_build_object(
      'transactionId', v_fix.id, 'date', v_fix.data_movimento, 'amount', v_fix.valor,
      'from', 'OUT', 'to', 'IN', 'descricao', v_fix.descricao);
  END LOOP;

  UPDATE public.transactions
     SET transfer_group_id = NULL,
         transfer_role = NULL,
         tipo = CASE WHEN v_bb.transfer_role = 'ENTRADA' THEN 'ENTRADA'::transaction_type ELSE 'SAIDA'::transaction_type END,
         observacao = coalesce(observacao || ' · ', '') || 'Transferência desfeita: contrapartida artificial removida (reparo financeiro).',
         updated_at = now()
   WHERE id = v_bb.id;

  DELETE FROM public.transactions WHERE id = _remove_id;

  UPDATE public.transactions
     SET tipo = 'ENTRADA'::transaction_type, updated_at = now()
   WHERE id = ANY(_fix_ids);

  v_balance_after := public.recalc_bank_account_balance(_account_id);
  SELECT count(*) FILTER (WHERE tipo <> 'ABERTURA_SALDO') INTO v_count_after
  FROM public.transactions
  WHERE bank_account_id = _account_id AND status <> 'CANCELADA';

  WITH cps AS (
    SELECT c.data, round(c.saldo_informado, 2) AS esperado,
           round(coalesce((
             SELECT sum(CASE
               WHEN t.tipo = 'ENTRADA' THEN abs(t.valor)
               WHEN t.tipo IN ('SAIDA','PAGAMENTO_CARTAO') THEN -abs(t.valor)
               WHEN t.tipo = 'TRANSFERENCIA' THEN CASE WHEN t.transfer_role = 'ENTRADA' THEN abs(t.valor) ELSE -abs(t.valor) END
               ELSE t.valor END)
             FROM public.transactions t
             WHERE t.bank_account_id = _account_id AND t.status <> 'CANCELADA'
               AND t.data_movimento <= c.data), 0), 2) AS simulado
    FROM public.bank_balance_checkpoints c
    WHERE c.bank_account_id = _account_id
      AND coalesce(c.tipo, 'DAILY') = 'DAILY'
      AND (_canonical_import_id IS NULL OR c.import_id IS NULL OR c.import_id = _canonical_import_id)
  )
  SELECT jsonb_agg(jsonb_build_object(
           'date', data, 'expected', esperado, 'simulated', simulado,
           'difference', round(simulado - esperado, 2), 'pass', abs(simulado - esperado) <= 0.005
         ) ORDER BY data),
         count(*) FILTER (WHERE abs(simulado - esperado) <= 0.005),
         count(*),
         max(esperado) FILTER (WHERE data = (SELECT max(data) FROM cps))
    INTO v_checkpoints, v_pass, v_total, v_closing
  FROM cps;

  v_residual := round(v_balance_after - coalesce(v_closing, v_balance_after), 2);

  IF v_count_after <> _expected_after_count
     OR round(v_balance_after, 2) <> round(_expected_after_balance, 2)
     OR v_residual <> 0
     OR v_total = 0
     OR v_pass <> v_total THEN
    RAISE EXCEPTION 'REPAIR_POST_VALIDATION_FAILED: esperado % / % com % checkpoints; obtido % / % com %/% · %',
      _expected_after_count, _expected_after_balance, _expected_after_count,
      v_count_after, v_balance_after, v_pass, v_total, coalesce(v_checkpoints::text, '[]');
  END IF;

  INSERT INTO public.bank_financial_repair_logs (
    family_id, account_id, repair_type, canonical_import_id, before_state, after_state,
    transaction_removed, transactions_direction_corrected, transfer_group_id,
    bb_transaction_preserved, post_validation, executed_by
  ) VALUES (
    v_family, _account_id, 'ITAU_LEDGER_REPAIR_2026_01_06', _canonical_import_id,
    v_before,
    jsonb_build_object('transactionCount', v_count_after, 'balance', round(v_balance_after, 2)),
    v_removed, v_corrected, v_group, v_bb_json,
    jsonb_build_object('checkpoints', coalesce(v_checkpoints, '[]'::jsonb),
                       'checkpointsPass', v_pass, 'checkpointsTotal', v_total,
                       'residualDifference', v_residual),
    auth.uid()
  ) RETURNING id INTO v_log;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'repairId', v_log,
    'repairType', 'ITAU_LEDGER_REPAIR_2026_01_06',
    'accountId', _account_id,
    'canonicalImportId', _canonical_import_id,
    'ledgerBefore', v_before,
    'ledgerAfter', jsonb_build_object('transactionCount', v_count_after, 'balance', round(v_balance_after, 2)),
    'transactionRemoved', v_removed,
    'transactionsDirectionCorrected', v_corrected,
    'transferGroupId', v_group,
    'bbTransactionPreserved', v_bb_json,
    'residualDifference', v_residual,
    'checkpoints', coalesce(v_checkpoints, '[]'::jsonb),
    'checkpointsPass', v_pass,
    'checkpointsTotal', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_financial_ledger_repair(uuid, uuid, uuid[], uuid, integer, numeric, integer, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_financial_ledger_repair(uuid, uuid, uuid[], uuid, integer, numeric, integer, numeric) TO authenticated;
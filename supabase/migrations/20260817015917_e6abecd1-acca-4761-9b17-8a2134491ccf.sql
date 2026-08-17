CREATE OR REPLACE FUNCTION public.apply_bank_persistence_repair(
  _item_id uuid, _source_id text, _data date, _valor numeric, _direcao text,
  _descricao text, _occurrence_index integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  it public.bank_statement_items%ROWTYPE;
  existente uuid;
  nova uuid;
  log_id uuid;
  tipo_mov transaction_type;
  saldo numeric;
BEGIN
  SELECT * INTO it FROM public.bank_statement_items WHERE id = _item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ITEM_NOT_FOUND');
  END IF;

  IF NOT public.can_manage_member_record(it.family_id, NULL::uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para reparar o extrato desta família';
  END IF;

  IF it.transaction_id_criada IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_REPAIRED', 'transaction_id', it.transaction_id_criada);
  END IF;

  SELECT transaction_id_created INTO existente
  FROM public.bank_persistence_repair_logs
  WHERE source_item_id = _item_id AND reverted_at IS NULL
  LIMIT 1;
  IF existente IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_REPAIRED', 'transaction_id', existente);
  END IF;

  IF it.data_movimento IS DISTINCT FROM _data
     OR abs(abs(it.valor) - abs(_valor)) > 0.01 THEN
    RETURN jsonb_build_object('status', 'PRECONDITION_FAILED',
      'motivo', 'A linha do extrato não confere com o movimento validado.');
  END IF;

  tipo_mov := CASE WHEN upper(_direcao) = 'IN' THEN 'ENTRADA' ELSE 'SAIDA' END::transaction_type;

  -- IDENTIDADE, NUNCA EQUIVALÊNCIA GENÉRICA.
  -- Duas linhas do mesmo dia, mesmo valor e mesmo sentido podem ser dois
  -- movimentos econômicos legítimos e distintos. Só bloqueia quando a própria
  -- identidade do item já está no ledger.

  -- A) transação com o mesmo source_id
  SELECT t.id INTO existente
  FROM public.transactions t
  WHERE t.bank_account_id = it.bank_account_id
    AND t.status <> 'CANCELADA'
    AND t.source_id IS NOT NULL
    AND t.source_id = _source_id
  LIMIT 1;
  IF existente IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'EQUIVALENT_EXISTS', 'transaction_id', existente,
      'motivo', 'Já existe transação com este mesmo identificador de origem (source_id).');
  END IF;

  -- B) transação vinculada a esta linha do extrato
  SELECT t.id INTO existente
  FROM public.transactions t
  WHERE t.bank_account_id = it.bank_account_id
    AND t.status <> 'CANCELADA'
    AND t.statement_item_id = it.id
  LIMIT 1;
  IF existente IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'EQUIVALENT_EXISTS', 'transaction_id', existente,
      'motivo', 'Já existe transação vinculada a esta linha do extrato.');
  END IF;

  -- C) fallback para imports antigos: mesma ocorrência do documento
  SELECT t.id INTO existente
  FROM public.transactions t
  WHERE t.bank_account_id = it.bank_account_id
    AND t.status <> 'CANCELADA'
    AND t.data_movimento = _data
    AND t.tipo = tipo_mov
    AND abs(t.valor - abs(_valor)) <= 0.01
    AND t.occurrence_index IS NOT DISTINCT FROM _occurrence_index
    AND (t.source_id IS NULL OR t.source_id = _source_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_statement_items x
      WHERE (x.transaction_id_criada = t.id OR x.transaction_id_matched = t.id)
        AND x.id <> it.id
    )
  LIMIT 1;
  IF existente IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'EQUIVALENT_EXISTS', 'transaction_id', existente,
      'motivo', 'Já existe transação exatamente nesta ocorrência do documento.');
  END IF;

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, tipo, descricao, valor, data_movimento,
    status, manual, source_id, statement_item_id, occurrence_index, created_by
  ) VALUES (
    it.family_id,
    (SELECT member_id FROM public.bank_accounts WHERE id = it.bank_account_id),
    it.bank_account_id, tipo_mov, _descricao, abs(_valor), _data,
    'CONFIRMADA', false, _source_id, it.id, _occurrence_index, auth.uid()
  ) RETURNING id INTO nova;

  INSERT INTO public.bank_persistence_repair_logs (
    family_id, account_id, source_import_id, source_item_id, source_id,
    transaction_id_created, amount, direction, data_movimento, item_state_before, executed_by
  ) VALUES (
    it.family_id, it.bank_account_id, it.import_id, it.id, _source_id,
    nova, abs(_valor), upper(_direcao), _data,
    jsonb_build_object(
      'review_action', it.review_action,
      'match_status', it.match_status,
      'incluir', it.incluir,
      'processado', it.processado,
      'source_id', it.source_id,
      'occurrence_index', it.occurrence_index,
      'transaction_id_criada', it.transaction_id_criada
    ),
    auth.uid()
  ) RETURNING id INTO log_id;

  UPDATE public.bank_statement_items
  SET review_action = 'CREATE_TRANSACTION',
      incluir = true,
      processado = true,
      transaction_id_criada = nova,
      source_id = COALESCE(NULLIF(source_id, ''), _source_id),
      occurrence_index = _occurrence_index,
      erro_mensagem = NULL
  WHERE id = it.id;

  saldo := public.recalc_bank_account_balance(it.bank_account_id);

  RETURN jsonb_build_object(
    'status', 'REPAIRED',
    'transaction_id', nova,
    'log_id', log_id,
    'source_id', _source_id,
    'saldo_conta', saldo
  );
END;
$function$;
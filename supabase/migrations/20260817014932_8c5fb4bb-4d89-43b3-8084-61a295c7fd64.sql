ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS statement_item_id uuid REFERENCES public.bank_statement_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_index integer;

CREATE TABLE IF NOT EXISTS public.bank_persistence_repair_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  repair_type text NOT NULL DEFAULT 'RESTORE_MISSING_LEDGER_LINE',
  source_import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  source_item_id uuid REFERENCES public.bank_statement_items(id) ON DELETE SET NULL,
  source_id text,
  transaction_id_created uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  direction text NOT NULL,
  data_movimento date NOT NULL,
  item_state_before jsonb,
  executed_by uuid REFERENCES auth.users(id),
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  reverted_at timestamp with time zone,
  revert_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bank_persistence_repair_logs TO authenticated;
GRANT ALL ON public.bank_persistence_repair_logs TO service_role;
ALTER TABLE public.bank_persistence_repair_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ver reparos da familia" ON public.bank_persistence_repair_logs
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.apply_bank_persistence_repair(
  _item_id uuid,
  _source_id text,
  _data date,
  _valor numeric,
  _direcao text,
  _descricao text,
  _occurrence_index integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT t.id INTO existente
  FROM public.transactions t
  WHERE t.bank_account_id = it.bank_account_id
    AND t.data_movimento = _data
    AND t.status <> 'CANCELADA'
    AND abs(t.valor - abs(_valor)) <= 0.01
    AND t.tipo = tipo_mov
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_statement_items x
      WHERE x.transaction_id_criada = t.id OR x.transaction_id_matched = t.id
    )
  LIMIT 1;
  IF existente IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'EQUIVALENT_EXISTS', 'transaction_id', existente);
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
$$;

CREATE OR REPLACE FUNCTION public.revert_bank_persistence_repair(_log_id uuid, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lg public.bank_persistence_repair_logs%ROWTYPE;
  st jsonb;
  saldo numeric;
BEGIN
  SELECT * INTO lg FROM public.bank_persistence_repair_logs WHERE id = _log_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'LOG_NOT_FOUND');
  END IF;
  IF NOT public.can_manage_member_record(lg.family_id, NULL::uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer o reparo desta família';
  END IF;
  IF lg.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_REVERTED');
  END IF;

  st := COALESCE(lg.item_state_before, '{}'::jsonb);

  UPDATE public.bank_statement_items
  SET review_action = COALESCE(st->>'review_action', review_action),
      incluir = COALESCE((st->>'incluir')::boolean, incluir),
      processado = COALESCE((st->>'processado')::boolean, processado),
      transaction_id_criada = NULL
  WHERE id = lg.source_item_id;

  DELETE FROM public.transactions WHERE id = lg.transaction_id_created;

  UPDATE public.bank_persistence_repair_logs
  SET reverted_at = now(), revert_reason = _motivo
  WHERE id = lg.id;

  saldo := public.recalc_bank_account_balance(lg.account_id);

  RETURN jsonb_build_object('status', 'REVERTED', 'saldo_conta', saldo);
END;
$$;
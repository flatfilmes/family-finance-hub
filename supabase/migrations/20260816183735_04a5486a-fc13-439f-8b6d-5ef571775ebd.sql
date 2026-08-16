CREATE TABLE public.bank_import_reset_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL,
  executed_by uuid REFERENCES auth.users(id),
  executed_at timestamptz NOT NULL DEFAULT now(),
  imports_removed integer NOT NULL DEFAULT 0,
  items_removed integer NOT NULL DEFAULT 0,
  checkpoints_removed integer NOT NULL DEFAULT 0,
  transactions_removed integer NOT NULL DEFAULT 0,
  links_removed integer NOT NULL DEFAULT 0,
  preserved_transactions integer NOT NULL DEFAULT 0,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bank_import_reset_logs TO authenticated;
GRANT ALL ON public.bank_import_reset_logs TO service_role;

ALTER TABLE public.bank_import_reset_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem os resets da propria familia"
ON public.bank_import_reset_logs FOR SELECT TO authenticated
USING (public.is_family_member(family_id, auth.uid()));

-- Escopo do reset: só o que tem origem comprovada nos extratos da conta.
CREATE OR REPLACE FUNCTION public.bank_import_reset_scope(_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  v_imports uuid[];
  v_items uuid[];
  v_checkpoints uuid[];
  v_tx_criadas uuid[];
  v_tx_transfer uuid[];
  v_tx_abertura uuid[];
  v_tx_remover uuid[];
  v_tx_bloqueadas uuid[];
  v_tx_matched uuid[];
  v_purchases uuid[];
  v_total_tx integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para esta conta';
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_imports
    FROM public.bank_statement_imports WHERE bank_account_id = _account_id;

  SELECT COALESCE(array_agg(id), '{}') INTO v_items
    FROM public.bank_statement_items WHERE bank_account_id = _account_id;

  SELECT COALESCE(array_agg(id), '{}') INTO v_checkpoints
    FROM public.bank_balance_checkpoints
   WHERE bank_account_id = _account_id
     AND (import_id = ANY(v_imports) OR origem = 'EXTRATO_IMPORTADO');

  -- Lineage direto: movimentação criada pela importação.
  SELECT COALESCE(array_agg(DISTINCT transaction_id_criada), '{}') INTO v_tx_criadas
    FROM public.bank_statement_items
   WHERE bank_account_id = _account_id AND transaction_id_criada IS NOT NULL;

  -- Transferências criadas pela importação: as duas pernas do mesmo grupo.
  SELECT COALESCE(array_agg(DISTINCT t.id), '{}') INTO v_tx_transfer
    FROM public.transactions t
   WHERE t.transfer_group_id IN (
     SELECT DISTINCT transfer_group_id FROM public.bank_statement_items
      WHERE bank_account_id = _account_id AND transfer_group_id IS NOT NULL
   );

  -- Saldo de abertura gerado automaticamente pela confirmação do extrato.
  SELECT COALESCE(array_agg(id), '{}') INTO v_tx_abertura
    FROM public.transactions
   WHERE bank_account_id = _account_id
     AND tipo = 'ABERTURA_SALDO'
     AND observacao = 'Extrato importado';

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_tx_remover
    FROM unnest(v_tx_criadas || v_tx_transfer || v_tx_abertura) AS x
   WHERE x IS NOT NULL;

  -- Movimentação compartilhada com compra: nunca removida, só perde o vínculo.
  SELECT COALESCE(array_agg(DISTINCT t.id), '{}') INTO v_tx_bloqueadas
    FROM public.transactions t
   WHERE t.id = ANY(v_tx_remover)
     AND (t.purchase_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.purchases p WHERE p.transaction_id = t.id));

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_tx_remover
    FROM unnest(v_tx_remover) AS x WHERE NOT (x = ANY(v_tx_bloqueadas));

  -- Vínculos com movimentação que já existia antes do extrato.
  SELECT COALESCE(array_agg(DISTINCT transaction_id_matched), '{}') INTO v_tx_matched
    FROM public.bank_statement_items
   WHERE bank_account_id = _account_id
     AND transaction_id_matched IS NOT NULL
     AND NOT (transaction_id_matched = ANY(v_tx_remover));

  SELECT COALESCE(array_agg(DISTINCT purchase_id_criada), '{}') INTO v_purchases
    FROM public.bank_statement_items
   WHERE bank_account_id = _account_id AND purchase_id_criada IS NOT NULL;

  SELECT count(*) INTO v_total_tx FROM public.transactions
   WHERE bank_account_id = _account_id AND status <> 'CANCELADA';

  RETURN jsonb_build_object(
    'account_id', _account_id,
    'family_id', acc.family_id,
    'banco', acc.banco,
    'nome_conta', acc.nome_conta,
    'saldo_referencia', acc.saldo_atual,
    'imports', to_jsonb(v_imports),
    'items', to_jsonb(v_items),
    'checkpoints', to_jsonb(v_checkpoints),
    'transactions_remover', to_jsonb(v_tx_remover),
    'transactions_matched', to_jsonb(v_tx_matched),
    'transactions_bloqueadas', to_jsonb(v_tx_bloqueadas),
    'purchases_criadas', to_jsonb(v_purchases),
    'total_transactions_conta', v_total_tx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bank_import_reset_scope(uuid) TO authenticated;

-- Simulação: mostra o que sai e o que fica, sem apagar nada.
CREATE OR REPLACE FUNCTION public.inspect_bank_import_reset(_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s jsonb;
  n_imports integer;
  n_items integer;
  n_check integer;
  n_tx integer;
  n_links integer;
  n_bloq integer;
  n_total integer;
BEGIN
  s := public.bank_import_reset_scope(_account_id);
  n_imports := jsonb_array_length(s->'imports');
  n_items := jsonb_array_length(s->'items');
  n_check := jsonb_array_length(s->'checkpoints');
  n_tx := jsonb_array_length(s->'transactions_remover');
  n_links := jsonb_array_length(s->'transactions_matched');
  n_bloq := jsonb_array_length(s->'transactions_bloqueadas');
  n_total := (s->>'total_transactions_conta')::integer;

  RETURN jsonb_build_object(
    'dry_run', true,
    'conta', jsonb_build_object(
      'id', s->'account_id',
      'banco', s->'banco',
      'nome_conta', s->'nome_conta',
      'saldo_referencia', s->'saldo_referencia'
    ),
    'remover', jsonb_build_object(
      'imports', n_imports,
      'statement_items', n_items,
      'checkpoints', n_check,
      'reconciliation_links', n_links,
      'transactions', n_tx
    ),
    'preservar', jsonb_build_object(
      'conta_bancaria', true,
      'saldo_referencia', s->'saldo_referencia',
      'transactions_independentes', GREATEST(n_total - n_tx, 0),
      'transactions_compartilhadas', n_bloq,
      'purchases_criadas_por_extrato', jsonb_array_length(s->'purchases_criadas')
    ),
    'detalhe_imports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'arquivo', i.nome_arquivo, 'status', i.status,
        'periodo_inicio', i.periodo_inicio, 'periodo_fim', i.periodo_fim,
        'lancamentos', i.quantidade_lancamentos) ORDER BY i.periodo_inicio NULLS LAST)
      FROM public.bank_statement_imports i
      WHERE i.id IN (SELECT (jsonb_array_elements_text(s->'imports'))::uuid)
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.inspect_bank_import_reset(uuid) TO authenticated;

-- Execução: remove só o que tem origem comprovada nos extratos desta conta.
CREATE OR REPLACE FUNCTION public.reset_bank_account_imports(_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s jsonb;
  acc public.bank_accounts%ROWTYPE;
  v_imports uuid[];
  v_tx uuid[];
  v_check uuid[];
  v_matched uuid[];
  snapshot jsonb;
  n_items integer := 0;
  n_check integer := 0;
  n_tx integer := 0;
  n_imports integer := 0;
  v_saldo numeric;
BEGIN
  s := public.bank_import_reset_scope(_account_id);
  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;

  SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_imports FROM jsonb_array_elements_text(s->'imports') x;
  SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_tx FROM jsonb_array_elements_text(s->'transactions_remover') x;
  SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_check FROM jsonb_array_elements_text(s->'checkpoints') x;
  SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_matched FROM jsonb_array_elements_text(s->'transactions_matched') x;

  -- Backup lógico: retrato do que será removido.
  snapshot := jsonb_build_object(
    'scope', s,
    'imports', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.bank_statement_imports i WHERE i.id = ANY(v_imports)), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(it)) FROM public.bank_statement_items it WHERE it.bank_account_id = _account_id), '[]'::jsonb),
    'checkpoints', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.bank_balance_checkpoints c WHERE c.id = ANY(v_check)), '[]'::jsonb),
    'transactions', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.transactions t WHERE t.id = ANY(v_tx)), '[]'::jsonb)
  );

  -- 1. desfaz vínculos com movimentações preexistentes (a movimentação fica).
  UPDATE public.bank_statement_items
     SET transaction_id_matched = NULL
   WHERE bank_account_id = _account_id AND transaction_id_matched IS NOT NULL;

  DELETE FROM public.reconciliations
   WHERE family_id = acc.family_id
     AND ((source_type = 'bank_statement_item' AND source_id IN (SELECT id FROM public.bank_statement_items WHERE bank_account_id = _account_id))
       OR (target_type = 'bank_statement_item' AND target_id IN (SELECT id FROM public.bank_statement_items WHERE bank_account_id = _account_id)));

  -- 2. remove itens e importações.
  DELETE FROM public.bank_balance_checkpoints WHERE id = ANY(v_check);
  GET DIAGNOSTICS n_check = ROW_COUNT;

  DELETE FROM public.bank_statement_items WHERE bank_account_id = _account_id;
  GET DIAGNOSTICS n_items = ROW_COUNT;

  DELETE FROM public.bank_statement_imports WHERE id = ANY(v_imports);
  GET DIAGNOSTICS n_imports = ROW_COUNT;

  -- 3. remove só as movimentações comprovadamente criadas pela importação.
  UPDATE public.transactions SET reversal_of = NULL
   WHERE reversal_of = ANY(v_tx) AND NOT (id = ANY(v_tx));

  DELETE FROM public.transactions t
   WHERE t.id = ANY(v_tx)
     AND t.purchase_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.transaction_id = t.id);
  GET DIAGNOSTICS n_tx = ROW_COUNT;

  v_saldo := public.recalc_bank_account_balance(_account_id);

  INSERT INTO public.bank_import_reset_logs (
    family_id, bank_account_id, executed_by,
    imports_removed, items_removed, checkpoints_removed,
    transactions_removed, links_removed, preserved_transactions, snapshot
  ) VALUES (
    acc.family_id, _account_id, auth.uid(),
    n_imports, n_items, n_check,
    n_tx, COALESCE(array_length(v_matched, 1), 0),
    (SELECT count(*) FROM public.transactions WHERE bank_account_id = _account_id AND status <> 'CANCELADA'),
    snapshot
  );

  RETURN jsonb_build_object(
    'dry_run', false,
    'imports_removed', n_imports,
    'items_removed', n_items,
    'checkpoints_removed', n_check,
    'transactions_removed', n_tx,
    'links_removed', COALESCE(array_length(v_matched, 1), 0),
    'preserved_transactions', (SELECT count(*) FROM public.transactions WHERE bank_account_id = _account_id AND status <> 'CANCELADA'),
    'saldo_atual', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_bank_account_imports(uuid) TO authenticated;
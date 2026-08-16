CREATE OR REPLACE FUNCTION public.reprocess_bank_statement_checkpoints_only(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  imp           record;
  v_inicio      date;
  v_fim         date;
  v_abertura    date;
  v_criados     int := 0;
  v_diarios     int := 0;
  v_total       int := 0;
BEGIN
  SELECT * INTO imp FROM bank_statement_imports WHERE id = _import_id;
  IF imp.id IS NULL THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF NOT is_family_member(imp.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  -- Período recomposto a partir dos lançamentos lidos do próprio documento.
  SELECT min(data_movimento), max(data_movimento)
    INTO v_inicio, v_fim
  FROM bank_statement_items
  WHERE import_id = _import_id AND data_movimento IS NOT NULL;

  v_inicio := COALESCE(imp.periodo_inicio, v_inicio);
  v_fim    := COALESCE(imp.periodo_fim, v_fim);

  -- Saldos de conferência derivados do documento (nunca do ledger).
  DELETE FROM bank_balance_checkpoints
   WHERE import_id = _import_id AND origem = 'EXTRATO_METADADOS';

  IF v_inicio IS NOT NULL AND imp.saldo_inicial IS NOT NULL THEN
    -- Se já há movimento no primeiro dia, o saldo anterior pertence ao dia anterior.
    v_abertura := CASE
      WHEN EXISTS (SELECT 1 FROM bank_statement_items
                    WHERE import_id = _import_id AND data_movimento = v_inicio)
      THEN v_inicio - 1 ELSE v_inicio END;

    IF NOT EXISTS (
      SELECT 1 FROM bank_balance_checkpoints
       WHERE bank_account_id = imp.bank_account_id AND data = v_abertura
         AND origem <> 'EXTRATO_METADADOS'
    ) THEN
      INSERT INTO bank_balance_checkpoints
        (family_id, bank_account_id, member_id, import_id, data, saldo_informado, origem, rotulo, created_by)
      VALUES
        (imp.family_id, imp.bank_account_id, imp.member_id, _import_id, v_abertura,
         imp.saldo_inicial, 'EXTRATO_METADADOS', 'Saldo anterior do extrato', auth.uid());
      v_criados := v_criados + 1;
    END IF;
  END IF;

  IF v_fim IS NOT NULL AND imp.saldo_final IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM bank_balance_checkpoints
       WHERE bank_account_id = imp.bank_account_id AND data = v_fim
         AND origem <> 'EXTRATO_METADADOS'
    ) THEN
      INSERT INTO bank_balance_checkpoints
        (family_id, bank_account_id, member_id, import_id, data, saldo_informado, origem, rotulo, created_by)
      VALUES
        (imp.family_id, imp.bank_account_id, imp.member_id, _import_id, v_fim,
         imp.saldo_final, 'EXTRATO_METADADOS', 'Saldo final do extrato', auth.uid());
      v_criados := v_criados + 1;
    END IF;
  END IF;

  UPDATE bank_statement_imports
     SET periodo_inicio = v_inicio,
         periodo_fim = v_fim,
         updated_at = now()
   WHERE id = _import_id;

  SELECT count(*) FILTER (WHERE origem <> 'EXTRATO_METADADOS'), count(*)
    INTO v_diarios, v_total
  FROM bank_balance_checkpoints
  WHERE bank_account_id = imp.bank_account_id
    AND v_inicio IS NOT NULL AND v_fim IS NOT NULL
    AND data BETWEEN v_inicio - 1 AND v_fim;

  RETURN jsonb_build_object(
    'import_id', _import_id,
    'arquivo', imp.nome_arquivo,
    'periodo_inicio', v_inicio,
    'periodo_fim', v_fim,
    'saldo_inicial', imp.saldo_inicial,
    'saldo_final', imp.saldo_final,
    'checkpoints_criados', v_criados,
    'checkpoints_diarios_pdf', v_diarios,
    'checkpoints_total', v_total,
    'movimentos_documento', (SELECT count(*) FROM bank_statement_items WHERE import_id = _import_id),
    'status', CASE WHEN v_total > 0 THEN 'VALIDADO' ELSE 'CHECKPOINTS_AUSENTES' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reprocess_account_checkpoints_only(_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  saidas   jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT id FROM bank_statement_imports
     WHERE bank_account_id = _account_id AND status <> 'CANCELLED'
     ORDER BY COALESCE(periodo_inicio, created_at::date), created_at
  LOOP
    saidas := saidas || jsonb_build_array(public.reprocess_bank_statement_checkpoints_only(r.id));
  END LOOP;
  RETURN jsonb_build_object('relatorios', saidas);
END;
$$;
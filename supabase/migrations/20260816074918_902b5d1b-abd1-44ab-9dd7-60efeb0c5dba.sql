CREATE OR REPLACE FUNCTION public.confirm_bank_statement_import(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  imp public.bank_statement_imports%ROWTYPE;
  acc public.bank_accounts%ROWTYPE;
  it public.bank_statement_items%ROWTYPE;
  v_tipo public.transaction_type;
  v_valor numeric;
  v_delta numeric;
  tx uuid;
  criadas integer := 0;
  ignoradas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importacao nao encontrada'; END IF;
  IF imp.status = 'CONFIRMED' THEN RAISE EXCEPTION 'Este extrato ja foi confirmado'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = imp.bank_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(imp.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para movimentar esta conta';
  END IF;

  FOR it IN
    SELECT * FROM public.bank_statement_items
     WHERE import_id = _import_id
     ORDER BY ordem
  LOOP
    IF NOT it.incluir
       OR it.match_status IN ('MATCHED', 'IGNORED')
       OR it.transaction_id_criada IS NOT NULL THEN
      ignoradas := ignoradas + 1;
      CONTINUE;
    END IF;

    v_delta := COALESCE(it.valor, 0);
    v_valor := abs(v_delta);

    v_tipo := CASE
      WHEN it.tipo_sugerido = 'AJUSTE' THEN 'AJUSTE_SALDO'::public.transaction_type
      WHEN it.tipo_sugerido = 'TRANSFERENCIA' THEN 'TRANSFERENCIA'::public.transaction_type
      WHEN v_delta >= 0 THEN 'ENTRADA'::public.transaction_type
      ELSE 'SAIDA'::public.transaction_type
    END;

    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      v_tipo,
      COALESCE(NULLIF(btrim(it.descricao_normalizada), ''), it.descricao_original),
      CASE WHEN v_tipo = 'AJUSTE_SALDO' THEN v_delta ELSE v_valor END,
      COALESCE(it.data_movimento, CURRENT_DATE),
      'CONFIRMADA'
    ) RETURNING id INTO tx;

    UPDATE public.bank_accounts
       SET saldo_atual = COALESCE(saldo_atual, 0) + v_delta
     WHERE id = imp.bank_account_id;

    UPDATE public.bank_statement_items
       SET transaction_id_criada = tx
     WHERE id = it.id;

    criadas := criadas + 1;
  END LOOP;

  UPDATE public.bank_statement_imports
     SET status = 'CONFIRMED', confirmado_em = now()
   WHERE id = _import_id;

  RETURN jsonb_build_object('criadas', criadas, 'ignoradas', ignoradas);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_bank_statement_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_statement_import(uuid) TO authenticated;
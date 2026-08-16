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
  inv public.card_invoices%ROWTYPE;
  v_tipo public.transaction_type;
  v_delta numeric;
  v_desc text;
  v_data date;
  v_forma public.payment_method;
  v_ano integer;
  v_dm text;
  v_inicio date;
  tx uuid;
  novo_purchase uuid;
  grupo uuid;
  criadas integer := 0;
  associadas integer := 0;
  ignoradas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importacao nao encontrada'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = imp.bank_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(imp.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para movimentar esta conta';
  END IF;

  v_ano := EXTRACT(YEAR FROM COALESCE(imp.periodo_inicio, imp.periodo_fim, imp.created_at::date));

  SELECT COALESCE(
           imp.periodo_inicio,
           MIN(i.data_movimento),
           MIN(CASE WHEN i.descricao_original ~ '^\d{2}/\d{2}'
                    THEN to_date(substring(i.descricao_original from '^(\d{2}/\d{2})') || '/' || v_ano::text, 'DD/MM/YYYY')
               END),
           imp.periodo_fim,
           imp.created_at::date)
    INTO v_inicio
  FROM public.bank_statement_items i WHERE i.import_id = _import_id;

  IF imp.saldo_inicial IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.transactions t
        WHERE t.bank_account_id = imp.bank_account_id
          AND t.status <> 'CANCELADA'
          AND t.data_movimento < v_inicio
     ) THEN
    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status, observacao
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      'ABERTURA_SALDO', 'Saldo anterior informado no extrato',
      imp.saldo_inicial, v_inicio - 1, 'CONFIRMADA', 'Extrato importado'
    );
  END IF;

  FOR it IN
    SELECT * FROM public.bank_statement_items WHERE import_id = _import_id ORDER BY ordem
  LOOP
    IF it.processado OR it.transaction_id_criada IS NOT NULL OR it.purchase_id_criada IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_delta := COALESCE(it.valor, 0);
    v_dm := substring(it.descricao_original from '^(\d{2}/\d{2})');
    v_data := COALESCE(
      it.data_movimento,
      CASE WHEN v_dm IS NOT NULL THEN to_date(v_dm || '/' || v_ano::text, 'DD/MM/YYYY') END,
      v_inicio);
    v_desc := COALESCE(NULLIF(btrim(it.descricao_normalizada), ''), it.descricao_original);

    IF it.review_action IN ('IGNORE', 'ASSOCIATE_EXISTING') OR v_delta = 0 THEN
      UPDATE public.bank_statement_items SET processado = true, data_movimento = v_data WHERE id = it.id;
      IF it.review_action = 'ASSOCIATE_EXISTING' THEN
        associadas := associadas + 1;
      ELSE
        ignoradas := ignoradas + 1;
      END IF;
      CONTINUE;
    END IF;

    IF it.review_action = 'MATCH_CARD_PAYMENT' AND it.card_invoice_id_matched IS NOT NULL THEN
      SELECT * INTO inv FROM public.card_invoices WHERE id = it.card_invoice_id_matched;
      IF FOUND AND inv.status <> 'PAGA' THEN
        tx := public.pay_card_invoice(inv.id, imp.bank_account_id, v_data);
        UPDATE public.bank_statement_items
           SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
        criadas := criadas + 1;
      ELSE
        UPDATE public.bank_statement_items SET processado = true, data_movimento = v_data WHERE id = it.id;
        associadas := associadas + 1;
      END IF;
      CONTINUE;
    END IF;

    IF it.review_action = 'MATCH_TRANSFER' AND it.transfer_account_id IS NOT NULL THEN
      IF v_delta < 0 THEN
        grupo := public.transfer_between_accounts(
          imp.bank_account_id, it.transfer_account_id, abs(v_delta), v_data, it.descricao_original);
      ELSE
        grupo := public.transfer_between_accounts(
          it.transfer_account_id, imp.bank_account_id, abs(v_delta), v_data, it.descricao_original);
      END IF;
      UPDATE public.bank_statement_items
         SET transfer_group_id = grupo, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    IF v_delta < 0 AND it.descricao_original ~* '(pagto|pagamento).*(cart)' THEN
      tx := NULL;
      SELECT t.id INTO tx
        FROM public.transactions t
       WHERE t.bank_account_id = imp.bank_account_id
         AND t.status <> 'CANCELADA'
         AND t.data_movimento = v_data
         AND round(abs(t.valor), 2) = round(abs(v_delta), 2)
         AND t.tipo IN ('SAIDA', 'PAGAMENTO_CARTAO')
         AND NOT EXISTS (
           SELECT 1 FROM public.bank_statement_items x
            WHERE x.id <> it.id
              AND (x.transaction_id_criada = t.id OR x.transaction_id_matched = t.id))
       LIMIT 1;

      IF tx IS NOT NULL THEN
        UPDATE public.bank_statement_items
           SET transaction_id_matched = tx, match_status = 'MATCHED',
               processado = true, data_movimento = v_data
         WHERE id = it.id;
        associadas := associadas + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.transactions (
        family_id, member_id, bank_account_id, created_by,
        tipo, descricao, valor, data_movimento, status
      ) VALUES (
        imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
        'PAGAMENTO_CARTAO', v_desc, abs(v_delta), v_data, 'CONFIRMADA'
      ) RETURNING id INTO tx;
      UPDATE public.bank_statement_items
         SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    IF it.review_action = 'CREATE_PURCHASE' AND v_delta < 0 THEN
      v_forma := CASE
        WHEN it.tipo_sugerido = 'TRANSFERENCIA' THEN 'TRANSFERENCIA'::public.payment_method
        WHEN it.descricao_original ~* '(boleto|fatura de |conta de |concession|energia|agua|água|celesc|saneamento|telefon|internet)'
          THEN 'BOLETO'::public.payment_method
        WHEN it.descricao_original ~* 'debito|débito' THEN 'DEBITO'::public.payment_method
        ELSE 'PIX'::public.payment_method
      END;
      INSERT INTO public.purchases (
        family_id, member_id, created_by, estabelecimento, data_compra, valor_total,
        forma_pagamento, bank_account_id, tipo_compra, data_pagamento_real, observacao
      ) VALUES (
        imp.family_id, acc.member_id, auth.uid(),
        COALESCE(NULLIF(btrim(it.descricao_original), ''), 'Compra do extrato'),
        v_data, abs(v_delta), v_forma, imp.bank_account_id, 'COMPRA_NORMAL', v_data,
        'Importado do extrato bancario'
      ) RETURNING id INTO novo_purchase;

      UPDATE public.bank_statement_items
         SET purchase_id_criada = novo_purchase, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    v_tipo := CASE
      WHEN it.review_action = 'REGISTER_FEE' THEN 'SAIDA'::public.transaction_type
      WHEN it.review_action = 'REGISTER_REFUND' THEN 'ENTRADA'::public.transaction_type
      WHEN it.review_action = 'MATCH_INCOME' THEN 'ENTRADA'::public.transaction_type
      WHEN v_delta >= 0 THEN 'ENTRADA'::public.transaction_type
      ELSE 'SAIDA'::public.transaction_type
    END;

    -- DEDUPE: nunca criar uma movimentacao que ja existe no ledger.
    tx := NULL;
    SELECT t.id INTO tx
      FROM public.transactions t
     WHERE t.bank_account_id = imp.bank_account_id
       AND t.status <> 'CANCELADA'
       AND t.data_movimento = v_data
       AND round(abs(t.valor), 2) = round(abs(v_delta), 2)
       AND ((v_delta < 0 AND t.tipo IN ('SAIDA', 'PAGAMENTO_CARTAO'))
            OR (v_delta >= 0 AND t.tipo = 'ENTRADA'))
       AND NOT EXISTS (
         SELECT 1 FROM public.bank_statement_items x
          WHERE x.id <> it.id
            AND (x.transaction_id_criada = t.id OR x.transaction_id_matched = t.id))
     LIMIT 1;

    IF tx IS NOT NULL THEN
      UPDATE public.bank_statement_items
         SET transaction_id_matched = tx, match_status = 'MATCHED',
             processado = true, data_movimento = v_data
       WHERE id = it.id;
      associadas := associadas + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      v_tipo, v_desc, abs(v_delta), v_data, 'CONFIRMADA'
    ) RETURNING id INTO tx;

    UPDATE public.bank_statement_items
       SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
    criadas := criadas + 1;
  END LOOP;

  UPDATE public.bank_statement_imports i
     SET status = 'CONFIRMED',
         confirmado_em = now(),
         periodo_inicio = COALESCE(i.periodo_inicio, (SELECT MIN(x.data_movimento) FROM public.bank_statement_items x WHERE x.import_id = _import_id)),
         periodo_fim = COALESCE(i.periodo_fim, (SELECT MAX(x.data_movimento) FROM public.bank_statement_items x WHERE x.import_id = _import_id))
   WHERE i.id = _import_id;

  PERFORM public.recalc_bank_account_balance(imp.bank_account_id);

  RETURN jsonb_build_object('criadas', criadas, 'associadas', associadas, 'ignoradas', ignoradas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_bank_statement_import(_import_id uuid, _tolerancia integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  imp public.bank_statement_imports%ROWTYPE;
  acc public.bank_accounts%ROWTYPE;
  v_inicio date;
  v_fim date;
  v_invalid integer := 0;
  v_reabertos integer := 0;
  v_antes integer := 0;
  v_depois integer := 0;
  v_pdf integer := 0;
  v_chk integer := 0;
  v_conf jsonb;
  v_status text;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importacao nao encontrada'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = imp.bank_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(imp.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para reprocessar esta conta';
  END IF;

  SELECT MIN(data_movimento), MAX(data_movimento)
    INTO v_inicio, v_fim
    FROM public.bank_statement_items WHERE import_id = _import_id;

  UPDATE public.bank_statement_imports
     SET periodo_inicio = COALESCE(periodo_inicio, v_inicio),
         periodo_fim = COALESCE(periodo_fim, v_fim),
         quantidade_lancamentos = (SELECT count(*) FROM public.bank_statement_items WHERE import_id = _import_id),
         updated_at = now()
   WHERE id = _import_id;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id;

  SELECT count(*) INTO v_antes
    FROM public.transactions t
   WHERE t.bank_account_id = imp.bank_account_id
     AND t.status <> 'CANCELADA'
     AND t.tipo NOT IN ('ABERTURA_SALDO', 'AJUSTE_SALDO')
     AND imp.periodo_inicio IS NOT NULL
     AND t.data_movimento BETWEEN imp.periodo_inicio AND imp.periodo_fim;

  FOR r IN
    SELECT i.id AS item_id, t.id AS tid, t.data_movimento AS tdata
      FROM public.bank_statement_items i
      JOIN public.transactions t ON t.id = i.transaction_id_matched
     WHERE i.import_id = _import_id
       AND i.data_movimento IS NOT NULL
       AND abs(t.data_movimento - i.data_movimento) > _tolerancia
  LOOP
    UPDATE public.bank_statement_items
       SET transaction_id_matched = NULL,
           match_status = 'NEW',
           confidence_score = 0,
           incluir = true,
           processado = false,
           review_action = CASE WHEN review_action = 'ASSOCIATE_EXISTING'
                                THEN 'CREATE_TRANSACTION' ELSE review_action END,
           erro_mensagem = 'Associacao invalida removida: ledger em ' || r.tdata::text,
           updated_at = now()
     WHERE id = r.item_id;

    INSERT INTO public.reconciliation_audit (
      family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by
    ) VALUES (
      imp.family_id, 'bank_statement_item', r.item_id, 'transaction_id_matched',
      r.tid::text, NULL, 'REPROCESSAMENTO_EXTRATO', auth.uid()
    );

    v_invalid := v_invalid + 1;
  END LOOP;

  UPDATE public.bank_statement_items
     SET processado = false, updated_at = now()
   WHERE import_id = _import_id
     AND processado = true
     AND transaction_id_criada IS NULL
     AND transaction_id_matched IS NULL
     AND purchase_id_criada IS NULL
     AND purchase_id_matched IS NULL
     AND transfer_group_id IS NULL
     AND review_action NOT IN ('IGNORE', 'ASSOCIATE_EXISTING');
  GET DIAGNOSTICS v_reabertos = ROW_COUNT;

  v_conf := public.confirm_bank_statement_import(_import_id);

  SELECT count(*) INTO v_depois
    FROM public.transactions t
   WHERE t.bank_account_id = imp.bank_account_id
     AND t.status <> 'CANCELADA'
     AND t.tipo NOT IN ('ABERTURA_SALDO', 'AJUSTE_SALDO')
     AND imp.periodo_inicio IS NOT NULL
     AND t.data_movimento BETWEEN imp.periodo_inicio AND imp.periodo_fim;

  SELECT count(*) INTO v_pdf
    FROM public.bank_statement_items
   WHERE import_id = _import_id AND review_action <> 'IGNORE';

  SELECT count(*) INTO v_chk
    FROM public.bank_balance_checkpoints WHERE import_id = _import_id;

  v_status := CASE
    WHEN v_depois < v_pdf THEN 'MOVIMENTOS_INCOMPLETOS'
    WHEN v_chk = 0 THEN 'SOURCE_FILE_MISSING'
    ELSE 'VALIDADO'
  END;

  RETURN jsonb_build_object(
    'import_id', _import_id,
    'arquivo', imp.nome_arquivo,
    'mes', to_char(COALESCE(imp.periodo_inicio, imp.periodo_fim), 'YYYY-MM'),
    'periodo_inicio', imp.periodo_inicio,
    'periodo_fim', imp.periodo_fim,
    'movimentos_pdf', v_pdf,
    'ledger_antes', v_antes,
    'ledger_depois', v_depois,
    'associacoes_invalidas_removidas', v_invalid,
    'itens_reabertos', v_reabertos,
    'criadas', v_conf -> 'criadas',
    'associadas', v_conf -> 'associadas',
    'ignoradas', v_conf -> 'ignoradas',
    'checkpoints', v_chk,
    'saldo_final', imp.saldo_final,
    'status', v_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_bank_opening_balances(_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  v_keep uuid;
  v_canceladas integer := 0;
  v_saldo numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para ajustar esta conta';
  END IF;

  SELECT id INTO v_keep
    FROM public.transactions
   WHERE bank_account_id = _account_id
     AND tipo = 'ABERTURA_SALDO'
     AND status <> 'CANCELADA'
   ORDER BY data_movimento ASC, created_at ASC
   LIMIT 1;

  IF v_keep IS NULL THEN
    RETURN jsonb_build_object('canceladas', 0, 'saldo', acc.saldo_atual);
  END IF;

  UPDATE public.transactions
     SET status = 'CANCELADA',
         observacao = COALESCE(observacao, '') || ' | Abertura redundante cancelada no reprocessamento',
         updated_at = now()
   WHERE bank_account_id = _account_id
     AND tipo = 'ABERTURA_SALDO'
     AND status <> 'CANCELADA'
     AND id <> v_keep;
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  v_saldo := public.recalc_bank_account_balance(_account_id);

  INSERT INTO public.reconciliation_audit (
    family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by
  ) VALUES (
    acc.family_id, 'bank_account', _account_id, 'aberturas_redundantes',
    v_canceladas::text, v_saldo::text, 'REPROCESSAMENTO_EXTRATO', auth.uid()
  );

  RETURN jsonb_build_object('canceladas', v_canceladas, 'saldo', v_saldo, 'mantida', v_keep);
END;
$function$;
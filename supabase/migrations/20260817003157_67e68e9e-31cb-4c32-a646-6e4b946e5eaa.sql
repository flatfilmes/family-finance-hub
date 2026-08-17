ALTER TABLE public.bank_statement_items
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS occurrence_index integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_items_import_source_id_idx
  ON public.bank_statement_items (import_id, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.bank_balance_checkpoints
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS source_item_id text;

ALTER TABLE public.bank_balance_checkpoints
  DROP CONSTRAINT IF EXISTS bank_balance_checkpoints_tipo_check;
ALTER TABLE public.bank_balance_checkpoints
  ADD CONSTRAINT bank_balance_checkpoints_tipo_check
  CHECK (tipo IN ('DAILY', 'CLOSING', 'OPENING', 'REFERENCE'));

CREATE OR REPLACE FUNCTION public.confirm_bank_statement_import(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- TRANSFERENCIA: exige confirmacao explicita. Uma correspondencia apenas
    -- POSSIVEL (semelhanca textual com o nome de outra conta) NUNCA pode criar
    -- o par de transferencia automaticamente: cai para movimentacao normal.
    IF it.review_action = 'MATCH_TRANSFER'
       AND it.transfer_account_id IS NOT NULL
       AND it.match_status <> 'POSSIBLE_MATCH' THEN
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
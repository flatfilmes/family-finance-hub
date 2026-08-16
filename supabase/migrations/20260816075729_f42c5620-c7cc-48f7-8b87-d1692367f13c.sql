ALTER TYPE public.bank_statement_match ADD VALUE IF NOT EXISTS 'DIVERGENT';

ALTER TABLE public.bank_statement_imports ADD COLUMN IF NOT EXISTS fingerprint text;
CREATE INDEX IF NOT EXISTS bank_statement_imports_fingerprint_idx
  ON public.bank_statement_imports (bank_account_id, fingerprint);

ALTER TABLE public.bank_statement_items ADD COLUMN IF NOT EXISTS review_action text NOT NULL DEFAULT 'IGNORE';
ALTER TABLE public.bank_statement_items ADD COLUMN IF NOT EXISTS income_id_matched uuid REFERENCES public.incomes(id) ON DELETE SET NULL;
ALTER TABLE public.bank_statement_items ADD COLUMN IF NOT EXISTS purchase_id_criada uuid REFERENCES public.purchases(id) ON DELETE SET NULL;
ALTER TABLE public.bank_statement_items ADD COLUMN IF NOT EXISTS transfer_group_id uuid;
ALTER TABLE public.bank_statement_items ADD COLUMN IF NOT EXISTS processado boolean NOT NULL DEFAULT false;

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

  FOR it IN
    SELECT * FROM public.bank_statement_items WHERE import_id = _import_id ORDER BY ordem
  LOOP
    -- idempotencia: nada e processado duas vezes
    IF it.processado OR it.transaction_id_criada IS NOT NULL OR it.purchase_id_criada IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_delta := COALESCE(it.valor, 0);
    v_data := COALESCE(it.data_movimento, CURRENT_DATE);
    v_desc := COALESCE(NULLIF(btrim(it.descricao_normalizada), ''), it.descricao_original);

    IF it.review_action IN ('IGNORE', 'ASSOCIATE_EXISTING') OR v_delta = 0 THEN
      UPDATE public.bank_statement_items SET processado = true WHERE id = it.id;
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
           SET transaction_id_criada = tx, processado = true WHERE id = it.id;
        criadas := criadas + 1;
      ELSE
        UPDATE public.bank_statement_items SET processado = true WHERE id = it.id;
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
         SET transfer_group_id = grupo, processado = true WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    IF it.review_action = 'CREATE_PURCHASE' AND v_delta < 0 THEN
      v_forma := CASE
        WHEN it.tipo_sugerido = 'TRANSFERENCIA' THEN 'TRANSFERENCIA'::public.payment_method
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
         SET purchase_id_criada = novo_purchase, processado = true WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    -- Demais acoes viram movimentacao direta no ledger (transactions)
    v_tipo := CASE
      WHEN it.review_action = 'REGISTER_FEE' THEN 'SAIDA'::public.transaction_type
      WHEN it.review_action = 'REGISTER_REFUND' THEN 'ENTRADA'::public.transaction_type
      WHEN it.review_action = 'MATCH_INCOME' THEN 'ENTRADA'::public.transaction_type
      WHEN v_delta >= 0 THEN 'ENTRADA'::public.transaction_type
      ELSE 'SAIDA'::public.transaction_type
    END;

    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      v_tipo, v_desc, abs(v_delta), v_data, 'CONFIRMADA'
    ) RETURNING id INTO tx;

    UPDATE public.bank_accounts
       SET saldo_atual = COALESCE(saldo_atual, 0) + v_delta
     WHERE id = imp.bank_account_id;

    UPDATE public.bank_statement_items
       SET transaction_id_criada = tx, processado = true WHERE id = it.id;
    criadas := criadas + 1;
  END LOOP;

  UPDATE public.bank_statement_imports
     SET status = 'CONFIRMED', confirmado_em = now()
   WHERE id = _import_id;

  RETURN jsonb_build_object('criadas', criadas, 'associadas', associadas, 'ignoradas', ignoradas);
END;
$function$;
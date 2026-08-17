-- ============ A2/A3: parcela canônica por compra ============
ALTER TABLE public.expense_installments ALTER COLUMN expense_id DROP NOT NULL;
ALTER TABLE public.expense_installments
  ADD CONSTRAINT expense_installments_origem_canonica
  CHECK (purchase_id IS NOT NULL OR expense_id IS NOT NULL);

-- ============ C: guardas de autorização ============
CREATE OR REPLACE FUNCTION public.assert_family_access(_family_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF _family_id IS NULL THEN RAISE EXCEPTION 'Registro inexistente'; END IF;
  IF NOT public.is_family_member(_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao nesta familia';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_bank_account_access(_account_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_family_access((SELECT family_id FROM public.bank_accounts WHERE id = _account_id));
END $$;

CREATE OR REPLACE FUNCTION public.assert_bank_import_access(_import_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_family_access((SELECT family_id FROM public.bank_statement_imports WHERE id = _import_id));
END $$;

CREATE OR REPLACE FUNCTION public.assert_bank_item_access(_item_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_family_access((SELECT family_id FROM public.bank_statement_items WHERE id = _item_id));
END $$;

CREATE OR REPLACE FUNCTION public.assert_purchase_access(_purchase_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_family_access((SELECT family_id FROM public.purchases WHERE id = _purchase_id));
END $$;

CREATE OR REPLACE FUNCTION public.assert_repair_log_access(_log_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_family_access((SELECT family_id FROM public.bank_persistence_repair_logs WHERE id = _log_id));
END $$;

-- Injeta a guarda no topo de cada rotina sensível que ainda não conferia família.
DO $inj$
DECLARE
  alvo record;
  def text;
  novo text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('reprocess_account_checkpoints_only', 'public.assert_bank_account_access(_account_id)'),
      ('normalize_bank_opening_balances',    'public.assert_bank_account_access(_account_id)'),
      ('reset_bank_account_imports',         'public.assert_bank_account_access(_account_id)'),
      ('bank_import_reset_scope',            'public.assert_bank_account_access(_account_id)'),
      ('inspect_bank_import_reset',          'public.assert_bank_account_access(_account_id)'),
      ('confirm_bank_statement_import',      'public.assert_bank_import_access(_import_id)'),
      ('reprocess_bank_statement_import',    'public.assert_bank_import_access(_import_id)'),
      ('apply_bank_persistence_repair',      'public.assert_bank_item_access(_item_id)'),
      ('revert_bank_persistence_repair',     'public.assert_repair_log_access(_log_id)'),
      ('merge_duplicate_purchase',           'public.assert_purchase_access(p_principal)'),
      ('purchase_undo_blocks',               'public.assert_purchase_access(p_purchase_id)')
    ) AS t(nome, guarda)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = alvo.nome
     LIMIT 1;
    IF def IS NULL OR position('assert_' in def) > 0 THEN CONTINUE; END IF;
    novo := regexp_replace(def, E'\nBEGIN\n', E'\nBEGIN\n  PERFORM ' || alvo.guarda || E';\n');
    IF novo = def THEN RAISE EXCEPTION 'Nao foi possivel injetar guarda em %', alvo.nome; END IF;
    EXECUTE novo;
  END LOOP;
END $inj$;

-- ============ A4: create_purchase_complete sem espelho em expenses ============
DROP FUNCTION IF EXISTS public.create_purchase_complete(jsonb,jsonb,integer,integer,numeric,text,uuid);
CREATE FUNCTION public.create_purchase_complete(
  p_purchase jsonb,
  p_items jsonb,
  p_parcelas integer DEFAULT 1,
  p_parcela_inicial integer DEFAULT 1,
  p_valor_parcela numeric DEFAULT NULL,
  p_periodicidade text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_family uuid := (p_purchase->>'family_id')::uuid;
  v_member uuid := NULLIF(p_purchase->>'member_id','')::uuid;
  v_card public.credit_cards%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_existing public.purchases%ROWTYPE;
  v_total numeric := 0;
  v_item jsonb;
  v_cat uuid;
  v_parcelas integer := GREATEST(1, COALESCE(p_parcelas, 1));
  v_inicial integer;
  v_restantes integer;
  v_valor_parcela numeric;
  v_base date;
  v_cycle record;
  v_invoice uuid;
  v_invoices uuid[] := '{}';
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF v_family IS NULL THEN RAISE EXCEPTION 'family_id obrigatorio'; END IF;
  IF NOT public.is_family_member(v_family, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao nesta familia';
  END IF;
  IF NOT public.can_manage_member_record(v_family, v_member, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para lancar por este membro';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.purchases
     WHERE family_id = v_family AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ALREADY_CREATED','purchase', to_jsonb(v_existing));
    END IF;
  END IF;

  SELECT COALESCE(SUM(round((it->>'valor_total')::numeric, 2)), 0) INTO v_total
    FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) it;

  BEGIN
    INSERT INTO public.purchases (
      family_id, member_id, created_by, estabelecimento, data_compra, valor_total,
      forma_pagamento, credit_card_id, bank_account_id, tipo_compra, status_pagamento,
      observacao, categoria_id, data_prevista_pagamento, data_pagamento_real,
      nota_fiscal_url, nota_fiscal_tipo, client_request_id
    ) VALUES (
      v_family,
      v_member,
      auth.uid(),
      COALESCE(NULLIF(btrim(p_purchase->>'estabelecimento'),''), 'Compra'),
      (p_purchase->>'data_compra')::date,
      v_total,
      COALESCE(NULLIF(p_purchase->>'forma_pagamento','')::public.payment_method, 'A_DEFINIR'),
      NULLIF(p_purchase->>'credit_card_id','')::uuid,
      NULLIF(p_purchase->>'bank_account_id','')::uuid,
      COALESCE(NULLIF(p_purchase->>'tipo_compra','')::public.purchase_type, 'COMPRA_NORMAL'),
      COALESCE(NULLIF(p_purchase->>'status_pagamento','')::public.purchase_payment_status, 'PAGO'),
      NULLIF(p_purchase->>'observacao',''),
      NULLIF(p_purchase->>'categoria_id','')::uuid,
      NULLIF(p_purchase->>'data_prevista_pagamento','')::date,
      NULLIF(p_purchase->>'data_pagamento_real','')::date,
      NULLIF(p_purchase->>'nota_fiscal_url',''),
      NULLIF(p_purchase->>'nota_fiscal_tipo',''),
      p_client_request_id
    ) RETURNING * INTO v_purchase;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.purchases
     WHERE family_id = v_family AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ALREADY_CREATED','purchase', to_jsonb(v_existing));
    END IF;
    RAISE;
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) LOOP
    v_cat := COALESCE(NULLIF(v_item->>'categoria_id','')::uuid, NULLIF(v_item->>'categoria_sugerida','')::uuid);
    INSERT INTO public.purchase_items (
      purchase_id, product_id, descricao_produto, quantidade, unidade,
      valor_unitario, valor_total, categoria_id, categoria_sugerida, categoria_ajustada
    ) VALUES (
      v_purchase.id,
      NULLIF(v_item->>'product_id','')::uuid,
      btrim(COALESCE(v_item->>'descricao_produto','')),
      COALESCE((v_item->>'quantidade')::numeric, 0),
      COALESCE(NULLIF(v_item->>'unidade',''), 'UN'),
      COALESCE((v_item->>'valor_unitario')::numeric, 0),
      round(COALESCE((v_item->>'valor_total')::numeric, 0), 2),
      v_cat,
      NULLIF(v_item->>'categoria_sugerida','')::uuid,
      NULLIF(v_item->>'categoria_sugerida','') IS NOT NULL
        AND NULLIF(v_item->>'categoria_sugerida','')::uuid IS DISTINCT FROM v_cat
    );
  END LOOP;

  IF v_purchase.tipo_compra <> 'COMPRA_PARCELADA' THEN
    v_parcelas := 1;
  END IF;
  v_inicial := LEAST(GREATEST(1, COALESCE(p_parcela_inicial, 1)), v_parcelas);

  -- Cartao de credito: parcelas + faturas ligadas SOMENTE a compra (sem espelho legado)
  IF v_purchase.forma_pagamento = 'CREDITO' AND v_purchase.credit_card_id IS NOT NULL THEN
    SELECT * INTO v_card FROM public.credit_cards
     WHERE id = v_purchase.credit_card_id AND family_id = v_family;
    IF FOUND THEN
      v_restantes := v_parcelas - v_inicial + 1;
      v_valor_parcela := CASE
        WHEN p_valor_parcela IS NOT NULL THEN round(p_valor_parcela, 2)
        ELSE round(v_total / GREATEST(1, v_restantes), 2) END;

      SELECT c.fechamento INTO v_base
        FROM public.card_cycle(v_card.dia_fechamento, v_card.dia_vencimento, v_purchase.data_compra) c;

      FOR i IN 0..(v_restantes - 1) LOOP
        SELECT * INTO v_cycle FROM public.card_cycle(
          v_card.dia_fechamento, v_card.dia_vencimento,
          LEAST(
            LEAST(v_card.dia_fechamento, 31),
            EXTRACT(DAY FROM (date_trunc('month', v_base + (i || ' months')::interval) + interval '1 month - 1 day'))::int
          ) - 1 + date_trunc('month', v_base + (i || ' months')::interval)::date
        );

        SELECT id INTO v_invoice FROM public.card_invoices
         WHERE credit_card_id = v_card.id AND data_fechamento = v_cycle.fechamento;
        IF v_invoice IS NULL THEN
          INSERT INTO public.card_invoices (
            family_id, credit_card_id, data_inicio_ciclo, data_fechamento, data_vencimento
          ) VALUES (v_family, v_card.id, v_cycle.inicio, v_cycle.fechamento, v_cycle.vencimento)
          RETURNING id INTO v_invoice;
        END IF;
        v_invoices := v_invoices || v_invoice;

        INSERT INTO public.expense_installments (
          family_id, expense_id, card_invoice_id, numero_parcela, total_parcelas,
          valor_parcela, data_vencimento, member_id, credit_card_id, purchase_id
        ) VALUES (
          v_family, NULL, v_invoice, v_inicial + i, v_parcelas,
          v_valor_parcela, v_cycle.vencimento, v_member, v_card.id, v_purchase.id
        );
      END LOOP;

      UPDATE public.card_invoices ci
         SET valor_total = COALESCE((
               SELECT SUM(ei.valor_parcela) FROM public.expense_installments ei
                WHERE ei.card_invoice_id = ci.id), 0)
       WHERE ci.id = ANY (v_invoices);
    END IF;
  END IF;

  IF v_purchase.tipo_compra IN ('COMPRA_RECORRENTE', 'CONTA_RECORRENTE') THEN
    INSERT INTO public.recurring_expenses (
      family_id, member_id, purchase_id, credit_card_id, bank_account_id, created_by,
      nome, valor, periodicidade, data_inicio, proxima_cobranca
    ) VALUES (
      v_family, v_member, v_purchase.id, v_purchase.credit_card_id, v_purchase.bank_account_id,
      auth.uid(), v_purchase.estabelecimento, v_total,
      COALESCE(NULLIF(p_periodicidade,'')::public.expense_recurrence, 'MENSAL'),
      v_purchase.data_compra,
      CASE COALESCE(NULLIF(p_periodicidade,''), 'MENSAL')
        WHEN 'MENSAL' THEN v_purchase.data_compra + interval '1 month'
        WHEN 'BIMESTRAL' THEN v_purchase.data_compra + interval '2 months'
        WHEN 'TRIMESTRAL' THEN v_purchase.data_compra + interval '3 months'
        WHEN 'SEMESTRAL' THEN v_purchase.data_compra + interval '6 months'
        WHEN 'ANUAL' THEN v_purchase.data_compra + interval '1 year'
        ELSE v_purchase.data_compra + interval '1 month'
      END::date
    );
  END IF;

  SELECT * INTO v_purchase FROM public.purchases WHERE id = v_purchase.id;
  RETURN jsonb_build_object('status','CREATED','purchase', to_jsonb(v_purchase));
END;
$fn$;

-- ============ A7: expenses vira READ_ONLY_LEGACY ============
REVOKE INSERT, UPDATE, DELETE ON public.expenses FROM anon, authenticated;
GRANT SELECT ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

-- ============ C2: anon nao executa rotina SECURITY DEFINER ============
DO $sweep$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.auth_ok THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $sweep$;

-- Rotinas internas: ninguem chama direto do cliente.
REVOKE ALL ON FUNCTION public.recalc_bank_account_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_purchase_duplicate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_bank_account_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_purchase_duplicate(uuid) TO service_role;

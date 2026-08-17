-- =========================================================
-- FASE 1 — HARDENING ESTRUTURAL
-- =========================================================

-- ---------- PARTE A: purchase atômica + idempotência ----------

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS purchases_client_request_id_uidx
  ON public.purchases (family_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Ciclo de fatura do cartao (espelha cycleForDate do frontend).
CREATE OR REPLACE FUNCTION public.card_cycle(_fech_dia integer, _venc_dia integer, _data date)
RETURNS TABLE (inicio date, fechamento date, vencimento date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  f_dia integer := LEAST(31, GREATEST(1, COALESCE(_fech_dia, 1)));
  v_dia integer := LEAST(31, GREATEST(1, COALESCE(_venc_dia, 10)));
  f date;
  ant date;
BEGIN
  f := make_date(EXTRACT(YEAR FROM _data)::int, EXTRACT(MONTH FROM _data)::int, 1)
       + (LEAST(f_dia, EXTRACT(DAY FROM (date_trunc('month', _data) + interval '1 month - 1 day'))::int) - 1);
  IF _data > f THEN
    f := (date_trunc('month', _data) + interval '1 month')::date;
    f := f + (LEAST(f_dia, EXTRACT(DAY FROM (date_trunc('month', f) + interval '1 month - 1 day'))::int) - 1);
  END IF;

  ant := (date_trunc('month', f) - interval '1 month')::date;
  ant := ant + (LEAST(f_dia, EXTRACT(DAY FROM (date_trunc('month', ant) + interval '1 month - 1 day'))::int) - 1);
  inicio := ant + 1;
  fechamento := f;

  IF v_dia > f_dia THEN
    vencimento := date_trunc('month', f)::date
      + (LEAST(v_dia, EXTRACT(DAY FROM (date_trunc('month', f) + interval '1 month - 1 day'))::int) - 1);
  ELSE
    vencimento := (date_trunc('month', f) + interval '1 month')::date;
    vencimento := vencimento
      + (LEAST(v_dia, EXTRACT(DAY FROM (date_trunc('month', vencimento) + interval '1 month - 1 day'))::int) - 1);
  END IF;

  RETURN NEXT;
END;
$$;

-- Criacao completa da compra numa unica transacao PostgreSQL.
CREATE OR REPLACE FUNCTION public.create_purchase_complete(
  p_purchase jsonb,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_parcelas integer DEFAULT 1,
  p_parcela_inicial integer DEFAULT 1,
  p_valor_parcela numeric DEFAULT NULL,
  p_periodicidade text DEFAULT 'MENSAL',
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family uuid := (p_purchase->>'family_id')::uuid;
  v_member uuid := NULLIF(p_purchase->>'member_id','')::uuid;
  v_card public.credit_cards%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_existing public.purchases%ROWTYPE;
  v_total numeric := 0;
  v_item jsonb;
  v_cat uuid;
  v_expense uuid;
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

  -- IDEMPOTENCIA: mesma requisicao repetida devolve a compra ja criada.
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

  -- Itens
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

  -- Cartao de credito: despesa legada + parcelas + faturas
  IF v_purchase.forma_pagamento = 'CREDITO' AND v_purchase.credit_card_id IS NOT NULL THEN
    SELECT * INTO v_card FROM public.credit_cards
     WHERE id = v_purchase.credit_card_id AND family_id = v_family;
    IF FOUND THEN
      INSERT INTO public.expenses (
        family_id, member_id, created_by, purchase_id, descricao, valor, data_compra,
        forma_pagamento, tipo_compra, cartao_id, parcelas_total, parcela_atual
      ) VALUES (
        v_family, v_member, auth.uid(), v_purchase.id, v_purchase.estabelecimento,
        v_total, v_purchase.data_compra, 'CREDITO',
        CASE WHEN v_parcelas > 1 THEN 'PARCELADO'::public.purchase_type
             ELSE 'CARTAO_CREDITO'::public.purchase_type END,
        v_card.id, v_parcelas, v_inicial
      ) RETURNING id INTO v_expense;

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
          v_family, v_expense, v_invoice, v_inicial + i, v_parcelas,
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

  -- Recorrentes
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
$$;

REVOKE ALL ON FUNCTION public.create_purchase_complete(jsonb, jsonb, integer, integer, numeric, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_complete(jsonb, jsonb, integer, integer, numeric, text, uuid) TO authenticated;

-- ---------- PARTE B: identidade canonica de importacoes bancarias ----------

ALTER TABLE public.bank_statement_imports
  ADD COLUMN IF NOT EXISTS duplicate_of_import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_import_id uuid;

CREATE OR REPLACE FUNCTION public.bank_import_set_canonical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.canonical_import_id := COALESCE(NEW.duplicate_of_import_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_import_canonical ON public.bank_statement_imports;
CREATE TRIGGER bank_import_canonical
BEFORE INSERT OR UPDATE ON public.bank_statement_imports
FOR EACH ROW EXECUTE FUNCTION public.bank_import_set_canonical();

-- Backfill: em cada grupo (conta+fingerprint), o canonico e o import que gerou
-- ledger (mais transactions criadas); empate resolvido pelo mais antigo.
WITH ranked AS (
  SELECT i.id, i.bank_account_id, i.fingerprint,
         (SELECT count(*) FROM public.bank_statement_items x
           WHERE x.import_id = i.id AND x.transaction_id_criada IS NOT NULL) AS criadas,
         i.created_at
    FROM public.bank_statement_imports i
   WHERE i.fingerprint IS NOT NULL
), eleito AS (
  SELECT DISTINCT ON (bank_account_id, fingerprint) bank_account_id, fingerprint, id AS canonical
    FROM ranked
   ORDER BY bank_account_id, fingerprint, criadas DESC, created_at ASC
)
UPDATE public.bank_statement_imports i
   SET duplicate_of_import_id = e.canonical
  FROM eleito e
 WHERE i.fingerprint IS NOT NULL
   AND i.bank_account_id = e.bank_account_id
   AND i.fingerprint = e.fingerprint
   AND i.id <> e.canonical
   AND i.duplicate_of_import_id IS NULL;

UPDATE public.bank_statement_imports
   SET canonical_import_id = COALESCE(duplicate_of_import_id, id)
 WHERE canonical_import_id IS DISTINCT FROM COALESCE(duplicate_of_import_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_imports_canonical_fingerprint_uidx
  ON public.bank_statement_imports (bank_account_id, fingerprint)
  WHERE fingerprint IS NOT NULL AND duplicate_of_import_id IS NULL;

-- ---------- PARTE C: guard de import ja confirmado ----------

ALTER FUNCTION public.confirm_bank_statement_import(uuid)
  RENAME TO confirm_bank_statement_import_exec;

CREATE OR REPLACE FUNCTION public.confirm_bank_statement_import(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  imp public.bank_statement_imports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importacao nao encontrada'; END IF;

  -- IMPORT IDEMPOTENCY: retry apos resposta perdida nao reprocessa nada.
  IF imp.status = 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_CONFIRMED',
      'import_id', _import_id,
      'created_transactions', 0,
      'created_purchases', 0,
      'criadas', 0, 'associadas', 0, 'ignoradas', 0
    );
  END IF;

  RETURN public.confirm_bank_statement_import_exec(_import_id) || jsonb_build_object('status','CONFIRMED','import_id',_import_id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_bank_statement_import_exec(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_bank_statement_import(uuid) TO authenticated;

-- ---------- PARTE D: defesa em profundidade em transactions ----------

REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon;

-- Relatório de impacto: nada é alterado aqui.
CREATE OR REPLACE FUNCTION public.inspect_card_statement_import_undo(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_imp public.card_statement_imports%ROWTYPE;
  v_item RECORD;
  v_p public.purchases%ROWTYPE;
  v_criadas_exclusivas int := 0;
  v_criadas_compartilhadas int := 0;
  v_associadas int := 0;
  v_ignorados int := 0;
  v_taxas int := 0;
  v_creditos int := 0;
  v_parcelas int := 0;
  v_bloqueios jsonb := '[]'::jsonb;
  v_motivos text[];
  v_compartilhada boolean;
  v_documento boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_imp FROM public.card_statement_imports WHERE id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura importada não encontrada'; END IF;
  IF NOT public.is_family_member(v_imp.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  FOR v_item IN
    SELECT * FROM public.card_statement_items WHERE import_id = p_import_id ORDER BY ordem
  LOOP
    IF v_item.purchase_id_criada IS NOT NULL THEN
      SELECT * INTO v_p FROM public.purchases WHERE id = v_item.purchase_id_criada;
      IF NOT FOUND THEN CONTINUE; END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.card_statement_items o
        WHERE o.import_id <> p_import_id
          AND (o.purchase_id_criada = v_p.id OR o.purchase_id_matched = v_p.id)
      ) INTO v_compartilhada;
      SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.purchase_id = v_p.id) INTO v_documento;

      SELECT count(*) INTO v_parcelas FROM public.expense_installments WHERE purchase_id = v_p.id;

      IF v_item.tipo_sugerido = 'TAXA' OR v_item.tipo_sugerido = 'JUROS' THEN v_taxas := v_taxas + 1;
      ELSIF v_item.tipo_sugerido = 'ESTORNO' THEN v_creditos := v_creditos + 1;
      END IF;

      IF v_compartilhada OR v_documento THEN
        v_criadas_compartilhadas := v_criadas_compartilhadas + 1;
        CONTINUE;
      END IF;

      v_motivos := public.purchase_undo_blocks(v_p.id);
      IF array_length(v_motivos, 1) IS NOT NULL THEN
        v_bloqueios := v_bloqueios || jsonb_build_object(
          'purchase_id', v_p.id,
          'estabelecimento', v_p.estabelecimento,
          'valor', v_p.valor_total,
          'motivos', to_jsonb(v_motivos)
        );
      ELSE
        v_criadas_exclusivas := v_criadas_exclusivas + 1;
      END IF;
    ELSIF v_item.match_status = 'IGNORED' THEN
      v_ignorados := v_ignorados + 1;
    ELSIF v_item.purchase_id_matched IS NOT NULL
       OR v_item.installment_id_matched IS NOT NULL
       OR v_item.recurring_expense_id_matched IS NOT NULL THEN
      v_associadas := v_associadas + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_parcelas
    FROM public.expense_installments i
   WHERE i.purchase_id IN (
     SELECT purchase_id_criada FROM public.card_statement_items
      WHERE import_id = p_import_id AND purchase_id_criada IS NOT NULL);

  RETURN jsonb_build_object(
    'import_id', v_imp.id,
    'status', v_imp.status,
    'ja_desfeita', v_imp.status = 'UNDONE',
    'nome_arquivo', v_imp.nome_arquivo,
    'confirmado_em', v_imp.confirmado_em,
    'quantidade_lancamentos', v_imp.quantidade_lancamentos,
    'compras_criadas_exclusivas', v_criadas_exclusivas,
    'compras_compartilhadas', v_criadas_compartilhadas,
    'compras_associadas', v_associadas,
    'parcelas', v_parcelas,
    'taxas', v_taxas,
    'creditos', v_creditos,
    'ignorados', v_ignorados,
    'bloqueios', v_bloqueios,
    'exige_revisao_manual', jsonb_array_length(v_bloqueios) > 0
  );
END;
$$;

-- Motivos que impedem remover automaticamente uma compra criada por importação.
CREATE OR REPLACE FUNCTION public.purchase_undo_blocks(p_purchase_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p public.purchases%ROWTYPE;
  v_bloqueios text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN RETURN v_bloqueios; END IF;

  IF v_p.status_pagamento = 'PAGO' OR v_p.data_pagamento_real IS NOT NULL THEN
    v_bloqueios := array_append(v_bloqueios, 'Compra já paga'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions t
              WHERE t.purchase_id = v_p.id AND (t.manual OR t.status = 'CONFIRMADA')) THEN
    v_bloqueios := array_append(v_bloqueios, 'BLOCKED_BY_BANK_TRANSACTION'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.expense_installments i
              WHERE i.purchase_id = v_p.id AND i.status = 'PAGO') THEN
    v_bloqueios := array_append(v_bloqueios, 'Parcela já paga'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.expense_installments i
             JOIN public.card_invoices f ON f.id = i.card_invoice_id
             WHERE i.purchase_id = v_p.id AND f.status IN ('FECHADA','PAGA')) THEN
    v_bloqueios := array_append(v_bloqueios, 'Fatura fechada ou paga vinculada'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_statement_items bi
             JOIN public.bank_statement_imports im ON im.id = bi.import_id
             WHERE (bi.purchase_id_matched = v_p.id OR bi.purchase_id_criada = v_p.id)
               AND im.status = 'CONFIRMED') THEN
    v_bloqueios := array_append(v_bloqueios, 'Extrato bancário confirmado vinculado'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.monthly_snapshots s
              WHERE s.family_id = v_p.family_id AND s.fechado
                AND s.ano = EXTRACT(YEAR FROM v_p.data_compra)::int
                AND s.mes = EXTRACT(MONTH FROM v_p.data_compra)::int) THEN
    v_bloqueios := array_append(v_bloqueios, 'Mês já fechado no histórico'::text);
  END IF;

  RETURN v_bloqueios;
END;
$$;

-- Operação transacional de desfazer.
CREATE OR REPLACE FUNCTION public.undo_card_statement_import(
  p_import_id uuid,
  p_aceitar_pendencias boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_imp public.card_statement_imports%ROWTYPE;
  v_relatorio jsonb;
  v_item RECORD;
  v_p public.purchases%ROWTYPE;
  v_compartilhada boolean;
  v_documento boolean;
  v_motivos text[];
  v_removidas int := 0;
  v_preservadas int := 0;
  v_bloqueadas int := 0;
  v_vinculos int := 0;
  v_faturas uuid[] := ARRAY[]::uuid[];
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_imp FROM public.card_statement_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura importada não encontrada'; END IF;
  IF NOT public.is_family_admin(v_imp.family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Somente um administrador da família pode desfazer uma importação';
  END IF;

  IF v_imp.status = 'UNDONE' THEN
    RETURN jsonb_build_object('resultado', 'ALREADY_UNDONE', 'import_id', v_imp.id);
  END IF;
  IF v_imp.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Só é possível desfazer uma importação confirmada. Use "Cancelar" para importações ainda em revisão.';
  END IF;

  v_relatorio := public.inspect_card_statement_import_undo(p_import_id);
  IF (v_relatorio->>'exige_revisao_manual')::boolean AND NOT p_aceitar_pendencias THEN
    RAISE EXCEPTION 'Alguns itens possuem histórico posterior e precisarão de revisão manual. Confirme para continuar preservando esses registros.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.card_statement_items WHERE import_id = p_import_id ORDER BY ordem
  LOOP
    IF v_item.purchase_id_criada IS NOT NULL THEN
      SELECT * INTO v_p FROM public.purchases WHERE id = v_item.purchase_id_criada;
      IF FOUND THEN
        SELECT EXISTS (
          SELECT 1 FROM public.card_statement_items o
          WHERE o.import_id <> p_import_id
            AND (o.purchase_id_criada = v_p.id OR o.purchase_id_matched = v_p.id)
        ) INTO v_compartilhada;
        SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.purchase_id = v_p.id) INTO v_documento;
        v_motivos := public.purchase_undo_blocks(v_p.id);

        IF v_compartilhada OR v_documento THEN
          v_preservadas := v_preservadas + 1;
        ELSIF array_length(v_motivos, 1) IS NOT NULL THEN
          v_bloqueadas := v_bloqueadas + 1;
        ELSE
          SELECT array_agg(DISTINCT card_invoice_id) INTO v_ids
            FROM public.expense_installments
           WHERE purchase_id = v_p.id AND card_invoice_id IS NOT NULL;
          IF v_ids IS NOT NULL THEN v_faturas := v_faturas || v_ids; END IF;

          UPDATE public.card_statement_items
             SET purchase_id_matched = NULL, purchase_id_criada = NULL,
                 match_status = 'UNMATCHED', user_action = 'PENDENTE'
           WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
          UPDATE public.bank_statement_items
             SET purchase_id_matched = NULL, purchase_id_criada = NULL, match_status = 'NEW'
           WHERE purchase_id_matched = v_p.id OR purchase_id_criada = v_p.id;
          DELETE FROM public.reconciliations
           WHERE (source_type = 'purchase' AND source_id = v_p.id)
              OR (target_type = 'purchase' AND target_id = v_p.id);
          DELETE FROM public.expense_installments WHERE purchase_id = v_p.id;
          DELETE FROM public.expense_installments
           WHERE expense_id IN (SELECT id FROM public.expenses WHERE purchase_id = v_p.id);
          DELETE FROM public.recurring_expenses WHERE purchase_id = v_p.id;
          DELETE FROM public.expenses WHERE purchase_id = v_p.id;
          DELETE FROM public.purchase_items WHERE purchase_id = v_p.id;
          DELETE FROM public.purchases WHERE id = v_p.id;
          v_removidas := v_removidas + 1;
        END IF;
      END IF;
    END IF;

    DELETE FROM public.reconciliations
     WHERE source_type = 'card_statement_item' AND source_id = v_item.id;
    GET DIAGNOSTICS v_ids = ROW_COUNT;
    v_vinculos := v_vinculos + 1;
  END LOOP;

  -- Os lançamentos lidos continuam no histórico da importação, sem efeito ativo.
  UPDATE public.card_statement_items
     SET purchase_id_criada = NULL,
         purchase_id_matched = NULL,
         installment_id_matched = NULL,
         recurring_expense_id_matched = NULL,
         match_status = 'UNMATCHED',
         user_action = 'PENDENTE',
         erro_mensagem = NULL
   WHERE import_id = p_import_id;

  IF array_length(v_faturas, 1) IS NOT NULL THEN
    UPDATE public.card_invoices f
       SET valor_total = COALESCE((
             SELECT sum(i.valor_parcela) FROM public.expense_installments i
              WHERE i.card_invoice_id = f.id), 0),
           updated_at = now()
     WHERE f.id = ANY(v_faturas);
  END IF;

  UPDATE public.card_statement_imports
     SET status = 'UNDONE',
         confirmado_em = NULL,
         erro_mensagem = NULL,
         updated_at = now()
   WHERE id = p_import_id;

  INSERT INTO public.reconciliation_audit
    (family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by)
  VALUES
    (v_imp.family_id, 'card_statement_import', v_imp.id, 'status', 'CONFIRMED', 'UNDONE',
     'DESFAZER_IMPORTACAO', auth.uid());

  RETURN jsonb_build_object(
    'resultado', 'UNDONE',
    'import_id', v_imp.id,
    'compras_removidas', v_removidas,
    'compras_preservadas', v_preservadas,
    'compras_bloqueadas', v_bloqueadas,
    'vinculos_removidos', v_vinculos,
    'relatorio', v_relatorio
  );
END;
$$;

-- Deduplicação: a mesma fatura do mesmo cartão não pode ser confirmada duas vezes.
CREATE OR REPLACE FUNCTION public.block_duplicate_confirmed_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND COALESCE(OLD.status, 'x') <> 'CONFIRMED'
     AND NEW.fingerprint IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.card_statement_imports o
       WHERE o.id <> NEW.id
         AND o.credit_card_id = NEW.credit_card_id
         AND o.fingerprint = NEW.fingerprint
         AND o.status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'Esta fatura já foi importada e confirmada neste cartão. Desfaça a importação anterior para substituí-la.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_duplicate_confirmed_statement ON public.card_statement_imports;
CREATE TRIGGER block_duplicate_confirmed_statement
BEFORE INSERT OR UPDATE OF status ON public.card_statement_imports
FOR EACH ROW EXECUTE FUNCTION public.block_duplicate_confirmed_statement();

REVOKE ALL ON FUNCTION public.purchase_undo_blocks(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.inspect_card_statement_import_undo(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.undo_card_statement_import(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.inspect_card_statement_import_undo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_card_statement_import(uuid, boolean) TO authenticated;
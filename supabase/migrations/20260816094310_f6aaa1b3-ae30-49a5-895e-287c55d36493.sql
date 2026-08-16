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
    v_vinculos := v_vinculos + 1;
  END LOOP;

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
     SET status = 'UNDONE', confirmado_em = NULL, erro_mensagem = NULL, updated_at = now()
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
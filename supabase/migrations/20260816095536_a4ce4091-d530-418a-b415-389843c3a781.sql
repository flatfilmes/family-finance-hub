-- Conjunto de compras alvo do reset seletivo de Compras/Cartoes.
CREATE OR REPLACE FUNCTION public.purchases_reset_scope(_family_id uuid, _incluir_manuais boolean)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id
  FROM public.purchases p
  WHERE p.family_id = _family_id
    AND (
      _incluir_manuais
      OR p.credit_card_id IS NOT NULL
      OR p.id IN (SELECT csi.purchase_id_criada FROM public.card_statement_items csi
                   WHERE csi.family_id = _family_id AND csi.purchase_id_criada IS NOT NULL)
      OR p.id IN (SELECT csi.purchase_id_matched FROM public.card_statement_items csi
                   WHERE csi.family_id = _family_id AND csi.purchase_id_matched IS NOT NULL)
      OR p.id IN (SELECT bsi.purchase_id_criada FROM public.bank_statement_items bsi
                   WHERE bsi.family_id = _family_id AND bsi.purchase_id_criada IS NOT NULL)
      OR p.id IN (SELECT d.purchase_id FROM public.documents d
                   WHERE d.family_id = _family_id AND d.purchase_id IS NOT NULL)
    )
$function$;

REVOKE ALL ON FUNCTION public.purchases_reset_scope(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchases_reset_scope(uuid, boolean) TO authenticated;

-- Relatorio previo do reset seletivo.
CREATE OR REPLACE FUNCTION public.inspect_family_purchases_cards_reset(
  p_family_id uuid,
  p_incluir_manuais boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF NOT public.is_family_member(p_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta familia';
  END IF;

  RETURN jsonb_build_object(
    'compras', (SELECT count(*) FROM public.purchases_reset_scope(p_family_id, p_incluir_manuais)),
    'compras_manuais', (
      SELECT count(*) FROM public.purchases p
      WHERE p.family_id = p_family_id
        AND p.id NOT IN (SELECT id FROM public.purchases_reset_scope(p_family_id, false))
    ),
    'itens', (
      SELECT count(*) FROM public.purchase_items pi
      WHERE pi.purchase_id IN (SELECT id FROM public.purchases_reset_scope(p_family_id, p_incluir_manuais))
    ),
    'parcelas', (
      SELECT count(*) FROM public.expense_installments ei
      WHERE ei.family_id = p_family_id
        AND (ei.credit_card_id IS NOT NULL OR ei.card_invoice_id IS NOT NULL
             OR ei.purchase_id IN (SELECT id FROM public.purchases_reset_scope(p_family_id, p_incluir_manuais)))
    ),
    'recorrencias', (
      SELECT count(*) FROM public.recurring_expenses re
      WHERE re.family_id = p_family_id
        AND (re.credit_card_id IS NOT NULL
             OR re.purchase_id IN (SELECT id FROM public.purchases_reset_scope(p_family_id, p_incluir_manuais)))
    ),
    'faturas_importadas', (SELECT count(*) FROM public.card_statement_imports WHERE family_id = p_family_id),
    'lancamentos_fatura', (SELECT count(*) FROM public.card_statement_items WHERE family_id = p_family_id),
    'faturas', (SELECT count(*) FROM public.card_invoices WHERE family_id = p_family_id),
    'reconciliacoes', (SELECT count(*) FROM public.reconciliations WHERE family_id = p_family_id),
    'documentos', (SELECT count(*) FROM public.documents WHERE family_id = p_family_id),
    'cartoes', (SELECT count(*) FROM public.credit_cards WHERE family_id = p_family_id),
    'transacoes_preservadas', (
      SELECT count(*) FROM public.transactions t
      WHERE t.family_id = p_family_id
        AND (
          t.purchase_id IS NULL
          OR t.manual
          OR t.tipo = 'PAGAMENTO_CARTAO'
          OR t.id IN (SELECT bsi.transaction_id_criada FROM public.bank_statement_items bsi WHERE bsi.family_id = p_family_id AND bsi.transaction_id_criada IS NOT NULL)
          OR t.id IN (SELECT bsi.transaction_id_matched FROM public.bank_statement_items bsi WHERE bsi.family_id = p_family_id AND bsi.transaction_id_matched IS NOT NULL)
        )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.inspect_family_purchases_cards_reset(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inspect_family_purchases_cards_reset(uuid, boolean) TO authenticated;

-- Reset seletivo, transacional, somente ADMIN da familia.
CREATE OR REPLACE FUNCTION public.reset_family_purchases_and_cards(
  p_family_id uuid,
  p_incluir_manuais boolean DEFAULT true,
  p_delete_cards boolean DEFAULT false,
  p_backup_created boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fam public.families%ROWTYPE;
  t jsonb := '{}'::jsonb;
  n integer;
  alvo uuid[];
  preservadas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = p_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Familia nao encontrada'; END IF;
  IF NOT public.is_family_admin(p_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Somente administradores da familia podem resetar os dados';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO alvo
    FROM public.purchases_reset_scope(p_family_id, COALESCE(p_incluir_manuais, true));

  -- 1) Movimentacoes bancarias reais: soltar o vinculo, nunca apagar.
  UPDATE public.transactions t
     SET purchase_id = NULL
   WHERE t.family_id = p_family_id
     AND t.purchase_id = ANY(alvo)
     AND (
       t.manual
       OR t.tipo = 'PAGAMENTO_CARTAO'
       OR t.id IN (SELECT bsi.transaction_id_criada FROM public.bank_statement_items bsi WHERE bsi.family_id = p_family_id AND bsi.transaction_id_criada IS NOT NULL)
       OR t.id IN (SELECT bsi.transaction_id_matched FROM public.bank_statement_items bsi WHERE bsi.family_id = p_family_id AND bsi.transaction_id_matched IS NOT NULL)
     );
  GET DIAGNOSTICS preservadas = ROW_COUNT;

  UPDATE public.purchases SET transaction_id = NULL WHERE id = ANY(alvo);

  -- 2) Extrato bancario: manter os lancamentos, remover apenas os vinculos com compras.
  UPDATE public.bank_statement_items
     SET purchase_id_criada = NULL
   WHERE family_id = p_family_id AND purchase_id_criada = ANY(alvo);
  UPDATE public.bank_statement_items
     SET purchase_id_matched = NULL
   WHERE family_id = p_family_id AND purchase_id_matched = ANY(alvo);
  UPDATE public.bank_statement_items
     SET card_invoice_id_matched = NULL
   WHERE family_id = p_family_id AND card_invoice_id_matched IS NOT NULL;

  -- 3) Conciliacoes e auditoria da area de compras/cartoes.
  DELETE FROM public.reconciliation_audit
   WHERE family_id = p_family_id
     AND (entidade IN ('purchase', 'card_statement_item', 'card_statement_import', 'card_invoice')
          OR entidade_id = ANY(alvo));
  DELETE FROM public.reconciliations
   WHERE family_id = p_family_id
     AND (source_id = ANY(alvo) OR target_id = ANY(alvo)
          OR source_type LIKE 'card_%' OR target_type LIKE 'card_%'
          OR source_type = 'purchase' OR target_type = 'purchase');
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('reconciliacoes', n);

  -- 4) Importacoes de fatura.
  DELETE FROM public.card_statement_items WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('lancamentos_fatura', n);
  DELETE FROM public.card_statement_imports WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('faturas_importadas', n);

  -- 5) Notas fiscais e importacoes de compra da familia.
  DELETE FROM public.purchase_import_items
   WHERE purchase_import_id IN (SELECT id FROM public.purchase_imports WHERE family_id = p_family_id);
  DELETE FROM public.purchase_imports WHERE family_id = p_family_id;
  DELETE FROM public.document_extraction_items
   WHERE extraction_id IN (SELECT id FROM public.document_extractions WHERE family_id = p_family_id);
  DELETE FROM public.document_extractions WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('extracoes', n);
  DELETE FROM public.documents WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('documentos', n);

  -- 6) Recorrencias ligadas a compras/cartoes.
  DELETE FROM public.recurring_expenses
   WHERE family_id = p_family_id
     AND (credit_card_id IS NOT NULL OR purchase_id = ANY(alvo));
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('recorrencias', n);

  -- 7) Parcelas e despesas derivadas.
  DELETE FROM public.expense_installments
   WHERE family_id = p_family_id
     AND (credit_card_id IS NOT NULL OR card_invoice_id IS NOT NULL OR purchase_id = ANY(alvo)
          OR expense_id IN (SELECT id FROM public.expenses WHERE family_id = p_family_id AND purchase_id = ANY(alvo)));
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('parcelas', n);
  DELETE FROM public.expense_installments
   WHERE expense_id IN (SELECT id FROM public.expenses WHERE family_id = p_family_id AND purchase_id = ANY(alvo));
  DELETE FROM public.expenses WHERE family_id = p_family_id AND purchase_id = ANY(alvo);

  -- 8) Itens e compras.
  DELETE FROM public.purchase_items WHERE purchase_id = ANY(alvo);
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('itens', n);
  DELETE FROM public.purchases WHERE id = ANY(alvo);
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('compras', n);

  -- 9) Faturas dos cartoes (historico), preservando o movimento bancario real.
  UPDATE public.transactions SET card_invoice_id = NULL
   WHERE family_id = p_family_id AND card_invoice_id IS NOT NULL;
  DELETE FROM public.expense_installments
   WHERE family_id = p_family_id AND card_invoice_id IS NOT NULL;
  DELETE FROM public.card_invoices WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('faturas', n);

  -- 10) Historico mensal (contem compras/cartoes).
  DELETE FROM public.monthly_closing_logs WHERE family_id = p_family_id;
  DELETE FROM public.monthly_snapshots WHERE family_id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('fechamentos', n);

  -- 11) Cartoes cadastrados: somente se pedido explicitamente.
  IF COALESCE(p_delete_cards, false) THEN
    UPDATE public.transactions SET credit_card_id = NULL
     WHERE family_id = p_family_id AND credit_card_id IS NOT NULL;
    DELETE FROM public.credit_cards WHERE family_id = p_family_id;
    GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('cartoes', n);
  ELSE
    t := t || jsonb_build_object('cartoes', 0);
  END IF;

  t := t || jsonb_build_object('transacoes_preservadas', preservadas);

  INSERT INTO public.family_reset_logs (family_id, family_nome, user_id, reset_type, backup_created, totais)
  VALUES (p_family_id, fam.nome_da_familia, auth.uid(), 'COMPRAS_CARTOES', COALESCE(p_backup_created, false), t);

  RETURN t;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_family_purchases_and_cards(uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_family_purchases_and_cards(uuid, boolean, boolean, boolean) TO authenticated;
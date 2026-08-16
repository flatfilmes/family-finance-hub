-- Helper interno: executa a purga completa para um conjunto de familias ja autorizadas.
CREATE OR REPLACE FUNCTION public.purge_demo_families(demo_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  removidas integer := 0;
BEGIN
  IF demo_ids IS NULL OR array_length(demo_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.reconciliation_audit WHERE family_id = ANY(demo_ids);
  DELETE FROM public.reconciliations WHERE family_id = ANY(demo_ids);
  DELETE FROM public.card_statement_items WHERE family_id = ANY(demo_ids);
  DELETE FROM public.card_statement_imports WHERE family_id = ANY(demo_ids);
  DELETE FROM public.monthly_closing_logs WHERE family_id = ANY(demo_ids);
  DELETE FROM public.monthly_snapshots WHERE family_id = ANY(demo_ids);
  DELETE FROM public.document_extraction_items
    WHERE extraction_id IN (SELECT id FROM public.document_extractions WHERE family_id = ANY(demo_ids));
  DELETE FROM public.document_extractions WHERE family_id = ANY(demo_ids);
  DELETE FROM public.purchase_import_items
    WHERE purchase_import_id IN (SELECT id FROM public.purchase_imports WHERE family_id = ANY(demo_ids));
  DELETE FROM public.purchase_imports WHERE family_id = ANY(demo_ids);
  DELETE FROM public.purchase_items
    WHERE purchase_id IN (SELECT id FROM public.purchases WHERE family_id = ANY(demo_ids));
  DELETE FROM public.recurring_expenses WHERE family_id = ANY(demo_ids);
  UPDATE public.purchases SET transaction_id = NULL WHERE family_id = ANY(demo_ids);
  DELETE FROM public.transactions WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expense_installments WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.documents WHERE family_id = ANY(demo_ids);
  DELETE FROM public.purchases WHERE family_id = ANY(demo_ids);
  DELETE FROM public.card_invoices WHERE family_id = ANY(demo_ids);
  DELETE FROM public.credit_cards WHERE family_id = ANY(demo_ids);
  DELETE FROM public.bank_accounts WHERE family_id = ANY(demo_ids);
  DELETE FROM public.budgets WHERE family_id = ANY(demo_ids);
  DELETE FROM public.fixed_expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.incomes WHERE family_id = ANY(demo_ids);
  DELETE FROM public.member_financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.demo_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.family_members WHERE family_id = ANY(demo_ids);
  DELETE FROM public.families WHERE id = ANY(demo_ids);
  GET DIAGNOSTICS removidas = ROW_COUNT;
  RETURN removidas;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_demo_families(uuid[]) FROM PUBLIC, anon, authenticated;

-- Rotina oficial: continua validando permissao e delega a purga ao helper.
CREATE OR REPLACE FUNCTION public.delete_demo_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  demo_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  SELECT array_agg(f.id) INTO demo_ids
  FROM public.families f
  WHERE f.is_demo = true
    AND public.is_family_admin(f.id, auth.uid());

  RETURN public.purge_demo_families(demo_ids);
END;
$function$;
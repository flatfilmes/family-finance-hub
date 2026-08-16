-- Auditoria tecnica de resets (sem conteudo financeiro).
CREATE TABLE IF NOT EXISTS public.family_reset_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  family_nome text,
  user_id uuid,
  reset_type text NOT NULL,
  backup_created boolean NOT NULL DEFAULT false,
  totais jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.family_reset_logs TO authenticated;
GRANT ALL ON public.family_reset_logs TO service_role;
ALTER TABLE public.family_reset_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins veem os resets da propria familia" ON public.family_reset_logs;
CREATE POLICY "Admins veem os resets da propria familia"
  ON public.family_reset_logs FOR SELECT TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

-- Utilitario interno unico de limpeza (sem checagem de permissao: quem chama valida).
CREATE OR REPLACE FUNCTION public.purge_family_records(_family_id uuid, _keep_structure boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t jsonb := '{}'::jsonb;
  n integer;
BEGIN
  IF _family_id IS NULL THEN RETURN t; END IF;

  DELETE FROM public.reconciliation_audit WHERE family_id = _family_id;
  DELETE FROM public.reconciliations WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('reconciliations', n);

  DELETE FROM public.card_statement_items WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('card_statement_items', n);
  DELETE FROM public.card_statement_imports WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('card_statement_imports', n);

  DELETE FROM public.monthly_closing_logs WHERE family_id = _family_id;
  DELETE FROM public.monthly_snapshots WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('monthly_snapshots', n);

  DELETE FROM public.document_extraction_items
    WHERE extraction_id IN (SELECT id FROM public.document_extractions WHERE family_id = _family_id);
  DELETE FROM public.document_extractions WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('document_extractions', n);
  DELETE FROM public.purchase_import_items
    WHERE purchase_import_id IN (SELECT id FROM public.purchase_imports WHERE family_id = _family_id);
  DELETE FROM public.purchase_imports WHERE family_id = _family_id;

  DELETE FROM public.purchase_items
    WHERE purchase_id IN (SELECT id FROM public.purchases WHERE family_id = _family_id);
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('purchase_items', n);

  DELETE FROM public.recurring_expenses WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('recurring_expenses', n);

  UPDATE public.purchases SET transaction_id = NULL WHERE family_id = _family_id;
  DELETE FROM public.transactions WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('transactions', n);

  DELETE FROM public.expense_installments WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('expense_installments', n);
  DELETE FROM public.expenses WHERE family_id = _family_id;
  DELETE FROM public.documents WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('documents', n);

  DELETE FROM public.purchases WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('purchases', n);

  DELETE FROM public.card_invoices WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('card_invoices', n);
  DELETE FROM public.credit_cards WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('credit_cards', n);
  DELETE FROM public.bank_accounts WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('bank_accounts', n);

  DELETE FROM public.budgets WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('budgets', n);
  DELETE FROM public.fixed_expenses WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('fixed_expenses', n);
  DELETE FROM public.incomes WHERE family_id = _family_id;
  GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('incomes', n);

  IF NOT _keep_structure THEN
    DELETE FROM public.member_financial_profiles WHERE family_id = _family_id;
    DELETE FROM public.financial_settings WHERE family_id = _family_id;
    DELETE FROM public.financial_profiles WHERE family_id = _family_id;
    DELETE FROM public.demo_settings WHERE family_id = _family_id;
    DELETE FROM public.family_members WHERE family_id = _family_id;
    GET DIAGNOSTICS n = ROW_COUNT; t := t || jsonb_build_object('family_members', n);
    DELETE FROM public.families WHERE id = _family_id;
    t := t || jsonb_build_object('families', 1);
  END IF;

  RETURN t;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_family_records(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Rotina demo continua separada, apenas reaproveitando o utilitario.
CREATE OR REPLACE FUNCTION public.purge_demo_families(demo_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fid uuid;
  removidas integer := 0;
BEGIN
  IF demo_ids IS NULL OR array_length(demo_ids, 1) IS NULL THEN RETURN 0; END IF;
  FOREACH fid IN ARRAY demo_ids LOOP
    PERFORM public.purge_family_records(fid, false);
    removidas := removidas + 1;
  END LOOP;
  RETURN removidas;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_demo_families(uuid[]) FROM PUBLIC, anon, authenticated;

-- Reset dos dados financeiros: mantem familia, membros, permissoes e perfis.
CREATE OR REPLACE FUNCTION public.reset_family_financial_data(
  _family_id uuid,
  _backup_created boolean DEFAULT false,
  _remover_demo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fam public.families%ROWTYPE;
  totais jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = _family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Familia nao encontrada'; END IF;
  IF NOT public.is_family_admin(_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Somente administradores da familia podem resetar os dados';
  END IF;

  totais := public.purge_family_records(_family_id, true);

  IF _remover_demo THEN
    UPDATE public.families SET is_demo = false WHERE id = _family_id;
    UPDATE public.demo_settings SET ativo = false WHERE family_id = _family_id;
  END IF;

  INSERT INTO public.family_reset_logs (family_id, family_nome, user_id, reset_type, backup_created, totais)
  VALUES (_family_id, fam.nome_da_familia, auth.uid(), 'FINANCEIRO', COALESCE(_backup_created, false), totais);

  RETURN totais;
END;
$function$;

-- Reset completo: remove tambem membros, perfis e a propria familia. Nao toca em usuarios/auth.
CREATE OR REPLACE FUNCTION public.reset_family_completely(
  _family_id uuid,
  _backup_created boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fam public.families%ROWTYPE;
  totais jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = _family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Familia nao encontrada'; END IF;
  IF NOT public.is_family_admin(_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Somente administradores da familia podem resetar os dados';
  END IF;

  totais := public.purge_family_records(_family_id, false);

  INSERT INTO public.family_reset_logs (family_id, family_nome, user_id, reset_type, backup_created, totais)
  VALUES (_family_id, fam.nome_da_familia, auth.uid(), 'FAMILIA_COMPLETA', COALESCE(_backup_created, false), totais);

  RETURN totais;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_family_financial_data(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_family_financial_data(uuid, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.reset_family_completely(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_family_completely(uuid, boolean) TO authenticated;
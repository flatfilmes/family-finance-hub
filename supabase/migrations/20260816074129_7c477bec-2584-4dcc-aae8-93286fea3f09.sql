ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'AJUSTE_SALDO';

CREATE OR REPLACE FUNCTION public.adjust_bank_account_balance(_account_id uuid, _novo_saldo numeric, _motivo text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  diff numeric;
  tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF _novo_saldo IS NULL THEN RAISE EXCEPTION 'Informe o novo saldo'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para ajustar esta conta';
  END IF;

  diff := _novo_saldo - COALESCE(acc.saldo_atual, 0);
  IF diff = 0 THEN RAISE EXCEPTION 'O novo saldo e igual ao saldo atual'; END IF;

  UPDATE public.bank_accounts SET saldo_atual = _novo_saldo WHERE id = _account_id;

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, created_by,
    tipo, descricao, valor, data_movimento, status
  ) VALUES (
    acc.family_id, acc.member_id, _account_id, auth.uid(),
    'AJUSTE_SALDO',
    'Ajuste de saldo' || CASE WHEN NULLIF(btrim(COALESCE(_motivo, '')), '') IS NOT NULL
      THEN ' — ' || btrim(_motivo) ELSE '' END,
    diff, CURRENT_DATE, 'CONFIRMADA'
  ) RETURNING id INTO tx_id;

  RETURN tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_bank_account(_account_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE acc public.bank_accounts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF NOT public.is_family_admin(acc.family_id, auth.uid())
     AND NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para alterar esta conta';
  END IF;
  UPDATE public.bank_accounts SET ativo = COALESCE(_ativo, false) WHERE id = _account_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_bank_account_if_unused(_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  usos integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF NOT public.is_family_admin(acc.family_id, auth.uid())
     AND NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para excluir esta conta';
  END IF;

  SELECT
    (SELECT count(*) FROM public.transactions WHERE bank_account_id = _account_id)
  + (SELECT count(*) FROM public.purchases WHERE bank_account_id = _account_id)
  + (SELECT count(*) FROM public.recurring_expenses WHERE bank_account_id = _account_id)
  INTO usos;

  IF usos > 0 THEN
    RAISE EXCEPTION 'Esta conta possui historico financeiro. Arquive a conta em vez de exclui-la.';
  END IF;

  DELETE FROM public.bank_accounts WHERE id = _account_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_credit_card(_card_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE card public.credit_cards%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO card FROM public.credit_cards WHERE id = _card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cartao nao encontrado'; END IF;
  IF NOT public.is_family_admin(card.family_id, auth.uid())
     AND NOT public.can_manage_member_record(card.family_id, card.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para alterar este cartao';
  END IF;
  UPDATE public.credit_cards SET ativo = COALESCE(_ativo, false) WHERE id = _card_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_credit_card_if_unused(_card_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  card public.credit_cards%ROWTYPE;
  usos integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO card FROM public.credit_cards WHERE id = _card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cartao nao encontrado'; END IF;
  IF NOT public.is_family_admin(card.family_id, auth.uid())
     AND NOT public.can_manage_member_record(card.family_id, card.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para excluir este cartao';
  END IF;

  SELECT
    (SELECT count(*) FROM public.purchases WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.expenses WHERE cartao_id = _card_id)
  + (SELECT count(*) FROM public.expense_installments WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.card_invoices WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.recurring_expenses WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.card_statement_imports WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.card_statement_items WHERE credit_card_id = _card_id)
  + (SELECT count(*) FROM public.transactions WHERE credit_card_id = _card_id)
  INTO usos;

  IF usos > 0 THEN
    RAISE EXCEPTION 'Este cartao possui historico financeiro. Arquive-o para preservar os dados.';
  END IF;

  DELETE FROM public.credit_cards WHERE id = _card_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_bank_account_balance(uuid, numeric, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.archive_bank_account(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.delete_bank_account_if_unused(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.archive_credit_card(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.delete_credit_card_if_unused(uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.adjust_bank_account_balance(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_bank_account(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bank_account_if_unused(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_credit_card(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_credit_card_if_unused(uuid) TO authenticated;
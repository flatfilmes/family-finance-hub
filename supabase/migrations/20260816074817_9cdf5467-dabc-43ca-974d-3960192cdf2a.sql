CREATE OR REPLACE FUNCTION public.set_bank_account_balance(
  _account_id uuid,
  _saldo numeric,
  _data date DEFAULT CURRENT_DATE,
  _motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  ja_tem boolean;
  diferenca numeric;
  v_tipo public.transaction_type;
  v_desc text;
  tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF _saldo IS NULL THEN RAISE EXCEPTION 'Informe o saldo da conta'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para movimentar esta conta';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transactions
     WHERE bank_account_id = _account_id
       AND tipo = 'ABERTURA_SALDO'
  ) INTO ja_tem;

  diferenca := _saldo - COALESCE(acc.saldo_atual, 0);

  IF ja_tem AND diferenca = 0 THEN
    RAISE EXCEPTION 'O saldo informado e igual ao saldo atual do sistema';
  END IF;

  IF ja_tem THEN
    v_tipo := 'AJUSTE_SALDO';
    v_desc := COALESCE(NULLIF(btrim(_motivo), ''), 'Ajuste de saldo da conta');
  ELSE
    v_tipo := 'ABERTURA_SALDO';
    v_desc := COALESCE(NULLIF(btrim(_motivo), ''), 'Saldo inicial informado pelo titular');
  END IF;

  UPDATE public.bank_accounts SET saldo_atual = _saldo WHERE id = _account_id;

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, created_by,
    tipo, descricao, valor, data_movimento, status
  ) VALUES (
    acc.family_id, acc.member_id, _account_id, auth.uid(),
    v_tipo, v_desc, diferenca, COALESCE(_data, CURRENT_DATE), 'CONFIRMADA'
  ) RETURNING id INTO tx_id;

  RETURN tx_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bank_account_balance(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bank_account_balance(uuid, numeric, date, text) TO authenticated;
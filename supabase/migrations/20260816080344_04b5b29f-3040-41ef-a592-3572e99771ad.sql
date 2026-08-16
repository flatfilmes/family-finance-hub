ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS natureza text,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS income_id uuid REFERENCES public.incomes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.register_bank_movement(
  _account_id uuid,
  _direcao text,
  _valor numeric,
  _data date DEFAULT CURRENT_DATE,
  _descricao text DEFAULT NULL,
  _natureza text DEFAULT 'OUTRO',
  _income_id uuid DEFAULT NULL,
  _observacao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  acc public.bank_accounts%ROWTYPE;
  v_tipo public.transaction_type;
  v_nat text;
  v_desc text;
  tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  IF _direcao NOT IN ('ENTRADA', 'SAIDA') THEN RAISE EXCEPTION 'Direcao invalida'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF NOT public.can_manage_member_record(acc.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para movimentar esta conta';
  END IF;

  v_nat := COALESCE(NULLIF(btrim(_natureza), ''), 'OUTRO');
  IF v_nat NOT IN ('DINHEIRO','RECEITA','TRANSFERENCIA_EXTERNA','ESTORNO','DESPESA','OUTRO') THEN
    RAISE EXCEPTION 'Natureza invalida';
  END IF;

  IF _income_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.incomes WHERE id = _income_id AND family_id = acc.family_id
  ) THEN
    RAISE EXCEPTION 'Receita vinculada nao pertence a esta familia';
  END IF;

  v_tipo := CASE WHEN _direcao = 'ENTRADA'
    THEN 'ENTRADA'::public.transaction_type
    ELSE 'SAIDA'::public.transaction_type END;

  v_desc := COALESCE(NULLIF(btrim(_descricao), ''),
    CASE WHEN _direcao = 'ENTRADA' THEN 'Deposito manual' ELSE 'Retirada manual' END);

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, created_by,
    tipo, descricao, valor, data_movimento, status,
    natureza, observacao, income_id, manual
  ) VALUES (
    acc.family_id, acc.member_id, _account_id, auth.uid(),
    v_tipo, v_desc, _valor, COALESCE(_data, CURRENT_DATE), 'CONFIRMADA',
    v_nat, NULLIF(btrim(_observacao), ''), _income_id, true
  ) RETURNING id INTO tx_id;

  UPDATE public.bank_accounts
     SET saldo_atual = COALESCE(saldo_atual, 0)
       + CASE WHEN _direcao = 'ENTRADA' THEN _valor ELSE -_valor END
   WHERE id = _account_id;

  RETURN tx_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_bank_transaction(
  _transaction_id uuid,
  _motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  orig public.transactions%ROWTYPE;
  perna public.transactions%ROWTYPE;
  acc public.bank_accounts%ROWTYPE;
  novo uuid;
  primeiro uuid;
  v_tipo public.transaction_type;
  v_delta numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO orig FROM public.transactions WHERE id = _transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimentacao nao encontrada'; END IF;
  IF orig.bank_account_id IS NULL THEN RAISE EXCEPTION 'Movimentacao sem conta bancaria'; END IF;
  IF NOT public.can_manage_member_record(orig.family_id, orig.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para estornar esta movimentacao';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE reversal_of = orig.id) THEN
    RAISE EXCEPTION 'Esta movimentacao ja foi estornada';
  END IF;
  IF orig.tipo IN ('PAGAMENTO_CARTAO') OR orig.purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'Estorne pela compra ou pela fatura de origem';
  END IF;

  FOR perna IN
    SELECT * FROM public.transactions
     WHERE (orig.transfer_group_id IS NOT NULL AND transfer_group_id = orig.transfer_group_id)
        OR (orig.transfer_group_id IS NULL AND id = orig.id)
  LOOP
    SELECT * INTO acc FROM public.bank_accounts WHERE id = perna.bank_account_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF perna.tipo = 'TRANSFERENCIA' THEN
      v_delta := CASE WHEN perna.transfer_role = 'SAIDA'
        THEN COALESCE(perna.valor, 0) ELSE -COALESCE(perna.valor, 0) END;
      v_tipo := 'TRANSFERENCIA'::public.transaction_type;
    ELSIF perna.tipo = 'ENTRADA' THEN
      v_delta := -COALESCE(perna.valor, 0);
      v_tipo := 'SAIDA'::public.transaction_type;
    ELSIF perna.tipo = 'SAIDA' THEN
      v_delta := COALESCE(perna.valor, 0);
      v_tipo := 'ENTRADA'::public.transaction_type;
    ELSE
      v_delta := -COALESCE(perna.valor, 0);
      v_tipo := 'AJUSTE_SALDO'::public.transaction_type;
    END IF;

    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status,
      natureza, observacao, manual, reversal_of,
      transfer_group_id, transfer_role
    ) VALUES (
      perna.family_id, perna.member_id, perna.bank_account_id, auth.uid(),
      v_tipo,
      'Estorno — ' || perna.descricao,
      CASE WHEN v_tipo = 'AJUSTE_SALDO' THEN v_delta ELSE abs(COALESCE(perna.valor, 0)) END,
      CURRENT_DATE, 'CONFIRMADA',
      'ESTORNO', NULLIF(btrim(_motivo), ''), true, perna.id,
      perna.transfer_group_id,
      CASE WHEN perna.transfer_role = 'SAIDA' THEN 'ENTRADA'
           WHEN perna.transfer_role = 'ENTRADA' THEN 'SAIDA' END
    ) RETURNING id INTO novo;

    UPDATE public.bank_accounts
       SET saldo_atual = COALESCE(saldo_atual, 0) + v_delta
     WHERE id = perna.bank_account_id;

    primeiro := COALESCE(primeiro, novo);
  END LOOP;

  RETURN primeiro;
END;
$$;

REVOKE ALL ON FUNCTION public.register_bank_movement(uuid, text, numeric, date, text, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_bank_movement(uuid, text, numeric, date, text, text, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_bank_transaction(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_bank_transaction(uuid, text) TO authenticated;
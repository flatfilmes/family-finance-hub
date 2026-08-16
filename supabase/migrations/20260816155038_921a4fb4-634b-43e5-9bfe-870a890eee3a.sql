create or replace function public.recalc_bank_account_balance(_account_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_saldo numeric;
begin
  select coalesce(sum(
    case
      when t.tipo = 'ENTRADA' then abs(t.valor)
      when t.tipo in ('SAIDA','PAGAMENTO_CARTAO') then -abs(t.valor)
      when t.tipo = 'TRANSFERENCIA' then case when t.transfer_role = 'ENTRADA' then abs(t.valor) else -abs(t.valor) end
      else t.valor
    end), 0)
    into v_saldo
  from public.transactions t
  where t.bank_account_id = _account_id and t.status <> 'CANCELADA';

  update public.bank_accounts set saldo_atual = round(v_saldo, 2) where id = _account_id;
  return round(v_saldo, 2);
end;
$$;
grant execute on function public.recalc_bank_account_balance(uuid) to authenticated, service_role;

create or replace function public.confirm_bank_statement_import(_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  imp public.bank_statement_imports%ROWTYPE;
  acc public.bank_accounts%ROWTYPE;
  it public.bank_statement_items%ROWTYPE;
  inv public.card_invoices%ROWTYPE;
  v_tipo public.transaction_type;
  v_delta numeric;
  v_desc text;
  v_data date;
  v_forma public.payment_method;
  v_ano integer;
  v_dm text;
  v_inicio date;
  tx uuid;
  novo_purchase uuid;
  grupo uuid;
  criadas integer := 0;
  associadas integer := 0;
  ignoradas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  SELECT * INTO imp FROM public.bank_statement_imports WHERE id = _import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importacao nao encontrada'; END IF;

  SELECT * INTO acc FROM public.bank_accounts WHERE id = imp.bank_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;

  IF NOT public.can_manage_member_record(imp.family_id, acc.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para movimentar esta conta';
  END IF;

  v_ano := EXTRACT(YEAR FROM COALESCE(imp.periodo_inicio, imp.periodo_fim, imp.created_at::date));

  SELECT COALESCE(
           imp.periodo_inicio,
           MIN(i.data_movimento),
           MIN(CASE WHEN i.descricao_original ~ '^\d{2}/\d{2}'
                    THEN to_date(substring(i.descricao_original from '^(\d{2}/\d{2})') || '/' || v_ano::text, 'DD/MM/YYYY')
               END),
           imp.periodo_fim,
           imp.created_at::date)
    INTO v_inicio
  FROM public.bank_statement_items i WHERE i.import_id = _import_id;

  IF imp.saldo_inicial IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.transactions t
        WHERE t.bank_account_id = imp.bank_account_id
          AND t.status <> 'CANCELADA'
          AND t.data_movimento < v_inicio
     ) THEN
    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status, observacao
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      'ABERTURA_SALDO', 'Saldo anterior informado no extrato',
      imp.saldo_inicial, v_inicio - 1, 'CONFIRMADA', 'Extrato importado'
    );
  END IF;

  FOR it IN
    SELECT * FROM public.bank_statement_items WHERE import_id = _import_id ORDER BY ordem
  LOOP
    IF it.processado OR it.transaction_id_criada IS NOT NULL OR it.purchase_id_criada IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_delta := COALESCE(it.valor, 0);
    v_dm := substring(it.descricao_original from '^(\d{2}/\d{2})');
    v_data := COALESCE(
      it.data_movimento,
      CASE WHEN v_dm IS NOT NULL THEN to_date(v_dm || '/' || v_ano::text, 'DD/MM/YYYY') END,
      v_inicio);
    v_desc := COALESCE(NULLIF(btrim(it.descricao_normalizada), ''), it.descricao_original);

    IF it.review_action IN ('IGNORE', 'ASSOCIATE_EXISTING') OR v_delta = 0 THEN
      UPDATE public.bank_statement_items SET processado = true, data_movimento = v_data WHERE id = it.id;
      IF it.review_action = 'ASSOCIATE_EXISTING' THEN
        associadas := associadas + 1;
      ELSE
        ignoradas := ignoradas + 1;
      END IF;
      CONTINUE;
    END IF;

    IF it.review_action = 'MATCH_CARD_PAYMENT' AND it.card_invoice_id_matched IS NOT NULL THEN
      SELECT * INTO inv FROM public.card_invoices WHERE id = it.card_invoice_id_matched;
      IF FOUND AND inv.status <> 'PAGA' THEN
        tx := public.pay_card_invoice(inv.id, imp.bank_account_id, v_data);
        UPDATE public.bank_statement_items
           SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
        criadas := criadas + 1;
      ELSE
        UPDATE public.bank_statement_items SET processado = true, data_movimento = v_data WHERE id = it.id;
        associadas := associadas + 1;
      END IF;
      CONTINUE;
    END IF;

    IF it.review_action = 'MATCH_TRANSFER' AND it.transfer_account_id IS NOT NULL THEN
      IF v_delta < 0 THEN
        grupo := public.transfer_between_accounts(
          imp.bank_account_id, it.transfer_account_id, abs(v_delta), v_data, it.descricao_original);
      ELSE
        grupo := public.transfer_between_accounts(
          it.transfer_account_id, imp.bank_account_id, abs(v_delta), v_data, it.descricao_original);
      END IF;
      UPDATE public.bank_statement_items
         SET transfer_group_id = grupo, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    IF v_delta < 0 AND it.descricao_original ~* '(pagto|pagamento).*(cart)' THEN
      INSERT INTO public.transactions (
        family_id, member_id, bank_account_id, created_by,
        tipo, descricao, valor, data_movimento, status
      ) VALUES (
        imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
        'PAGAMENTO_CARTAO', v_desc, abs(v_delta), v_data, 'CONFIRMADA'
      ) RETURNING id INTO tx;
      UPDATE public.bank_statement_items
         SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    IF it.review_action = 'CREATE_PURCHASE' AND v_delta < 0 THEN
      v_forma := CASE
        WHEN it.tipo_sugerido = 'TRANSFERENCIA' THEN 'TRANSFERENCIA'::public.payment_method
        WHEN it.descricao_original ~* '(boleto|fatura de |conta de |concession|energia|agua|água|celesc|saneamento|telefon|internet)'
          THEN 'BOLETO'::public.payment_method
        WHEN it.descricao_original ~* 'debito|débito' THEN 'DEBITO'::public.payment_method
        ELSE 'PIX'::public.payment_method
      END;
      INSERT INTO public.purchases (
        family_id, member_id, created_by, estabelecimento, data_compra, valor_total,
        forma_pagamento, bank_account_id, tipo_compra, data_pagamento_real, observacao
      ) VALUES (
        imp.family_id, acc.member_id, auth.uid(),
        COALESCE(NULLIF(btrim(it.descricao_original), ''), 'Compra do extrato'),
        v_data, abs(v_delta), v_forma, imp.bank_account_id, 'COMPRA_NORMAL', v_data,
        'Importado do extrato bancario'
      ) RETURNING id INTO novo_purchase;

      UPDATE public.bank_statement_items
         SET purchase_id_criada = novo_purchase, processado = true, data_movimento = v_data WHERE id = it.id;
      criadas := criadas + 1;
      CONTINUE;
    END IF;

    v_tipo := CASE
      WHEN it.review_action = 'REGISTER_FEE' THEN 'SAIDA'::public.transaction_type
      WHEN it.review_action = 'REGISTER_REFUND' THEN 'ENTRADA'::public.transaction_type
      WHEN it.review_action = 'MATCH_INCOME' THEN 'ENTRADA'::public.transaction_type
      WHEN v_delta >= 0 THEN 'ENTRADA'::public.transaction_type
      ELSE 'SAIDA'::public.transaction_type
    END;

    INSERT INTO public.transactions (
      family_id, member_id, bank_account_id, created_by,
      tipo, descricao, valor, data_movimento, status
    ) VALUES (
      imp.family_id, acc.member_id, imp.bank_account_id, auth.uid(),
      v_tipo, v_desc, abs(v_delta), v_data, 'CONFIRMADA'
    ) RETURNING id INTO tx;

    UPDATE public.bank_statement_items
       SET transaction_id_criada = tx, processado = true, data_movimento = v_data WHERE id = it.id;
    criadas := criadas + 1;
  END LOOP;

  UPDATE public.bank_statement_imports i
     SET status = 'CONFIRMED',
         confirmado_em = now(),
         periodo_inicio = COALESCE(i.periodo_inicio, (SELECT MIN(x.data_movimento) FROM public.bank_statement_items x WHERE x.import_id = _import_id)),
         periodo_fim = COALESCE(i.periodo_fim, (SELECT MAX(x.data_movimento) FROM public.bank_statement_items x WHERE x.import_id = _import_id))
   WHERE i.id = _import_id;

  PERFORM public.recalc_bank_account_balance(imp.bank_account_id);

  RETURN jsonb_build_object('criadas', criadas, 'associadas', associadas, 'ignoradas', ignoradas);
END;
$$;

do $$
declare
  v_acc uuid := '5c08421c-bb8d-42b4-8f90-ec9361584e59';
  v_imp uuid := '3acfb757-b295-48af-898d-1046c1721622';
  v_fam uuid;
  v_member uuid;
begin
  select family_id, member_id into v_fam, v_member from public.bank_accounts where id = v_acc;

  update public.transactions set data_movimento = '2026-08-03' where id in
    ('fe8162df-65b1-4ed7-8d51-3135bcf58b97','2340ed47-94fa-4f7f-8244-f28e8e62d877','b9be9bf6-68ad-4bf9-99a8-4cb069e433c1');
  update public.transactions set data_movimento = '2026-08-05' where id in
    ('0e8b01f5-28dd-4f73-92e4-ae1776512d57','06b4fe64-e4db-4002-b2d4-2bae1d305a75');
  update public.transactions set data_movimento = '2026-08-11' where id = '032711d4-5ebc-41e6-89e2-2beaf9f24349';
  update public.transactions set data_movimento = '2026-08-12', tipo = 'PAGAMENTO_CARTAO'
    where id = '265e39f4-287b-4aa8-8345-4740a2a5a8f8';

  update public.purchases p set data_compra = t.data_movimento, data_pagamento_real = t.data_movimento
    from public.transactions t where t.purchase_id = p.id and t.bank_account_id = v_acc;

  update public.purchases set forma_pagamento = 'BOLETO'
   where id in ('7abb3164-c8db-4ab5-9a63-d0a0e6145357','c3a54b55-14c4-4821-a66a-3badd6fc035c');

  update public.bank_statement_items set data_movimento = '2026-08-03' where import_id = v_imp and ordem in (0,1,2);
  update public.bank_statement_items set data_movimento = '2026-08-05' where import_id = v_imp and ordem in (3,4);
  update public.bank_statement_items set data_movimento = '2026-08-11' where import_id = v_imp and ordem = 5;
  update public.bank_statement_items set data_movimento = '2026-08-12' where import_id = v_imp and ordem = 6;

  update public.bank_statement_imports
     set periodo_inicio = '2026-08-03', periodo_fim = '2026-08-12'
   where id = v_imp;

  if not exists (select 1 from public.transactions
                  where bank_account_id = v_acc and tipo = 'ABERTURA_SALDO') then
    insert into public.transactions (
      family_id, member_id, bank_account_id, tipo, descricao, valor, data_movimento, status, observacao
    ) values (
      v_fam, v_member, v_acc, 'ABERTURA_SALDO', 'Saldo anterior informado no extrato',
      269.64, '2026-08-02', 'CONFIRMADA', 'Extrato Banco do Brasil importado'
    );
  end if;

  delete from public.bank_balance_checkpoints where bank_account_id = v_acc and import_id = v_imp;
  insert into public.bank_balance_checkpoints
    (family_id, bank_account_id, member_id, import_id, data, saldo_informado, origem, rotulo)
  values
    (v_fam, v_acc, v_member, v_imp, '2026-08-03', 5217.14, 'EXTRATO_IMPORTADO', 'Saldo do dia'),
    (v_fam, v_acc, v_member, v_imp, '2026-08-05', 4876.32, 'EXTRATO_IMPORTADO', 'Saldo do dia'),
    (v_fam, v_acc, v_member, v_imp, '2026-08-11', 4799.32, 'EXTRATO_IMPORTADO', 'Saldo do dia'),
    (v_fam, v_acc, v_member, v_imp, '2026-08-12', 4795.00, 'EXTRATO_IMPORTADO', 'Saldo final do extrato');

  perform public.recalc_bank_account_balance(v_acc);
end $$;
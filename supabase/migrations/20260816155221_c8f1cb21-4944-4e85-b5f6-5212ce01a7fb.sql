create or replace function public.purchase_payment_status_rule()
returns trigger
language plpgsql
set search_path = public
as $$
BEGIN
  NEW.status_pagamento := CASE
    WHEN NEW.forma_pagamento = 'A_DEFINIR' THEN 'PENDENTE_PAGAMENTO'::public.purchase_payment_status
    WHEN NEW.forma_pagamento = 'CREDITO' THEN 'COMPROMETIDO'::public.purchase_payment_status
    WHEN NEW.forma_pagamento = 'BOLETO' AND NEW.data_pagamento_real IS NULL THEN 'PENDENTE'::public.purchase_payment_status
    ELSE 'PAGO'::public.purchase_payment_status
  END;

  IF NEW.forma_pagamento <> 'CREDITO' THEN
    NEW.credit_card_id := NULL;
  END IF;

  IF NEW.forma_pagamento = 'A_DEFINIR' THEN
    NEW.bank_account_id := NULL;
    NEW.data_pagamento_real := NULL;
  END IF;

  RETURN NEW;
END;
$$;

create or replace function public.purchase_transaction_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_status public.transaction_status;
  v_desc text;
  v_tx uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.transactions WHERE purchase_id = OLD.id AND tipo <> 'PAGAMENTO_CARTAO';
    RETURN OLD;
  END IF;

  DELETE FROM public.transactions WHERE purchase_id = NEW.id AND tipo <> 'PAGAMENTO_CARTAO';

  IF NEW.status_pagamento = 'PENDENTE_PAGAMENTO' THEN
    UPDATE public.purchases SET transaction_id = NULL WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  v_status := CASE
    WHEN NEW.status_pagamento = 'PAGO' THEN 'CONFIRMADA'::public.transaction_status
    WHEN NEW.status_pagamento = 'CANCELADO' THEN 'CANCELADA'::public.transaction_status
    ELSE 'PENDENTE'::public.transaction_status
  END;
  v_desc := COALESCE(NULLIF(NEW.estabelecimento, ''), 'Compra');

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, credit_card_id, purchase_id, created_by,
    tipo, descricao, valor, data_movimento, status
  ) VALUES (
    NEW.family_id,
    NEW.member_id,
    CASE
      WHEN NEW.forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA','DINHEIRO') THEN NEW.bank_account_id
      WHEN NEW.forma_pagamento = 'BOLETO' AND NEW.data_pagamento_real IS NOT NULL THEN NEW.bank_account_id
      ELSE NULL
    END,
    NEW.credit_card_id,
    NEW.id,
    NEW.created_by,
    'SAIDA',
    v_desc,
    COALESCE(NEW.valor_total, 0),
    COALESCE(NEW.data_pagamento_real, NEW.data_compra),
    v_status
  ) RETURNING id INTO v_tx;

  UPDATE public.purchases SET transaction_id = v_tx WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

do $$
declare v_acc uuid := '5c08421c-bb8d-42b4-8f90-ec9361584e59';
begin
  update public.transactions set purchase_id = null
   where id = '265e39f4-287b-4aa8-8345-4740a2a5a8f8';

  update public.bank_statement_items
     set purchase_id_criada = null,
         transaction_id_criada = '265e39f4-287b-4aa8-8345-4740a2a5a8f8'
   where purchase_id_criada = '24ae5545-019d-4a9d-9297-a11d206812f0';

  update public.purchases set transaction_id = null where id = '24ae5545-019d-4a9d-9297-a11d206812f0';
  delete from public.transactions where purchase_id = '24ae5545-019d-4a9d-9297-a11d206812f0';
  delete from public.purchases where id = '24ae5545-019d-4a9d-9297-a11d206812f0';

  update public.purchases
     set data_pagamento_real = data_compra
   where id in ('7abb3164-c8db-4ab5-9a63-d0a0e6145357','c3a54b55-14c4-4821-a66a-3badd6fc035c');

  perform public.recalc_bank_account_balance(v_acc);
end $$;
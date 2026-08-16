-- Compra pendente: existe como registro, mas ainda não movimenta banco nem cartão.
CREATE OR REPLACE FUNCTION public.purchase_payment_status_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.status_pagamento := CASE
    WHEN NEW.forma_pagamento = 'A_DEFINIR' THEN 'PENDENTE_PAGAMENTO'::public.purchase_payment_status
    WHEN NEW.forma_pagamento = 'CREDITO' THEN 'COMPROMETIDO'::public.purchase_payment_status
    WHEN NEW.forma_pagamento = 'BOLETO' THEN 'PENDENTE'::public.purchase_payment_status
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
END; $function$;

-- Nenhuma movimentação é criada enquanto o pagamento não for registrado.
CREATE OR REPLACE FUNCTION public.purchase_transaction_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    CASE WHEN NEW.forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA') THEN NEW.bank_account_id ELSE NULL END,
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
END; $function$;
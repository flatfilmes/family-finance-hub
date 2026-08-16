CREATE OR REPLACE FUNCTION public.purchase_bank_balance_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_debit numeric := 0;
  new_debit numeric := 0;
BEGIN
  -- Apenas formas de pagamento que realmente saem da conta bancária.
  -- DINHEIRO é saída de caixa e nunca afeta o saldo bancário.
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.bank_account_id IS NOT NULL
     AND OLD.status_pagamento = 'PAGO'
     AND OLD.forma_pagamento IN ('PIX', 'DEBITO', 'TRANSFERENCIA') THEN
    old_debit := COALESCE(OLD.valor_total, 0);
    UPDATE public.bank_accounts
       SET saldo_atual = saldo_atual + old_debit
     WHERE id = OLD.bank_account_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.bank_account_id IS NOT NULL
     AND NEW.status_pagamento = 'PAGO'
     AND NEW.forma_pagamento IN ('PIX', 'DEBITO', 'TRANSFERENCIA') THEN
    new_debit := COALESCE(NEW.valor_total, 0);
    UPDATE public.bank_accounts
       SET saldo_atual = saldo_atual - new_debit
     WHERE id = NEW.bank_account_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $function$;
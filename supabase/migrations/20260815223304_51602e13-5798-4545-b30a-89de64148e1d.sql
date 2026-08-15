-- 1. Situação do pagamento da compra
DO $$ BEGIN
  CREATE TYPE public.purchase_payment_status AS ENUM ('PAGO', 'COMPROMETIDO', 'PENDENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Novos campos em purchases
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS tipo_compra public.purchase_type NOT NULL DEFAULT 'COMPRA_NORMAL',
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_pagamento public.purchase_payment_status NOT NULL DEFAULT 'PAGO';

CREATE INDEX IF NOT EXISTS purchases_bank_account_id_idx ON public.purchases(bank_account_id);
CREATE INDEX IF NOT EXISTS purchases_status_pagamento_idx ON public.purchases(status_pagamento);

-- 3. Regra financeira: define a situação do pagamento a partir da forma de pagamento
CREATE OR REPLACE FUNCTION public.purchase_payment_status_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status_pagamento := CASE
    WHEN NEW.forma_pagamento = 'CREDITO' THEN 'COMPROMETIDO'::public.purchase_payment_status
    WHEN NEW.forma_pagamento = 'BOLETO' THEN 'PENDENTE'::public.purchase_payment_status
    ELSE 'PAGO'::public.purchase_payment_status
  END;
  IF NEW.forma_pagamento <> 'CREDITO' THEN
    NEW.credit_card_id := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS purchases_payment_status ON public.purchases;
CREATE TRIGGER purchases_payment_status
  BEFORE INSERT OR UPDATE OF forma_pagamento ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_payment_status_rule();

-- 4. Saída de dinheiro na conta bancária quando o pagamento é à vista pela conta
CREATE OR REPLACE FUNCTION public.purchase_bank_balance_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_debit numeric := 0;
  new_debit numeric := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.bank_account_id IS NOT NULL
     AND OLD.status_pagamento = 'PAGO'
     AND OLD.forma_pagamento IN ('PIX', 'DEBITO', 'TRANSFERENCIA', 'DINHEIRO') THEN
    old_debit := COALESCE(OLD.valor_total, 0);
    UPDATE public.bank_accounts
       SET saldo_atual = saldo_atual + old_debit
     WHERE id = OLD.bank_account_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.bank_account_id IS NOT NULL
     AND NEW.status_pagamento = 'PAGO'
     AND NEW.forma_pagamento IN ('PIX', 'DEBITO', 'TRANSFERENCIA', 'DINHEIRO') THEN
    new_debit := COALESCE(NEW.valor_total, 0);
    UPDATE public.bank_accounts
       SET saldo_atual = saldo_atual - new_debit
     WHERE id = NEW.bank_account_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.purchase_bank_balance_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchases_bank_balance ON public.purchases;
CREATE TRIGGER purchases_bank_balance
  AFTER INSERT OR UPDATE OF valor_total, bank_account_id, forma_pagamento, status_pagamento
  OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_bank_balance_sync();
-- 1. Enums
DO $$ BEGIN
  CREATE TYPE public.transaction_type AS ENUM ('ENTRADA','SAIDA','TRANSFERENCIA','PAGAMENTO_CARTAO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('CONFIRMADA','PENDENTE','CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tabela de movimentações
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  card_invoice_id uuid REFERENCES public.card_invoices(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  tipo public.transaction_type NOT NULL,
  descricao text NOT NULL DEFAULT '',
  valor numeric NOT NULL DEFAULT 0,
  data_movimento date NOT NULL DEFAULT CURRENT_DATE,
  status public.transaction_status NOT NULL DEFAULT 'CONFIRMADA',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select" ON public.transactions;
CREATE POLICY "transactions_select" ON public.transactions
  FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));

DROP POLICY IF EXISTS "transactions_insert" ON public.transactions;
CREATE POLICY "transactions_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

DROP POLICY IF EXISTS "transactions_update" ON public.transactions;
CREATE POLICY "transactions_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

DROP POLICY IF EXISTS "transactions_delete" ON public.transactions;
CREATE POLICY "transactions_delete" ON public.transactions
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

DROP TRIGGER IF EXISTS transactions_updated_at ON public.transactions;
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS transactions_family_idx ON public.transactions(family_id, data_movimento DESC);
CREATE INDEX IF NOT EXISTS transactions_purchase_idx ON public.transactions(purchase_id);

-- 3. Compra -> movimentação
CREATE OR REPLACE FUNCTION public.purchase_transaction_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo public.transaction_type;
  v_status public.transaction_status;
  v_desc text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.transactions WHERE purchase_id = OLD.id AND tipo <> 'PAGAMENTO_CARTAO';
    RETURN OLD;
  END IF;

  v_tipo := 'SAIDA';
  v_status := CASE
    WHEN NEW.status_pagamento = 'PAGO' THEN 'CONFIRMADA'::public.transaction_status
    ELSE 'PENDENTE'::public.transaction_status
  END;
  v_desc := COALESCE(NULLIF(NEW.estabelecimento, ''), 'Compra');

  DELETE FROM public.transactions WHERE purchase_id = NEW.id AND tipo <> 'PAGAMENTO_CARTAO';

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, credit_card_id, purchase_id, created_by,
    tipo, descricao, valor, data_movimento, status
  ) VALUES (
    NEW.family_id,
    NEW.member_id,
    CASE WHEN NEW.forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA','DINHEIRO') THEN NEW.bank_account_id ELSE NULL END,
    NEW.credit_card_id,
    NEW.id,
    NEW.created_by,
    v_tipo,
    v_desc,
    COALESCE(NEW.valor_total, 0),
    NEW.data_compra,
    v_status
  );

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS purchase_transaction_sync ON public.purchases;
CREATE TRIGGER purchase_transaction_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_transaction_sync();

-- 4. Pagamento de fatura
CREATE OR REPLACE FUNCTION public.pay_card_invoice(_invoice_id uuid, _bank_account_id uuid, _data date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv public.card_invoices%ROWTYPE;
  card public.credit_cards%ROWTYPE;
  acc public.bank_accounts%ROWTYPE;
  tx_id uuid;
BEGIN
  SELECT * INTO inv FROM public.card_invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada'; END IF;

  SELECT * INTO card FROM public.credit_cards WHERE id = inv.credit_card_id;
  SELECT * INTO acc FROM public.bank_accounts WHERE id = _bank_account_id;
  IF NOT FOUND OR acc.family_id <> inv.family_id THEN
    RAISE EXCEPTION 'Conta bancária inválida para esta família';
  END IF;

  IF NOT public.can_manage_member_record(inv.family_id, card.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta fatura';
  END IF;

  IF inv.status = 'PAGA' THEN RAISE EXCEPTION 'Fatura já está paga'; END IF;

  UPDATE public.bank_accounts
     SET saldo_atual = saldo_atual - COALESCE(inv.valor_total, 0)
   WHERE id = _bank_account_id;

  UPDATE public.card_invoices SET status = 'PAGA' WHERE id = _invoice_id;
  UPDATE public.expense_installments SET status = 'PAGO' WHERE card_invoice_id = _invoice_id;

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, credit_card_id, card_invoice_id, created_by,
    tipo, descricao, valor, data_movimento, status
  ) VALUES (
    inv.family_id, card.member_id, _bank_account_id, inv.credit_card_id, inv.id, auth.uid(),
    'PAGAMENTO_CARTAO',
    'Pagamento da fatura ' || COALESCE(card.banco, '') || ' ' || COALESCE(card.nome_cartao, ''),
    COALESCE(inv.valor_total, 0), COALESCE(_data, CURRENT_DATE), 'CONFIRMADA'
  ) RETURNING id INTO tx_id;

  RETURN tx_id;
END; $$;

REVOKE ALL ON FUNCTION public.pay_card_invoice(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_card_invoice(uuid, uuid, date) TO authenticated;

-- 5. Backfill das compras existentes
INSERT INTO public.transactions (
  family_id, member_id, bank_account_id, credit_card_id, purchase_id, created_by,
  tipo, descricao, valor, data_movimento, status
)
SELECT p.family_id, p.member_id,
       CASE WHEN p.forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA','DINHEIRO') THEN p.bank_account_id ELSE NULL END,
       p.credit_card_id, p.id, p.created_by,
       'SAIDA',
       COALESCE(NULLIF(p.estabelecimento, ''), 'Compra'),
       COALESCE(p.valor_total, 0), p.data_compra,
       CASE WHEN p.status_pagamento = 'PAGO' THEN 'CONFIRMADA'::public.transaction_status ELSE 'PENDENTE'::public.transaction_status END
FROM public.purchases p
WHERE NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.purchase_id = p.id);

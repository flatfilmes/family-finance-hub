-- 1. Status extra e vínculo compra -> movimentação
ALTER TYPE public.purchase_payment_status ADD VALUE IF NOT EXISTS 'CANCELADO';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

-- 2. Trigger de sincronização passa a gravar o transaction_id na compra
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
  -- evita recursão quando a própria trigger atualiza a compra
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.transactions WHERE purchase_id = OLD.id AND tipo <> 'PAGAMENTO_CARTAO';
    RETURN OLD;
  END IF;

  v_status := CASE
    WHEN NEW.status_pagamento = 'PAGO' THEN 'CONFIRMADA'::public.transaction_status
    WHEN NEW.status_pagamento = 'CANCELADO' THEN 'CANCELADA'::public.transaction_status
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
    CASE WHEN NEW.forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA') THEN NEW.bank_account_id ELSE NULL END,
    NEW.credit_card_id,
    NEW.id,
    NEW.created_by,
    'SAIDA',
    v_desc,
    COALESCE(NEW.valor_total, 0),
    NEW.data_compra,
    v_status
  ) RETURNING id INTO v_tx;

  UPDATE public.purchases SET transaction_id = v_tx WHERE id = NEW.id;

  RETURN NEW;
END; $function$;

-- 3. Compras recorrentes
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE CASCADE,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  nome text NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  periodicidade public.expense_recurrence NOT NULL DEFAULT 'MENSAL',
  proxima_cobranca date NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expenses TO authenticated;
GRANT ALL ON public.recurring_expenses TO service_role;

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_expenses_select" ON public.recurring_expenses
  FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "recurring_expenses_insert" ON public.recurring_expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "recurring_expenses_update" ON public.recurring_expenses
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "recurring_expenses_delete" ON public.recurring_expenses
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Limpeza do modo demonstração inclui as recorrências
CREATE OR REPLACE FUNCTION public.delete_demo_data()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  demo_ids uuid[];
  removidas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  SELECT array_agg(f.id) INTO demo_ids
  FROM public.families f
  WHERE f.is_demo = true
    AND public.is_family_admin(f.id, auth.uid());

  IF demo_ids IS NULL OR array_length(demo_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.purchase_items WHERE purchase_id IN (SELECT id FROM public.purchases WHERE family_id = ANY(demo_ids));
  DELETE FROM public.recurring_expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.transactions WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expense_installments WHERE family_id = ANY(demo_ids);
  DELETE FROM public.expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.purchases WHERE family_id = ANY(demo_ids);
  DELETE FROM public.card_invoices WHERE family_id = ANY(demo_ids);
  DELETE FROM public.credit_cards WHERE family_id = ANY(demo_ids);
  DELETE FROM public.bank_accounts WHERE family_id = ANY(demo_ids);
  DELETE FROM public.budgets WHERE family_id = ANY(demo_ids);
  DELETE FROM public.fixed_expenses WHERE family_id = ANY(demo_ids);
  DELETE FROM public.incomes WHERE family_id = ANY(demo_ids);
  DELETE FROM public.member_financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.financial_profiles WHERE family_id = ANY(demo_ids);
  DELETE FROM public.demo_settings WHERE family_id = ANY(demo_ids);
  DELETE FROM public.family_members WHERE family_id = ANY(demo_ids);
  DELETE FROM public.families WHERE id = ANY(demo_ids);

  GET DIAGNOSTICS removidas = ROW_COUNT;
  RETURN removidas;
END;
$function$;
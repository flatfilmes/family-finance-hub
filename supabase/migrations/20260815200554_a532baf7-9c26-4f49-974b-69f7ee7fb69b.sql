CREATE TYPE public.invoice_status AS ENUM ('ABERTA', 'FECHADA', 'PAGA');
CREATE TYPE public.installment_status AS ENUM ('PENDENTE', 'PAGO');

CREATE TABLE public.card_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  data_inicio_ciclo date NOT NULL,
  data_fechamento date NOT NULL,
  data_vencimento date NOT NULL,
  valor_total numeric NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'ABERTA',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_card_id, data_fechamento)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_invoices TO authenticated;
GRANT ALL ON public.card_invoices TO service_role;
ALTER TABLE public.card_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_invoices_select ON public.card_invoices FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY card_invoices_insert_admin ON public.card_invoices FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY card_invoices_update_admin ON public.card_invoices FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY card_invoices_delete_admin ON public.card_invoices FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER card_invoices_updated_at BEFORE UPDATE ON public.card_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.expense_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  card_invoice_id uuid REFERENCES public.card_invoices(id) ON DELETE SET NULL,
  numero_parcela integer NOT NULL DEFAULT 1,
  total_parcelas integer NOT NULL DEFAULT 1,
  valor_parcela numeric NOT NULL DEFAULT 0,
  data_vencimento date NOT NULL,
  status public.installment_status NOT NULL DEFAULT 'PENDENTE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_id, numero_parcela)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_installments TO authenticated;
GRANT ALL ON public.expense_installments TO service_role;
ALTER TABLE public.expense_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_installments_select ON public.expense_installments FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY expense_installments_insert_admin ON public.expense_installments FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY expense_installments_update_admin ON public.expense_installments FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY expense_installments_delete_admin ON public.expense_installments FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER expense_installments_updated_at BEFORE UPDATE ON public.expense_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_card_invoices_family ON public.card_invoices(family_id, credit_card_id, data_vencimento);
CREATE INDEX idx_expense_installments_family ON public.expense_installments(family_id, data_vencimento);

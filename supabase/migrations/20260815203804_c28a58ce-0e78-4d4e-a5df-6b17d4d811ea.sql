CREATE TYPE public.bank_account_type AS ENUM ('CORRENTE','POUPANCA','PAGAMENTO','INVESTIMENTO');

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  banco text NOT NULL,
  nome_conta text NOT NULL,
  tipo_conta public.bank_account_type NOT NULL DEFAULT 'CORRENTE',
  saldo_atual numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_accounts_family_idx ON public.bank_accounts(family_id);
CREATE INDEX bank_accounts_member_idx ON public.bank_accounts(member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_accounts_select" ON public.bank_accounts FOR SELECT TO authenticated
USING (public.can_view_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "bank_accounts_insert" ON public.bank_accounts FOR INSERT TO authenticated
WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "bank_accounts_update" ON public.bank_accounts FOR UPDATE TO authenticated
USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "bank_accounts_delete" ON public.bank_accounts FOR DELETE TO authenticated
USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
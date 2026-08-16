CREATE TABLE public.bank_balance_checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  data date NOT NULL,
  saldo_informado numeric NOT NULL,
  origem text NOT NULL DEFAULT 'EXTRATO_IMPORTADO',
  rotulo text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bank_balance_checkpoints_unico
  ON public.bank_balance_checkpoints (bank_account_id, data, COALESCE(import_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX bank_balance_checkpoints_conta_idx
  ON public.bank_balance_checkpoints (bank_account_id, data);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_balance_checkpoints TO authenticated;
GRANT ALL ON public.bank_balance_checkpoints TO service_role;

ALTER TABLE public.bank_balance_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver checkpoints de saldo da familia" ON public.bank_balance_checkpoints
  FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "Criar checkpoints de saldo da familia" ON public.bank_balance_checkpoints
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "Atualizar checkpoints de saldo da familia" ON public.bank_balance_checkpoints
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "Excluir checkpoints de saldo da familia" ON public.bank_balance_checkpoints
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));
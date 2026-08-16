CREATE TABLE public.monthly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  ano integer NOT NULL,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  renda_fixa numeric NOT NULL DEFAULT 0,
  renda_variavel_prevista numeric NOT NULL DEFAULT 0,
  renda_variavel_recebida numeric NOT NULL DEFAULT 0,
  receita_total_real numeric NOT NULL DEFAULT 0,
  saldo_bancario_final numeric NOT NULL DEFAULT 0,
  gastos_realizados numeric NOT NULL DEFAULT 0,
  compras_pix_debito_dinheiro numeric NOT NULL DEFAULT 0,
  compras_cartao numeric NOT NULL DEFAULT 0,
  parcelas_do_mes numeric NOT NULL DEFAULT 0,
  recorrencias_do_mes numeric NOT NULL DEFAULT 0,
  contas_recorrentes_do_mes numeric NOT NULL DEFAULT 0,
  faturas_em_aberto numeric NOT NULL DEFAULT 0,
  faturas_pagas numeric NOT NULL DEFAULT 0,
  comprometido_final numeric NOT NULL DEFAULT 0,
  reserva_final numeric NOT NULL DEFAULT 0,
  dinheiro_livre_final numeric NOT NULL DEFAULT 0,
  status_saude_financeira text NOT NULL DEFAULT 'VERDE',
  fechado boolean NOT NULL DEFAULT true,
  fechado_em timestamp with time zone NOT NULL DEFAULT now(),
  fechado_por uuid,
  reaberto_em timestamp with time zone,
  reaberto_por uuid,
  motivo_reabertura text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX monthly_snapshots_familia_unica
  ON public.monthly_snapshots (family_id, ano, mes)
  WHERE member_id IS NULL;

CREATE UNIQUE INDEX monthly_snapshots_membro_unico
  ON public.monthly_snapshots (family_id, member_id, ano, mes)
  WHERE member_id IS NOT NULL;

CREATE INDEX monthly_snapshots_competencia ON public.monthly_snapshots (family_id, ano DESC, mes DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_snapshots TO authenticated;
GRANT ALL ON public.monthly_snapshots TO service_role;

ALTER TABLE public.monthly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem o historico permitido"
  ON public.monthly_snapshots FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));

CREATE POLICY "Admins fecham o mes"
  ON public.monthly_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));

CREATE POLICY "Admins atualizam o fechamento"
  ON public.monthly_snapshots FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));

CREATE POLICY "Admins removem o fechamento"
  ON public.monthly_snapshots FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER monthly_snapshots_updated_at
  BEFORE UPDATE ON public.monthly_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.monthly_closing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES public.monthly_snapshots(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  ano integer NOT NULL,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  acao text NOT NULL CHECK (acao IN ('FECHAR_MES', 'REABRIR_MES')),
  motivo text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX monthly_closing_logs_familia ON public.monthly_closing_logs (family_id, created_at DESC);

GRANT SELECT, INSERT ON public.monthly_closing_logs TO authenticated;
GRANT ALL ON public.monthly_closing_logs TO service_role;

ALTER TABLE public.monthly_closing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem a auditoria da familia"
  ON public.monthly_closing_logs FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));

CREATE POLICY "Admins registram auditoria de fechamento"
  ON public.monthly_closing_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
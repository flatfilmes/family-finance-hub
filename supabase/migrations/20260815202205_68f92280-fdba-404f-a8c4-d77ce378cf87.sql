-- 1. Tipo de perfil do membro
DO $$ BEGIN
  CREATE TYPE public.member_profile_type AS ENUM ('ADMIN_FAMILIAR','MEMBRO','DEPENDENTE','VISUALIZADOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tabela de perfis financeiros individuais
CREATE TABLE IF NOT EXISTS public.member_financial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  tipo_perfil public.member_profile_type NOT NULL DEFAULT 'MEMBRO',
  pode_lancar_despesas boolean NOT NULL DEFAULT true,
  pode_ver_proprios_dados boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_member_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_financial_profiles TO authenticated;
GRANT ALL ON public.member_financial_profiles TO service_role;

ALTER TABLE public.member_financial_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mfp_select" ON public.member_financial_profiles
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "mfp_insert_admin" ON public.member_financial_profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "mfp_update_admin" ON public.member_financial_profiles
  FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "mfp_delete_admin" ON public.member_financial_profiles
  FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));

DROP TRIGGER IF EXISTS member_financial_profiles_updated_at ON public.member_financial_profiles;
CREATE TRIGGER member_financial_profiles_updated_at BEFORE UPDATE ON public.member_financial_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_mfp_family ON public.member_financial_profiles(family_id);

-- 3. Backfill dos membros existentes
INSERT INTO public.member_financial_profiles (family_member_id, family_id, tipo_perfil, pode_lancar_despesas, pode_ver_proprios_dados)
SELECT fm.id, fm.family_id,
  CASE fm.permissao WHEN 'ADMIN' THEN 'ADMIN_FAMILIAR' WHEN 'MEMBER' THEN 'MEMBRO' ELSE 'VISUALIZADOR' END::public.member_profile_type,
  fm.permissao <> 'VIEWER',
  true
FROM public.family_members fm
ON CONFLICT (family_member_id) DO NOTHING;

-- 4. Vínculo de responsável nas tabelas financeiras (nullable, dados preservados)
ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;
ALTER TABLE public.credit_cards ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;
ALTER TABLE public.fixed_expenses ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incomes_member ON public.incomes(member_id);
CREATE INDEX IF NOT EXISTS idx_expenses_member ON public.expenses(member_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_member ON public.credit_cards(member_id);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_member ON public.fixed_expenses(member_id);

-- 5. Helpers de acesso individual
CREATE OR REPLACE FUNCTION public.is_own_family_member(_member_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.family_members WHERE id = _member_id AND user_id = _user_id);
$$;

-- pode ver: admin vê tudo; demais veem registros sem responsável ou vinculados a si
CREATE OR REPLACE FUNCTION public.can_view_member_record(_family_id uuid, _member_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_family_admin(_family_id, _user_id)
     OR (public.is_family_member(_family_id, _user_id)
         AND (_member_id IS NULL OR public.is_own_family_member(_member_id, _user_id)));
$$;

-- pode gerenciar: admin, ou membro com permissão de lançamento sobre registro próprio
CREATE OR REPLACE FUNCTION public.can_manage_member_record(_family_id uuid, _member_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_family_admin(_family_id, _user_id)
     OR EXISTS (
       SELECT 1 FROM public.family_members fm
       LEFT JOIN public.member_financial_profiles p ON p.family_member_id = fm.id
       WHERE fm.id = _member_id
         AND fm.user_id = _user_id
         AND fm.family_id = _family_id
         AND fm.permissao <> 'VIEWER'
         AND COALESCE(p.pode_lancar_despesas, true)
     );
$$;

-- 6. Políticas atualizadas nas tabelas financeiras
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incomes','expenses','credit_cards','fixed_expenses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_admin', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_admin', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_admin', t);

    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.can_view_member_record(family_id, member_id, auth.uid()))$f$, t || '_select', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()))$f$, t || '_insert', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
      WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()))$f$, t || '_update', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (public.can_manage_member_record(family_id, member_id, auth.uid()))$f$, t || '_delete', t);
  END LOOP;
END $$;
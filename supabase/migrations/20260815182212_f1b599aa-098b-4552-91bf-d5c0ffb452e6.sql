
-- Enums
CREATE TYPE public.family_permission AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE public.financial_goal AS ENUM ('organizar_financas', 'sair_de_dividas', 'economizar', 'comprar_bem', 'investir');

-- Shared updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telefone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome_completo, email, telefone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'nome_completo', NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.email, ''),
    NEW.raw_user_meta_data ->> 'telefone'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- FAMILIES
CREATE TABLE public.families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_da_familia TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.families TO authenticated;
GRANT ALL ON public.families TO service_role;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER families_updated_at BEFORE UPDATE ON public.families FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FAMILY MEMBERS
CREATE TABLE public.family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  relacionamento TEXT,
  permissao public.family_permission NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);
CREATE INDEX family_members_family_id_idx ON public.family_members(family_id);
CREATE INDEX family_members_user_id_idx ON public.family_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER family_members_updated_at BEFORE UPDATE ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Security definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_family_member(_family_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members WHERE family_id = _family_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.families WHERE id = _family_id AND owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_family_admin(_family_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = _family_id AND user_id = _user_id AND permissao = 'ADMIN'
  ) OR EXISTS (
    SELECT 1 FROM public.families WHERE id = _family_id AND owner_id = _user_id
  );
$$;

-- Families policies
CREATE POLICY "families_select_members" ON public.families FOR SELECT TO authenticated
  USING (public.is_family_member(id, auth.uid()));
CREATE POLICY "families_insert_owner" ON public.families FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "families_update_admin" ON public.families FOR UPDATE TO authenticated
  USING (public.is_family_admin(id, auth.uid())) WITH CHECK (public.is_family_admin(id, auth.uid()));
CREATE POLICY "families_delete_owner" ON public.families FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Family members policies
CREATE POLICY "family_members_select" ON public.family_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_family_member(family_id, auth.uid()));
CREATE POLICY "family_members_insert_admin" ON public.family_members FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "family_members_update_admin" ON public.family_members FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "family_members_delete_admin" ON public.family_members FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

-- FINANCIAL PROFILES
CREATE TABLE public.financial_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL UNIQUE REFERENCES public.families(id) ON DELETE CASCADE,
  quantidade_dependentes INTEGER NOT NULL DEFAULT 0,
  objetivo_principal public.financial_goal,
  renda_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
  possui_renda_variavel BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_profiles TO authenticated;
GRANT ALL ON public.financial_profiles TO service_role;
ALTER TABLE public.financial_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER financial_profiles_updated_at BEFORE UPDATE ON public.financial_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "financial_profiles_select" ON public.financial_profiles FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "financial_profiles_insert_admin" ON public.financial_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "financial_profiles_update_admin" ON public.financial_profiles FOR UPDATE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid())) WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY "financial_profiles_delete_admin" ON public.financial_profiles FOR DELETE TO authenticated
  USING (public.is_family_admin(family_id, auth.uid()));

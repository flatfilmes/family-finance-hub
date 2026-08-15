CREATE TABLE public.financial_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  percentual_reserva numeric NOT NULL DEFAULT 10,
  limite_alerta_cartao numeric NOT NULL DEFAULT 70,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_settings TO authenticated;
GRANT ALL ON public.financial_settings TO service_role;

ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_settings_select ON public.financial_settings
  FOR SELECT TO authenticated USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY financial_settings_insert_admin ON public.financial_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY financial_settings_update_admin ON public.financial_settings
  FOR UPDATE TO authenticated USING (public.is_family_admin(family_id, auth.uid()))
  WITH CHECK (public.is_family_admin(family_id, auth.uid()));
CREATE POLICY financial_settings_delete_admin ON public.financial_settings
  FOR DELETE TO authenticated USING (public.is_family_admin(family_id, auth.uid()));

CREATE TRIGGER financial_settings_updated_at BEFORE UPDATE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
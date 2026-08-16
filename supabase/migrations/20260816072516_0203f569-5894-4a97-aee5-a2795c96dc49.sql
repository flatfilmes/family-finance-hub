CREATE OR REPLACE FUNCTION public.create_family_with_owner(
  p_family_name text,
  p_first_member_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_nome text := NULLIF(btrim(COALESCE(p_family_name, '')), '');
  v_membro text := NULLIF(btrim(COALESCE(p_first_member_name, '')), '');
  v_family_id uuid;
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da familia';
  END IF;

  IF v_membro IS NULL THEN
    SELECT NULLIF(btrim(nome_completo), '') INTO v_membro FROM public.profiles WHERE id = v_user_id;
    v_membro := COALESCE(v_membro, 'Responsavel');
  END IF;

  INSERT INTO public.families (nome_da_familia, owner_id, is_demo)
  VALUES (v_nome, v_user_id, false)
  RETURNING id INTO v_family_id;

  INSERT INTO public.family_members (family_id, user_id, nome, relacionamento, permissao)
  VALUES (v_family_id, v_user_id, v_membro, 'Responsável', 'ADMIN')
  RETURNING id INTO v_member_id;

  INSERT INTO public.member_financial_profiles (
    family_member_id, family_id, tipo_perfil, pode_lancar_despesas, pode_ver_proprios_dados
  ) VALUES (v_member_id, v_family_id, 'ADMIN_FAMILIAR', true, true);

  RETURN jsonb_build_object(
    'family_id', v_family_id,
    'member_id', v_member_id,
    'family_name', v_nome,
    'member_name', v_membro
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_family_with_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_family_with_owner(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_family_with_owner(text, text) TO authenticated;

-- Criacao direta pelo app deixa de ser permitida: o bootstrap passa somente pela RPC.
DROP POLICY IF EXISTS families_insert_owner ON public.families;
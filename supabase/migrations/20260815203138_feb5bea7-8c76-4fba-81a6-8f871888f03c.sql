GRANT EXECUTE ON FUNCTION public.is_family_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_family_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_own_family_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_member_record(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_member_record(uuid, uuid, uuid) TO authenticated;
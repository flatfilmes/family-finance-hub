CREATE POLICY "evidencias visiveis para a familia" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'evidencias-financeiras'
    AND public.is_family_member(((storage.foldername(name))[1])::uuid, auth.uid()));

CREATE POLICY "evidencias enviadas pela familia" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidencias-financeiras'
    AND public.is_family_member(((storage.foldername(name))[1])::uuid, auth.uid()));

CREATE POLICY "evidencias atualizadas pela familia" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'evidencias-financeiras'
    AND public.is_family_member(((storage.foldername(name))[1])::uuid, auth.uid()))
  WITH CHECK (bucket_id = 'evidencias-financeiras'
    AND public.is_family_member(((storage.foldername(name))[1])::uuid, auth.uid()));

CREATE POLICY "evidencias removidas por admin da familia" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidencias-financeiras'
    AND public.is_family_admin(((storage.foldername(name))[1])::uuid, auth.uid()));
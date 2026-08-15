CREATE POLICY "Familia ve seus documentos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
);

CREATE POLICY "Familia envia documentos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
);

CREATE POLICY "Familia atualiza documentos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
)
WITH CHECK (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
);

CREATE POLICY "Familia remove documentos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
);
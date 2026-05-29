
CREATE POLICY "workspace-assets read" ON storage.objects FOR SELECT USING (bucket_id = 'workspace-assets');
CREATE POLICY "workspace-assets insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'workspace-assets');
CREATE POLICY "workspace-assets update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'workspace-assets');
CREATE POLICY "workspace-assets delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'workspace-assets');

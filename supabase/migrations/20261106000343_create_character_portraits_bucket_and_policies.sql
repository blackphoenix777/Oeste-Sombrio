INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'character-portraits',
  'character-portraits',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "character_portraits_select_public"
ON storage.objects FOR SELECT
USING (bucket_id = 'character-portraits');

CREATE POLICY "character_portraits_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'character-portraits'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

CREATE POLICY "character_portraits_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'character-portraits'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
)
WITH CHECK (
  bucket_id = 'character-portraits'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

CREATE POLICY "character_portraits_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'character-portraits'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);
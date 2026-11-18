-- Novo bucket de mapas (40 MB, público, mesmo padrão de character-portraits)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mesa-maps', 'mesa-maps', true, 41943040, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies em storage.objects para mesa-maps
CREATE POLICY "mesa_maps_select_public" ON storage.objects FOR SELECT USING (
  bucket_id = 'mesa-maps'
);

CREATE POLICY "mesa_maps_insert_mestre" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'mesa-maps'
  AND CASE
    WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_mestre_da_mesa(((storage.foldername(name))[1])::uuid)
    ELSE false
  END
);

CREATE POLICY "mesa_maps_update_mestre" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'mesa-maps'
  AND CASE
    WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_mestre_da_mesa(((storage.foldername(name))[1])::uuid)
    ELSE false
  END
) WITH CHECK (
  bucket_id = 'mesa-maps'
  AND CASE
    WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_mestre_da_mesa(((storage.foldername(name))[1])::uuid)
    ELSE false
  END
);

CREATE POLICY "mesa_maps_delete_mestre" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'mesa-maps'
  AND CASE
    WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_mestre_da_mesa(((storage.foldername(name))[1])::uuid)
    ELSE false
  END
);

-- Novas colunas em public.mesas
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS mapa_url text;
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS npcs_mesa JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS grid_cols INTEGER DEFAULT 24;
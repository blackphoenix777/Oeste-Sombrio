CREATE TABLE IF NOT EXISTS public.mesa_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mesa_id UUID NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
    owner_type VARCHAR(10) NOT NULL CHECK (owner_type IN ('player', 'creature')),
    owner_ref UUID NOT NULL,
    owner_user_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
    display_name VARCHAR(100) NOT NULL,
    image_url TEXT,
    grid_x INTEGER NOT NULL DEFAULT 0,
    grid_y INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mesa_id, owner_type, owner_ref)
);

CREATE INDEX IF NOT EXISTS idx_mesa_tokens_owner_user_id ON public.mesa_tokens (owner_user_id);

ALTER TABLE public.mesa_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mesa_tokens TO authenticated;

CREATE POLICY "mesa_tokens_select_members_or_mestre" ON public.mesa_tokens
  FOR SELECT TO authenticated
  USING (
    public.is_mestre_da_mesa(mesa_id)
    OR mesa_id IN (
      SELECT membros_mesa.mesa_id
      FROM public.membros_mesa
      WHERE membros_mesa.usuario_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "mesa_tokens_insert_mestre_only" ON public.mesa_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_mestre_da_mesa(mesa_id)
  );

CREATE POLICY "mesa_tokens_delete_mestre_only" ON public.mesa_tokens
  FOR DELETE TO authenticated
  USING (
    public.is_mestre_da_mesa(mesa_id)
  );

CREATE POLICY "mesa_tokens_update_mestre_or_owner" ON public.mesa_tokens
  FOR UPDATE TO authenticated
  USING (
    public.is_mestre_da_mesa(mesa_id)
    OR (owner_type = 'player' AND owner_user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_mestre_da_mesa(mesa_id)
    OR (owner_type = 'player' AND owner_user_id = (SELECT auth.uid()))
  );

-- Isolamento: somente policies de membros_mesa, eventos_mesa e fichas.
DROP POLICY IF EXISTS membros_insert_self ON public.membros_mesa;
CREATE POLICY membros_insert_mestre_self ON public.membros_mesa
FOR INSERT TO authenticated
WITH CHECK (
 usuario_id = (SELECT auth.uid())
 AND cargo = 'mestre'
 AND public.is_mestre_da_mesa(mesa_id)
);

CREATE OR REPLACE FUNCTION public.entrar_na_mesa_por_codigo(p_codigo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_mesa_id uuid;
BEGIN
 IF v_uid IS NULL THEN
  RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '28000';
 END IF;
 IF p_codigo IS NULL OR btrim(p_codigo) = '' THEN
  RAISE EXCEPTION 'Código de convite inválido' USING ERRCODE = '22023';
 END IF;
 SELECT id INTO v_mesa_id FROM public.mesas
 WHERE codigo_convite = upper(btrim(p_codigo));
 IF v_mesa_id IS NULL THEN
  RAISE EXCEPTION 'Código de convite inválido' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.membros_mesa (mesa_id, usuario_id, cargo)
 VALUES (v_mesa_id, v_uid, 'jogador')
 ON CONFLICT (mesa_id, usuario_id) DO NOTHING;
 RETURN v_mesa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.entrar_na_mesa_por_codigo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entrar_na_mesa_por_codigo(text) TO authenticated;

DROP POLICY IF EXISTS eventos_select_visiveis ON public.eventos_mesa;
CREATE POLICY eventos_select_visiveis ON public.eventos_mesa
FOR SELECT TO authenticated USING (
 (visivel_para = 'todos' AND (
   public.is_mestre_da_mesa(mesa_id)
   OR mesa_id IN (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id = (SELECT auth.uid()))
 ))
 OR usuario_id = (SELECT auth.uid())
 OR public.is_mestre_da_mesa(mesa_id)
);

DROP POLICY IF EXISTS "Jogadores leem suas fichas" ON public.fichas;
CREATE POLICY "Jogadores leem suas fichas" ON public.fichas
FOR SELECT TO authenticated USING (
 usuario_id = (SELECT auth.uid())
 OR (mesa_id IS NOT NULL AND public.is_mestre_da_mesa(mesa_id))
);
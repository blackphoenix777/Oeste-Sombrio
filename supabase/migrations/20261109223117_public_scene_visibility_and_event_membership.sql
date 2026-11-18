ALTER TABLE public.mesa_tokens ADD COLUMN visible_to_players boolean NOT NULL DEFAULT false;
DROP POLICY eventos_insert_own ON public.eventos_mesa;
CREATE POLICY eventos_insert_own ON public.eventos_mesa FOR INSERT TO authenticated WITH CHECK (
 usuario_id=(SELECT auth.uid()) AND (public.is_mestre_da_mesa(mesa_id) OR mesa_id IN
 (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id=(SELECT auth.uid()))));
DROP POLICY mesa_tokens_select_members_or_mestre ON public.mesa_tokens;
CREATE POLICY mesa_tokens_select_members_or_mestre ON public.mesa_tokens FOR SELECT TO authenticated USING (
 public.is_mestre_da_mesa(mesa_id) OR (
 mesa_id IN (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id=(SELECT auth.uid()))
 AND (visible_to_players OR owner_user_id=(SELECT auth.uid()))));
DROP POLICY mesa_tokens_update_mestre_or_owner ON public.mesa_tokens;
CREATE POLICY mesa_tokens_update_mestre_or_owner ON public.mesa_tokens FOR UPDATE TO authenticated USING (
 public.is_mestre_da_mesa(mesa_id) OR (owner_type='player' AND owner_user_id=(SELECT auth.uid())
 AND mesa_id IN (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id=(SELECT auth.uid()))))
 WITH CHECK (public.is_mestre_da_mesa(mesa_id) OR (owner_type='player' AND owner_user_id=(SELECT auth.uid())
 AND mesa_id IN (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id=(SELECT auth.uid()))));

CREATE FUNCTION public.proteger_campos_token() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND NOT public.is_mestre_da_mesa(OLD.mesa_id) THEN
  IF (to_jsonb(NEW)-ARRAY['grid_x','grid_y','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['grid_x','grid_y','updated_at']) THEN
   RAISE EXCEPTION 'Somente o Mestre pode alterar os dados ou a visibilidade do token' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.proteger_campos_token() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER proteger_campos_token BEFORE UPDATE ON public.mesa_tokens
FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_token();

CREATE FUNCTION public.definir_visibilidade_token(p_token_id uuid,p_visible boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE room uuid;
BEGIN
 SELECT mesa_id INTO room FROM public.mesa_tokens WHERE id=p_token_id;
 IF auth.uid() IS NULL OR room IS NULL OR NOT public.is_mestre_da_mesa(room) THEN
  RAISE EXCEPTION 'Apenas o Mestre pode alterar a visibilidade' USING ERRCODE='42501';
 END IF;
 IF p_visible IS NULL THEN RAISE EXCEPTION 'Visibilidade inválida' USING ERRCODE='22023'; END IF;
 UPDATE public.mesa_tokens SET visible_to_players=p_visible,updated_at=now() WHERE id=p_token_id;
END $$;
REVOKE ALL ON FUNCTION public.definir_visibilidade_token(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.definir_visibilidade_token(uuid,boolean) TO authenticated;

CREATE FUNCTION public.obter_cena_publica(p_mesa_id uuid)
RETURNS TABLE(token_id uuid,owner_type varchar,owner_ref uuid,display_name varchar,image_url text,grid_x integer,grid_y integer,is_own boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_mestre_da_mesa(p_mesa_id) OR EXISTS
 (SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=p_mesa_id AND mm.usuario_id=auth.uid())) THEN
  RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT mt.id,mt.owner_type,mt.owner_ref,mt.display_name,mt.image_url,mt.grid_x,mt.grid_y,
 coalesce(mt.owner_user_id=auth.uid(),false)
 FROM public.mesa_tokens mt WHERE mt.mesa_id=p_mesa_id
 AND (mt.visible_to_players OR mt.owner_user_id=auth.uid() OR public.is_mestre_da_mesa(p_mesa_id))
 ORDER BY mt.created_at,mt.id;
END $$;
REVOKE ALL ON FUNCTION public.obter_cena_publica(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.obter_cena_publica(uuid) TO authenticated;

-- A cena privada não pode continuar acessível pelo SELECT/Realtime da linha de mesas.
DROP POLICY mesas_select_member_or_mestre ON public.mesas;
CREATE POLICY mesas_select_mestre ON public.mesas FOR SELECT TO authenticated USING (mestre_id=(SELECT auth.uid()));
CREATE FUNCTION public.listar_mesas_acessiveis(p_mesa_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,nome varchar,descricao text,sistema varchar,mestre_id uuid,created_at timestamptz,mapa_url text,grid_cols integer,codigo_convite varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.id,m.nome,m.descricao,m.sistema,m.mestre_id,m.created_at,m.mapa_url,m.grid_cols,
 CASE WHEN m.mestre_id=auth.uid() THEN m.codigo_convite ELSE NULL::varchar END
 FROM public.mesas m WHERE auth.uid() IS NOT NULL AND (p_mesa_id IS NULL OR m.id=p_mesa_id)
 AND (m.mestre_id=auth.uid() OR EXISTS(SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=m.id AND mm.usuario_id=auth.uid()))
 ORDER BY m.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.listar_mesas_acessiveis(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.listar_mesas_acessiveis(uuid) TO authenticated;
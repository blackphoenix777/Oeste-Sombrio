-- Fase 2. Aplicar atomicamente via Supabase apply_migration.
ALTER TABLE public.mesa_tokens ADD COLUMN iniciativa integer NOT NULL DEFAULT 0;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
   AND schemaname='public' AND tablename='mesa_tokens') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_tokens;
 END IF;
END $$;

-- Aceita o valor textual das fichas, sem deixar dados legados inválidos abortarem o save.
CREATE FUNCTION public.normalizar_iniciativa_token(valor text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF valor IS NULL OR btrim(valor) !~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN RETURN 0; END IF;
 RETURN greatest(-2147483648::numeric,least(2147483647::numeric,trunc(valor::numeric)))::integer;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN 0;
END $$;
REVOKE ALL ON FUNCTION public.normalizar_iniciativa_token(text) FROM PUBLIC,anon,authenticated;

-- Triggers internos: a autorização é feita pelo RLS do INSERT/UPDATE de origem.
-- Não abre UPDATE de atributos/visibilidade ao jogador e não publica fichas completas.
CREATE FUNCTION public.sincronizar_iniciativa_ficha_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE valor integer:=public.normalizar_iniciativa_token(NEW.dados->>'iniciativa');
BEGIN
 UPDATE public.mesa_tokens SET iniciativa=valor,updated_at=clock_timestamp()
 WHERE mesa_id=NEW.mesa_id AND owner_type='player' AND owner_ref=NEW.id
   AND owner_user_id=NEW.usuario_id AND iniciativa IS DISTINCT FROM valor;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sincronizar_iniciativa_ficha_token() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sincronizar_iniciativa_ficha_token AFTER INSERT OR UPDATE OF dados,mesa_id ON public.fichas
 FOR EACH ROW EXECUTE FUNCTION public.sincronizar_iniciativa_ficha_token();

CREATE FUNCTION public.sincronizar_iniciativa_cena_tokens() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.mesa_tokens t SET iniciativa=public.normalizar_iniciativa_token(c.item->'data'->>'iniciativa'),
 updated_at=clock_timestamp()
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.cena_ativa)='array' THEN NEW.cena_ativa ELSE '[]'::jsonb END) c(item)
 WHERE t.mesa_id=NEW.id AND t.owner_type='creature' AND t.owner_ref::text=c.item->>'instanceId'
 AND t.iniciativa IS DISTINCT FROM public.normalizar_iniciativa_token(c.item->'data'->>'iniciativa');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sincronizar_iniciativa_cena_tokens() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sincronizar_iniciativa_cena_tokens AFTER UPDATE OF cena_ativa ON public.mesas
 FOR EACH ROW EXECUTE FUNCTION public.sincronizar_iniciativa_cena_tokens();

-- Jogador adicionado depois do último save recebe o valor atual, inclusive por clientes antigos.
CREATE FUNCTION public.inicializar_iniciativa_jogador_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.owner_type='player' THEN
  SELECT public.normalizar_iniciativa_token(f.dados->>'iniciativa') INTO NEW.iniciativa
  FROM public.fichas f WHERE f.id=NEW.owner_ref AND f.mesa_id=NEW.mesa_id AND f.usuario_id=NEW.owner_user_id;
  NEW.iniciativa:=coalesce(NEW.iniciativa,0);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inicializar_iniciativa_jogador_token() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inicializar_iniciativa_jogador_token BEFORE INSERT ON public.mesa_tokens
 FOR EACH ROW EXECUTE FUNCTION public.inicializar_iniciativa_jogador_token();

-- Backfill por ficha ou instanceId: nunca por nome, sourceId ou ficha de catálogo.
UPDATE public.mesa_tokens t SET iniciativa=public.normalizar_iniciativa_token(f.dados->>'iniciativa')
 FROM public.fichas f WHERE t.owner_type='player' AND t.owner_ref=f.id
 AND t.mesa_id=f.mesa_id AND t.owner_user_id=f.usuario_id;
UPDATE public.mesa_tokens t SET iniciativa=public.normalizar_iniciativa_token(c.item->'data'->>'iniciativa')
 FROM public.mesas m CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(m.cena_ativa)='array' THEN m.cena_ativa ELSE '[]'::jsonb END) c(item)
 WHERE t.mesa_id=m.id AND t.owner_type='creature' AND t.owner_ref::text=c.item->>'instanceId';

-- Mudança do tipo de retorno exige recriação, dentro da mesma transação da migração.
DROP FUNCTION public.obter_cena_publica(uuid);
CREATE FUNCTION public.obter_cena_publica(p_mesa_id uuid)
RETURNS TABLE(token_id uuid,owner_type varchar,owner_ref uuid,display_name varchar,image_url text,
 grid_x integer,grid_y integer,is_own boolean,iniciativa integer,visible_to_players boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_mestre_da_mesa(p_mesa_id) OR EXISTS
 (SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=p_mesa_id AND mm.usuario_id=auth.uid())) THEN
  RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT mt.id,mt.owner_type,mt.owner_ref,mt.display_name,mt.image_url,mt.grid_x,mt.grid_y,
 coalesce(mt.owner_user_id=auth.uid(),false),mt.iniciativa,mt.visible_to_players
 FROM public.mesa_tokens mt WHERE mt.mesa_id=p_mesa_id
 AND (mt.visible_to_players OR mt.owner_user_id=auth.uid() OR public.is_mestre_da_mesa(p_mesa_id))
 ORDER BY mt.created_at,mt.id;
END $$;
REVOKE ALL ON FUNCTION public.obter_cena_publica(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.obter_cena_publica(uuid) TO authenticated;


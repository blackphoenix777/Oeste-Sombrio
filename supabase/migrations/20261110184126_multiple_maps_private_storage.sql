-- Etapa 2. Aplicar atomicamente; preservar identidade de mapas/tokens em reexecuções.
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS mapas jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS mapa_ativo_jogadores_id uuid;
ALTER TABLE public.mesa_tokens ADD COLUMN IF NOT EXISTS mapa_id uuid;
DO $$ DECLARE r record; mid uuid; BEGIN
 FOR r IN SELECT * FROM public.mesas FOR UPDATE LOOP
  IF jsonb_array_length(coalesce(r.mapas,'[]'))=0 THEN
   mid:=gen_random_uuid();
   UPDATE public.mesas SET mapas=jsonb_build_array(jsonb_build_object('id',mid,'slot',1,'nome','Mapa 1',
    'url',r.mapa_url,'storage_path',substring(r.mapa_url from '/object/public/mesa-maps/([^?]+)'),
    'grid_cols',greatest(4,least(64,coalesce(r.grid_cols,24))))),mapa_ativo_jogadores_id=mid WHERE id=r.id;
  ELSE mid:=(r.mapas->0->>'id')::uuid; END IF;
  UPDATE public.mesa_tokens SET mapa_id=mid WHERE mesa_id=r.id AND mapa_id IS NULL;
  UPDATE public.mesas SET combate_ativo=combate_ativo || jsonb_build_object('mapa_id',mid)
   WHERE id=r.id AND combate_ativo IS NOT NULL AND NOT combate_ativo ? 'mapa_id';
 END LOOP;
END $$;
ALTER TABLE public.mesa_tokens ALTER COLUMN mapa_id SET NOT NULL;
ALTER TABLE public.mesa_tokens DROP CONSTRAINT IF EXISTS mesa_tokens_mesa_id_owner_type_owner_ref_key;
ALTER TABLE public.mesa_tokens ADD CONSTRAINT mesa_tokens_mesa_mapa_owner_unique UNIQUE(mesa_id,mapa_id,owner_type,owner_ref);

CREATE FUNCTION public.validar_mapas_mesa() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m jsonb; ids uuid[]:='{}'; slots integer[]:='{}'; mid uuid; slot integer; cols integer;
BEGIN
 IF TG_OP='INSERT' AND coalesce(NEW.mapas,'[]')='[]'::jsonb THEN
  mid:=gen_random_uuid();
  NEW.mapas:=jsonb_build_array(jsonb_build_object('id',mid,'slot',1,'nome','Mapa 1','url',NEW.mapa_url,
   'storage_path',substring(NEW.mapa_url from '/object/public/mesa-maps/([^?]+)'), 'grid_cols',coalesce(NEW.grid_cols,24)));
  NEW.mapa_ativo_jogadores_id:=mid;
 END IF;
 IF NEW.mapas IS NULL OR jsonb_typeof(NEW.mapas)<>'array' OR jsonb_array_length(NEW.mapas) NOT BETWEEN 1 AND 4 THEN
  RAISE EXCEPTION 'A mesa deve conter entre 1 e 4 mapas' USING ERRCODE='22023'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.mapas) LOOP
  mid:=(m->>'id')::uuid; slot:=(m->>'slot')::integer; cols:=(m->>'grid_cols')::integer;
  IF mid IS NULL OR slot IS NULL OR slot NOT BETWEEN 1 AND 4 OR cols IS NULL OR cols NOT BETWEEN 4 AND 64
   OR mid=ANY(ids) OR slot=ANY(slots) OR length(trim(coalesce(m->>'nome',''))) NOT BETWEEN 1 AND 80 THEN
   RAISE EXCEPTION 'Mapa, slot, nome ou grade inválidos/duplicados' USING ERRCODE='22023'; END IF;
  IF nullif(m->>'storage_path','') IS NOT NULL AND m->>'storage_path' !~
   ('^'||NEW.id::text||'/(slot_'||slot||'|mapa)\.(jpg|jpeg|png|webp|gif)$') THEN
   RAISE EXCEPTION 'Arquivo não pertence ao slot desta mesa' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,mid); slots:=array_append(slots,slot);
 END LOOP;
 IF NEW.mapa_ativo_jogadores_id IS NULL OR NOT NEW.mapa_ativo_jogadores_id=ANY(ids) THEN
  RAISE EXCEPTION 'A flâmula deve apontar para um mapa existente' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND NEW.mapas IS DISTINCT FROM OLD.mapas AND EXISTS(
  SELECT 1 FROM public.mesa_tokens t WHERE t.mesa_id=NEW.id AND NOT t.mapa_id=ANY(ids)) THEN
  RAISE EXCEPTION 'Remova os tokens do mapa antes de excluir o slot' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validar_mapas_mesa() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validar_mapas_mesa BEFORE INSERT OR UPDATE OF mapas,mapa_ativo_jogadores_id ON public.mesas
 FOR EACH ROW EXECUTE FUNCTION public.validar_mapas_mesa();

CREATE FUNCTION public.validar_mapa_token() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.mesas WHERE id=NEW.mesa_id FOR SHARE;
 -- Compatibilidade com clientes anteriores e fixtures; o cliente novo sempre envia mapa_id.
 IF NEW.mapa_id IS NULL AND TG_OP='INSERT' THEN
  SELECT mapa_ativo_jogadores_id INTO NEW.mapa_id FROM public.mesas WHERE id=NEW.mesa_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mesas m, jsonb_array_elements(m.mapas) e
  WHERE m.id=NEW.mesa_id AND e->>'id'=NEW.mapa_id::text) THEN
  RAISE EXCEPTION 'Mapa não pertence à mesa' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validar_mapa_token() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validar_mapa_token BEFORE INSERT OR UPDATE OF mapa_id,mesa_id ON public.mesa_tokens
 FOR EACH ROW EXECUTE FUNCTION public.validar_mapa_token();

CREATE FUNCTION public.mapa_visivel_ao_usuario(room uuid,mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.mesas m WHERE m.id=room
  AND m.mapa_ativo_jogadores_id=mid AND (m.mestre_id=auth.uid() OR EXISTS(
   SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=m.id AND mm.usuario_id=auth.uid())));
$$;
REVOKE ALL ON FUNCTION public.mapa_visivel_ao_usuario(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mapa_visivel_ao_usuario(uuid,uuid) TO authenticated;
DROP POLICY mesa_tokens_select_members_or_mestre ON public.mesa_tokens;
CREATE POLICY mesa_tokens_select_members_or_mestre ON public.mesa_tokens FOR SELECT TO authenticated USING (
 public.is_mestre_da_mesa(mesa_id) OR (public.mapa_visivel_ao_usuario(mesa_id,mapa_id) AND (visible_to_players OR owner_user_id=auth.uid())));
DROP POLICY mesa_tokens_update_mestre_or_owner ON public.mesa_tokens;
CREATE POLICY mesa_tokens_update_mestre_or_owner ON public.mesa_tokens FOR UPDATE TO authenticated
 USING(public.is_mestre_da_mesa(mesa_id) OR (public.mapa_visivel_ao_usuario(mesa_id,mapa_id) AND owner_type='player' AND owner_user_id=auth.uid()))
 WITH CHECK(public.is_mestre_da_mesa(mesa_id) OR (public.mapa_visivel_ao_usuario(mesa_id,mapa_id) AND owner_type='player' AND owner_user_id=auth.uid()));

CREATE TABLE public.mesa_mapa_sinais(
 mesa_id uuid PRIMARY KEY REFERENCES public.mesas(id) ON DELETE CASCADE,
 mapa_ativo_id uuid NOT NULL, revisao bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.mesa_mapa_sinais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_mapa_sinais FROM anon,authenticated;
GRANT SELECT ON public.mesa_mapa_sinais TO authenticated;
CREATE POLICY mapa_sinais_select_membros ON public.mesa_mapa_sinais FOR SELECT TO authenticated USING(
 public.is_mestre_da_mesa(mesa_id) OR mesa_id IN(SELECT mesa_id FROM public.membros_mesa WHERE usuario_id=(SELECT auth.uid())));
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_mapa_sinais;
INSERT INTO public.mesa_mapa_sinais(mesa_id,mapa_ativo_id) SELECT id,mapa_ativo_jogadores_id FROM public.mesas;
CREATE FUNCTION public.sinalizar_mudanca_mapa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE room uuid; mid uuid; before_map jsonb; after_map jsonb;
BEGIN
 IF TG_TABLE_NAME='mesas' THEN
  room:=NEW.id; mid:=NEW.mapa_ativo_jogadores_id;
  IF TG_OP='UPDATE' THEN
   SELECT e INTO before_map FROM jsonb_array_elements(OLD.mapas) e WHERE e->>'id'=OLD.mapa_ativo_jogadores_id::text;
   SELECT e INTO after_map FROM jsonb_array_elements(NEW.mapas) e WHERE e->>'id'=mid::text;
   IF before_map IS NOT DISTINCT FROM after_map THEN RETURN NULL; END IF;
  END IF;
 ELSE
  room:=CASE WHEN TG_OP='DELETE' THEN OLD.mesa_id ELSE NEW.mesa_id END;
  SELECT mapa_ativo_jogadores_id INTO mid FROM public.mesas WHERE id=room;
  IF mid IS NULL THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN IF OLD.mapa_id<>mid THEN RETURN NULL; END IF;
  ELSIF TG_OP='INSERT' THEN IF NEW.mapa_id<>mid THEN RETURN NULL; END IF;
  ELSE IF NEW.mapa_id<>mid AND OLD.mapa_id<>mid THEN RETURN NULL; END IF; END IF;
 END IF;
 INSERT INTO public.mesa_mapa_sinais(mesa_id,mapa_ativo_id) VALUES(room,mid)
 ON CONFLICT(mesa_id) DO UPDATE SET mapa_ativo_id=EXCLUDED.mapa_ativo_id,
  revisao=public.mesa_mapa_sinais.revisao+1,updated_at=clock_timestamp();
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sinalizar_mudanca_mapa() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trigger_sinalizar_mapa AFTER INSERT OR UPDATE OF mapas,mapa_ativo_jogadores_id ON public.mesas
 FOR EACH ROW EXECUTE FUNCTION public.sinalizar_mudanca_mapa();
CREATE TRIGGER mapa_token_sinal AFTER INSERT OR UPDATE OR DELETE ON public.mesa_tokens
 FOR EACH ROW EXECUTE FUNCTION public.sinalizar_mudanca_mapa();

CREATE OR REPLACE FUNCTION public.obter_cena_publica(p_mesa_id uuid)
RETURNS TABLE(token_id uuid,owner_type varchar,owner_ref uuid,display_name varchar,image_url text,
 grid_x integer,grid_y integer,is_own boolean,iniciativa integer,visible_to_players boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_mestre_da_mesa(p_mesa_id) OR EXISTS(SELECT 1 FROM public.membros_mesa
  WHERE mesa_id=p_mesa_id AND usuario_id=auth.uid())) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.owner_type,t.owner_ref,t.display_name,t.image_url,t.grid_x,t.grid_y,
  coalesce(t.owner_user_id=auth.uid(),false),t.iniciativa,t.visible_to_players FROM public.mesa_tokens t
  JOIN public.mesas m ON m.id=t.mesa_id AND m.mapa_ativo_jogadores_id=t.mapa_id
  WHERE t.mesa_id=p_mesa_id AND (public.is_mestre_da_mesa(p_mesa_id) OR t.visible_to_players OR t.owner_user_id=auth.uid())
  ORDER BY t.created_at,t.id;
END $$;
CREATE FUNCTION public.obter_mapa_publico(p_mesa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.mesas; mapa jsonb; ts jsonb; rev bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_mestre_da_mesa(p_mesa_id) OR EXISTS(SELECT 1 FROM public.membros_mesa
  WHERE mesa_id=p_mesa_id AND usuario_id=auth.uid())) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.mesas WHERE id=p_mesa_id;
 SELECT e INTO mapa FROM jsonb_array_elements(m.mapas) e WHERE e->>'id'=m.mapa_ativo_jogadores_id::text;
 SELECT coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('mapa_id',m.mapa_ativo_jogadores_id)),'[]') INTO ts
  FROM public.obter_cena_publica(p_mesa_id) t;
 SELECT revisao INTO rev FROM public.mesa_mapa_sinais WHERE mesa_id=p_mesa_id;
 RETURN jsonb_build_object('mapa',mapa,'tokens',ts,'revisao',coalesce(rev,0));
END $$;
REVOKE ALL ON FUNCTION public.obter_mapa_publico(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.obter_mapa_publico(uuid) TO authenticated;

-- Evita vazamento da URL legada quando a flâmula está em outro mapa.
CREATE OR REPLACE FUNCTION public.listar_mesas_acessiveis(p_mesa_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,nome varchar,descricao text,sistema varchar,mestre_id uuid,created_at timestamptz,mapa_url text,grid_cols integer,codigo_convite varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.id,m.nome,m.descricao,m.sistema,m.mestre_id,m.created_at,
  CASE WHEN m.mestre_id=auth.uid() THEN m.mapa_url ELSE e->>'url' END,
  CASE WHEN m.mestre_id=auth.uid() THEN m.grid_cols ELSE (e->>'grid_cols')::integer END,
  CASE WHEN m.mestre_id=auth.uid() THEN m.codigo_convite ELSE NULL::varchar END
 FROM public.mesas m LEFT JOIN LATERAL (SELECT value e FROM jsonb_array_elements(m.mapas)
  WHERE value->>'id'=m.mapa_ativo_jogadores_id::text) active ON true
 WHERE auth.uid() IS NOT NULL AND (p_mesa_id IS NULL OR m.id=p_mesa_id) AND
 (m.mestre_id=auth.uid() OR EXISTS(SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=m.id AND mm.usuario_id=auth.uid())) ORDER BY m.created_at DESC;
$$;

-- Mutações parciais sob lock: abas simultâneas não sobrescrevem o array inteiro.
CREATE FUNCTION public.gerenciar_mapas(p_mesa_id uuid,p_acao text,p_mapa_id uuid DEFAULT NULL,p_dados jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.mesas; target jsonb; mid uuid; slot integer; arr jsonb; path text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_mestre_da_mesa(p_mesa_id) THEN RAISE EXCEPTION 'Apenas o Mestre pode gerenciar mapas' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.mesas WHERE id=p_mesa_id FOR UPDATE;
 SELECT e INTO target FROM jsonb_array_elements(m.mapas) e WHERE e->>'id'=p_mapa_id::text;
 IF p_acao='adicionar' THEN
  IF jsonb_array_length(m.mapas)>=4 THEN RAISE EXCEPTION 'Limite de 4 mapas atingido' USING ERRCODE='22023'; END IF;
  SELECT n INTO slot FROM generate_series(1,4) n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.mapas) e WHERE (e->>'slot')::integer=n) ORDER BY n LIMIT 1;
  mid:=gen_random_uuid(); target:=jsonb_build_object('id',mid,'slot',slot,'nome','Mapa '||slot,'url',NULL,'grid_cols',24);
  m.mapas:=m.mapas || jsonb_build_array(target);
 ELSE
  IF target IS NULL THEN RAISE EXCEPTION 'Mapa não existe mais' USING ERRCODE='22023'; END IF;
  mid:=p_mapa_id;
  IF p_acao='flamula' THEN m.mapa_ativo_jogadores_id:=mid;
  ELSIF p_acao='excluir' THEN
   IF jsonb_array_length(m.mapas)<=1 THEN RAISE EXCEPTION 'Preserve ao menos um mapa' USING ERRCODE='22023'; END IF;
   IF m.combate_ativo->>'mapa_id'=mid::text THEN RAISE EXCEPTION 'Encerre o combate deste mapa antes de excluí-lo' USING ERRCODE='22023'; END IF;
   DELETE FROM public.mesa_tokens WHERE mesa_id=p_mesa_id AND mapa_id=mid;
   SELECT jsonb_agg(e ORDER BY (e->>'slot')::integer) INTO m.mapas FROM jsonb_array_elements(m.mapas) e WHERE e->>'id'<>mid::text;
   IF m.mapa_ativo_jogadores_id=mid THEN m.mapa_ativo_jogadores_id:=(m.mapas->0->>'id')::uuid; END IF;
  ELSIF p_acao='editar' THEN
   IF p_dados ? 'nome' THEN target:=target || jsonb_build_object('nome',trim(p_dados->>'nome')); END IF;
   IF p_dados ? 'grid_cols' THEN target:=target || jsonb_build_object('grid_cols',(p_dados->>'grid_cols')::integer); END IF;
   IF p_dados ? 'url' THEN
    path:=p_dados->>'storage_path';
    IF path IS NULL OR path !~ ('^'||p_mesa_id::text||'/slot_'||(target->>'slot')||'\.(jpg|jpeg|png|webp|gif)$') THEN
     RAISE EXCEPTION 'Caminho inválido para este slot' USING ERRCODE='22023'; END IF;
    target:=target || jsonb_build_object('url',p_dados->>'url','storage_path',path);
   END IF;
   SELECT jsonb_agg(CASE WHEN e->>'id'=mid::text THEN target ELSE e END ORDER BY (e->>'slot')::integer) INTO m.mapas FROM jsonb_array_elements(m.mapas) e;
  ELSE RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE public.mesas SET mapas=m.mapas,mapa_ativo_jogadores_id=m.mapa_ativo_jogadores_id WHERE id=p_mesa_id;
 RETURN jsonb_build_object('mapas',m.mapas,'mapa_ativo_jogadores_id',m.mapa_ativo_jogadores_id,'mapa_id',mid);
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_mapas(uuid,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_mapas(uuid,text,uuid,jsonb) TO authenticated;

-- Downloads autenticados, inclusive para URLs legadas preservadas na migração.
UPDATE storage.buckets SET public=false WHERE id='mesa-maps';
CREATE FUNCTION public.pode_ler_arquivo_mapa(path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.mesas m
  WHERE split_part(path,'/',1)=m.id::text AND (m.mestre_id=auth.uid() OR
   (EXISTS(SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=m.id AND mm.usuario_id=auth.uid()) AND
    EXISTS(SELECT 1 FROM jsonb_array_elements(m.mapas) e WHERE e->>'id'=m.mapa_ativo_jogadores_id::text AND e->>'storage_path'=path))));
$$;
REVOKE ALL ON FUNCTION public.pode_ler_arquivo_mapa(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pode_ler_arquivo_mapa(text) TO authenticated;
DROP POLICY mesa_maps_select_public ON storage.objects;
CREATE POLICY mesa_maps_select_autorizado ON storage.objects FOR SELECT TO authenticated USING(bucket_id='mesa-maps' AND public.pode_ler_arquivo_mapa(name));
-- INSERT/UPDATE existentes verificam Mestre e pasta. Restringe novos uploads aos quatro slots.
CREATE POLICY mesa_maps_slots_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'mesa-maps' OR name ~ '^[0-9a-f-]{36}/slot_[1-4]\.(jpg|jpeg|png|webp|gif)$');
CREATE POLICY mesa_maps_slots_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'mesa-maps' OR name ~ '^[0-9a-f-]{36}/slot_[1-4]\.(jpg|jpeg|png|webp|gif)$')
 WITH CHECK(bucket_id<>'mesa-maps' OR name ~ '^[0-9a-f-]{36}/slot_[1-4]\.(jpg|jpeg|png|webp|gif)$');

-- Mantém a assinatura do tracker; o combate fica vinculado ao mapa de seus tokens.
DO $$ DECLARE src text; BEGIN
 SELECT pg_get_functiondef('public.gerenciar_combate(uuid,text,bigint,jsonb,uuid,uuid)'::regprocedure) INTO src;
 src:=replace(src,'DECLARE estado jsonb;', 'DECLARE combat_map uuid; estado jsonb;');
 src:=replace(src,'fonte:=escolha->>''modo'';',
  'IF combat_map IS NULL THEN combat_map:=tok.mapa_id; ELSIF combat_map<>tok.mapa_id THEN RAISE EXCEPTION ''Selecione participantes do mesmo mapa'' USING ERRCODE=''22023''; END IF; fonte:=escolha->>''modo'';');
 src:=replace(src,'''cascata_d20'',dado,''cascata_total'',cascata);','''cascata_d20'',dado,''cascata_total'',cascata,''mapa_id'',combat_map);');
 src:=replace(src,'-- Na entrada tardia,',
  'IF tok.mapa_id::text IS DISTINCT FROM estado->>''mapa_id'' THEN RAISE EXCEPTION ''Token pertence a outro mapa'' USING ERRCODE=''22023''; END IF; -- Na entrada tardia,');
 EXECUTE src;
 SELECT pg_get_functiondef('public.obter_combate_publico(uuid)'::regprocedure) INTO src;
 src:=replace(src,'IF estado IS NULL OR gm THEN',
  'IF NOT gm AND estado->>''mapa_id'' IS DISTINCT FROM (SELECT mapa_ativo_jogadores_id::text FROM public.mesas WHERE id=p_mesa_id) THEN estado:=NULL; END IF; IF estado IS NULL OR gm THEN');
 EXECUTE src;
END $$;


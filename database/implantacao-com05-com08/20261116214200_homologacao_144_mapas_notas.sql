-- HOMOLOGACAO ONLY: igyupxczhczidfgtjiws. Nunca aplicar em producao.
-- Aplicada via Supabase apply_migration: 20261116214200, homologacao_144_mapas_notas.
-- Paridade auditada de gerenciar_mapas + correcao minima do tipo JSONB das notas.
CREATE OR REPLACE FUNCTION public.gerenciar_mapas(p_mesa_id uuid, p_acao text, p_mapa_id uuid DEFAULT NULL::uuid, p_dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.gerenciar_mapas(uuid,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_mapas(uuid,text,uuid,jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.validar_notas_mestre()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE pending jsonb; node jsonb; ids text[] := '{}'; batch jsonb; depth integer := 0;
BEGIN
  IF jsonb_typeof(NEW.notas_mestre) IS DISTINCT FROM 'array' OR octet_length(NEW.notas_mestre::text) > 2097152 THEN
    RAISE EXCEPTION 'Caderno inválido ou maior que 2 MB.' USING ERRCODE = '22023';
  END IF;
  pending := NEW.notas_mestre;
  WHILE jsonb_array_length(pending) > 0 LOOP
    depth := depth + 1;
    IF depth > 12 THEN RAISE EXCEPTION 'Limite de 12 níveis.' USING ERRCODE = '22023'; END IF;
    batch := '[]';
    FOR node IN SELECT * FROM jsonb_array_elements(pending) LOOP
      IF jsonb_typeof(node) <> 'object' OR coalesce(node->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
         OR node->>'id' = ANY(ids) OR coalesce(length(trim(node->>'nome')), 0) NOT BETWEEN 1 AND 120
         OR coalesce(node->>'tipo', '') NOT IN ('pasta', 'arquivo') THEN
        RAISE EXCEPTION 'Entrada de nota inválida.' USING ERRCODE = '22023';
      END IF;
      ids := array_append(ids, node->>'id');
      IF cardinality(ids) > 1000 THEN RAISE EXCEPTION 'Limite de 1000 entradas.' USING ERRCODE = '22023'; END IF;
      IF node->>'tipo' = 'pasta' THEN
        IF jsonb_typeof(node->'itens') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Pasta inválida.' USING ERRCODE = '22023'; END IF;
        batch := batch || (node->'itens');
      ELSIF jsonb_typeof(node->'conteudo') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Texto inválido.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    pending := batch;
  END LOOP;
  IF TG_OP = 'UPDATE' THEN NEW.notas_mestre_versao := OLD.notas_mestre_versao + 1; END IF;
  RETURN NEW;
END $function$;
NOTIFY pgrst, 'reload schema';


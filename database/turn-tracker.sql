-- Fase 3: estado privado + sinal Realtime sem conteúdo privado.
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS combate_ativo jsonb DEFAULT NULL;
CREATE TABLE public.mesa_combate_sinais (
 mesa_id uuid PRIMARY KEY REFERENCES public.mesas(id) ON DELETE CASCADE,
 revisao bigint NOT NULL DEFAULT 1
);
ALTER TABLE public.mesa_combate_sinais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_combate_sinais FROM anon,authenticated;
GRANT SELECT ON public.mesa_combate_sinais TO authenticated;
CREATE POLICY combate_sinais_select_membros ON public.mesa_combate_sinais FOR SELECT TO authenticated
 USING (public.is_mestre_da_mesa(mesa_id) OR mesa_id IN
 (SELECT mm.mesa_id FROM public.membros_mesa mm WHERE mm.usuario_id=(SELECT auth.uid())));
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_combate_sinais;

CREATE FUNCTION public.sinalizar_mudanca_combate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE room uuid;
BEGIN
 IF TG_TABLE_NAME='mesas' THEN
  IF NEW.combate_ativo IS NOT DISTINCT FROM OLD.combate_ativo THEN RETURN NEW; END IF;
  room:=NEW.id;
 ELSE
  IF TG_OP='UPDATE' AND (NEW.iniciativa,NEW.visible_to_players,NEW.display_name,NEW.image_url)
    IS NOT DISTINCT FROM (OLD.iniciativa,OLD.visible_to_players,OLD.display_name,OLD.image_url) THEN RETURN NEW; END IF;
  room:=CASE WHEN TG_OP='DELETE' THEN OLD.mesa_id ELSE NEW.mesa_id END;
  -- Não gera sinal durante remoção em cascata da própria mesa.
  IF NOT EXISTS(SELECT 1 FROM public.mesas WHERE id=room AND combate_ativo IS NOT NULL) THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO public.mesa_combate_sinais(mesa_id) VALUES(room)
 ON CONFLICT(mesa_id) DO UPDATE SET revisao=public.mesa_combate_sinais.revisao+1;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sinalizar_mudanca_combate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER combate_estado_sinal AFTER UPDATE OF combate_ativo ON public.mesas
 FOR EACH ROW EXECUTE FUNCTION public.sinalizar_mudanca_combate();
CREATE TRIGGER combate_token_sinal AFTER INSERT OR UPDATE OR DELETE ON public.mesa_tokens
 FOR EACH ROW EXECUTE FUNCTION public.sinalizar_mudanca_combate();

CREATE FUNCTION public.item_combate(t public.mesa_tokens,valor integer,fonte text,tardio boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('token_id',t.id,'owner_ref',t.owner_ref,'owner_type',t.owner_type,
 'name',t.display_name,'image_url',t.image_url,'iniciativa',valor,'visible_to_players',t.visible_to_players,
 'entrou_no_meio',tardio,'iniciativa_fonte',fonte);
$$;
REVOKE ALL ON FUNCTION public.item_combate(public.mesa_tokens,integer,text,boolean) FROM PUBLIC,anon,authenticated;

-- Renova só metadados públicos e iniciativa de ficha. Não altera a ordem no meio do round.
CREATE FUNCTION public.atualizar_resumo_combate(room uuid,estado jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lista jsonb; idx integer; antigo integer:=coalesce((estado->>'turno_atual_idx')::integer,0);
BEGIN
 IF estado IS NULL THEN RETURN NULL; END IF;
 WITH vivos AS (
  SELECT e.n, public.item_combate(t,CASE WHEN e.item->>'iniciativa_fonte'='ficha' THEN t.iniciativa
    ELSE public.normalizar_iniciativa_token(e.item->>'iniciativa') END,
    e.item->>'iniciativa_fonte',coalesce((e.item->>'entrou_no_meio')::boolean,false)) AS item
  FROM jsonb_array_elements(estado->'ordem') WITH ORDINALITY e(item,n)
  JOIN public.mesa_tokens t ON t.id::text=e.item->>'token_id' AND t.mesa_id=room
 ) SELECT coalesce(jsonb_agg(item ORDER BY n),'[]'::jsonb),
   coalesce((SELECT count(*)::integer FROM vivos WHERE n<coalesce((SELECT min(n) FROM vivos WHERE n>antigo),(SELECT min(n) FROM vivos))),0)
 INTO lista,idx FROM vivos;
 RETURN estado || jsonb_build_object('ordem',lista,'turno_atual_idx',idx);
END $$;
REVOKE ALL ON FUNCTION public.atualizar_resumo_combate(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.obter_combate_publico(p_mesa_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE estado jsonb; lista jsonb; atual text; idx integer; gm boolean; rev bigint;
BEGIN
 gm:=public.is_mestre_da_mesa(p_mesa_id);
 IF auth.uid() IS NULL OR NOT (gm OR EXISTS(SELECT 1 FROM public.membros_mesa
   WHERE mesa_id=p_mesa_id AND usuario_id=auth.uid())) THEN
  RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE='42501';
 END IF;
 SELECT public.atualizar_resumo_combate(m.id,m.combate_ativo),coalesce(s.revisao,0) INTO estado,rev
 FROM public.mesas m LEFT JOIN public.mesa_combate_sinais s ON s.mesa_id=m.id WHERE m.id=p_mesa_id;
 IF estado IS NULL OR gm THEN RETURN jsonb_build_object('combate',estado,'revisao',rev); END IF;
 atual:=estado->'ordem'->((estado->>'turno_atual_idx')::integer)->>'token_id';
 SELECT coalesce(jsonb_agg(e.item ORDER BY e.n),'[]'::jsonb) INTO lista
 FROM jsonb_array_elements(estado->'ordem') WITH ORDINALITY e(item,n)
 JOIN public.mesa_tokens t ON t.id::text=e.item->>'token_id' AND t.mesa_id=p_mesa_id
 WHERE t.visible_to_players OR t.owner_user_id=auth.uid();
 SELECT (n-1)::integer INTO idx FROM jsonb_array_elements(lista) WITH ORDINALITY e(item,n) WHERE item->>'token_id'=atual;
 -- Não retorna índice privado, quantidade oculta, IDs ocultos ou dados da rolagem do Mestre.
 RETURN jsonb_build_object('revisao',rev,'combate',jsonb_build_object('id',estado->'id','ativo',true,
 'versao',estado->'versao','round',estado->'round','turno_atual_idx',coalesce(idx,-1),
 'turno_oculto',atual IS NOT NULL AND idx IS NULL,'ordem',lista));
END $$;
REVOKE ALL ON FUNCTION public.obter_combate_publico(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.obter_combate_publico(uuid) TO authenticated;

CREATE FUNCTION public.gerenciar_combate(p_mesa_id uuid,p_acao text,p_versao bigint DEFAULT NULL,
 p_participantes jsonb DEFAULT NULL,p_token_id uuid DEFAULT NULL,p_combate_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE estado jsonb; lista jsonb:='[]'; escolha jsonb; tok public.mesa_tokens;
 total integer; cascata integer; dado integer; pos integer:=0; valor integer; fonte text; idx integer; rodada integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_mestre_da_mesa(p_mesa_id) THEN
  RAISE EXCEPTION 'Apenas o Mestre pode controlar o combate' USING ERRCODE='42501';
 END IF;
 SELECT combate_ativo INTO estado FROM public.mesas WHERE id=p_mesa_id FOR UPDATE;
 IF p_acao='iniciar' THEN
  IF estado IS NOT NULL THEN RAISE EXCEPTION 'Já existe um combate ativo. Atualize o tracker.' USING ERRCODE='40001'; END IF;
  IF p_participantes IS NULL OR jsonb_typeof(p_participantes)<>'array' OR jsonb_array_length(p_participantes) NOT BETWEEN 1 AND 200 THEN
   RAISE EXCEPTION 'Selecione entre 1 e 200 participantes' USING ERRCODE='22023';
  END IF;
  total:=jsonb_array_length(p_participantes);
  IF (SELECT count(DISTINCT item->>'token_id') FROM jsonb_array_elements(p_participantes) item)<>total THEN
   RAISE EXCEPTION 'Participante duplicado' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO cascata FROM jsonb_array_elements(p_participantes) item WHERE item->>'modo'='cascata';
  IF cascata>0 THEN dado:=floor(random()*20)::integer+1; END IF;
  FOR escolha IN SELECT item FROM jsonb_array_elements(p_participantes) item
    ORDER BY public.normalizar_iniciativa_token(item->>'prioridade'),item->>'token_id'
  LOOP
   SELECT * INTO tok FROM public.mesa_tokens WHERE id::text=escolha->>'token_id' AND mesa_id=p_mesa_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Participante não está mais nesta cena' USING ERRCODE='22023'; END IF;
   fonte:=escolha->>'modo';
   IF fonte IS NULL OR fonte NOT IN ('ficha','cascata') OR (tok.owner_type='player' AND fonte<>'ficha') THEN
    RAISE EXCEPTION 'Modo de iniciativa inválido' USING ERRCODE='22023';
   END IF;
   IF fonte='cascata' THEN valor:=dado+cascata-pos; pos:=pos+1; ELSE valor:=tok.iniciativa; END IF;
   lista:=lista || jsonb_build_array(public.item_combate(tok,valor,fonte,false));
  END LOOP;
  SELECT jsonb_agg(item ORDER BY (item->>'iniciativa')::integer DESC,item->>'name',item->>'token_id') INTO lista FROM jsonb_array_elements(lista) item;
  estado:=jsonb_build_object('id',gen_random_uuid(),'ativo',true,'round',1,'turno_atual_idx',0,'ordem',lista,'versao',1,
    'cascata_d20',dado,'cascata_total',cascata);
 ELSE
  IF estado IS NULL OR p_combate_id IS NULL OR p_combate_id::text<>estado->>'id'
    OR p_versao IS DISTINCT FROM (estado->>'versao')::bigint THEN
   RAISE EXCEPTION 'Combate atualizado em outra sessão. Confira a ordem antes de tentar novamente.' USING ERRCODE='40001';
  END IF;
  estado:=public.atualizar_resumo_combate(p_mesa_id,estado);
  lista:=estado->'ordem'; idx:=(estado->>'turno_atual_idx')::integer; rodada:=(estado->>'round')::integer;
  IF p_acao='encerrar' THEN estado:=NULL;
  ELSIF p_acao='adicionar' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(lista) item WHERE item->>'token_id'=p_token_id::text) THEN
    RAISE EXCEPTION 'Esta entidade já participa do combate' USING ERRCODE='22023';
   END IF;
   SELECT * INTO tok FROM public.mesa_tokens WHERE id=p_token_id AND mesa_id=p_mesa_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Token não está nesta cena' USING ERRCODE='22023'; END IF;
   -- Na entrada tardia, creature (inclusive NPC) segue a regra de monstro solicitada.
   lista:=lista || jsonb_build_array(public.item_combate(tok,CASE WHEN tok.owner_type='player' THEN tok.iniciativa ELSE 0 END,
     CASE WHEN tok.owner_type='player' THEN 'ficha' ELSE 'fixa' END,true));
  ELSIF p_acao='proximo' THEN
   total:=jsonb_array_length(lista);
   IF total=0 THEN RAISE EXCEPTION 'Não há participantes em cena. Encerre o combate ou adicione alguém.' USING ERRCODE='22023'; END IF;
   idx:=idx+1;
   IF idx>=total THEN
    idx:=0; rodada:=rodada+1;
    SELECT jsonb_agg(item || jsonb_build_object('entrou_no_meio',false)
      ORDER BY (item->>'iniciativa_fonte'='fixa'),(item->>'iniciativa')::integer DESC,item->>'name',item->>'token_id') INTO lista FROM jsonb_array_elements(lista) item;
   END IF;
  ELSE RAISE EXCEPTION 'Ação de combate inválida' USING ERRCODE='22023'; END IF;
  IF estado IS NOT NULL THEN estado:=estado || jsonb_build_object('ordem',lista,'round',rodada,'turno_atual_idx',idx,
   'versao',(estado->>'versao')::bigint+1); END IF;
 END IF;
 UPDATE public.mesas SET combate_ativo=estado WHERE id=p_mesa_id;
 RETURN public.obter_combate_publico(p_mesa_id);
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_combate(uuid,text,bigint,jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_combate(uuid,text,bigint,jsonb,uuid,uuid) TO authenticated;

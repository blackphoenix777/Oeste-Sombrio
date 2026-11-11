-- Mantém criaturas tardias no fim inclusive em empates com iniciativa zero.
CREATE OR REPLACE FUNCTION public.gerenciar_combate(p_mesa_id uuid,p_acao text,p_versao bigint DEFAULT NULL,
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

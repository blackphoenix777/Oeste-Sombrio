-- Equipment inbox, private notes and per-token integrity/REM. Atomic deployment.
BEGIN;
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS notas_mestre jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN IF NOT EXISTS notas_mestre_versao bigint NOT NULL DEFAULT 1;

CREATE TABLE public.itens_entregues_pendentes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mesa_id uuid NOT NULL REFERENCES public.mesas ON DELETE CASCADE,
 ficha_id uuid NOT NULL REFERENCES public.fichas ON DELETE CASCADE,
 destinatario_user_id uuid NOT NULL REFERENCES public.usuarios ON DELETE CASCADE,
 item_data jsonb NOT NULL CHECK(jsonb_typeof(item_data)='object' AND octet_length(item_data::text)<=65536),
 quantidade integer NOT NULL DEFAULT 1 CHECK(quantidade BETWEEN 1 AND 999),
 entregue boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entregas_destinatario_pendentes ON public.itens_entregues_pendentes(destinatario_user_id,ficha_id) WHERE NOT entregue;
ALTER TABLE public.itens_entregues_pendentes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.itens_entregues_pendentes FROM anon,authenticated;
GRANT SELECT ON public.itens_entregues_pendentes TO authenticated;
CREATE POLICY entregas_leitura ON public.itens_entregues_pendentes FOR SELECT TO authenticated
 USING(public.is_mestre_da_mesa(mesa_id) OR destinatario_user_id=(SELECT auth.uid()));
-- Writes go through narrow RPCs; a recipient cannot change item/quantity/destination.
CREATE FUNCTION public.enviar_item_para_jogador(p_mesa_id uuid,p_ficha_id uuid,p_item_data jsonb,p_quantidade integer DEFAULT 1,p_entrega_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dono uuid; anterior public.itens_entregues_pendentes;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_mestre_da_mesa(p_mesa_id) THEN RAISE EXCEPTION 'Acesso negado: apenas o Mestre pode enviar itens.' USING ERRCODE='42501'; END IF;
 SELECT f.usuario_id INTO dono FROM public.fichas f WHERE f.id=p_ficha_id AND f.mesa_id=p_mesa_id
 AND EXISTS(SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id=p_mesa_id AND mm.usuario_id=f.usuario_id);
 IF dono IS NULL THEN RAISE EXCEPTION 'Ficha destinatária não pertence a um membro desta mesa.' USING ERRCODE='22023'; END IF;
 IF p_quantidade IS NULL OR p_quantidade NOT BETWEEN 1 AND 999 OR p_entrega_id IS NULL OR p_item_data IS NULL
 OR jsonb_typeof(p_item_data)<>'object' OR octet_length(p_item_data::text)>65536
 OR length(trim(coalesce(p_item_data->>'nome',p_item_data->>'name',''))) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'Item ou quantidade inválidos.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.itens_entregues_pendentes(id,mesa_id,ficha_id,destinatario_user_id,item_data,quantidade)
 VALUES(p_entrega_id,p_mesa_id,p_ficha_id,dono,p_item_data,p_quantidade) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO anterior FROM public.itens_entregues_pendentes WHERE id=p_entrega_id;
 IF anterior.mesa_id<>p_mesa_id OR anterior.ficha_id<>p_ficha_id OR anterior.item_data<>p_item_data OR anterior.quantidade<>p_quantidade
 THEN RAISE EXCEPTION 'Identificador de entrega já utilizado.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('success',true,'id',p_entrega_id);
END $$;
CREATE FUNCTION public.confirmar_entrega_item(p_entrega_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.itens_entregues_pendentes e JOIN public.fichas f ON f.id=e.ficha_id
 WHERE e.id=p_entrega_id AND e.destinatario_user_id=auth.uid() AND f.usuario_id=auth.uid()
 AND coalesce(f.dados->'receivedDeliveryIds','[]') ? e.id::text)
 THEN RAISE EXCEPTION 'Entrega ainda não persistida na sua ficha.' USING ERRCODE='42501'; END IF;
 UPDATE public.itens_entregues_pendentes SET entregue=true WHERE id=p_entrega_id AND NOT entregue;
END $$;
-- Preserve newly received items when an older concurrent session saves a full sheet.
-- A session which knows the receipt can subsequently consume/remove the item normally.
CREATE FUNCTION public.preservar_recibos_inventario() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt text; item jsonb;
BEGIN
 IF jsonb_typeof(OLD.dados->'receivedDeliveryIds') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
 IF jsonb_array_length(OLD.dados->'receivedDeliveryIds')=0 THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.dados->'receivedDeliveryIds') IS DISTINCT FROM 'array' THEN
  NEW.dados:=jsonb_set(NEW.dados,'{receivedDeliveryIds}','[]'); END IF;
 IF jsonb_typeof(NEW.dados->'inventoryItems') IS DISTINCT FROM 'array' THEN
  NEW.dados:=jsonb_set(NEW.dados,'{inventoryItems}','[]'); END IF;
 FOR receipt IN SELECT jsonb_array_elements_text(coalesce(OLD.dados->'receivedDeliveryIds','[]')) LOOP
  IF NOT (NEW.dados->'receivedDeliveryIds' ? receipt) THEN
   SELECT e INTO item FROM jsonb_array_elements(coalesce(OLD.dados->'inventoryItems','[]')) e WHERE e->>'id'=receipt LIMIT 1;
   IF item IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.dados->'inventoryItems') e WHERE e->>'id'=receipt) THEN
    NEW.dados:=jsonb_set(NEW.dados,'{inventoryItems}',NEW.dados->'inventoryItems'||jsonb_build_array(item)); END IF;
   NEW.dados:=jsonb_set(NEW.dados,'{receivedDeliveryIds}',NEW.dados->'receivedDeliveryIds'||to_jsonb(receipt));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER preservar_recibos_inventario BEFORE UPDATE OF dados ON public.fichas FOR EACH ROW EXECUTE FUNCTION public.preservar_recibos_inventario();

-- Validate a whole tree at the boundary; optimistic versioning prevents lost edits.
CREATE FUNCTION public.validar_notas_mestre() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE pending jsonb; node jsonb; ids text[]:='{}'; batch jsonb; depth integer:=0;
BEGIN
 IF jsonb_typeof(NEW.notas_mestre) IS DISTINCT FROM 'array' OR octet_length(NEW.notas_mestre::text)>2097152 THEN
  RAISE EXCEPTION 'Caderno inválido ou maior que 2 MB.' USING ERRCODE='22023'; END IF;
 pending:=NEW.notas_mestre;
 WHILE jsonb_array_length(pending)>0 LOOP
  depth:=depth+1; IF depth>12 THEN RAISE EXCEPTION 'Limite de 12 níveis.' USING ERRCODE='22023'; END IF;
  batch:='[]';
  FOR node IN SELECT * FROM jsonb_array_elements(pending) LOOP
   IF jsonb_typeof(node)<>'object' OR coalesce(node->>'id','') !~ '^[0-9a-fA-F-]{36}$'
    OR node->>'id'=ANY(ids) OR coalesce(length(trim(node->>'nome')),0) NOT BETWEEN 1 AND 120
    OR coalesce(node->>'tipo','') NOT IN ('pasta','arquivo') THEN RAISE EXCEPTION 'Entrada de nota inválida.' USING ERRCODE='22023'; END IF;
   ids:=array_append(ids,node->>'id');
   IF cardinality(ids)>1000 THEN RAISE EXCEPTION 'Limite de 1000 entradas.' USING ERRCODE='22023'; END IF;
   IF node->>'tipo'='pasta' THEN
    IF jsonb_typeof(node->'itens') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Pasta inválida.' USING ERRCODE='22023'; END IF;
    batch:=batch||(node->'itens');
   ELSIF jsonb_typeof(node->'conteudo') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Texto inválido.' USING ERRCODE='22023'; END IF;
  END LOOP;
  pending:=batch;
 END LOOP;
 IF TG_OP='UPDATE' THEN NEW.notas_mestre_versao:=OLD.notas_mestre_versao+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validar_notas_mestre BEFORE UPDATE OF notas_mestre ON public.mesas FOR EACH ROW EXECUTE FUNCTION public.validar_notas_mestre();

CREATE TABLE public.mesa_token_status (
 token_id uuid PRIMARY KEY REFERENCES public.mesa_tokens ON DELETE CASCADE,
 mesa_id uuid NOT NULL REFERENCES public.mesas ON DELETE CASCADE, mapa_id uuid NOT NULL,
 owner_type varchar(10) NOT NULL, owner_ref uuid NOT NULL,
 six_b_total integer NOT NULL DEFAULT 6 CHECK(six_b_total BETWEEN 1 AND 120),
 danos_bloqueados integer NOT NULL DEFAULT 0 CHECK(danos_bloqueados BETWEEN 0 AND six_b_total),
 rem_current integer, rem_max integer, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((rem_current IS NULL AND rem_max IS NULL) OR (rem_max>0 AND rem_current BETWEEN 0 AND rem_max))
);
CREATE INDEX token_status_mesa_mapa ON public.mesa_token_status(mesa_id,mapa_id);
ALTER TABLE public.mesa_token_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_token_status FROM anon,authenticated;
GRANT SELECT ON public.mesa_token_status TO authenticated;
CREATE POLICY token_status_mestre_all ON public.mesa_token_status FOR SELECT TO authenticated USING(public.is_mestre_da_mesa(mesa_id));
CREATE POLICY token_status_jogadores_aliados ON public.mesa_token_status FOR SELECT TO authenticated USING(
 owner_type='player' AND EXISTS(SELECT 1 FROM public.mesa_tokens t WHERE t.id=token_id AND t.owner_type='player'
 AND public.mapa_visivel_ao_usuario(t.mesa_id,t.mapa_id) AND (t.visible_to_players OR t.owner_user_id=auth.uid())));

CREATE FUNCTION public.sincronizar_token_status(p_token_id uuid,p_six_b_total integer,p_danos_bloqueados integer,p_rem_current integer,p_rem_max integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.mesa_tokens;
BEGIN
 SELECT * INTO t FROM public.mesa_tokens WHERE id=p_token_id;
 IF auth.uid() IS NULL OR t.id IS NULL OR NOT (public.is_mestre_da_mesa(t.mesa_id) OR
  (t.owner_type='player' AND t.owner_user_id=auth.uid() AND public.mapa_visivel_ao_usuario(t.mesa_id,t.mapa_id)))
 THEN RAISE EXCEPTION 'Acesso negado para atualizar status deste token.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.mesa_token_status(token_id,mesa_id,mapa_id,owner_type,owner_ref,six_b_total,danos_bloqueados,rem_current,rem_max)
 VALUES(t.id,t.mesa_id,t.mapa_id,t.owner_type,t.owner_ref,p_six_b_total,p_danos_bloqueados,p_rem_current,p_rem_max)
 ON CONFLICT(token_id) DO UPDATE SET six_b_total=EXCLUDED.six_b_total,danos_bloqueados=EXCLUDED.danos_bloqueados,
 rem_current=EXCLUDED.rem_current,rem_max=EXCLUDED.rem_max,updated_at=now();
END $$;
-- Safe integer conversion for imported character JSON.
CREATE FUNCTION public.status_int(v text, fallback integer DEFAULT 0) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN RETURN coalesce(v::integer,fallback); EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN fallback; END $$;
CREATE FUNCTION public.resumo_status_dados(d jsonb, default_total integer DEFAULT 6) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE total integer:=0; damage integer; maxi integer; current_rem integer; part text[]; key text; marks jsonb; fatigue integer:=0;
BEGIN
 IF coalesce(d->>'config-6b','') ~* '^\s*[1-9][0-9]*d(4|6|8|10|12)(\s*\+\s*[1-9][0-9]*d(4|6|8|10|12))*\s*$' THEN
  FOR part IN SELECT regexp_matches(d->>'config-6b','([0-9]+)d(?:4|6|8|10|12)','gi') LOOP total:=least(120,total+public.status_int(part[1])); END LOOP;
 ELSIF jsonb_typeof(d->'config6B')='object' THEN
  FOREACH key IN ARRAY ARRAY['d4','d6','d8','d10','d12'] LOOP total:=least(120,total+greatest(0,public.status_int(d->'config6B'->>key))); END LOOP;
 END IF;
 total:=greatest(1,least(120,CASE WHEN total>0 THEN total ELSE default_total END));
 marks:=d->'damagedChambers';
 IF jsonb_typeof(marks) IS DISTINCT FROM 'array' THEN
  -- Legacy marked chambers include fatigue zeros; never infer damage from usedChambers.
  SELECT coalesce(max(public.status_int(c->>'grau')),0) INTO fatigue FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'activeConditions')='array' THEN d->'activeConditions' ELSE '[]' END) c WHERE lower(c->>'nome')='fatigado';
  SELECT coalesce(jsonb_agg(x),'[]') INTO marks FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'markedChambers')='array' THEN d->'markedChambers' ELSE '[]' END) x
  WHERE fatigue=0 OR public.status_int(d->'originalChambers'->>public.status_int(x#>>'{}'),121)>fatigue;
 END IF;
 SELECT count(DISTINCT public.status_int(x#>>'{}',-1)) INTO damage FROM jsonb_array_elements(marks) x WHERE public.status_int(x#>>'{}',-1) BETWEEN 0 AND total-1;
 maxi:=public.status_int(d->>'rem-total'); current_rem:=least(maxi,greatest(0,public.status_int(d->>'rem-atual')));
 RETURN jsonb_build_object('six_b_total',total,'danos_bloqueados',damage,'rem_current',CASE WHEN maxi>0 THEN current_rem END,'rem_max',CASE WHEN maxi>0 THEN maxi END);
END $$;
CREATE FUNCTION public.atualizar_status_da_fonte(p_token_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.mesa_tokens; d jsonb; s jsonb;
BEGIN
 SELECT * INTO t FROM public.mesa_tokens WHERE id=p_token_id; IF t.id IS NULL THEN RETURN; END IF;
 IF t.owner_type='player' THEN SELECT dados INTO d FROM public.fichas WHERE id=t.owner_ref;
 ELSE SELECT e->'data' INTO d FROM public.mesas m CROSS JOIN LATERAL jsonb_array_elements(coalesce(m.cena_ativa,'[]')) e WHERE m.id=t.mesa_id AND e->>'instanceId'=t.owner_ref::text; END IF;
 s:=public.resumo_status_dados(coalesce(d,'{}'),CASE WHEN t.owner_type='player' THEN 6 ELSE 1 END);
 INSERT INTO public.mesa_token_status(token_id,mesa_id,mapa_id,owner_type,owner_ref,six_b_total,danos_bloqueados,rem_current,rem_max)
 VALUES(t.id,t.mesa_id,t.mapa_id,t.owner_type,t.owner_ref,(s->>'six_b_total')::integer,(s->>'danos_bloqueados')::integer,(s->>'rem_current')::integer,(s->>'rem_max')::integer)
 ON CONFLICT(token_id) DO UPDATE SET mesa_id=EXCLUDED.mesa_id,mapa_id=EXCLUDED.mapa_id,owner_type=EXCLUDED.owner_type,owner_ref=EXCLUDED.owner_ref,
 six_b_total=EXCLUDED.six_b_total,danos_bloqueados=EXCLUDED.danos_bloqueados,rem_current=EXCLUDED.rem_current,rem_max=EXCLUDED.rem_max,updated_at=now()
 WHERE (mesa_token_status.mesa_id,mesa_token_status.mapa_id,mesa_token_status.owner_type,mesa_token_status.owner_ref,mesa_token_status.six_b_total,mesa_token_status.danos_bloqueados,mesa_token_status.rem_current,mesa_token_status.rem_max)
 IS DISTINCT FROM (EXCLUDED.mesa_id,EXCLUDED.mapa_id,EXCLUDED.owner_type,EXCLUDED.owner_ref,EXCLUDED.six_b_total,EXCLUDED.danos_bloqueados,EXCLUDED.rem_current,EXCLUDED.rem_max);
END $$;
CREATE FUNCTION public.atualizar_status_tokens_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record;
BEGIN
 IF TG_TABLE_NAME='mesa_tokens' THEN PERFORM public.atualizar_status_da_fonte(NEW.id);
 ELSIF TG_TABLE_NAME='fichas' THEN
  FOR t IN SELECT id FROM public.mesa_tokens WHERE owner_type='player' AND owner_ref=NEW.id LOOP PERFORM public.atualizar_status_da_fonte(t.id); END LOOP;
 ELSE
  FOR t IN SELECT id FROM public.mesa_tokens WHERE mesa_id=NEW.id AND owner_type='creature' LOOP PERFORM public.atualizar_status_da_fonte(t.id); END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER status_token_fonte AFTER INSERT OR UPDATE OF mapa_id,owner_ref,owner_type ON public.mesa_tokens FOR EACH ROW EXECUTE FUNCTION public.atualizar_status_tokens_trigger();
CREATE TRIGGER status_ficha_fonte AFTER INSERT OR UPDATE OF dados ON public.fichas FOR EACH ROW EXECUTE FUNCTION public.atualizar_status_tokens_trigger();
CREATE TRIGGER status_cena_fonte AFTER UPDATE OF cena_ativa ON public.mesas FOR EACH ROW EXECUTE FUNCTION public.atualizar_status_tokens_trigger();
DO $$ DECLARE t record; BEGIN FOR t IN SELECT id FROM public.mesa_tokens LOOP PERFORM public.atualizar_status_da_fonte(t.id); END LOOP; END $$;

REVOKE ALL ON FUNCTION public.enviar_item_para_jogador(uuid,uuid,jsonb,integer,uuid),public.confirmar_entrega_item(uuid),public.sincronizar_token_status(uuid,integer,integer,integer,integer),public.atualizar_status_da_fonte(uuid),public.atualizar_status_tokens_trigger(),public.validar_notas_mestre(),public.preservar_recibos_inventario(),public.status_int(text,integer),public.resumo_status_dados(jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_item_para_jogador(uuid,uuid,jsonb,integer,uuid),public.confirmar_entrega_item(uuid),public.sincronizar_token_status(uuid,integer,integer,integer,integer) TO authenticated;
-- Invoker validation/receipt triggers do not call privileged helpers.
ALTER PUBLICATION supabase_realtime ADD TABLE public.itens_entregues_pendentes,public.mesa_token_status;
NOTIFY pgrst,'reload schema';
COMMIT;

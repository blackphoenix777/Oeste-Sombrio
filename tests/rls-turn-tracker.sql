BEGIN;
CREATE TEMP TABLE tracker_results(test text,result text) ON COMMIT DROP;
GRANT SELECT,INSERT ON tracker_results TO authenticated;
DO $test$
DECLARE
 gm uuid:='11111111-1111-4111-8111-111111111111'; member uuid:='22222222-2222-4222-8222-222222222222';
 outsider uuid:='33333333-3333-4333-8333-333333333333';
 room uuid:=gen_random_uuid(); other_room uuid:=gen_random_uuid();
 ficha uuid:=gen_random_uuid(); ficha_late uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); late_p uuid:=gen_random_uuid(); late_c uuid:=gen_random_uuid(); foreign_t uuid:=gen_random_uuid();
 response jsonb; state jsonb; selected jsonb; before_tokens jsonb; before_fichas jsonb; before_mesa jsonb; before_events jsonb;
 denied boolean; version_old bigint; revision_old bigint; total integer; v1 integer; v2 integer; loops integer:=0;
BEGIN
 INSERT INTO public.mesas(id,nome,mestre_id,codigo_convite,cena_ativa,npcs_mesa)
 VALUES(room,'TRACKER temporary',gm,upper(substr(md5(random()::text),1,6)),'[{"data":{"notas":"PRIVATE","hp":17}}]','[]'),
 (other_room,'TRACKER other temporary',gm,upper(substr(md5(random()::text),1,6)),'[]','[]');
 INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo) VALUES(room,gm,'mestre'),(room,member,'jogador');
 INSERT INTO public.fichas(id,usuario_id,mesa_id,nome_personagem,dados)
 VALUES(ficha,member,room,'Player','{"iniciativa":"20","hp":9,"activeConditions":["ferido"]}'),
 (ficha_late,member,room,'Late player','{"iniciativa":"30","hp":7}');
 INSERT INTO public.eventos_mesa(mesa_id,usuario_id,tipo,visivel_para,conteudo) VALUES(room,gm,'mensagem','todos','{"texto":"history"}');
 INSERT INTO public.mesa_tokens(id,mesa_id,owner_type,owner_ref,owner_user_id,display_name,iniciativa,visible_to_players)
 VALUES(p,room,'player',ficha,member,'Player',20,false),
 (c1,room,'creature',gen_random_uuid(),NULL,'Inebriados #1',6,true),
 (c2,room,'creature',gen_random_uuid(),NULL,'Inebriados #2',8,false),
 (late_p,room,'player',ficha_late,member,'Late player',30,false),
 (late_c,room,'creature',gen_random_uuid(),NULL,'Late hidden monster',17,false),
 (foreign_t,other_room,'creature',gen_random_uuid(),NULL,'Other room',1,true);
 selected:=jsonb_build_array(jsonb_build_object('token_id',p,'modo','ficha','prioridade',3),
 jsonb_build_object('token_id',c1,'modo','cascata','prioridade',1),jsonb_build_object('token_id',c2,'modo','cascata','prioridade',2));
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.obter_combate_publico(room)->'combate'<>'null'::jsonb THEN RAISE EXCEPTION 'combate inicial'; END IF;
 INSERT INTO tracker_results VALUES('Mestre consulta mesa sem combate','PASS — null');
 denied:=false;
 BEGIN PERFORM public.gerenciar_combate(room,'iniciar',NULL,'[]'); EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'lista vazia aceita'; END IF;
 INSERT INTO tracker_results VALUES('Setup sem participantes','PASS — 22023');
 denied:=false;
 BEGIN PERFORM public.gerenciar_combate(room,'iniciar',NULL,jsonb_build_array(jsonb_build_object('token_id',foreign_t,'modo','ficha')));
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'token externo aceito'; END IF;
 INSERT INTO tracker_results VALUES('Setup com token de outra mesa','PASS — 22023');
 denied:=false;
 BEGIN PERFORM public.gerenciar_combate(room,'iniciar',NULL,selected || jsonb_build_array(selected->0));
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'duplicado aceito'; END IF;
 INSERT INTO tracker_results VALUES('Setup com token duplicado','PASS — 22023');
 response:=public.gerenciar_combate(room,'iniciar',NULL,selected); state:=response->'combate';
 IF state->>'round'<>'1' OR state->>'turno_atual_idx'<>'0' OR jsonb_array_length(state->'ordem')<>3 THEN RAISE EXCEPTION 'estado inicial'; END IF;
 INSERT INTO tracker_results VALUES('Mestre inicia combate com apenas os selecionados','PASS — round 1, índice 0, três participantes');
 SELECT (item->>'iniciativa')::integer INTO v1 FROM jsonb_array_elements(state->'ordem') item WHERE item->>'token_id'=c1::text;
 SELECT (item->>'iniciativa')::integer INTO v2 FROM jsonb_array_elements(state->'ordem') item WHERE item->>'token_id'=c2::text;
 IF v1<>v2+1 OR v1<>(state->>'cascata_d20')::integer+2 OR (state->>'cascata_d20')::integer NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'cascata'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT (item->>'iniciativa')::integer valor,lag((item->>'iniciativa')::integer) OVER(ORDER BY n) anterior
 FROM jsonb_array_elements(state->'ordem') WITH ORDINALITY e(item,n)) q WHERE valor>anterior) THEN RAISE EXCEPTION 'ordem'; END IF;
 INSERT INTO tracker_results VALUES('Cascata d20 + N e prioridades individuais; ordem unificada','PASS — primeiro=d20+2, segundo=primeiro-1');
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=c1 AND iniciativa=6) OR NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=c2 AND iniciativa=8) THEN RAISE EXCEPTION 'tokens alterados pela cascata'; END IF;
 INSERT INTO tracker_results VALUES('Cascata não sobrescreve iniciativas dos tokens/fichas','PASS');
 denied:=false;
 BEGIN PERFORM public.gerenciar_combate(room,'iniciar',NULL,selected); EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'reinício indevido'; END IF;
 INSERT INTO tracker_results VALUES('Segundo início com combate ativo','PASS — 40001');
 IF NOT EXISTS(SELECT 1 FROM public.mesa_combate_sinais WHERE mesa_id=room AND revisao>=1) THEN RAISE EXCEPTION 'sinal ausente'; END IF;
 INSERT INTO tracker_results VALUES('Início produz sinal Realtime sem nomes/ordem','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 response:=public.obter_combate_publico(room);
 IF jsonb_array_length(response->'combate'->'ordem')<>2 OR response::text LIKE '%'||c2::text||'%' OR response::text LIKE '%PRIVATE%' OR response->'combate' ? 'cascata_d20' THEN RAISE EXCEPTION 'vazamento'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'combate'->'ordem') item WHERE item->>'token_id'=p::text) THEN RAISE EXCEPTION 'próprio oculto ausente'; END IF;
 IF EXISTS(SELECT 1 FROM public.mesas WHERE id=room) THEN RAISE EXCEPTION 'linha privada exposta'; END IF;
 INSERT INTO tracker_results VALUES('Jogador recebe só próprio token e criatura visível; mesas segue privada','PASS');
 IF (SELECT count(*) FROM public.mesa_combate_sinais WHERE mesa_id=room)<>1 THEN RAISE EXCEPTION 'sinal inacessível'; END IF;
 INSERT INTO tracker_results VALUES('Membro pode ler sinal para assinar Realtime','PASS');
 FOREACH selected IN ARRAY ARRAY['"iniciar"'::jsonb,'"proximo"'::jsonb,'"adicionar"'::jsonb,'"encerrar"'::jsonb] LOOP
  denied:=false;
  BEGIN PERFORM public.gerenciar_combate(room,selected#>>'{}',(state->>'versao')::bigint,NULL,late_p,(state->>'id')::uuid);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'jogador controlou combate'; END IF;
 END LOOP;
 INSERT INTO tracker_results VALUES('Jogador não inicia/avança/adiciona/encerra via RPC','PASS — 42501 nas quatro ações');
 denied:=false;
 BEGIN UPDATE public.mesa_combate_sinais SET revisao=999 WHERE mesa_id=room; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'jogador escreve sinal'; END IF;
 UPDATE public.mesas SET combate_ativo=NULL WHERE id=room;
 GET DIAGNOSTICS total=ROW_COUNT; IF total<>0 THEN RAISE EXCEPTION 'jogador mudou mesa'; END IF;
 INSERT INTO tracker_results VALUES('Jogador não altera sinais nem combate via UPDATE direto','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 denied:=false;
 BEGIN PERFORM public.obter_combate_publico(room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied OR EXISTS(SELECT 1 FROM public.mesa_combate_sinais WHERE mesa_id=room) THEN RAISE EXCEPTION 'não-membro leu'; END IF;
 INSERT INTO tracker_results VALUES('Não-membro sem RPC ou sinal da mesa','PASS — 42501 / zero linhas');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 EXECUTE 'SET LOCAL ROLE anon';
 denied:=false;
 BEGIN PERFORM public.obter_combate_publico(room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 EXECUTE 'RESET ROLE'; IF NOT denied THEN RAISE EXCEPTION 'anon leu'; END IF;
 INSERT INTO tracker_results VALUES('Anon não executa RPC pública','PASS — 42501');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 version_old:=(state->>'versao')::bigint;
 response:=public.gerenciar_combate(room,'proximo',version_old,NULL,NULL,(state->>'id')::uuid); state:=response->'combate';
 IF state->>'turno_atual_idx'<>'1' THEN RAISE EXCEPTION 'avanço'; END IF;
 INSERT INTO tracker_results VALUES('Próximo Turno avança o índice','PASS — índice 1');
 denied:=false;
 BEGIN PERFORM public.gerenciar_combate(room,'proximo',version_old,NULL,NULL,(state->>'id')::uuid); EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'versão antiga aceita'; END IF;
 INSERT INTO tracker_results VALUES('Repetição/segunda sessão com versão antiga','PASS — 40001, sem avanço extra');
 response:=public.gerenciar_combate(room,'adicionar',(state->>'versao')::bigint,NULL,late_c,(state->>'id')::uuid); state:=response->'combate';
 IF state->'ordem'->3->>'token_id'<>late_c::text OR state->'ordem'->3->>'iniciativa'<>'0' OR state->'ordem'->3->>'entrou_no_meio'<>'true' THEN RAISE EXCEPTION 'monstro tardio'; END IF;
 INSERT INTO tracker_results VALUES('Monstro oculto tardio entra no fim com iniciativa 0 fixa','PASS');
 response:=public.gerenciar_combate(room,'adicionar',(state->>'versao')::bigint,NULL,late_p,(state->>'id')::uuid); state:=response->'combate';
 IF state->'ordem'->4->>'token_id'<>late_p::text OR state->'ordem'->4->>'iniciativa'<>'30' THEN RAISE EXCEPTION 'jogador tardio'; END IF;
 INSERT INTO tracker_results VALUES('Jogador tardio entra no fim apesar da iniciativa 30','PASS');
 revision_old:=(response->>'revisao')::bigint;
 UPDATE public.mesa_tokens SET iniciativa=99 WHERE id=c1;
 response:=public.obter_combate_publico(room);
 IF (response->>'revisao')::bigint<=revision_old THEN RAISE EXCEPTION 'sem sinal iniciativa'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'combate'->'ordem') item WHERE item->>'token_id'=c1::text AND (item->>'iniciativa')::integer=v1) THEN RAISE EXCEPTION 'cascata dinâmica'; END IF;
 INSERT INTO tracker_results VALUES('Mudança de token sinaliza atualização; cascata mantém iniciativa fixa','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 UPDATE public.fichas SET dados=jsonb_set(dados,'{iniciativa}','"40"') WHERE id=ficha_late;
 UPDATE public.fichas SET dados=jsonb_set(dados,'{iniciativa}','"0"') WHERE id=ficha;
 response:=public.obter_combate_publico(room);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'combate'->'ordem') item WHERE item->>'token_id'=late_p::text AND item->>'iniciativa'='40' AND item->>'entrou_no_meio'='true') THEN RAISE EXCEPTION 'ficha tardia'; END IF;
 IF response::text LIKE '%'||late_c::text||'%' THEN RAISE EXCEPTION 'tardio oculto exposto'; END IF;
 INSERT INTO tracker_results VALUES('Ficha atualizada aparece no resumo sem revelar monstro oculto tardio','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 WHILE state->>'round'='1' LOOP
  response:=public.gerenciar_combate(room,'proximo',(state->>'versao')::bigint,NULL,NULL,(state->>'id')::uuid); state:=response->'combate';
  loops:=loops+1; IF loops>5 THEN RAISE EXCEPTION 'round não termina'; END IF;
 END LOOP;
 IF state->>'round'<>'2' OR state->>'turno_atual_idx'<>'0' OR state->'ordem'->0->>'token_id'<>late_p::text OR
 state->'ordem'->4->>'token_id'<>late_c::text OR state->'ordem'->4->>'iniciativa'<>'0' OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(state->'ordem') item WHERE (item->>'entrou_no_meio')::boolean) THEN RAISE EXCEPTION 'round tardio'; END IF;
 INSERT INTO tracker_results VALUES('Round 2: jogador sobe com iniciativa 40; monstro segue no fim/0; flags limpas','PASS');
 IF state->'ordem'->3->>'token_id'<>p::text OR state->'ordem'->3->>'iniciativa'<>'0' THEN RAISE EXCEPTION 'empate zero tirou monstro do fim'; END IF;
 INSERT INTO tracker_results VALUES('Criatura tardia permanece depois de jogador com iniciativa zero','PASS');
 WHILE state->'ordem'->((state->>'turno_atual_idx')::integer)->>'token_id'<>c2::text LOOP
  response:=public.gerenciar_combate(room,'proximo',(state->>'versao')::bigint,NULL,NULL,(state->>'id')::uuid); state:=response->'combate';
  loops:=loops+1; IF loops>10 THEN RAISE EXCEPTION 'não alcançou oculto'; END IF;
 END LOOP;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 response:=public.obter_combate_publico(room);
 IF response->'combate'->>'turno_atual_idx'<>'-1' OR response->'combate'->>'turno_oculto'<>'true' OR response::text LIKE '%'||c2::text||'%' THEN RAISE EXCEPTION 'turno oculto vazou'; END IF;
 INSERT INTO tracker_results VALUES('Turno de criatura oculta: índice público -1, sem ID ou nome oculto','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 -- Sinal de ocultação existe mesmo quando o UPDATE do token não é visível ao jogador.
 revision_old:=(response->>'revisao')::bigint;
 PERFORM public.definir_visibilidade_token(c1,false);
 IF (SELECT revisao FROM public.mesa_combate_sinais WHERE mesa_id=room)<=revision_old THEN RAISE EXCEPTION 'ocultar sem sinal'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 response:=public.obter_combate_publico(room);
 IF response::text LIKE '%'||c1::text||'%' THEN RAISE EXCEPTION 'ocultar vazou'; END IF;
 INSERT INTO tracker_results VALUES('Ocultar gera sinal público seguro e remove entidade da RPC','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_tokens FROM public.mesa_tokens t WHERE mesa_id=room;
 SELECT jsonb_agg(to_jsonb(f) ORDER BY id) INTO before_fichas FROM public.fichas f WHERE mesa_id=room;
 SELECT to_jsonb(m)-'combate_ativo' INTO before_mesa FROM public.mesas m WHERE id=room;
 SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO before_events FROM public.eventos_mesa e WHERE mesa_id=room;
 response:=public.gerenciar_combate(room,'encerrar',(state->>'versao')::bigint,NULL,NULL,(state->>'id')::uuid);
 IF response->'combate'<>'null'::jsonb OR (SELECT combate_ativo FROM public.mesas WHERE id=room) IS NOT NULL THEN RAISE EXCEPTION 'encerrar'; END IF;
 IF before_tokens IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.mesa_tokens t WHERE mesa_id=room) OR
 before_fichas IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.fichas f WHERE mesa_id=room) OR
 before_mesa IS DISTINCT FROM (SELECT to_jsonb(m)-'combate_ativo' FROM public.mesas m WHERE id=room) OR
 before_events IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.eventos_mesa e WHERE mesa_id=room) THEN RAISE EXCEPTION 'encerrar alterou dados'; END IF;
 INSERT INTO tracker_results VALUES('Encerrar limpa só combate: tokens/fichas/HP/condições/cena/mapa/chat idênticos','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.obter_combate_publico(room)->'combate'<>'null'::jsonb THEN RAISE EXCEPTION 'jogador mantém combate'; END IF;
 INSERT INTO tracker_results VALUES('Jogador recebe null após encerramento','PASS');
 EXECUTE 'RESET ROLE';
END $test$;
SELECT * FROM tracker_results;
ROLLBACK;

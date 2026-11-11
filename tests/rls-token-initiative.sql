BEGIN;
CREATE TEMP TABLE phase2_results(test text,result text) ON COMMIT DROP;
GRANT SELECT,INSERT ON phase2_results TO authenticated;
DO $t$
DECLARE
 gm uuid:='11111111-1111-4111-8111-111111111111';
 player uuid:='22222222-2222-4222-8222-222222222222';
 outsider uuid:='33333333-3333-4333-8333-333333333333';
 room uuid:=gen_random_uuid(); other_room uuid:=gen_random_uuid();
 sheet uuid:=gen_random_uuid(); peer_sheet uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid();
 one uuid:=gen_random_uuid(); two uuid:=gen_random_uuid();
 token_one uuid:=gen_random_uuid(); token_two uuid:=gen_random_uuid();
 own_token uuid:=gen_random_uuid(); peer_token uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid();
 denied boolean; n integer; payload jsonb;
BEGIN
 INSERT INTO public.mesas(id,nome,mestre_id,codigo_convite,cena_ativa)
 VALUES(room,'PHASE2 temporary',gm,upper(substr(md5(random()::text),1,6)),
 jsonb_build_array(jsonb_build_object('instanceId',one,'sourceId',source_id,'name','Inebriados #1','data',jsonb_build_object('iniciativa','12','notas','PRIVATE')),
 jsonb_build_object('instanceId',two,'sourceId',source_id,'name','Inebriados #2','data',jsonb_build_object('iniciativa','7','notas','PRIVATE')))),
 (other_room,'PHASE2 unrelated',gm,upper(substr(md5(random()::text),1,6)),'[]');
 INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo) VALUES(room,gm,'mestre'),(room,player,'jogador');
 INSERT INTO public.fichas(id,usuario_id,mesa_id,nome_personagem,dados)
 VALUES(sheet,player,room,'PHASE2 Player','{"iniciativa":"9","notas":"PRIVATE"}'),
 (peer_sheet,outsider,room,'PHASE2 Peer','{"iniciativa":"6"}');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF auth.uid()<>gm OR NOT public.is_mestre_da_mesa(room) THEN RAISE EXCEPTION 'identidade Mestre'; END IF;
 INSERT INTO public.mesa_tokens(id,mesa_id,owner_type,owner_ref,display_name,iniciativa)
 VALUES(token_one,room,'creature',one,'Inebriados #1',12),(token_two,room,'creature',two,'Inebriados #2',7);
 IF (SELECT count(DISTINCT owner_ref) FROM public.mesa_tokens WHERE mesa_id=room)<>2 OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_one AND iniciativa=12 AND NOT visible_to_players) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_two AND iniciativa=7 AND NOT visible_to_players) THEN RAISE EXCEPTION 'cópias falharam'; END IF;
 INSERT INTO phase2_results VALUES('Mestre cria Inebriados #1/#2, IDs distintos e iniciativas 12/7','PASS');
 INSERT INTO public.mesa_tokens(id,mesa_id,owner_type,owner_ref,owner_user_id,display_name)
 VALUES(own_token,room,'player',sheet,player,'Player'),(peer_token,room,'player',peer_sheet,outsider,'Peer'),
 (unrelated,other_room,'creature',one,null,'Unrelated');
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=unrelated AND iniciativa=0 AND NOT visible_to_players) THEN RAISE EXCEPTION 'default'; END IF;
 INSERT INTO phase2_results VALUES('Token sem iniciativa usa default 0 e visibilidade false','PASS');
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=own_token AND iniciativa=9) THEN RAISE EXCEPTION 'inicializar ficha'; END IF;
 INSERT INTO phase2_results VALUES('INSERT token jogador lê iniciativa atual da própria ficha (9)','PASS');
 UPDATE public.mesa_tokens SET iniciativa=19 WHERE mesa_id=room AND owner_type='creature' AND owner_ref=one;
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_one AND iniciativa=19) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_two AND iniciativa=7) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=unrelated AND iniciativa=0) THEN RAISE EXCEPTION 'UPDATE contaminou cópia/mesa'; END IF;
 INSERT INTO phase2_results VALUES('UPDATE por mesa+instanceId muda apenas #1 (19); #2=7 e outra mesa=0','PASS');
 UPDATE public.mesas SET cena_ativa=jsonb_set(cena_ativa,'{0,data,iniciativa}','"23"') WHERE id=room;
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_one AND iniciativa=23) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_two AND iniciativa=7) THEN RAISE EXCEPTION 'save cena'; END IF;
 INSERT INTO phase2_results VALUES('Save cena privada sincroniza #1=23 sem alterar #2=7','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF auth.uid()<>player OR public.is_mestre_da_mesa(room) THEN RAISE EXCEPTION 'identidade jogador'; END IF;
 IF (SELECT count(*) FROM public.obter_cena_publica(room))<>1 OR
 NOT EXISTS(SELECT 1 FROM public.obter_cena_publica(room) WHERE token_id=own_token AND iniciativa=9 AND is_own) THEN RAISE EXCEPTION 'ocultos na RPC'; END IF;
 IF (SELECT count(*) FROM public.mesa_tokens WHERE mesa_id=room)<>1 THEN RAISE EXCEPTION 'ocultos no SELECT'; END IF;
 INSERT INTO phase2_results VALUES('Membro: RPC e SELECT retornam só próprio token, iniciativa 9','PASS');
 UPDATE public.fichas SET dados=jsonb_set(dados,'{iniciativa}','"31"') WHERE id=sheet;
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=own_token AND iniciativa=31 AND NOT visible_to_players) THEN RAISE EXCEPTION 'save jogador'; END IF;
 INSERT INTO phase2_results VALUES('Membro salva ficha: token próprio passa a 31 sem revelar visibilidade','PASS');
 denied:=false;
 BEGIN UPDATE public.mesa_tokens SET iniciativa=999 WHERE id=own_token; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'bypass iniciativa'; END IF;
 INSERT INTO phase2_results VALUES('Membro não burla ficha com UPDATE direto da iniciativa','PASS — 42501');
 denied:=false;
 BEGIN UPDATE public.mesa_tokens SET visible_to_players=true WHERE id=own_token; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'bypass visibilidade'; END IF;
 UPDATE public.mesa_tokens SET grid_x=3,grid_y=4 WHERE id=own_token;
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=own_token AND grid_x=3 AND grid_y=4 AND iniciativa=31) THEN RAISE EXCEPTION 'movimento'; END IF;
 INSERT INTO phase2_results VALUES('Membro mantém movimento; alterar visibilidade continua negado','PASS');
 UPDATE public.mesa_tokens SET iniciativa=999 WHERE id=token_two;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'alterou criatura oculta'; END IF;
 INSERT INTO phase2_results VALUES('Membro não altera iniciativa de criatura oculta','PASS — 0 linhas');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=peer_token AND iniciativa=6) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_two AND iniciativa=7) THEN RAISE EXCEPTION 'save jogador afetou outros'; END IF;
 PERFORM public.definir_visibilidade_token(token_one,true);
 INSERT INTO phase2_results VALUES('Save jogador preserva token de outro jogador e criaturas','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM public.obter_cena_publica(room))<>2 THEN RAISE EXCEPTION 'revelar'; END IF;
 SELECT to_jsonb(t) INTO payload FROM public.obter_cena_publica(room) t WHERE token_id=token_one;
 IF payload->>'iniciativa'<>'23' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>10 OR payload ? 'data' OR payload ? 'notas' THEN RAISE EXCEPTION 'resumo excessivo/incorreto'; END IF;
 IF EXISTS(SELECT 1 FROM public.mesas WHERE id=room) OR EXISTS(SELECT 1 FROM public.fichas WHERE id=peer_sheet) THEN RAISE EXCEPTION 'ficha/cena privada'; END IF;
 INSERT INTO phase2_results VALUES('Revelado #1: RPC contém iniciativa 23 e só 10 campos; cena/ficha alheia privadas','PASS');
 UPDATE public.mesa_tokens SET iniciativa=999 WHERE id=token_one;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'alterou criatura visível'; END IF;
 INSERT INTO phase2_results VALUES('Membro não altera iniciativa da criatura mesmo visível','PASS — 0 linhas');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 UPDATE public.mesas SET cena_ativa=jsonb_set(cena_ativa,'{0,data,iniciativa}','"inválida"') WHERE id=room;
 IF NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_one AND iniciativa=0) OR
 NOT EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_two AND iniciativa=7) THEN RAISE EXCEPTION 'normalização'; END IF;
 INSERT INTO phase2_results VALUES('Iniciativa inválida normaliza a 0, preservando outra cópia','PASS');
 IF (SELECT count(*) FROM public.mesa_tokens WHERE mesa_id=room)<>4 THEN RAISE EXCEPTION 'Mestre perdeu tokens'; END IF;
 INSERT INTO phase2_results VALUES('Mestre lê todos os 4 tokens, inclusive ocultos','PASS');
 PERFORM public.definir_visibilidade_token(token_one,false);
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM public.obter_cena_publica(room))<>1 OR EXISTS(SELECT 1 FROM public.mesa_tokens WHERE id=token_one) THEN RAISE EXCEPTION 'ocultar'; END IF;
 INSERT INTO phase2_results VALUES('Ocultar remove token e iniciativa da RPC e SELECT do jogador','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 denied:=false;
 BEGIN PERFORM public.obter_cena_publica(room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied OR EXISTS(SELECT 1 FROM public.mesa_tokens WHERE mesa_id=room) THEN RAISE EXCEPTION 'não-membro acessou'; END IF;
 INSERT INTO phase2_results VALUES('Não-membro: RPC negada; SELECT vazio mesmo com ficha/token na mesa','PASS');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 EXECUTE 'SET LOCAL ROLE anon';
 denied:=false;
 BEGIN PERFORM public.obter_cena_publica(room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 EXECUTE 'RESET ROLE';
 IF NOT denied THEN RAISE EXCEPTION 'anon acessou'; END IF;
 INSERT INTO phase2_results VALUES('Anon não executa RPC pública','PASS — 42501');
 IF has_function_privilege('authenticated','public.sincronizar_iniciativa_ficha_token()','EXECUTE') OR
 has_function_privilege('authenticated','public.sincronizar_iniciativa_cena_tokens()','EXECUTE') OR
 has_function_privilege('anon','public.inicializar_iniciativa_jogador_token()','EXECUTE') THEN RAISE EXCEPTION 'triggers expostos'; END IF;
 INSERT INTO phase2_results VALUES('Funções internas sem EXECUTE para clientes','PASS');
END $t$;
SELECT * FROM phase2_results;
ROLLBACK;

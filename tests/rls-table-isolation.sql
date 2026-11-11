BEGIN;
CREATE TEMP TABLE isolation_results (test text, result text) ON COMMIT DROP;
GRANT SELECT, INSERT ON isolation_results TO authenticated;
DO $test$
DECLARE
 gm uuid := '11111111-1111-4111-8111-111111111111';
 player uuid := '22222222-2222-4222-8222-222222222222';
 outsider uuid := '33333333-3333-4333-8333-333333333333';
 room uuid := gen_random_uuid();
 other_room uuid := gen_random_uuid();
 new_room uuid;
 invite text := upper(substr(md5(random()::text),1,6));
 other_invite text := upper(substr(md5(random()::text),1,6));
 own_sheet uuid := gen_random_uuid();
 peer_sheet uuid := gen_random_uuid();
 private_sheet uuid := gen_random_uuid();
 external_sheet uuid := gen_random_uuid();
 blocked boolean;
 n integer;
 returned_id uuid;
BEGIN
 INSERT INTO public.mesas(id,nome,mestre_id,codigo_convite)
 VALUES(room,'RLS temporary A',gm,invite),(other_room,'RLS temporary B',outsider,other_invite);
 INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo)
 VALUES(room,gm,'mestre'),(room,player,'jogador');
 INSERT INTO public.fichas(id,usuario_id,mesa_id,nome_personagem,dados)
 VALUES(own_sheet,player,room,'RLS own','{}'),(peer_sheet,outsider,room,'RLS peer','{}'),
 (private_sheet,outsider,null,'RLS private','{}'),(external_sheet,outsider,other_room,'RLS other room','{}');
 INSERT INTO public.eventos_mesa(mesa_id,usuario_id,tipo,visivel_para,conteudo)
 VALUES(room,gm,'mensagem','todos','{}'),(room,gm,'mensagem','mestre','{}'),
 (room,player,'mensagem','mestre','{}');

 -- Testes sem associação: as mesmas claims que auth.uid() lê nas requisições.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF current_user <> 'authenticated' OR auth.uid() <> outsider OR public.is_mestre_da_mesa(room) THEN RAISE EXCEPTION 'Identidade outsider incorreta'; END IF;
 blocked := false;
 BEGIN PERFORM public.entrar_na_mesa_por_codigo('INVALID-CODE'); EXCEPTION WHEN SQLSTATE '22023' THEN blocked := SQLERRM='Código de convite inválido'; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Convite inválido não bloqueado'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: convite inválido','PASS — 22023, Código de convite inválido');
 blocked := false;
 BEGIN PERFORM public.entrar_na_mesa_por_codigo(room::text); EXCEPTION WHEN SQLSTATE '22023' THEN blocked := true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'UUID aceito como convite'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: UUID pela nova RPC','PASS — bloqueado');
 blocked := false;
 BEGIN PERFORM public.entrar_mesa_por_codigo(room::text); EXCEPTION WHEN raise_exception THEN blocked := true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'UUID aceito pela RPC legada'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: UUID pela RPC legada','PASS — bloqueado');
 blocked := false;
 BEGIN INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo) VALUES(room,outsider,'jogador'); EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'INSERT direto permitido'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: INSERT direto jogador','PASS — RLS 42501');
 blocked := false;
 BEGIN INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo) VALUES(room,outsider,'mestre'); EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Falsificação de mestre permitida'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: INSERT fingindo ser Mestre','PASS — RLS 42501');
 SELECT count(*) INTO n FROM public.eventos_mesa WHERE mesa_id=room;
 IF n<>0 THEN RAISE EXCEPTION 'Eventos expostos a outsider: %',n; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: eventos alheios, inclusive todos','PASS — 0 linhas');
 SELECT count(*) INTO n FROM public.fichas WHERE id=own_sheet;
 IF n<>0 THEN RAISE EXCEPTION 'Ficha exposta a não-membro'; END IF;
 INSERT INTO isolation_results VALUES('Não-membro: ficha alheia','PASS — 0 linhas');

 returned_id := public.entrar_na_mesa_por_codigo(' '||lower(invite)||' ');
 IF returned_id<>room THEN RAISE EXCEPTION 'RPC retornou mesa errada'; END IF;
 SELECT count(*) INTO n FROM public.membros_mesa WHERE mesa_id=room AND usuario_id=outsider AND cargo='jogador';
 IF n<>1 THEN RAISE EXCEPTION 'Convite válido falhou'; END IF;
 INSERT INTO isolation_results VALUES('Convite válido normalizado: cria jogador','PASS — UUID correto, cargo jogador');
 PERFORM public.entrar_na_mesa_por_codigo(invite);
 PERFORM public.entrar_mesa_por_codigo(invite);
 SELECT count(*) INTO n FROM public.membros_mesa WHERE mesa_id=room AND usuario_id=outsider;
 IF n<>1 THEN RAISE EXCEPTION 'Vínculo duplicado'; END IF;
 INSERT INTO isolation_results VALUES('Reentrada e compatibilidade RPC legada','PASS — vínculo único');
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF auth.uid()<>player OR public.is_mestre_da_mesa(room) THEN RAISE EXCEPTION 'Identidade jogador incorreta'; END IF;
 SELECT count(*) INTO n FROM public.eventos_mesa WHERE mesa_id=room AND visivel_para='todos';
 IF n<>1 THEN RAISE EXCEPTION 'Jogador perdeu evento público'; END IF;
 INSERT INTO isolation_results VALUES('Membro comum: evento todos','PASS — 1 linha');
 SELECT count(*) INTO n FROM public.eventos_mesa WHERE mesa_id=room AND visivel_para='mestre' AND usuario_id=player;
 IF n<>1 THEN RAISE EXCEPTION 'Jogador perdeu evento secreto próprio'; END IF;
 INSERT INTO isolation_results VALUES('Membro comum: evento secreto próprio','PASS — 1 linha');
 SELECT count(*) INTO n FROM public.eventos_mesa WHERE mesa_id=room AND visivel_para='mestre' AND usuario_id=gm;
 IF n<>0 THEN RAISE EXCEPTION 'Segredo alheio exposto'; END IF;
 INSERT INTO isolation_results VALUES('Membro comum: segredo do Mestre','PASS — 0 linhas');
 SELECT count(*) INTO n FROM public.fichas WHERE id=peer_sheet;
 IF n<>0 THEN RAISE EXCEPTION 'Ficha do colega exposta'; END IF;
 INSERT INTO isolation_results VALUES('Membro comum: ficha de colega da mesma mesa','PASS — 0 linhas');
 SELECT count(*) INTO n FROM public.fichas WHERE id=own_sheet;
 IF n<>1 THEN RAISE EXCEPTION 'Ficha própria bloqueada'; END IF;
 INSERT INTO isolation_results VALUES('Membro comum: ficha própria','PASS — 1 linha');
 SELECT count(*) INTO n FROM public.fichas WHERE id IN(private_sheet,external_sheet);
 IF n<>0 THEN RAISE EXCEPTION 'Ficha externa/privada exposta'; END IF;
 INSERT INTO isolation_results VALUES('Regressão: fichas alheias privadas e de outra mesa','PASS — 0 linhas');
 UPDATE public.fichas SET dados='{"test":true}' WHERE id=peer_sheet;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'UPDATE de colega permitido'; END IF;
 UPDATE public.fichas SET dados='{"test":true}' WHERE id=own_sheet;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'UPDATE próprio bloqueado'; END IF;
 INSERT INTO isolation_results VALUES('Regressão: editar ficha própria/alheia','PASS — própria 1, alheia 0');
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gm,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT count(*) INTO n FROM public.fichas WHERE mesa_id=room;
 IF n<>2 THEN RAISE EXCEPTION 'Mestre não lê jogadores'; END IF;
 INSERT INTO isolation_results VALUES('Mestre: fichas dos dois jogadores','PASS — 2 linhas');
 SELECT count(*) INTO n FROM public.eventos_mesa WHERE mesa_id=room;
 IF n<>3 THEN RAISE EXCEPTION 'Mestre não lê todos eventos'; END IF;
 INSERT INTO isolation_results VALUES('Mestre: eventos públicos e secretos','PASS — 3 linhas');
 SELECT count(*) INTO n FROM public.fichas WHERE id IN(private_sheet,external_sheet);
 IF n<>0 THEN RAISE EXCEPTION 'Mestre lê fichas externas'; END IF;
 INSERT INTO isolation_results VALUES('Regressão: Mestre não lê fichas privadas/externas','PASS — 0 linhas');
 INSERT INTO public.mesas(nome,mestre_id,codigo_convite) VALUES('RLS temporary creation',gm,upper(substr(md5(random()::text),1,6))) RETURNING id INTO new_room;
 INSERT INTO public.membros_mesa(mesa_id,usuario_id,cargo) VALUES(new_room,gm,'mestre');
 SELECT count(*) INTO n FROM public.membros_mesa WHERE mesa_id=new_room AND usuario_id=gm AND cargo='mestre';
 IF n<>1 THEN RAISE EXCEPTION 'Criação de mesa não registra Mestre'; END IF;
 INSERT INTO isolation_results VALUES('Mestre: criar mesa + INSERT de vínculo como no frontend','PASS — cargo mestre');
 EXECUTE 'RESET ROLE';
 IF has_function_privilege('anon','public.entrar_na_mesa_por_codigo(text)','EXECUTE') THEN RAISE EXCEPTION 'RPC aberta a anon'; END IF;
 INSERT INTO isolation_results VALUES('RPC nova: execução anônima','PASS — privilégio negado');
END $test$;
SELECT * FROM isolation_results;
ROLLBACK;

-- Teste transacional PostgreSQL 17 / RLS / Concorrência / Idempotência para COM-09, COM-10, COM-11 e COM-12.
-- Executado exclusivamente em transação com ROLLBACK (nunca persiste dados de teste).
BEGIN;
CREATE TEMP TABLE com09_12_results(test text, result text) ON COMMIT DROP;
GRANT SELECT, INSERT ON com09_12_results TO authenticated;

DO $test$
DECLARE
  gm uuid := '11111111-1111-4111-8111-111111111111';
  player_a uuid := '22222222-2222-4222-8222-222222222222';
  player_b uuid := '33333333-3333-4333-8333-333333333333';
  outsider uuid := '44444444-4444-4444-8444-444444444444';
  room uuid := gen_random_uuid();
  other_room uuid := gen_random_uuid();
  map1 uuid := gen_random_uuid();
  map2 uuid := gen_random_uuid();
  other_map uuid := gen_random_uuid();
  ficha_a uuid := gen_random_uuid();
  ficha_b uuid := gen_random_uuid();
  tok_a uuid := gen_random_uuid();
  tok_b uuid := gen_random_uuid();
  tok_creature uuid := gen_random_uuid();
  tok_hidden uuid := gen_random_uuid();
  tok_far uuid := gen_random_uuid();
  inst_creature uuid := gen_random_uuid();
  inst_hidden uuid := gen_random_uuid();
  inst_far uuid := gen_random_uuid();
  resp jsonb;
  combat_obj jsonb;
  combat_id uuid;
  opp_id text;
  req_id text;
  req_id_2 text;
  req_id_cancel text;
  req_id_stale text;
  order_before jsonb;
  order_after jsonb;
  denied boolean;
  conflict boolean;
  bad_param boolean;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT v.id, v.email, jsonb_build_object('username', v.uname)
  FROM (
    VALUES
      (gm, 'com0912-gm@test.local', 'com0912_gm_' || substr(room::text, 1, 8)),
      (player_a, 'com0912-pa@test.local', 'com0912_pa_' || substr(room::text, 1, 8)),
      (player_b, 'com0912-pb@test.local', 'com0912_pb_' || substr(room::text, 1, 8)),
      (outsider, 'com0912-out@test.local', 'com0912_out_' || substr(room::text, 1, 8))
  ) AS v(id, email, uname)
  WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v.id)
    AND NOT EXISTS (SELECT 1 FROM public.usuarios pu WHERE pu.id = v.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.usuarios(id, username, email)
  SELECT v.id, v.uname, v.email
  FROM (
    VALUES
      (gm, 'com0912-gm@test.local', 'com0912_gm_' || substr(room::text, 1, 8)),
      (player_a, 'com0912-pa@test.local', 'com0912_pa_' || substr(room::text, 1, 8)),
      (player_b, 'com0912-pb@test.local', 'com0912_pb_' || substr(room::text, 1, 8)),
      (outsider, 'com0912-out@test.local', 'com0912_out_' || substr(room::text, 1, 8))
  ) AS v(id, email, uname)
  WHERE NOT EXISTS (SELECT 1 FROM public.usuarios pu WHERE pu.id = v.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.mesas(id, nome, mestre_id, codigo_convite, mapas, mapa_ativo_jogadores_id, npcs_mesa, cena_ativa)
  VALUES
    (
      room,
      'RLS COM09-12',
      gm,
      upper(substr(md5(random()::text), 1, 6)),
      jsonb_build_array(
        jsonb_build_object('id', map1, 'slot', 1, 'nome', 'Saloon', 'grid_cols', 24),
        jsonb_build_object('id', map2, 'slot', 2, 'nome', 'Estacao', 'grid_cols', 24)
      ),
      map1,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'instanceId', inst_creature,
          'sourceType', 'custom',
          'sourceCategory', 'NPC',
          'operationalMode', 'creature_mode',
          'data', jsonb_build_object('nome', 'Capanga Criatura', 'operationalMode', 'creature_mode', 'isCriatura', true)
        ),
        jsonb_build_object(
          'instanceId', inst_hidden,
          'sourceType', 'custom',
          'sourceCategory', 'NPC',
          'operationalMode', 'creature_mode',
          'data', jsonb_build_object('nome', 'Atirador Oculto', 'operationalMode', 'creature_mode', 'isCriatura', true)
        ),
        jsonb_build_object(
          'instanceId', inst_far,
          'sourceType', 'custom',
          'sourceCategory', 'NPC',
          'operationalMode', 'creature_mode',
          'data', jsonb_build_object('nome', 'Bandido Distante', 'operationalMode', 'creature_mode', 'isCriatura', true)
        )
      )
    ),
    (
      other_room,
      'Outra Mesa COM09-12',
      gm,
      upper(substr(md5(random()::text), 1, 6)),
      jsonb_build_array(jsonb_build_object('id', other_map, 'slot', 1, 'nome', 'Mina', 'grid_cols', 24)),
      other_map,
      '[]'::jsonb,
      '[]'::jsonb
    );

  INSERT INTO public.membros_mesa(mesa_id, usuario_id, cargo)
  VALUES
    (room, gm, 'mestre'),
    (room, player_a, 'jogador'),
    (room, player_b, 'jogador'),
    (other_room, gm, 'mestre');

  INSERT INTO public.fichas(id, usuario_id, mesa_id, nome_personagem, dados)
  VALUES
    (ficha_a, player_a, room, 'Pistoleiro A', '{"iniciativa":"15","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}'),
    (ficha_b, player_b, room, 'Pistoleiro B', '{"iniciativa":"10","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}');

  -- Coordenadas de grade: tok_a=(2,2), tok_b=(3,2) [1,5m], tok_creature=(2,3) [1,5m], tok_far=(10,10) [12m]
  INSERT INTO public.mesa_tokens(id, mesa_id, mapa_id, owner_type, owner_ref, owner_user_id, display_name, grid_x, grid_y, iniciativa, visible_to_players)
  VALUES
    (tok_a, room, map1, 'player', ficha_a, player_a, 'Pistoleiro A', 2, 2, 15, true),
    (tok_b, room, map1, 'player', ficha_b, player_b, 'Pistoleiro B', 3, 2, 10, true),
    (tok_creature, room, map1, 'creature', inst_creature, NULL, 'Capanga Criatura', 2, 3, 5, true),
    (tok_hidden, room, map1, 'creature', inst_hidden, NULL, 'Atirador Oculto', 3, 3, 4, false),
    (tok_far, room, map1, 'creature', inst_far, NULL, 'Bandido Distante', 10, 10, 2, true);

  -- 1. Inicia combate com ordem determinística (modo ficha para todos: A=15 [4 ações], B=10 [3 ações], Criatura=5 [1 ação], Oculto=4 [1 ação], Distante=2 [1 ação])
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  resp := public.gerenciar_combate(
    room, 'iniciar', NULL,
    jsonb_build_array(
      jsonb_build_object('token_id', tok_a, 'modo', 'ficha', 'prioridade', 1),
      jsonb_build_object('token_id', tok_b, 'modo', 'ficha', 'prioridade', 2),
      jsonb_build_object('token_id', tok_creature, 'modo', 'ficha', 'prioridade', 3),
      jsonb_build_object('token_id', tok_hidden, 'modo', 'ficha', 'prioridade', 4),
      jsonb_build_object('token_id', tok_far, 'modo', 'ficha', 'prioridade', 5)
    )
  );
  combat_obj := resp->'combate';
  combat_id := (combat_obj->>'id')::uuid;
  order_before := (SELECT jsonb_agg(jsonb_build_object('id', e->>'token_id', 'init', e->>'current_initiative')) FROM jsonb_array_elements(combat_obj->'ordem') e);

  -- 2. COM-11: GM tenta abrir oportunidade fora de alcance (tok_a -> tok_far: 8 quadrados = 12m > 1.5m) sem confirmação -> 22023
  bad_param := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_a, 'open_opportunity', 'op-out-of-range',
      'ataque_oportunidade', 1, NULL, NULL, tok_far, 1.5, false,
      'combate-corpo-a-corpo', true, true, 'Fora de alcance', map1, 1, (combat_obj->>'versao')::bigint, NULL, NULL
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    bad_param := true;
  END;
  IF NOT bad_param THEN RAISE EXCEPTION 'Oportunidade fora de alcance aceita sem confirmação'; END IF;
  INSERT INTO com09_12_results VALUES('COM-11: oportunidade fora de alcance (12m > 1.5m) bloqueada no servidor', 'PASS');

  -- 3. COM-10: Antes da própria vez, Jogador B (idx 1, pre_turn) solicita reação antecipada
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Jogador B não pode abrir oportunidade (42501)
  denied := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'open_opportunity', 'op-pl-open',
      'ataque_oportunidade', 1, NULL, NULL, tok_creature, 1.5, false,
      'combate-corpo-a-corpo', true, true, 'Tentativa jogador', map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador B conseguiu abrir oportunidade'; END IF;

  -- Jogador B solicita reação antecipada válida
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'request_early_reaction', 'op-req-b-1',
    'reacao', 1, NULL, NULL, NULL, NULL, false,
    NULL, false, false, 'Interceptar disparo', map1, 1, NULL, NULL, NULL
  );
  req_id := resp->'result'->>'requestId';
  IF (resp->'result'->>'status') <> 'pending' OR (resp->'result'->>'availableActions')::integer <> 3 THEN
    RAISE EXCEPTION 'Solicitação antecipada falhou ou consumiu antes da aprovação: %', resp->'result';
  END IF;

  -- Replay idempotente da solicitação com mesmo opId não duplica
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'request_early_reaction', 'op-req-b-1',
    'reacao', 1, NULL, NULL, NULL, NULL, false,
    NULL, false, false, 'Interceptar disparo', map1, 1, NULL, NULL, NULL
  );
  IF NOT coalesce((resp->'result'->>'idempotentReplay')::boolean, false) THEN
    RAISE EXCEPTION 'Replay idempotente de solicitação falhou';
  END IF;

  -- Jogador B NÃO pode aprovar a própria solicitação (42501)
  denied := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'approve_early_reaction', 'op-self-approve',
      'reacao', NULL, NULL, req_id, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador B aprovou a própria reação antecipada'; END IF;

  -- Jogador A NÃO vê a solicitação privada de Jogador B e não pode cancelá-la (42501)
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.obter_combate_publico(room);
  IF jsonb_array_length(coalesce(resp->'combate'->'solicitacoes_reacao', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'Vazamento de solicitação de reação de Jogador B para Jogador A';
  END IF;
  denied := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'cancel_early_reaction', 'op-a-cancel-b',
      'reacao', NULL, NULL, req_id, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador A cancelou solicitação de Jogador B'; END IF;
  INSERT INTO com09_12_results VALUES('COM-10: solicitação antecipada, idempotência, sigilo entre jogadores e bloqueio de autoaprovação (42501)', 'PASS');

  -- 4. Xerife nega a primeira solicitação -> zero ações consumidas
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'deny_early_reaction', 'op-deny-b-1',
    'reacao', NULL, NULL, req_id, NULL, NULL, false,
    NULL, NULL, false, NULL, map1, 1, NULL, NULL, 'Sem linha de visão'
  );
  IF (resp->'result'->>'status') <> 'denied' OR (resp->'result'->>'availableActions')::integer <> 3 THEN
    RAISE EXCEPTION 'Negação alterou saldo: %', resp->'result';
  END IF;

  -- 5. Jogador B solicita e cancela a própria solicitação pendente -> zero consumo
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'request_early_reaction', 'op-req-b-cancel',
    'reacao', 1, NULL, NULL, NULL, NULL, false,
    NULL, false, false, 'Desistiu', map1, 1, NULL, NULL, NULL
  );
  req_id_cancel := resp->'result'->>'requestId';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'cancel_early_reaction', 'op-do-cancel-b',
    'reacao', NULL, NULL, req_id_cancel, NULL, NULL, false,
    NULL, NULL, false, NULL, map1, 1, NULL, NULL, 'Mudou de ideia'
  );
  IF (resp->'result'->>'status') <> 'cancelled' OR (resp->'result'->>'availableActions')::integer <> 3 THEN
    RAISE EXCEPTION 'Cancelamento próprio falhou: %', resp->'result';
  END IF;

  -- 6. Jogador B solicita novamente e Xerife aprova -> consome 1 ação (3 -> 2), ordem/iniciativa inalteradas, dupla aprovação bloqueada
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'request_early_reaction', 'op-req-b-2',
    'reacao', 1, NULL, NULL, NULL, NULL, false,
    NULL, false, false, 'Esquivar de explosão', map1, 1, NULL, NULL, NULL
  );
  req_id_2 := resp->'result'->>'requestId';

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'approve_early_reaction', 'op-approve-b-2',
    'reacao', NULL, NULL, req_id_2, NULL, NULL, false,
    NULL, NULL, false, NULL, map1, 1, NULL, 1, 'Aprovado pelo Xerife'
  );
  IF (resp->'result'->>'status') <> 'approved' OR (resp->'result'->>'availableActions')::integer <> 2 OR (resp->'result'->>'spentActions')::integer <> 1 THEN
    RAISE EXCEPTION 'Aprovação não debitou exatamente 1 ação: %', resp->'result';
  END IF;
  order_after := (SELECT jsonb_agg(jsonb_build_object('id', e->>'token_id', 'init', e->>'current_initiative')) FROM jsonb_array_elements(resp->'combate'->'ordem') e);
  IF order_after IS DISTINCT FROM order_before THEN
    RAISE EXCEPTION 'Aprovação de reação antecipada alterou ordem/iniciativa!';
  END IF;

  -- Replay idempotente da aprovação com mesmo opId não debita novamente
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_b, 'approve_early_reaction', 'op-approve-b-2',
    'reacao', NULL, NULL, req_id_2, NULL, NULL, false,
    NULL, NULL, false, NULL, map1, 1, NULL, 1, 'Aprovado pelo Xerife'
  );
  IF NOT coalesce((resp->'result'->>'idempotentReplay')::boolean, false) OR (resp->'result'->>'availableActions')::integer <> 2 THEN
    RAISE EXCEPTION 'Replay idempotente de aprovação debitou duas vezes!';
  END IF;

  -- Segunda aprovação com opId diferente retorna PT409
  conflict := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'approve_early_reaction', 'op-approve-b-2-dup',
      'reacao', NULL, NULL, req_id_2, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, 'Duplicada'
    );
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'Dupla aprovação com opId distinto não retornou PT409'; END IF;
  INSERT INTO com09_12_results VALUES('COM-10: negação (0 débito), cancelamento, aprovação (-1 ação sem mudar ordem), idempotência e PT409 em dupla aprovação', 'PASS');

  -- 7. COM-09 + COM-11: Avança turno de A -> B (tok_a fica post_turn com 4 ações preservadas)
  combat_obj := resp->'combate';
  resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
  combat_obj := resp->'combate';

  -- Jogador A tenta ação ordinária pós-turno -> bloqueada (22023)
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  bad_param := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-a-post-ord', 'atacar', 1, NULL, false, false, map1, 1, 1);
  EXCEPTION WHEN invalid_parameter_value THEN
    bad_param := true;
  END;
  IF NOT bad_param THEN RAISE EXCEPTION 'Ação ordinária pós-turno permitida para Jogador A'; END IF;

  -- Xerife abre oportunidade válida para Jogador A (tok_a=(2,2) vs tok_creature=(2,3) -> 1,5m <= 1,5m)
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_a, 'open_opportunity', 'op-open-a-1',
    'ataque_oportunidade', 1, NULL, NULL, tok_creature, 1.5, false,
    'combate-corpo-a-corpo', true, true, 'Capanga tentou recuar', map1, 1, NULL, NULL, NULL
  );
  opp_id := resp->'result'->>'opportunityId';
  IF (resp->'result'->>'rangeStatus') <> 'in_range' OR (resp->'result'->>'gridDistanceMeters')::numeric <> 1.5 THEN
    RAISE EXCEPTION 'Cálculo de distância na grade incorreto: %', resp->'result';
  END IF;

  -- Jogador A executa reação pós-turno contra a oportunidade aberta -> consome 1 ação (4 -> 3)
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_a, 'execute_opportunity_reaction', 'op-exec-a-1',
    'ataque_oportunidade', NULL, opp_id, NULL, NULL, NULL, false,
    NULL, NULL, false, NULL, map1, 1, NULL, 1, NULL
  );
  IF (resp->'result'->>'status') <> 'committed' OR (resp->'result'->>'availableActions')::integer <> 3 THEN
    RAISE EXCEPTION 'Execução de reação pós-turno falhou: %', resp->'result';
  END IF;

  -- Segunda execução da mesma oportunidade com opId diferente -> PT409
  conflict := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_a, 'execute_opportunity_reaction', 'op-exec-a-dup',
      'ataque_oportunidade', NULL, opp_id, NULL, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'Oportunidade já consumida aceita novamente'; END IF;
  INSERT INTO com09_12_results VALUES('COM-09/11: ação ordinária bloqueada pós-turno, oportunidade 1.5m válida, consumo pós-turno (4->3) e PT409 em reuso', 'PASS');

  -- 8. Solicitação pendente de criatura pré-turno expira automaticamente quando chega o turno dela (sem débito)
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.gerenciar_reacao_combate(
    room, combat_id, tok_creature, 'request_early_reaction', 'op-req-cr-1',
    'reacao', 1, NULL, NULL, NULL, NULL, false,
    NULL, false, false, 'Reação criatura', map1, 1, NULL, NULL, NULL
  );
  req_id_stale := resp->'result'->>'requestId';
  combat_obj := resp->'combate';
  -- Avança turno de B -> Capanga Criatura (agora é a vez da criatura -> solicitação antecipada expira!)
  resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
  conflict := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_creature, 'approve_early_reaction', 'op-app-cr-stale',
      'reacao', NULL, NULL, req_id_stale, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'Solicitação expirada após início do turno foi aprovada'; END IF;

  -- Avança até Round 2: criatura encerra turno preservando 1 ação pós-turno e depois expira na virada da rodada
  combat_obj := resp->'combate';
  WHILE (combat_obj->>'round')::integer = 1 LOOP
    resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
    combat_obj := resp->'combate';
  END LOOP;

  -- Tentar aprovar solicitação da Rodada 1 na Rodada 2 -> PT409
  conflict := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'approve_early_reaction', 'op-old-round-app',
      'reacao', NULL, NULL, req_id_2, NULL, NULL, false,
      NULL, NULL, false, NULL, map1, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'Solicitação de rodada antiga aceita na Rodada 2'; END IF;

  -- Verifica que na Rodada 2 os saldos foram resetados sem transporte (A=4, B=3, Criatura=1) e oportunidades/solicitações limpas
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(combat_obj->'ordem') e WHERE e->>'token_id' = tok_a::text AND (e->'action_state'->>'spentActions')::integer = 0 AND (e->'action_state'->>'initialBudget')::integer = 4)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(combat_obj->'ordem') e WHERE e->>'token_id' = tok_creature::text AND (e->'action_state'->>'spentActions')::integer = 0 AND (e->'action_state'->>'initialBudget')::integer = 1)
     OR jsonb_array_length(combat_obj->'oportunidades_reacao') <> 0
     OR jsonb_array_length(combat_obj->'solicitacoes_reacao') <> 0 THEN
    RAISE EXCEPTION 'Virada de rodada não expirou saldos/oportunidades/solicitações corretamente';
  END IF;
  INSERT INTO com09_12_results VALUES('COM-09/10: expiração de solicitação ao iniciar turno e expiração limpa na virada para Round 2 (PT409 em rodada antiga)', 'PASS');

  -- 9. Privilégios EXECUTE + bloqueio de outsider e anon (42501)
  EXECUTE 'RESET ROLE';
  IF has_function_privilege('anon', 'public.gerenciar_reacao_combate(uuid,uuid,uuid,text,text,text,integer,text,text,uuid,numeric,boolean,text,boolean,boolean,text,uuid,integer,bigint,bigint,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.gerenciar_reacao_combate(uuid,uuid,uuid,text,text,text,integer,text,text,uuid,numeric,boolean,text,boolean,boolean,text,uuid,integer,bigint,bigint,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.gerenciar_reacao_combate(uuid,uuid,uuid,text,text,text,integer,text,text,uuid,numeric,boolean,text,boolean,boolean,text,uuid,integer,bigint,bigint,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.calcular_fase_turno_combate(jsonb,jsonb,integer)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Privilégios EXECUTE de COM-09..COM-12 inconsistentes';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN
    PERFORM public.gerenciar_reacao_combate(
      room, combat_id, tok_b, 'request_early_reaction', 'op-outsider',
      'reacao', 1, NULL, NULL, NULL, NULL, false,
      NULL, false, false, 'Intruso', map1, 2, NULL, NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Usuário externo à mesa executou gerenciar_reacao_combate'; END IF;
  EXECUTE 'RESET ROLE';
  INSERT INTO com09_12_results VALUES('Segurança SQL/RLS: privilégios EXECUTE, bloqueio anon/public e bloqueio de usuário externo (42501)', 'PASS');
END $test$;

SELECT * FROM com09_12_results;
ROLLBACK;

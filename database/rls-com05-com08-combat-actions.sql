-- ATENÇÃO: Script de VERIFICAÇÃO transacional (NÃO É MIGRAÇÃO - envolto em BEGIN/ROLLBACK). Espelho de tests/rls-com05-com08-combat-actions.sql.
-- Teste transacional PostgreSQL/RLS para COM-05..COM-08 (preparado para execução após aprovação de database/com05-com08-combat-state-and-actions.sql).
BEGIN;
CREATE TEMP TABLE com05_08_results(test text, result text) ON COMMIT DROP;
GRANT SELECT, INSERT ON com05_08_results TO authenticated;

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
  tok_map2 uuid := gen_random_uuid();
  tok_monster uuid := gen_random_uuid();
  tok_hidden uuid := gen_random_uuid();
  tok_m1 uuid := gen_random_uuid();
  tok_m2 uuid := gen_random_uuid();
  tok_m3 uuid := gen_random_uuid();
  tok_m4 uuid := gen_random_uuid();
  inst_monster uuid := gen_random_uuid();
  inst_hidden uuid := gen_random_uuid();
  inst_m2 uuid := gen_random_uuid();
  inst_m3 uuid := gen_random_uuid();
  inst_m4 uuid := gen_random_uuid();
  resp jsonb;
  combat_obj jsonb;
  combat_id uuid;
  other_combat jsonb;
  res_obj jsonb;
  res_replay jsonb;
  denied boolean;
  err_sqlstate text;
BEGIN
  -- Garante usuários sintéticos em auth.users/public.usuarios dentro da transação de ROLLBACK.
  INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT v.id, v.email, jsonb_build_object('username', v.uname)
  FROM (
    VALUES
      (gm, 'com0508-gm@test.local', 'com0508_gm_' || substr(room::text, 1, 8)),
      (player_a, 'com0508-pa@test.local', 'com0508_pa_' || substr(room::text, 1, 8)),
      (player_b, 'com0508-pb@test.local', 'com0508_pb_' || substr(room::text, 1, 8)),
      (outsider, 'com0508-out@test.local', 'com0508_out_' || substr(room::text, 1, 8))
  ) AS v(id, email, uname)
  WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v.id)
    AND NOT EXISTS (SELECT 1 FROM public.usuarios pu WHERE pu.id = v.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.usuarios(id, username, email)
  SELECT v.id, v.uname, v.email
  FROM (
    VALUES
      (gm, 'com0508-gm@test.local', 'com0508_gm_' || substr(room::text, 1, 8)),
      (player_a, 'com0508-pa@test.local', 'com0508_pa_' || substr(room::text, 1, 8)),
      (player_b, 'com0508-pb@test.local', 'com0508_pb_' || substr(room::text, 1, 8)),
      (outsider, 'com0508-out@test.local', 'com0508_out_' || substr(room::text, 1, 8))
  ) AS v(id, email, uname)
  WHERE NOT EXISTS (SELECT 1 FROM public.usuarios pu WHERE pu.id = v.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.mesas(id, nome, mestre_id, codigo_convite, mapas, mapa_ativo_jogadores_id, npcs_mesa, cena_ativa)
  VALUES
    (
      room,
      'RLS COM05-08',
      gm,
      upper(substr(md5(random()::text), 1, 6)),
      jsonb_build_array(
        jsonb_build_object('id', map1, 'slot', 1, 'nome', 'Saloon', 'grid_cols', 24),
        jsonb_build_object('id', map2, 'slot', 2, 'nome', 'Canion', 'grid_cols', 24)
      ),
      map1,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'instanceId', inst_monster,
          'sourceType', 'oficial',
          'sourceCategory', 'Criatura',
          'data', jsonb_build_object('nome', 'Inebriados', 'acoes_por_turno', 2)
        ),
        jsonb_build_object(
          'instanceId', inst_hidden,
          'sourceType', 'custom',
          'sourceCategory', 'NPC',
          'operationalMode', 'creature_mode',
          'data', jsonb_build_object('nome', 'Bandido Oculto', 'operationalMode', 'creature_mode', 'isCriatura', true)
        )
      )
    ),
    (
      other_room,
      'RLS COM05-08 Bestiario',
      gm,
      upper(substr(md5(random()::text), 1, 6)),
      jsonb_build_array(
        jsonb_build_object('id', other_map, 'slot', 1, 'nome', 'Ruinas', 'grid_cols', 24)
      ),
      other_map,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('instanceId', inst_monster, 'sourceType', 'oficial', 'sourceCategory', 'Criatura', 'data', jsonb_build_object('nome', 'Inebriados', 'acoes_por_turno', 2)),
        jsonb_build_object('instanceId', inst_m2, 'sourceType', 'oficial', 'sourceCategory', 'Criatura', 'data', jsonb_build_object('nome', 'Gosma Eterna', 'acoes_por_turno', 2)),
        jsonb_build_object('instanceId', inst_m3, 'sourceType', 'oficial', 'sourceCategory', 'Criatura', 'data', jsonb_build_object('nome', 'Cão das Sombras', 'acoes_por_turno', 3)),
        jsonb_build_object('instanceId', inst_m4, 'sourceType', 'oficial', 'sourceCategory', 'Criatura', 'data', jsonb_build_object('nome', 'Verme do Carvão', 'acoes_por_turno', 3))
      )
    );

  INSERT INTO public.membros_mesa(mesa_id, usuario_id, cargo)
  VALUES
    (room, gm, 'mestre'),
    (room, player_a, 'jogador'),
    (room, player_b, 'jogador'),
    (other_room, gm, 'mestre');

  INSERT INTO public.fichas(id, usuario_id, mesa_id, nome_personagem, dados)
  VALUES
    (ficha_a, player_a, room, 'Pistoleiro A', '{"iniciativa":"10","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}'),
    (ficha_b, player_b, room, 'Pistoleiro B', '{"iniciativa":"6","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}');

  INSERT INTO public.mesa_tokens(id, mesa_id, mapa_id, owner_type, owner_ref, owner_user_id, display_name, iniciativa, visible_to_players)
  VALUES
    (tok_a, room, map1, 'player', ficha_a, player_a, 'Pistoleiro A', 10, true),
    (tok_b, room, map1, 'player', ficha_b, player_b, 'Pistoleiro B', 6, true),
    (tok_map2, room, map2, 'creature', gen_random_uuid(), NULL, 'Guarda Mapa 2', 12, true),
    (tok_monster, room, map1, 'creature', inst_monster, NULL, 'Inebriados #1', 0, true),
    (tok_hidden, room, map1, 'creature', inst_hidden, NULL, 'Bandido Oculto', 0, false),
    (tok_m1, other_room, other_map, 'creature', inst_monster, NULL, 'Inebriados', 0, true),
    (tok_m2, other_room, other_map, 'creature', inst_m2, NULL, 'Gosma Eterna', 0, true),
    (tok_m3, other_room, other_map, 'creature', inst_m3, NULL, 'Cão das Sombras', 0, true),
    (tok_m4, other_room, other_map, 'creature', inst_m4, NULL, 'Verme do Carvão', 0, true);

  -- 1. Mestre inicia combate e servidor cria current_initiative + action_state canônico
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  resp := public.gerenciar_combate(
    room,
    'iniciar',
    NULL,
    jsonb_build_array(
      jsonb_build_object('token_id', tok_a, 'modo', 'ficha', 'prioridade', 1),
      jsonb_build_object('token_id', tok_b, 'modo', 'ficha', 'prioridade', 2),
      jsonb_build_object('token_id', tok_monster, 'modo', 'cascata', 'prioridade', 1),
      jsonb_build_object('token_id', tok_hidden, 'modo', 'cascata', 'prioridade', 2)
    )
  );
  combat_obj := resp->'combate';
  combat_id := (combat_obj->>'id')::uuid;

  -- Avança deterministicamente até o turno de tok_a (caso a cascata aleatória tenha rolado > 10)
  WHILE (combat_obj->'ordem'->((combat_obj->>'turno_atual_idx')::integer)->>'token_id') <> tok_a::text LOOP
    resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
    combat_obj := resp->'combate';
  END LOOP;
  INSERT INTO com05_08_results VALUES('Mestre inicia combate com action_state persistido no servidor', 'PASS');

  -- 2. Jogador A atualiza iniciativa da ficha mid-round -> frozen current_initiative=10 e next_round_initiative=24
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', player_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.fichas SET dados = jsonb_set(dados, '{iniciativa}', '"24"') WHERE id = ficha_a;
  resp := public.obter_combate_publico(room);

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(resp->'combate'->'ordem') e
    WHERE e->>'token_id' = tok_a::text
      AND (e->>'current_initiative')::integer = 10
      AND (e->>'next_round_initiative')::integer = 24
      AND (e->'action_state'->>'initialBudget')::integer = 3
  ) THEN
    RAISE EXCEPTION 'Iniciativa vigente/futura não preservada no snapshot público';
  END IF;
  INSERT INTO com05_08_results VALUES('Iniciativa vigente congelada (10) e futura (24) registrada na mesma rodada', 'PASS');

  -- 3. Sigilo: jogador A NÃO recebe action_state de tok_b nem tok_hidden
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(resp->'combate'->'ordem') e
    WHERE e->>'token_id' = tok_b::text AND e ? 'action_state'
  ) OR resp::text LIKE '%' || tok_hidden::text || '%' THEN
    RAISE EXCEPTION 'Vazamento de action_state alheio ou token oculto';
  END IF;
  INSERT INTO com05_08_results VALUES('Sigilo de action_state alheio e de participantes ocultos preservado', 'PASS');

  -- 4. Jogador A tenta modificar orçamento de tok_b -> 42501
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_b, 'reserve', 'op-b-stolen', 'atacar', 1, NULL, false, false, map1, 1, 1);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador A alterou combatente B'; END IF;

  -- Jogador A tenta criar ação customizada -> 42501
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-player-custom', 'custom', 1, NULL, false, false, map1, 1, 1, 'Tentativa de jogador');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador A executou ação customizada'; END IF;

  -- Jogador A tenta usar reação por conta própria (p_is_reaction = true) -> 42501
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-player-react', 'ataque_oportunidade', 1, NULL, true, false, map1, 1, 1);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Jogador A autorizou reação sem Xerife'; END IF;
  INSERT INTO com05_08_results VALUES('Jogador bloqueado de alterar outro combatente, usar custom ou autorizar reação (42501)', 'PASS');

  -- 5. Reserva válida no turno de tok_a + custo adulterado + reação/custom GM + idempotência pós-rede
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- tok_a é o turno ativo (idx 0): reserva ação normal limpar_olhos (custo 2)
  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-r1-res', 'limpar_olhos', 2, NULL, false, false, map1, 1, 1);
  res_obj := resp->'result';
  IF (res_obj->>'availableActions')::integer <> 1 OR (res_obj->>'version')::integer <> 2 THEN
    RAISE EXCEPTION 'Reserva inválida: %', res_obj;
  END IF;

  -- Repetição idempotente após queda de rede com mesma op_id e expected_version antiga (1)
  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-r1-res', 'limpar_olhos', 2, NULL, false, false, map1, 1, 1);
  res_replay := resp->'result';
  IF NOT (res_replay->>'idempotentReplay')::boolean OR (res_replay->>'availableActions')::integer <> 1 THEN
    RAISE EXCEPTION 'Idempotência falhou: %', res_replay;
  END IF;

  -- Repetição da MESMA op_id com payload diferente DEVE ser rejeitada (22023)
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-r1-res', 'atacar', 1, NULL, false, false, map1, 1, 1);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Mesma op_id com payload divergente aceita'; END IF;
  INSERT INTO com05_08_results VALUES('Reserva transacional, replay idempotente sem duplo débito e rejeição de payload divergente com mesma op_id', 'PASS');

  -- 6. Payload com custo adulterado -> 22023
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-tamper', 'remover_desorientado', 1, NULL, false, false, map1, 1, 2);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Custo adulterado aceito'; END IF;

  -- Mestre tentando custom sem justificativa -> 22023
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-gm-no-just', 'custom', 1, NULL, false, false, map1, 1, 2, '');
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Custom sem justificativa aceita'; END IF;

  -- Reação com actionType não elegível para reação -> 22023
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-bad-react-type', 'limpar_olhos', 2, NULL, true, false, map1, 1, 2);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Tipo inválido em reação aceito'; END IF;

  -- 7. Operação com versão obsoleta -> P0409 (conflito otimista sem retry automático do PostgREST)
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-stale', 'atacar', 1, NULL, false, false, map1, 1, 1);
  EXCEPTION WHEN SQLSTATE 'P0409' OR serialization_failure THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Versão obsoleta aceita'; END IF;

  -- 8. Mapa incorreto -> 22023
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-map', 'atacar', 1, NULL, false, false, map2, 1, 2);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Mapa incorreto aceito'; END IF;
  INSERT INTO com05_08_results VALUES('Custo adulterado, custom sem justificativa, tipo de reação inválido, versão obsoleta e mapa incorreto rejeitados', 'PASS');

  -- 9. Virada de rodada bloqueada com reserva pendente -> commit -> reação GM válida -> custom GM com justificativa
  resp := public.obter_combate_publico(room);
  combat_obj := resp->'combate';
  -- Avança até o fim da rodada 1 (encerra turno de tok_a mantendo 1 ação restante para reação)
  WHILE (combat_obj->>'turno_atual_idx')::integer < jsonb_array_length(combat_obj->'ordem') - 1 LOOP
    resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
    combat_obj := resp->'combate';
  END LOOP;

  denied := false;
  BEGIN
    PERFORM public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Virada de rodada permitida com reserva pendente'; END IF;

  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'commit', 'op-c1', NULL, NULL, res_obj->>'reservationId', false, true, map1, 1, 2);
  IF (resp->'result'->>'spentActions')::integer <> 2 THEN
    RAISE EXCEPTION 'Commit não registrou gasto';
  END IF;

  -- Mestre autoriza reação pós-turno de tok_a consumindo a 1 ação restante
  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-gm-react', 'ataque_oportunidade', 1, NULL, true, false, map1, 1, 3, 'Ataque de oportunidade aprovado');
  IF (resp->'result'->>'availableActions')::integer <> 0 OR (resp->'result'->>'reason') <> 'Ataque de oportunidade aprovado' THEN
    RAISE EXCEPTION 'Reação pós-turno autorizada pelo Mestre falhou: %', resp->'result';
  END IF;
  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'commit', 'op-gm-react-c', NULL, NULL, resp->'result'->>'reservationId', true, true, map1, 1, 4);

  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'cancel', 'op-cancel-after', NULL, NULL, res_obj->>'reservationId', false, false, map1, 1, 5);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cancelamento após commit permitido'; END IF;
  INSERT INTO com05_08_results VALUES('Bloqueio de virada pendente, commit, reação autorizada pelo Mestre e proibição de reembolso pós-commit', 'PASS');

  -- 10. Virada válida para Round 2 promove iniciativa 24 -> orçamento 5, zera saldo anterior e permite custom do Mestre com justificativa
  resp := public.obter_combate_publico(room);
  combat_obj := resp->'combate';
  resp := public.gerenciar_combate(room, 'proximo', (combat_obj->>'versao')::bigint, NULL, NULL, combat_id);
  combat_obj := resp->'combate';
  IF (combat_obj->>'round')::integer <> 2 OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(combat_obj->'ordem') e
    WHERE e->>'token_id' = tok_a::text
      AND (e->>'current_initiative')::integer = 24
      AND (e->'action_state'->>'initialBudget')::integer = 5
      AND (e->'action_state'->>'spentActions')::integer = 0
  ) THEN
    RAISE EXCEPTION 'Virada de rodada 2 não promoveu iniciativa/orçamento corretamente';
  END IF;

  -- No Round 2 (tok_a é idx 0 pois 24 > máx cascata 22), Mestre registra ação customizada com justificativa
  resp := public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-gm-custom', 'custom', 2, NULL, false, false, map1, 2, 1, 'Manobra especial de cena');
  IF (resp->'result'->>'cost')::integer <> 2 OR (resp->'result'->>'availableActions')::integer <> 3 THEN
    RAISE EXCEPTION 'Ação customizada do Mestre falhou: %', resp->'result';
  END IF;
  INSERT INTO com05_08_results VALUES('Round 2 promove 24 -> 5 ações sem transportar gastos e aceita custom do Mestre com justificativa', 'PASS');

  -- 11. Compatibilidade com combate já em andamento iniciado antes da migração (sem action_state / current_initiative)
  EXECUTE 'RESET ROLE';
  UPDATE public.mesas
  SET combate_ativo = jsonb_set(
    combate_ativo,
    '{ordem}',
    (
      SELECT jsonb_agg(item - 'action_state' - 'current_initiative' - 'next_round_initiative')
      FROM jsonb_array_elements(combate_ativo->'ordem') item
    )
  )
  WHERE id = room;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resp := public.obter_combate_publico(room);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(resp->'combate'->'ordem') e
    WHERE e->>'token_id' = tok_a::text
      AND (e->>'current_initiative')::integer = 24
      AND jsonb_typeof(e->'action_state') = 'object'
      AND (e->'action_state'->>'initialBudget')::integer = 5
  ) THEN
    RAISE EXCEPTION 'Combate pré-migração não foi compatibilizado por obter_combate_publico';
  END IF;
  INSERT INTO com05_08_results VALUES('Compatibilidade retroativa com combate iniciado antes da migração validada', 'PASS');

  -- 12. Isolamento entre mesas e mapas (token de outro mapa e combate de outra mesa bloqueados)
  resp := public.obter_combate_publico(room);
  combat_obj := resp->'combate';
  denied := false;
  BEGIN
    PERFORM public.gerenciar_combate(room, 'adicionar', (combat_obj->>'versao')::bigint, NULL, tok_map2, combat_id);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Token de outro mapa adicionado ao combate'; END IF;

  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(other_room, combat_id, tok_a, 'reserve', 'op-cross-room', 'atacar', 1, NULL, false, false, map1, 2, 1);
  EXCEPTION WHEN invalid_parameter_value OR SQLSTATE 'P0409' OR serialization_failure THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Operação aceita entre mesas distintas'; END IF;
  INSERT INTO com05_08_results VALUES('Isolamento entre mesas e mapas preservado', 'PASS');

  -- 13. Preservação das ações fixas dos 4 monstros oficiais (Inebriados=2, Gosma=2, Cão=3, Verme=3)
  resp := public.gerenciar_combate(
    other_room,
    'iniciar',
    NULL,
    jsonb_build_array(
      jsonb_build_object('token_id', tok_m1, 'modo', 'cascata', 'prioridade', 1),
      jsonb_build_object('token_id', tok_m2, 'modo', 'cascata', 'prioridade', 2),
      jsonb_build_object('token_id', tok_m3, 'modo', 'cascata', 'prioridade', 3),
      jsonb_build_object('token_id', tok_m4, 'modo', 'cascata', 'prioridade', 4)
    )
  );
  other_combat := resp->'combate';
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(other_combat->'ordem') e WHERE e->>'token_id' = tok_m1::text AND (e->'action_state'->>'initialBudget')::integer = 2)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(other_combat->'ordem') e WHERE e->>'token_id' = tok_m2::text AND (e->'action_state'->>'initialBudget')::integer = 2)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(other_combat->'ordem') e WHERE e->>'token_id' = tok_m3::text AND (e->'action_state'->>'initialBudget')::integer = 3)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(other_combat->'ordem') e WHERE e->>'token_id' = tok_m4::text AND (e->'action_state'->>'initialBudget')::integer = 3) THEN
    RAISE EXCEPTION 'Orçamentos fixos dos 4 monstros oficiais incorretos: %', other_combat->'ordem';
  END IF;
  INSERT INTO com05_08_results VALUES('Ações fixas dos 4 monstros oficiais preservadas na RPC SQL (2, 2, 3, 3)', 'PASS');

  -- 14. Verificação efetiva de privilégios EXECUTE das RPCs e funções internas + bloqueio de anon
  EXECUTE 'RESET ROLE';
  IF has_function_privilege('anon', 'public.gerenciar_acao_combate(uuid,uuid,uuid,text,text,text,integer,text,boolean,boolean,uuid,integer,bigint,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.gerenciar_acao_combate(uuid,uuid,uuid,text,text,text,integer,text,boolean,boolean,uuid,integer,bigint,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.gerenciar_acao_combate(uuid,uuid,uuid,text,text,text,integer,text,boolean,boolean,uuid,integer,bigint,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.custo_canonico_acao_combate(text,integer,boolean,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.atualizar_resumo_combate(uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.criar_action_state_combate(public.mesas,uuid,uuid,integer,public.mesa_tokens,integer)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Privilégios EXECUTE das funções COM-05..COM-08 inconsistentes';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  denied := false;
  BEGIN
    PERFORM public.gerenciar_acao_combate(room, combat_id, tok_a, 'reserve', 'op-anon', 'atacar', 1, NULL, false, false, map1, 2, 1);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Anon executou gerenciar_acao_combate'; END IF;
  EXECUTE 'RESET ROLE';
  INSERT INTO com05_08_results VALUES('Privilégios efetivos de catálogo e bloqueio anon validados (42501)', 'PASS');
END $test$;

SELECT * FROM com05_08_results;
ROLLBACK;

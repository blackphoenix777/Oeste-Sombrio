-- COM-05, COM-06, COM-07 e COM-08:
-- Persistência canônica da rodada (current_initiative / next_round_initiative / action_state),
-- custos canônicos no servidor e RPC transacional idempotente gerenciar_acao_combate.
-- ATENÇÃO: Arquivo preparado para revisão; NÃO aplicar em produção sem aprovação explícita.

DROP FUNCTION IF EXISTS public.custo_canonico_acao_combate(text, integer);
CREATE OR REPLACE FUNCTION public.custo_canonico_acao_combate(
  p_action_type text,
  p_requested_cost integer DEFAULT NULL,
  p_is_gm boolean DEFAULT false,
  p_justificativa text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_action_type, '')));
  v_canonical integer;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'Tipo de ação ausente' USING ERRCODE = '22023';
  END IF;

  IF v_key = 'custom' THEN
    IF NOT coalesce(p_is_gm, false) THEN
      RAISE EXCEPTION 'Apenas o Mestre pode autorizar ações customizadas' USING ERRCODE = '42501';
    END IF;
    IF p_requested_cost IS NULL OR p_requested_cost NOT BETWEEN 1 AND 10 THEN
      RAISE EXCEPTION 'Custo customizado fora do intervalo permitido (1..10)' USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_justificativa, '')) = '' THEN
      RAISE EXCEPTION 'Justificativa obrigatória para ação customizada' USING ERRCODE = '22023';
    END IF;
    RETURN p_requested_cost;
  END IF;

  IF p_requested_cost IS NOT NULL AND p_requested_cost < 1 THEN
    RAISE EXCEPTION 'Custo de ação inválido ou adulterado' USING ERRCODE = '22023';
  END IF;

  IF v_key IN (
    'atacar', 'mover', 'mirar', 'recarregar', 'usar_item', 'magia',
    'narrativa', 'apagar_fogo', 'em_chamas', 'ataque_oportunidade',
    'reacao', 'ataque_aprimorado_inebriado'
  ) THEN
    v_canonical := 1;
  ELSIF v_key IN (
    'limpar_olhos', 'remover_cego_fuligem', 'salto_das_sombras',
    'onda_de_dejetos', 'quebrar_objeto', 'habilidade_2_acoes'
  ) THEN
    v_canonical := 2;
  ELSIF v_key = 'remover_desorientado' THEN
    v_canonical := 3;
  ELSE
    RAISE EXCEPTION 'Tipo de ação desconhecido: %', v_key USING ERRCODE = '22023';
  END IF;

  IF p_requested_cost IS NOT NULL AND p_requested_cost <> v_canonical THEN
    RAISE EXCEPTION 'Custo adulterado para %: esperado %, recebido %', v_key, v_canonical, p_requested_cost
      USING ERRCODE = '22023';
  END IF;

  RETURN v_canonical;
END $$;
REVOKE ALL ON FUNCTION public.custo_canonico_acao_combate(text, integer, boolean, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.calcular_orcamento_inicial_combate(
  p_mesa public.mesas,
  p_tok public.mesa_tokens,
  p_current_init integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_dados jsonb := '{}'::jsonb;
  v_inst jsonb := NULL;
  v_op_mode text := NULL;
  v_is_criatura text := NULL;
  v_source_type text := NULL;
  v_source_cat text := NULL;
  v_tipo_ficha text := NULL;
  v_is_official_monster boolean := false;
  v_fixed_actions integer := NULL;
  v_conds jsonb := '[]'::jsonb;
  v_incapacitated boolean := false;
  v_stunned_deg integer := 0;
  v_init integer := greatest(0, coalesce(p_current_init, 0));
  v_bonus_raw integer := floor(greatest(0, coalesce(p_current_init, 0)) / 5.0)::integer;
  v_loose_count integer := 0;
  v_atletismo_lvl integer := 0;
  v_capacity integer := 2;
  v_overloaded boolean := false;
  v_lost_overload integer := 0;
  v_budget integer := NULL;
  v_elem jsonb;
  v_cname text;
  v_item jsonb;
  v_loc text;
  v_qty integer;
  v_die text;
BEGIN
  IF p_tok.owner_type = 'player' THEN
    SELECT coalesce(f.dados, '{}'::jsonb) INTO v_dados
    FROM public.fichas f
    WHERE f.id = p_tok.owner_ref AND f.mesa_id = p_mesa.id;
    v_op_mode := 'full_sheet';
  ELSE
    SELECT c.item INTO v_inst
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_mesa.cena_ativa) = 'array' THEN p_mesa.cena_ativa ELSE '[]'::jsonb END
    ) c(item)
    WHERE c.item->>'instanceId' = p_tok.owner_ref::text
    LIMIT 1;

    v_dados := coalesce(v_inst->'data', '{}'::jsonb);
    v_source_type := lower(btrim(coalesce(v_inst->>'sourceType', '')));
    v_source_cat := lower(btrim(coalesce(v_inst->>'sourceCategory', '')));
    v_tipo_ficha := lower(btrim(coalesce(v_dados->>'tipo_ficha', '')));
    v_is_official_monster := (
      v_source_type = 'oficial'
      AND v_source_cat <> 'npc'
      AND v_tipo_ficha <> 'npc'
      AND (v_dados->'isBestiaryCustom') IS DISTINCT FROM 'true'::jsonb
    ) OR v_tipo_ficha = 'monstro';

    v_op_mode := coalesce(
      nullif(v_inst->>'operationalMode', ''),
      nullif(v_dados->>'operationalMode', '')
    );
    IF v_op_mode IS NULL THEN
      v_is_criatura := coalesce(v_inst->>'isCriatura', v_dados->>'isCriatura', v_dados->>'is-criatura');
      IF v_is_criatura = 'true' THEN
        v_op_mode := 'creature_mode';
      ELSIF v_is_criatura = 'false' THEN
        v_op_mode := 'full_sheet';
      END IF;
    END IF;
  END IF;

  -- Inspeciona condições incapacitantes e Atordoado
  v_conds := CASE WHEN jsonb_typeof(v_dados->'activeConditions') = 'array' THEN v_dados->'activeConditions' ELSE '[]'::jsonb END;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(v_conds) LOOP
    v_cname := lower(btrim(coalesce(
      CASE WHEN jsonb_typeof(v_elem) = 'string' THEN v_elem #>> '{}' ELSE coalesce(v_elem->>'nome', v_elem->>'name', v_elem->>'id') END,
      ''
    )));
    IF v_cname IN ('paralisado', 'paralizado', 'inconsciente', 'cobertura total') THEN
      v_incapacitated := true;
    ELSIF v_cname = 'atordoado' THEN
      v_stunned_deg := v_stunned_deg + greatest(0, coalesce(public.normalizar_iniciativa_token(coalesce(v_elem->>'grau', v_elem->>'degree', '1')), 1));
    END IF;
  END LOOP;

  -- NPC legado sem modalidade definida mantém orçamento indefinido
  IF p_tok.owner_type <> 'player' AND v_op_mode IS NULL AND NOT v_is_official_monster THEN
    RETURN jsonb_build_object(
      'budget_defined', false,
      'pending_reason', 'legacy_npc_operational_mode_unset',
      'initial_budget', NULL,
      'kind', 'npc_human',
      'operational_mode', NULL
    );
  END IF;

  -- Monstro do bestiário: quantidade fixa da ficha sem escalar pela cascata
  IF v_is_official_monster THEN
    IF coalesce(v_dados->>'acoes_por_turno', '') ~ '^[0-9]+$' THEN
      v_fixed_actions := (v_dados->>'acoes_por_turno')::integer;
    ELSIF coalesce(v_dados->>'acoes_fixas', '') ~ '^[0-9]+$' THEN
      v_fixed_actions := (v_dados->>'acoes_fixas')::integer;
    ELSIF coalesce(v_dados->>'acoesFixas', '') ~ '^[0-9]+$' THEN
      v_fixed_actions := (v_dados->>'acoesFixas')::integer;
    ELSIF coalesce(v_dados->>'acoes', '') ~ '^[0-9]+$' THEN
      v_fixed_actions := (v_dados->>'acoes')::integer;
    END IF;

    IF v_fixed_actions IS NULL THEN
      RETURN jsonb_build_object(
        'budget_defined', false,
        'pending_reason', 'bestiary_monster_fixed_actions_undefined',
        'initial_budget', NULL,
        'kind', 'bestiary_monster',
        'operational_mode', coalesce(v_op_mode, 'creature_mode')
      );
    END IF;

    v_budget := CASE WHEN v_incapacitated THEN 0 ELSE greatest(0, v_fixed_actions) END;
    RETURN jsonb_build_object(
      'budget_defined', true,
      'pending_reason', NULL,
      'initial_budget', v_budget,
      'kind', 'bestiary_monster',
      'operational_mode', coalesce(v_op_mode, 'creature_mode')
    );
  END IF;

  -- NPC Criatura: 1 ação básica fixa (0 se incapacitado)
  IF v_op_mode = 'creature_mode' THEN
    v_budget := CASE WHEN v_incapacitated THEN 0 ELSE 1 END;
    RETURN jsonb_build_object(
      'budget_defined', true,
      'pending_reason', NULL,
      'initial_budget', v_budget,
      'kind', CASE WHEN (v_dados->'isVeterano' = 'true'::jsonb OR v_dados->'is-veterano' = 'true'::jsonb) THEN 'npc_veteran' ELSE 'npc_human' END,
      'operational_mode', 'creature_mode'
    );
  END IF;

  -- Jogador ou NPC Avançado (full_sheet): 1 + floor(init / 5) - sobrecarga - Atordoado (mín 1)
  IF v_incapacitated THEN
    RETURN jsonb_build_object(
      'budget_defined', true,
      'pending_reason', NULL,
      'initial_budget', 0,
      'kind', CASE WHEN p_tok.owner_type = 'player' THEN 'player' WHEN (v_dados->'isVeterano' = 'true'::jsonb OR v_dados->'is-veterano' = 'true'::jsonb) THEN 'npc_veteran' ELSE 'npc_human' END,
      'operational_mode', 'full_sheet'
    );
  END IF;

  FOREACH v_die IN ARRAY ARRAY['d4', 'd6', 'd8', 'd10', 'd12'] LOOP
    IF (v_dados->('pericia-atletismo-' || v_die)) = 'true'::jsonb THEN
      v_atletismo_lvl := v_atletismo_lvl + 1;
    END IF;
  END LOOP;
  v_capacity := 2 + (v_atletismo_lvl * 2);

  IF jsonb_typeof(v_dados->'inventoryItems') = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_dados->'inventoryItems') LOOP
      v_loc := coalesce(nullif(lower(btrim(v_item->>'storageLocation')), ''), 'solto');
      IF v_loc = 'solto'
         AND lower(btrim(coalesce(v_item->>'listId', ''))) <> 'animais'
         AND lower(btrim(coalesce(v_item->>'name', v_item->>'nome', ''))) NOT IN ('aguia', 'coruja', 'cavalo', 'cabra', 'vaca')
         AND NOT (
           (v_item->'equipped') = 'true'::jsonb
           AND lower(btrim(coalesce(v_item->>'name', v_item->>'nome', ''))) ~ '^(alforjes?|sela|barda)\b'
         ) THEN
        v_qty := greatest(1, coalesce(public.normalizar_iniciativa_token(coalesce(v_item->>'qty', '1')), 1));
        v_loose_count := v_loose_count + v_qty;
      END IF;
    END LOOP;
  END IF;

  v_overloaded := (v_loose_count > v_capacity);
  v_lost_overload := CASE WHEN v_overloaded THEN 2 ELSE 0 END;
  v_budget := 1 + greatest(0, v_bonus_raw - v_lost_overload - v_stunned_deg);

  RETURN jsonb_build_object(
    'budget_defined', true,
    'pending_reason', NULL,
    'initial_budget', v_budget,
    'kind', CASE WHEN p_tok.owner_type = 'player' THEN 'player' WHEN (v_dados->'isVeterano' = 'true'::jsonb OR v_dados->'is-veterano' = 'true'::jsonb) THEN 'npc_veteran' ELSE 'npc_human' END,
    'operational_mode', 'full_sheet'
  );
END $$;
REVOKE ALL ON FUNCTION public.calcular_orcamento_inicial_combate(public.mesas, public.mesa_tokens, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.criar_action_state_combate(
  p_mesa public.mesas,
  p_combate_id uuid,
  p_mapa_id uuid,
  p_round integer,
  p_tok public.mesa_tokens,
  p_current_init integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_budget jsonb := public.calcular_orcamento_inicial_combate(p_mesa, p_tok, p_current_init);
BEGIN
  RETURN jsonb_build_object(
    'mesaId', p_mesa.id,
    'combateId', p_combate_id,
    'mapaId', coalesce(p_mapa_id, p_tok.mapa_id),
    'round', p_round,
    'combatantId', p_tok.id,
    'instanceId', p_tok.owner_ref,
    'kind', v_budget->'kind',
    'operationalMode', v_budget->'operational_mode',
    'currentInitiative', p_current_init,
    'budgetDefined', (v_budget->>'budget_defined')::boolean,
    'pendingReason', v_budget->'pending_reason',
    'initialBudget', v_budget->'initial_budget',
    'spentActions', 0,
    'reservedActions', 0,
    'turnEnded', false,
    'version', 1,
    'ledger', '[]'::jsonb,
    'auditLog', '[]'::jsonb,
    'opResults', '{}'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public.criar_action_state_combate(public.mesas, uuid, uuid, integer, public.mesa_tokens, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.item_combate_v2(
  t public.mesa_tokens,
  curr_init integer,
  next_init integer,
  fonte text,
  tardio boolean,
  action_state jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'token_id', t.id,
    'owner_ref', t.owner_ref,
    'owner_type', t.owner_type,
    'name', t.display_name,
    'image_url', t.image_url,
    'iniciativa', curr_init,
    'current_initiative', curr_init,
    'next_round_initiative', CASE WHEN next_init IS NOT NULL AND next_init <> curr_init THEN to_jsonb(next_init) ELSE 'null'::jsonb END,
    'visible_to_players', t.visible_to_players,
    'entrou_no_meio', tardio,
    'iniciativa_fonte', fonte,
    'action_state', coalesce(action_state, 'null'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.item_combate_v2(public.mesa_tokens, integer, integer, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- Mantém iniciativa vigente congelada durante a rodada, registra mudanças em next_round_initiative
-- e garante compatibilidade automática de combates iniciados antes da migração (COM-05..COM-08).
CREATE OR REPLACE FUNCTION public.atualizar_resumo_combate(room uuid, estado jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  m_row public.mesas;
  lista jsonb;
  idx integer;
  antigo integer := coalesce((estado->>'turno_atual_idx')::integer, 0);
  v_round integer := greatest(1, coalesce((estado->>'round')::integer, 1));
  v_cid uuid := NULLIF(estado->>'id', '')::uuid;
  v_mid uuid := NULLIF(estado->>'mapa_id', '')::uuid;
BEGIN
  IF estado IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m_row FROM public.mesas WHERE id = room;
  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH vivos AS (
    SELECT
      e.n,
      public.item_combate_v2(
        t,
        CASE
          WHEN e.item->>'iniciativa_fonte' = 'ficha'
            THEN public.normalizar_iniciativa_token(coalesce(e.item->>'current_initiative', e.item->>'iniciativa'))
          ELSE public.normalizar_iniciativa_token(coalesce(e.item->>'current_initiative', e.item->>'iniciativa'))
        END,
        CASE
          WHEN e.item->>'iniciativa_fonte' = 'ficha'
               AND t.iniciativa IS DISTINCT FROM public.normalizar_iniciativa_token(coalesce(e.item->>'current_initiative', e.item->>'iniciativa'))
            THEN t.iniciativa
          WHEN e.item->>'iniciativa_fonte' = 'ficha' AND e.item->>'next_round_initiative' IS NOT NULL
            THEN public.normalizar_iniciativa_token(e.item->>'next_round_initiative')
          ELSE NULL
        END,
        e.item->>'iniciativa_fonte',
        coalesce((e.item->>'entrou_no_meio')::boolean, false),
        CASE
          WHEN jsonb_typeof(e.item->'action_state') = 'object'
               AND (e.item->'action_state'->>'round')::integer = v_round
            THEN e.item->'action_state'
          ELSE public.criar_action_state_combate(
            m_row,
            v_cid,
            coalesce(v_mid, t.mapa_id),
            v_round,
            t,
            public.normalizar_iniciativa_token(coalesce(e.item->>'current_initiative', e.item->>'iniciativa'))
          )
        END
      ) AS item
    FROM jsonb_array_elements(estado->'ordem') WITH ORDINALITY e(item, n)
    JOIN public.mesa_tokens t
      ON t.id::text = e.item->>'token_id'
     AND t.mesa_id = room
     AND (estado->>'mapa_id' IS NULL OR t.mapa_id::text = estado->>'mapa_id')
  )
  SELECT
    coalesce(jsonb_agg(item ORDER BY n), '[]'::jsonb),
    coalesce((SELECT count(*)::integer FROM vivos WHERE n < coalesce((SELECT min(n) FROM vivos WHERE n > antigo), (SELECT min(n) FROM vivos))), 0)
  INTO lista, idx
  FROM vivos;

  IF jsonb_array_length(lista) = 0 THEN
    idx := -1;
  END IF;

  RETURN estado || jsonb_build_object('ordem', lista, 'turno_atual_idx', idx);
END $$;
REVOKE ALL ON FUNCTION public.atualizar_resumo_combate(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Protege campos privados do action_state/next_round_initiative de outros jogadores no retorno público.
CREATE OR REPLACE FUNCTION public.obter_combate_publico(p_mesa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  estado jsonb;
  lista jsonb;
  atual text := NULL;
  v_turn_idx integer;
  idx integer;
  gm boolean;
  rev bigint;
  v_player_map uuid;
BEGIN
  gm := public.is_mestre_da_mesa(p_mesa_id);
  IF auth.uid() IS NULL OR NOT (gm OR EXISTS (
    SELECT 1 FROM public.membros_mesa WHERE mesa_id = p_mesa_id AND usuario_id = auth.uid()
  )) THEN
    RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE = '42501';
  END IF;

  SELECT
    public.atualizar_resumo_combate(m.id, m.combate_ativo),
    coalesce(s.revisao, 0),
    m.mapa_ativo_jogadores_id
  INTO estado, rev, v_player_map
  FROM public.mesas m
  LEFT JOIN public.mesa_combate_sinais s ON s.mesa_id = m.id
  WHERE m.id = p_mesa_id;

  IF NOT gm AND estado IS NOT NULL AND estado->>'mapa_id' IS DISTINCT FROM v_player_map::text THEN
    estado := NULL;
  END IF;

  IF estado IS NULL OR gm THEN
    RETURN jsonb_build_object('combate', estado, 'revisao', rev);
  END IF;

  v_turn_idx := coalesce((estado->>'turno_atual_idx')::integer, -1);
  IF v_turn_idx >= 0 AND v_turn_idx < jsonb_array_length(coalesce(estado->'ordem', '[]'::jsonb)) THEN
    atual := estado->'ordem'->v_turn_idx->>'token_id';
  END IF;
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN t.owner_user_id = auth.uid() THEN e.item
      ELSE (e.item - 'action_state' - 'next_round_initiative')
    END
    ORDER BY e.n
  ), '[]'::jsonb) INTO lista
  FROM jsonb_array_elements(estado->'ordem') WITH ORDINALITY e(item, n)
  JOIN public.mesa_tokens t ON t.id::text = e.item->>'token_id' AND t.mesa_id = p_mesa_id
  WHERE public.mapa_visivel_ao_usuario(p_mesa_id, t.mapa_id)
    AND (t.visible_to_players OR t.owner_user_id = auth.uid());

  SELECT (n - 1)::integer INTO idx
  FROM jsonb_array_elements(lista) WITH ORDINALITY e(item, n)
  WHERE item->>'token_id' = atual;

  RETURN jsonb_build_object(
    'revisao', rev,
    'combate', jsonb_build_object(
      'id', estado->'id',
      'ativo', true,
      'mapa_id', estado->'mapa_id',
      'versao', estado->'versao',
      'round', estado->'round',
      'turno_atual_idx', coalesce(idx, -1),
      'turno_oculto', atual IS NOT NULL AND idx IS NULL,
      'ordem', lista
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.obter_combate_publico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_combate_publico(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.gerenciar_combate(
  p_mesa_id uuid,
  p_acao text,
  p_versao bigint DEFAULT NULL,
  p_participantes jsonb DEFAULT NULL,
  p_token_id uuid DEFAULT NULL,
  p_combate_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  mesa_row public.mesas;
  estado jsonb;
  lista jsonb := '[]';
  escolha jsonb;
  tok public.mesa_tokens;
  combat_map uuid;
  v_combat_id uuid;
  total integer;
  cascata integer;
  dado integer;
  pos integer := 0;
  valor integer;
  fonte text;
  idx integer;
  rodada integer;
  v_old_tid text;
  v_new_tid text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_mestre_da_mesa(p_mesa_id) THEN
    RAISE EXCEPTION 'Apenas o Mestre pode controlar o combate' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO mesa_row FROM public.mesas WHERE id = p_mesa_id FOR UPDATE;
  estado := mesa_row.combate_ativo;

  IF p_acao = 'iniciar' THEN
    IF estado IS NOT NULL THEN
      RAISE EXCEPTION 'Já existe um combate ativo. Atualize o tracker.' USING ERRCODE = '40001';
    END IF;
    IF p_participantes IS NULL OR jsonb_typeof(p_participantes) <> 'array' OR jsonb_array_length(p_participantes) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Selecione entre 1 e 200 participantes' USING ERRCODE = '22023';
    END IF;
    total := jsonb_array_length(p_participantes);
    IF (SELECT count(DISTINCT item->>'token_id') FROM jsonb_array_elements(p_participantes) item) <> total THEN
      RAISE EXCEPTION 'Participante duplicado' USING ERRCODE = '22023';
    END IF;

    v_combat_id := gen_random_uuid();
    SELECT count(*) INTO cascata FROM jsonb_array_elements(p_participantes) item WHERE item->>'modo' = 'cascata';
    IF cascata > 0 THEN
      dado := floor(random() * 20)::integer + 1;
    END IF;

    FOR escolha IN
      SELECT item FROM jsonb_array_elements(p_participantes) item
      ORDER BY public.normalizar_iniciativa_token(item->>'prioridade'), item->>'token_id'
    LOOP
      SELECT * INTO tok FROM public.mesa_tokens WHERE id::text = escolha->>'token_id' AND mesa_id = p_mesa_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Participante não está mais nesta cena' USING ERRCODE = '22023';
      END IF;
      IF combat_map IS NULL THEN
        combat_map := tok.mapa_id;
      ELSIF combat_map IS DISTINCT FROM tok.mapa_id THEN
        RAISE EXCEPTION 'Selecione participantes do mesmo mapa' USING ERRCODE = '22023';
      END IF;
      fonte := escolha->>'modo';
      IF fonte IS NULL OR fonte NOT IN ('ficha', 'cascata') OR (tok.owner_type = 'player' AND fonte <> 'ficha') THEN
        RAISE EXCEPTION 'Modo de iniciativa inválido' USING ERRCODE = '22023';
      END IF;
      IF fonte = 'cascata' THEN
        valor := dado + cascata - pos;
        pos := pos + 1;
      ELSE
        valor := tok.iniciativa;
      END IF;
      lista := lista || jsonb_build_array(
        public.item_combate_v2(
          tok,
          valor,
          NULL,
          fonte,
          false,
          public.criar_action_state_combate(mesa_row, v_combat_id, combat_map, 1, tok, valor)
        )
      );
    END LOOP;

    SELECT jsonb_agg(item ORDER BY (item->>'iniciativa')::integer DESC, item->>'name', item->>'token_id')
    INTO lista FROM jsonb_array_elements(lista) item;

    estado := jsonb_build_object(
      'id', v_combat_id,
      'ativo', true,
      'round', 1,
      'turno_atual_idx', 0,
      'ordem', lista,
      'versao', 1,
      'cascata_d20', dado,
      'cascata_total', cascata,
      'mapa_id', combat_map
    );
  ELSE
    IF estado IS NULL OR p_combate_id IS NULL OR p_combate_id::text <> estado->>'id'
       OR p_versao IS DISTINCT FROM (estado->>'versao')::bigint THEN
      RAISE EXCEPTION 'Combate atualizado em outra sessão. Confira a ordem antes de tentar novamente.' USING ERRCODE = '40001';
    END IF;

    estado := public.atualizar_resumo_combate(p_mesa_id, estado);
    lista := estado->'ordem';
    idx := (estado->>'turno_atual_idx')::integer;
    rodada := (estado->>'round')::integer;
    v_combat_id := (estado->>'id')::uuid;
    combat_map := (estado->>'mapa_id')::uuid;

    IF p_acao = 'encerrar' THEN
      estado := NULL;
    ELSIF p_acao = 'adicionar' THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(lista) item WHERE item->>'token_id' = p_token_id::text) THEN
        RAISE EXCEPTION 'Esta entidade já participa do combate' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO tok FROM public.mesa_tokens WHERE id = p_token_id AND mesa_id = p_mesa_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Token não está nesta cena' USING ERRCODE = '22023';
      END IF;
      IF tok.mapa_id IS DISTINCT FROM combat_map THEN
        RAISE EXCEPTION 'Token pertence a outro mapa' USING ERRCODE = '22023';
      END IF;
      valor := CASE WHEN tok.owner_type = 'player' THEN tok.iniciativa ELSE 0 END;
      fonte := CASE WHEN tok.owner_type = 'player' THEN 'ficha' ELSE 'fixa' END;
      lista := lista || jsonb_build_array(
        public.item_combate_v2(
          tok,
          valor,
          NULL,
          fonte,
          true,
          public.criar_action_state_combate(mesa_row, v_combat_id, combat_map, rodada, tok, valor)
        )
      );
    ELSIF p_acao = 'proximo' THEN
      total := jsonb_array_length(lista);
      IF total = 0 THEN
        RAISE EXCEPTION 'Não há participantes em cena. Encerre o combate ou adicione alguém.' USING ERRCODE = '22023';
      END IF;

      IF idx >= 0 AND idx < total THEN
        v_old_tid := lista->idx->>'token_id';
        SELECT jsonb_agg(
          CASE
            WHEN item->>'token_id' = v_old_tid AND jsonb_typeof(item->'action_state') = 'object'
              THEN jsonb_set(item, '{action_state,turnEnded}', 'true'::jsonb, true)
            ELSE item
          END
          ORDER BY n
        ) INTO lista
        FROM jsonb_array_elements(lista) WITH ORDINALITY e(item, n);
      END IF;

      idx := idx + 1;
      IF idx >= total THEN
        -- Bloqueia virada de rodada se houver reserva pendente sem confirmação/cancelamento.
        IF EXISTS (
          SELECT 1
          FROM jsonb_array_elements(lista) it,
               jsonb_array_elements(coalesce(it->'action_state'->'ledger', '[]'::jsonb)) led
          WHERE led->>'status' = 'reserved'
        ) THEN
          RAISE EXCEPTION 'Resolva ou cancele as reservas de ação pendentes antes de encerrar a rodada' USING ERRCODE = '22023';
        END IF;

        idx := 0;
        rodada := rodada + 1;

        SELECT jsonb_agg(
          (
            public.item_combate_v2(
              t,
              promoted_val,
              NULL,
              it.item->>'iniciativa_fonte',
              false,
              public.criar_action_state_combate(mesa_row, v_combat_id, combat_map, rodada, t, promoted_val)
            )
          )
          ORDER BY (it.item->>'iniciativa_fonte' = 'fixa'), promoted_val DESC, t.display_name, t.id::text
        ) INTO lista
        FROM jsonb_array_elements(lista) it(item)
        JOIN public.mesa_tokens t ON t.id::text = it.item->>'token_id' AND t.mesa_id = p_mesa_id
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN it.item->>'iniciativa_fonte' = 'ficha' THEN
              coalesce(
                CASE WHEN it.item->>'next_round_initiative' IS NOT NULL THEN public.normalizar_iniciativa_token(it.item->>'next_round_initiative') END,
                t.iniciativa
              )
            ELSE public.normalizar_iniciativa_token(coalesce(it.item->>'current_initiative', it.item->>'iniciativa'))
          END AS promoted_val
        ) calc;
      ELSE
        v_new_tid := lista->idx->>'token_id';
        SELECT jsonb_agg(
          CASE
            WHEN item->>'token_id' = v_new_tid AND jsonb_typeof(item->'action_state') = 'object'
              THEN jsonb_set(item, '{action_state,turnEnded}', 'false'::jsonb, true)
            ELSE item
          END
          ORDER BY n
        ) INTO lista
        FROM jsonb_array_elements(lista) WITH ORDINALITY e(item, n);
      END IF;
    ELSE
      RAISE EXCEPTION 'Ação de combate inválida' USING ERRCODE = '22023';
    END IF;

    IF estado IS NOT NULL THEN
      estado := estado || jsonb_build_object(
        'ordem', lista,
        'round', rodada,
        'turno_atual_idx', idx,
        'versao', (estado->>'versao')::bigint + 1
      );
    END IF;
  END IF;

  UPDATE public.mesas SET combate_ativo = estado WHERE id = p_mesa_id;
  RETURN public.obter_combate_publico(p_mesa_id);
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_combate(uuid, text, bigint, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_combate(uuid, text, bigint, jsonb, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.gerenciar_acao_combate(uuid, uuid, uuid, text, text, text, integer, text, boolean, boolean, uuid, integer, bigint);
CREATE OR REPLACE FUNCTION public.gerenciar_acao_combate(
  p_mesa_id uuid,
  p_combate_id uuid,
  p_token_id uuid,
  p_operacao text,
  p_op_id text,
  p_action_type text DEFAULT NULL,
  p_cost integer DEFAULT NULL,
  p_reservation_id text DEFAULT NULL,
  p_is_reaction boolean DEFAULT false,
  p_result_revealed boolean DEFAULT false,
  p_mapa_id uuid DEFAULT NULL,
  p_round integer DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_justificativa text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  mesa_row public.mesas;
  tok public.mesa_tokens;
  estado jsonb;
  lista jsonb;
  idx integer := 0;
  v_item jsonb := NULL;
  v_item_pos integer := -1;
  v_as jsonb;
  v_ledger jsonb;
  v_audit jsonb;
  v_op_results jsonb;
  v_gm boolean;
  v_op text := lower(btrim(coalesce(p_operacao, '')));
  v_op_id text := btrim(coalesce(p_op_id, ''));
  v_action_key text := lower(btrim(coalesce(p_action_type, '')));
  v_reason text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_target_action_key text;
  v_prev jsonb;
  v_req_res_id text;
  v_idemp_match boolean;
  v_next_seq integer;
  v_cost integer;
  v_avail integer;
  v_spent integer := 0;
  v_reserved integer := 0;
  v_res_id text;
  v_evicted_entry jsonb := NULL;
  v_evicted_match boolean;
  v_target_res jsonb := NULL;
  v_target_pos integer := -1;
  v_turn_idx integer;
  v_is_curr_turn boolean;
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_out jsonb;
  v_pub jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501';
  END IF;
  IF v_op_id = '' THEN
    RAISE EXCEPTION 'Identificador único de operação (p_op_id) é obrigatório' USING ERRCODE = '22023';
  END IF;

  v_gm := public.is_mestre_da_mesa(p_mesa_id);
  IF NOT v_gm AND NOT EXISTS (
    SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id = p_mesa_id AND mm.usuario_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO mesa_row FROM public.mesas WHERE id = p_mesa_id FOR UPDATE;
  estado := mesa_row.combate_ativo;

  IF estado IS NULL OR NOT coalesce((estado->>'ativo')::boolean, false) THEN
    RAISE EXCEPTION 'Não há combate ativo nesta mesa' USING ERRCODE = '22023';
  END IF;
  IF p_combate_id IS NULL OR p_combate_id::text <> estado->>'id' THEN
    RAISE EXCEPTION 'Identidade do combate não corresponde ao combate ativo' USING ERRCODE = 'P0409';
  END IF;
  IF p_mapa_id IS NOT NULL AND estado->>'mapa_id' IS DISTINCT FROM p_mapa_id::text THEN
    RAISE EXCEPTION 'Operação direcionada a mapa incorreto' USING ERRCODE = '22023';
  END IF;
  IF p_round IS NOT NULL AND p_round <> coalesce((estado->>'round')::integer, 1) THEN
    RAISE EXCEPTION 'Operação direcionada a rodada obsoleta' USING ERRCODE = 'P0409';
  END IF;

  SELECT * INTO tok FROM public.mesa_tokens WHERE id = p_token_id AND mesa_id = p_mesa_id;
  IF NOT FOUND OR (estado->>'mapa_id' IS NOT NULL AND tok.mapa_id::text IS DISTINCT FROM estado->>'mapa_id') THEN
    RAISE EXCEPTION 'Combatente não pertence a este combate/mapa' USING ERRCODE = '22023';
  END IF;

  IF NOT v_gm THEN
    IF tok.owner_type <> 'player' OR tok.owner_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Jogador só pode operar ações do próprio personagem' USING ERRCODE = '42501';
    END IF;
  END IF;

  lista := estado->'ordem';
  SELECT (e.n - 1)::integer, e.item
  INTO v_item_pos, v_item
  FROM jsonb_array_elements(lista) WITH ORDINALITY e(item, n)
  WHERE e.item->>'token_id' = p_token_id::text;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Token não participa da ordem de combate' USING ERRCODE = '22023';
  END IF;

  v_as := CASE
    WHEN jsonb_typeof(v_item->'action_state') = 'object'
         AND (v_item->'action_state'->>'round')::integer = coalesce((estado->>'round')::integer, 1)
      THEN v_item->'action_state'
    ELSE public.criar_action_state_combate(
      mesa_row,
      NULLIF(estado->>'id', '')::uuid,
      coalesce(NULLIF(estado->>'mapa_id', '')::uuid, tok.mapa_id),
      coalesce((estado->>'round')::integer, 1),
      tok,
      public.normalizar_iniciativa_token(coalesce(v_item->>'current_initiative', v_item->>'iniciativa'))
    )
  END;

  v_op_results := coalesce(v_as->'opResults', '{}'::jsonb);
  -- Idempotência estrita em rede/reconexão: retorna resultado anterior somente se o payload coincidir.
  IF v_op_results ? v_op_id THEN
    v_prev := v_op_results->v_op_id;
    v_idemp_match := (coalesce(v_prev->>'operation', '') = v_op);
    IF v_idemp_match AND v_op = 'reserve' THEN
      v_req_res_id := nullif(btrim(coalesce(p_reservation_id, '')), '');
      v_idemp_match :=
        coalesce(v_prev->>'actionType', '') = v_action_key
        AND coalesce((v_prev->>'isReaction')::boolean, false) = coalesce(p_is_reaction, false)
        AND (p_cost IS NULL OR (v_prev->>'cost')::integer = p_cost)
        AND (v_req_res_id IS NULL OR coalesce(v_prev->>'reservationId', '') = v_req_res_id)
        AND (p_justificativa IS NULL OR coalesce(v_prev->>'reason', '') = coalesce(v_reason, ''));
    ELSIF v_idemp_match AND v_op IN ('commit', 'cancel') THEN
      v_req_res_id := btrim(coalesce(p_reservation_id, ''));
      v_idemp_match :=
        v_req_res_id = ''
        OR v_req_res_id = coalesce(v_prev->>'reservationId', '')
        OR ('res_' || v_req_res_id) = coalesce(v_prev->>'reservationId', '')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(v_as->'ledger', '[]'::jsonb)) led
          WHERE led->>'opId' = v_req_res_id
            AND led->>'reservationId' = coalesce(v_prev->>'reservationId', '')
        );
    END IF;
    IF NOT v_idemp_match THEN
      RAISE EXCEPTION 'Conflito de idempotência: p_op_id (%) já utilizado com payload diferente', v_op_id USING ERRCODE = '22023';
    END IF;
    v_pub := public.obter_combate_publico(p_mesa_id);
    RETURN jsonb_build_object(
      'result', v_prev || jsonb_build_object('idempotentReplay', true),
      'combate', v_pub->'combate',
      'revisao', v_pub->'revisao'
    );
  END IF;

  -- Proteção contra descarte na janela de 64 entradas de opResults:
  -- mesmo após 65+ operações na mesma rodada, reservas e finalizações continuam registradas no ledger.
  SELECT e
  INTO v_evicted_entry
  FROM jsonb_array_elements(coalesce(v_as->'ledger', '[]'::jsonb)) e
  WHERE e->>'opId' = v_op_id OR e->>'finalOpId' = v_op_id
  LIMIT 1;

  IF v_evicted_entry IS NOT NULL THEN
    IF v_evicted_entry->>'opId' = v_op_id THEN
      v_req_res_id := nullif(btrim(coalesce(p_reservation_id, '')), '');
      v_evicted_match :=
        v_op = 'reserve'
        AND coalesce(v_evicted_entry->>'actionType', '') = v_action_key
        AND coalesce((v_evicted_entry->>'isReaction')::boolean, false) = coalesce(p_is_reaction, false)
        AND (p_cost IS NULL OR (v_evicted_entry->>'cost')::integer = p_cost)
        AND (v_req_res_id IS NULL OR coalesce(v_evicted_entry->>'reservationId', '') = v_req_res_id)
        AND (p_justificativa IS NULL OR coalesce(v_evicted_entry->>'reason', '') = coalesce(v_reason, ''));
      v_prev := jsonb_build_object(
        'ok', true,
        'operation', 'reserve',
        'opId', v_op_id,
        'reservationId', v_evicted_entry->>'reservationId',
        'actionType', v_evicted_entry->>'actionType',
        'cost', (v_evicted_entry->>'cost')::integer,
        'isReaction', coalesce((v_evicted_entry->>'isReaction')::boolean, false),
        'authorizedByGm', coalesce((v_evicted_entry->>'authorizedByGm')::boolean, false),
        'reason', v_evicted_entry->'reason',
        'status', v_evicted_entry->>'status',
        'evictedFromRecentCache', true
      );
    ELSE
      v_req_res_id := btrim(coalesce(p_reservation_id, ''));
      v_evicted_match :=
        v_op = coalesce(v_evicted_entry->>'finalOperation', '')
        AND (
          v_req_res_id = ''
          OR v_req_res_id = coalesce(v_evicted_entry->>'reservationId', '')
          OR ('res_' || v_req_res_id) = coalesce(v_evicted_entry->>'reservationId', '')
          OR v_req_res_id = coalesce(v_evicted_entry->>'opId', '')
        );
      v_prev := jsonb_build_object(
        'ok', true,
        'operation', v_evicted_entry->>'finalOperation',
        'opId', v_op_id,
        'reservationId', v_evicted_entry->>'reservationId',
        'actionType', v_evicted_entry->>'actionType',
        'cost', (v_evicted_entry->>'cost')::integer,
        'isReaction', coalesce((v_evicted_entry->>'isReaction')::boolean, false),
        'authorizedByGm', coalesce((v_evicted_entry->>'authorizedByGm')::boolean, false),
        'reason', v_evicted_entry->'reason',
        'status', v_evicted_entry->>'status',
        'evictedFromRecentCache', true
      );
    END IF;
    IF NOT coalesce(v_evicted_match, false) THEN
      RAISE EXCEPTION 'Conflito de idempotência: p_op_id (%) já utilizado com payload diferente', v_op_id USING ERRCODE = '22023';
    END IF;
    SELECT
      coalesce(sum(CASE WHEN e->>'status' = 'committed' THEN (e->>'cost')::integer ELSE 0 END), 0),
      coalesce(sum(CASE WHEN e->>'status' = 'reserved' THEN (e->>'cost')::integer ELSE 0 END), 0)
    INTO v_spent, v_reserved
    FROM jsonb_array_elements(coalesce(v_as->'ledger', '[]'::jsonb)) e;
    v_avail := greatest(0, coalesce((v_as->>'initialBudget')::integer, 0) - v_spent - v_reserved);
    v_pub := public.obter_combate_publico(p_mesa_id);
    RETURN jsonb_build_object(
      'result', v_prev || jsonb_build_object(
        'idempotentReplay', true,
        'version', (v_as->>'version')::bigint,
        'spentActions', v_spent,
        'reservedActions', v_reserved,
        'availableActions', v_avail
      ),
      'combate', v_pub->'combate',
      'revisao', v_pub->'revisao'
    );
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> (v_as->>'version')::bigint THEN
    RAISE EXCEPTION 'Versão obsoleta do estado de ações' USING ERRCODE = 'P0409';
  END IF;

  v_ledger := coalesce(v_as->'ledger', '[]'::jsonb);
  v_audit := coalesce(v_as->'auditLog', '[]'::jsonb);

  IF v_op = 'reserve' THEN
    IF NOT coalesce((v_as->>'budgetDefined')::boolean, false) OR (v_as->>'initialBudget') IS NULL THEN
      RAISE EXCEPTION 'Orçamento de ações não definido para esta modalidade' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_ledger) >= 64 THEN
      RAISE EXCEPTION 'Limite de operações de ação por rodada atingido (64)' USING ERRCODE = '22023';
    END IF;
    IF v_action_key = 'custom' AND NOT v_gm THEN
      RAISE EXCEPTION 'Apenas o Mestre pode autorizar ações customizadas' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_is_reaction, false) THEN
      IF v_action_key NOT IN ('ataque_oportunidade', 'reacao', 'custom') THEN
        RAISE EXCEPTION 'Tipo de ação inválido para reação: %', v_action_key USING ERRCODE = '22023';
      END IF;
      IF NOT v_gm THEN
        RAISE EXCEPTION 'Reação fora de turno ou sem gatilho verificado exige autorização do Xerife' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_turn_idx := coalesce((estado->>'turno_atual_idx')::integer, -1);
    v_is_curr_turn := (v_item_pos = v_turn_idx) AND NOT coalesce((v_as->>'turnEnded')::boolean, false);
    IF NOT coalesce(p_is_reaction, false) AND NOT v_is_curr_turn THEN
      RAISE EXCEPTION 'Ações normais só podem ser reservadas durante o próprio turno' USING ERRCODE = '22023';
    END IF;
    v_cost := public.custo_canonico_acao_combate(p_action_type, p_cost, v_gm, v_reason);
    SELECT
      coalesce(sum(CASE WHEN e->>'status' = 'committed' THEN (e->>'cost')::integer ELSE 0 END), 0),
      coalesce(sum(CASE WHEN e->>'status' = 'reserved' THEN (e->>'cost')::integer ELSE 0 END), 0)
    INTO v_spent, v_reserved
    FROM jsonb_array_elements(v_ledger) e;
    v_avail := greatest(0, (v_as->>'initialBudget')::integer - v_spent - v_reserved);
    IF v_cost > v_avail THEN
      RAISE EXCEPTION 'Saldo de ações insuficiente (disponível: %, solicitado: %)', v_avail, v_cost USING ERRCODE = '22023';
    END IF;
    v_res_id := coalesce(nullif(btrim(p_reservation_id), ''), 'res_' || v_op_id);
    v_ledger := v_ledger || jsonb_build_array(
      jsonb_build_object(
        'opId', v_op_id,
        'reservationId', v_res_id,
        'actionType', v_action_key,
        'cost', v_cost,
        'isReaction', coalesce(p_is_reaction, false),
        'authorizedByGm', v_gm,
        'reason', v_reason,
        'status', 'reserved',
        'resultRevealed', false,
        'actorUserId', auth.uid(),
        'createdAt', v_now,
        'updatedAt', v_now
      )
    );
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'reserve',
      'opId', v_op_id,
      'reservationId', v_res_id,
      'actionType', v_action_key,
      'cost', v_cost,
      'isReaction', coalesce(p_is_reaction, false),
      'authorizedByGm', v_gm,
      'reason', v_reason,
      'status', 'reserved'
    );
  ELSIF v_op IN ('commit', 'cancel') THEN
    SELECT (e.n - 1)::integer, e.item
    INTO v_target_pos, v_target_res
    FROM jsonb_array_elements(v_ledger) WITH ORDINALITY e(item, n)
    WHERE e.item->>'reservationId' = btrim(coalesce(p_reservation_id, ''))
       OR e.item->>'opId' = btrim(coalesce(p_reservation_id, ''));
    IF v_target_res IS NULL THEN
      RAISE EXCEPTION 'Reserva de ação não encontrada' USING ERRCODE = '22023';
    END IF;
    IF v_op = 'commit' THEN
      IF v_target_res->>'status' <> 'reserved' THEN
        RAISE EXCEPTION 'Reserva já processada ou cancelada' USING ERRCODE = '22023';
      END IF;
      IF coalesce((v_target_res->>'isReaction')::boolean, false) OR coalesce(p_is_reaction, false) THEN
        v_target_action_key := lower(btrim(coalesce(v_target_res->>'actionType', '')));
        IF v_target_action_key NOT IN ('ataque_oportunidade', 'reacao', 'custom') THEN
          RAISE EXCEPTION 'Tipo de ação inválido para reação' USING ERRCODE = '22023';
        END IF;
        IF (coalesce(p_is_reaction, false) AND NOT v_gm)
           OR (NOT coalesce((v_target_res->>'authorizedByGm')::boolean, false) AND NOT v_gm) THEN
          RAISE EXCEPTION 'Reação exige autorização do Xerife' USING ERRCODE = '42501';
        END IF;
      END IF;
      v_target_res := v_target_res || jsonb_build_object(
        'status', 'committed',
        'resultRevealed', coalesce(p_result_revealed, true),
        'finalOpId', v_op_id,
        'finalOperation', 'commit',
        'updatedAt', v_now
      );
      v_out := jsonb_build_object(
        'ok', true,
        'idempotentReplay', false,
        'operation', 'commit',
        'opId', v_op_id,
        'reservationId', v_target_res->>'reservationId',
        'actionType', v_target_res->>'actionType',
        'cost', (v_target_res->>'cost')::integer,
        'isReaction', coalesce((v_target_res->>'isReaction')::boolean, false),
        'authorizedByGm', coalesce((v_target_res->>'authorizedByGm')::boolean, v_gm),
        'reason', coalesce(v_target_res->'reason', to_jsonb(v_reason)),
        'status', 'committed'
      );
    ELSE
      IF v_target_res->>'status' = 'committed'
         OR coalesce((v_target_res->>'resultRevealed')::boolean, false)
         OR coalesce(p_result_revealed, false) THEN
        RAISE EXCEPTION 'Cancelamento proibido após confirmação ou resultado revelado' USING ERRCODE = '22023';
      END IF;
      IF v_target_res->>'status' = 'cancelled' THEN
        RAISE EXCEPTION 'Reserva já cancelada' USING ERRCODE = '22023';
      END IF;
      v_target_res := v_target_res || jsonb_build_object(
        'status', 'cancelled',
        'finalOpId', v_op_id,
        'finalOperation', 'cancel',
        'updatedAt', v_now
      );
      v_out := jsonb_build_object(
        'ok', true,
        'idempotentReplay', false,
        'operation', 'cancel',
        'opId', v_op_id,
        'reservationId', v_target_res->>'reservationId',
        'actionType', v_target_res->>'actionType',
        'cost', (v_target_res->>'cost')::integer,
        'isReaction', coalesce((v_target_res->>'isReaction')::boolean, false),
        'authorizedByGm', coalesce((v_target_res->>'authorizedByGm')::boolean, v_gm),
        'reason', coalesce(v_target_res->'reason', to_jsonb(v_reason)),
        'status', 'cancelled'
      );
    END IF;
    v_ledger := jsonb_set(v_ledger, ARRAY[v_target_pos::text], v_target_res, false);
  ELSE
    RAISE EXCEPTION 'Operação inválida: %', v_op USING ERRCODE = '22023';
  END IF;

  SELECT
    coalesce(sum(CASE WHEN e->>'status' = 'committed' THEN (e->>'cost')::integer ELSE 0 END), 0),
    coalesce(sum(CASE WHEN e->>'status' = 'reserved' THEN (e->>'cost')::integer ELSE 0 END), 0)
  INTO v_spent, v_reserved
  FROM jsonb_array_elements(v_ledger) e;
  v_avail := greatest(0, (v_as->>'initialBudget')::integer - v_spent - v_reserved);

  v_out := v_out || jsonb_build_object(
    'version', (v_as->>'version')::bigint + 1,
    'spentActions', v_spent,
    'reservedActions', v_reserved,
    'availableActions', v_avail
  );

  v_next_seq := CASE
    WHEN jsonb_array_length(v_audit) > 0
      THEN coalesce((v_audit->(jsonb_array_length(v_audit) - 1)->>'seq')::integer, jsonb_array_length(v_audit)) + 1
    ELSE 1
  END;

  v_audit := v_audit || jsonb_build_array(v_out || jsonb_build_object(
    'seq', v_next_seq,
    'timestamp', v_now,
    'actorUserId', auth.uid()
  ));
  IF jsonb_array_length(v_audit) > 64 THEN
    SELECT coalesce(jsonb_agg(e.item ORDER BY e.n), '[]'::jsonb)
    INTO v_audit
    FROM jsonb_array_elements(v_audit) WITH ORDINALITY e(item, n)
    WHERE e.n > jsonb_array_length(v_audit) - 64;
  END IF;

  v_op_results := v_op_results || jsonb_build_object(v_op_id, v_out);
  IF (SELECT count(*) FROM jsonb_object_keys(v_op_results)) > 64 THEN
    SELECT coalesce(jsonb_object_agg(recent.k, recent.val), '{}'::jsonb)
    INTO v_op_results
    FROM (
      SELECT kv.key AS k, kv.value AS val
      FROM jsonb_each(v_op_results) AS kv
      ORDER BY coalesce((kv.value->>'version')::bigint, 0) DESC
      LIMIT 64
    ) recent;
  END IF;

  v_as := v_as || jsonb_build_object(
    'spentActions', v_spent,
    'reservedActions', v_reserved,
    'version', (v_as->>'version')::bigint + 1,
    'ledger', v_ledger,
    'auditLog', v_audit,
    'opResults', v_op_results
  );

  IF v_item->>'current_initiative' IS NULL THEN
    v_item := v_item || jsonb_build_object(
      'current_initiative', (v_as->>'currentInitiative')::integer,
      'next_round_initiative', 'null'::jsonb
    );
  END IF;
  v_item := jsonb_set(v_item, '{action_state}', v_as, true);
  lista := jsonb_set(lista, ARRAY[v_item_pos::text], v_item, false);
  estado := estado || jsonb_build_object(
    'ordem', lista,
    'versao', (estado->>'versao')::bigint + 1
  );

  UPDATE public.mesas SET combate_ativo = estado WHERE id = p_mesa_id;
  v_pub := public.obter_combate_publico(p_mesa_id);

  RETURN jsonb_build_object(
    'result', v_out,
    'combate', v_pub->'combate',
    'revisao', v_pub->'revisao'
  );
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_acao_combate(uuid, uuid, uuid, text, text, text, integer, text, boolean, boolean, uuid, integer, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_acao_combate(uuid, uuid, uuid, text, text, text, integer, text, boolean, boolean, uuid, integer, bigint, text) TO authenticated;

-- COM-09, COM-10, COM-11 e COM-12:
-- Preservação de ações pós-turno (COM-09), fluxo transacional de reação antecipada com aprovação do Xerife (COM-10),
-- oportunidades contextuais V1 indicadas manualmente pelo Xerife (COM-11) e projeção pública/privada para a barra contextual (COM-12).
-- ATENÇÃO: Migração local incremental. NÃO aplicar em Homologação ou Produção sem aprovação explícita.

CREATE OR REPLACE FUNCTION public.calcular_fase_turno_combate(
  p_estado jsonb,
  p_item jsonb,
  p_item_pos integer
) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_turn_idx integer;
  v_as jsonb;
  v_round integer;
BEGIN
  IF p_estado IS NULL OR NOT coalesce((p_estado->>'ativo')::boolean, false) OR p_item IS NULL THEN
    RETURN 'round_ended';
  END IF;

  v_round := greatest(1, coalesce((p_estado->>'round')::integer, 1));
  v_as := CASE WHEN jsonb_typeof(p_item->'action_state') = 'object' THEN p_item->'action_state' ELSE NULL END;

  IF v_as IS NOT NULL AND (v_as->>'round') IS NOT NULL AND (v_as->>'round')::integer < v_round THEN
    RETURN 'round_ended';
  END IF;

  IF v_as IS NOT NULL AND coalesce((v_as->>'turnEnded')::boolean, false) THEN
    RETURN 'post_turn';
  END IF;

  v_turn_idx := coalesce((p_estado->>'turno_atual_idx')::integer, -1);
  IF p_item_pos >= 0 AND v_turn_idx >= 0 AND p_item_pos = v_turn_idx THEN
    RETURN 'active_turn';
  END IF;

  IF p_item_pos >= 0 AND v_turn_idx >= 0 AND p_item_pos < v_turn_idx
     AND NOT coalesce((p_item->>'entrou_no_meio')::boolean, false) THEN
    RETURN 'post_turn';
  END IF;

  RETURN 'pre_turn';
END $$;
REVOKE ALL ON FUNCTION public.calcular_fase_turno_combate(jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- Evolui obter_combate_publico preservando 100% do contrato COM-05..COM-08
-- e filtrando oportunidades_reacao / solicitacoes_reacao sem vazar dados privados ou tokens ocultos.
CREATE OR REPLACE FUNCTION public.obter_combate_publico(p_mesa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  estado jsonb;
  lista jsonb;
  v_opps jsonb := '[]'::jsonb;
  v_reqs jsonb := '[]'::jsonb;
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

  IF estado IS NULL THEN
    RETURN jsonb_build_object('combate', NULL, 'revisao', rev);
  END IF;

  IF gm THEN
    RETURN jsonb_build_object(
      'combate',
      (estado - 'reaction_op_results') || jsonb_build_object(
        'oportunidades_reacao', coalesce(estado->'oportunidades_reacao', '[]'::jsonb),
        'solicitacoes_reacao', coalesce(estado->'solicitacoes_reacao', '[]'::jsonb)
      ),
      'revisao', rev
    );
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

  -- Jogador vê apenas oportunidades do próprio combatente (ou de combatente público visível no mapa ativo, sem vazar alvo oculto)
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN t_target.id IS NOT NULL AND NOT t_target.visible_to_players AND t_target.owner_user_id IS DISTINCT FROM auth.uid()
        THEN (o.item - 'targetTokenId' - 'targetName')
      ELSE o.item
    END
    ORDER BY o.n
  ), '[]'::jsonb) INTO v_opps
  FROM jsonb_array_elements(coalesce(estado->'oportunidades_reacao', '[]'::jsonb)) WITH ORDINALITY o(item, n)
  JOIN public.mesa_tokens t_react
    ON t_react.id::text = o.item->>'combatantId'
   AND t_react.mesa_id = p_mesa_id
  LEFT JOIN public.mesa_tokens t_target
    ON t_target.id::text = o.item->>'targetTokenId'
   AND t_target.mesa_id = p_mesa_id
  WHERE public.mapa_visivel_ao_usuario(p_mesa_id, t_react.mapa_id)
    AND t_react.owner_user_id = auth.uid();

  -- Jogador vê estritamente as solicitações do próprio combatente
  SELECT coalesce(jsonb_agg(r.item ORDER BY r.n), '[]'::jsonb) INTO v_reqs
  FROM jsonb_array_elements(coalesce(estado->'solicitacoes_reacao', '[]'::jsonb)) WITH ORDINALITY r(item, n)
  JOIN public.mesa_tokens t_req
    ON t_req.id::text = r.item->>'combatantId'
   AND t_req.mesa_id = p_mesa_id
  WHERE public.mapa_visivel_ao_usuario(p_mesa_id, t_req.mapa_id)
    AND t_req.owner_user_id = auth.uid();

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
      'ordem', lista,
      'oportunidades_reacao', v_opps,
      'solicitacoes_reacao', v_reqs
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.obter_combate_publico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_combate_publico(uuid) TO authenticated;

-- Evolui gerenciar_combate preservando 100% do contrato COM-05..COM-08:
-- inicializa oportunidades/solicitações de reação, expira solicitações antecipadas quando o turno
-- do combatente inicia ou na virada da rodada, e expira oportunidades/saldo na virada da rodada.
CREATE OR REPLACE FUNCTION public.gerenciar_combate(
  p_mesa_id uuid,
  p_acao text,
  p_versao bigint DEFAULT NULL,
  p_participantes jsonb DEFAULT NULL,
  p_token_id uuid DEFAULT NULL,
  p_combate_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  mesa_row public.mesas;
  estado jsonb;
  lista jsonb := '[]';
  v_opps jsonb := '[]'::jsonb;
  v_reqs jsonb := '[]'::jsonb;
  v_rop jsonb := '{}'::jsonb;
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
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
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
      'mapa_id', combat_map,
      'oportunidades_reacao', '[]'::jsonb,
      'solicitacoes_reacao', '[]'::jsonb,
      'reaction_op_results', '{}'::jsonb
    );
  ELSE
    IF estado IS NULL OR p_combate_id IS NULL OR p_combate_id::text <> estado->>'id'
       OR p_versao IS DISTINCT FROM (estado->>'versao')::bigint THEN
      RAISE EXCEPTION 'Combate atualizado em outra sessão. Confira a ordem antes de tentar novamente.' USING ERRCODE = '40001';
    END IF;

    estado := public.atualizar_resumo_combate(p_mesa_id, estado);
    lista := estado->'ordem';
    v_opps := coalesce(estado->'oportunidades_reacao', '[]'::jsonb);
    v_reqs := coalesce(estado->'solicitacoes_reacao', '[]'::jsonb);
    v_rop := coalesce(estado->'reaction_op_results', '{}'::jsonb);
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
        -- Virada da rodada: expira saldos remanescentes, oportunidades abertas e solicitações pendentes da rodada anterior.
        v_opps := '[]'::jsonb;
        v_reqs := '[]'::jsonb;
        v_rop := '{}'::jsonb;

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

        -- Ao chegar a vez de v_new_tid (ou encerrar v_old_tid), solicitações pendentes de reação antecipada
        -- desse combatente expiram automaticamente sem consumir ação.
        IF jsonb_array_length(v_reqs) > 0 THEN
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN r.item->>'status' = 'pending'
                   AND (r.item->>'combatantId' = v_new_tid OR r.item->>'combatantId' = v_old_tid)
                THEN r.item || jsonb_build_object(
                  'status', 'expired',
                  'resolutionReason', CASE WHEN r.item->>'combatantId' = v_new_tid THEN 'combatant_turn_started' ELSE 'combatant_turn_ended' END,
                  'updatedAt', v_now
                )
              ELSE r.item
            END
            ORDER BY r.n
          ), '[]'::jsonb) INTO v_reqs
          FROM jsonb_array_elements(v_reqs) WITH ORDINALITY r(item, n);
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Ação de combate inválida' USING ERRCODE = '22023';
    END IF;

    IF estado IS NOT NULL THEN
      estado := estado || jsonb_build_object(
        'ordem', lista,
        'round', rodada,
        'turno_atual_idx', idx,
        'versao', (estado->>'versao')::bigint + 1,
        'oportunidades_reacao', v_opps,
        'solicitacoes_reacao', v_reqs,
        'reaction_op_results', v_rop
      );
    END IF;
  END IF;

  UPDATE public.mesas SET combate_ativo = estado WHERE id = p_mesa_id;
  RETURN public.obter_combate_publico(p_mesa_id);
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_combate(uuid, text, bigint, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_combate(uuid, text, bigint, jsonb, uuid, uuid) TO authenticated;

-- RPC transacional, autoritativa e idempotente para COM-09, COM-10 e COM-11.
-- Utiliza SQLSTATE PT409 (HTTP 409 Conflict imediato) em conflitos de versão, rodada, estado ou saldo.
CREATE OR REPLACE FUNCTION public.gerenciar_reacao_combate(
  p_mesa_id uuid,
  p_combate_id uuid,
  p_token_id uuid,
  p_operacao text,
  p_op_id text,
  p_action_type text DEFAULT 'reacao',
  p_cost integer DEFAULT NULL,
  p_opportunity_id text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_target_token_id uuid DEFAULT NULL,
  p_reach_meters numeric DEFAULT NULL,
  p_range_confirmed boolean DEFAULT false,
  p_passive_skill text DEFAULT NULL,
  p_passive_skill_required boolean DEFAULT NULL,
  p_passive_skill_confirmed boolean DEFAULT false,
  p_trigger_label text DEFAULT NULL,
  p_mapa_id uuid DEFAULT NULL,
  p_round integer DEFAULT NULL,
  p_expected_combat_version bigint DEFAULT NULL,
  p_expected_action_version bigint DEFAULT NULL,
  p_justificativa text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  mesa_row public.mesas;
  tok public.mesa_tokens;
  target_tok public.mesa_tokens;
  estado jsonb;
  lista jsonb;
  v_opps jsonb;
  v_reqs jsonb;
  v_rop jsonb;
  v_item jsonb := NULL;
  v_item_pos integer := -1;
  v_as jsonb;
  v_ledger jsonb;
  v_audit jsonb;
  v_as_ops jsonb;
  v_gm boolean;
  v_op text := lower(btrim(coalesce(p_operacao, '')));
  v_op_id text := btrim(coalesce(p_op_id, ''));
  v_action_key text := lower(btrim(coalesce(nullif(p_action_type, ''), 'reacao')));
  v_reason text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_trigger text := nullif(btrim(coalesce(p_trigger_label, '')), '');
  v_round integer;
  v_combat_version bigint;
  v_turn_phase text;
  v_prev jsonb;
  v_idemp_ok boolean := false;
  v_cost integer;
  v_spent integer := 0;
  v_reserved integer := 0;
  v_avail integer := 0;
  v_opp jsonb := NULL;
  v_opp_pos integer := -1;
  v_opp_id text;
  v_req jsonb := NULL;
  v_req_pos integer := -1;
  v_req_id text;
  v_res_id text;
  v_next_seq integer;
  v_dist_sq integer := NULL;
  v_dist_m numeric := NULL;
  v_eff_reach numeric := NULL;
  v_range_status text := 'needs_gm_confirmation';
  v_passive_req boolean := false;
  v_passive_skill text := NULL;
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
  IF v_op NOT IN (
    'open_opportunity',
    'close_opportunity',
    'execute_opportunity_reaction',
    'request_early_reaction',
    'approve_early_reaction',
    'deny_early_reaction',
    'cancel_early_reaction'
  ) THEN
    RAISE EXCEPTION 'Operação de reação inválida: %', v_op USING ERRCODE = '22023';
  END IF;

  v_gm := public.is_mestre_da_mesa(p_mesa_id);
  IF NOT v_gm AND NOT EXISTS (
    SELECT 1 FROM public.membros_mesa mm WHERE mm.mesa_id = p_mesa_id AND mm.usuario_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso negado a esta mesa' USING ERRCODE = '42501';
  END IF;

  IF v_op IN ('open_opportunity', 'close_opportunity', 'approve_early_reaction', 'deny_early_reaction')
     AND NOT v_gm THEN
    RAISE EXCEPTION 'Apenas o Xerife pode executar esta operação de reação' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO mesa_row FROM public.mesas WHERE id = p_mesa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mesa não encontrada' USING ERRCODE = '22023';
  END IF;
  estado := mesa_row.combate_ativo;

  IF estado IS NULL OR NOT coalesce((estado->>'ativo')::boolean, false) THEN
    RAISE EXCEPTION 'Não há combate ativo nesta mesa' USING ERRCODE = '22023';
  END IF;
  IF p_combate_id IS NULL OR p_combate_id::text <> estado->>'id' THEN
    RAISE EXCEPTION 'Identidade do combate não corresponde ao combate ativo' USING ERRCODE = 'PT409';
  END IF;

  v_round := greatest(1, coalesce((estado->>'round')::integer, 1));
  v_combat_version := coalesce((estado->>'versao')::bigint, 1);

  IF p_mapa_id IS NOT NULL AND estado->>'mapa_id' IS DISTINCT FROM p_mapa_id::text THEN
    RAISE EXCEPTION 'Operação de reação direcionada a mapa incorreto' USING ERRCODE = '22023';
  END IF;
  IF p_round IS NOT NULL AND p_round <> v_round THEN
    RAISE EXCEPTION 'Operação direcionada a rodada encerrada ou obsoleta' USING ERRCODE = 'PT409';
  END IF;

  estado := public.atualizar_resumo_combate(p_mesa_id, estado);
  lista := coalesce(estado->'ordem', '[]'::jsonb);
  v_opps := coalesce(estado->'oportunidades_reacao', '[]'::jsonb);
  v_reqs := coalesce(estado->'solicitacoes_reacao', '[]'::jsonb);
  v_rop := coalesce(estado->'reaction_op_results', '{}'::jsonb);

  -- 1. Idempotência estrita por p_op_id (antes da validação de versão para absorver retry pós-queda de rede)
  IF v_rop ? v_op_id THEN
    v_prev := v_rop->v_op_id;
    v_idemp_ok := coalesce(v_prev->>'operation', '') = v_op
      AND (p_token_id IS NULL OR coalesce(v_prev->>'combatantId', '') = p_token_id::text);
    IF v_idemp_ok AND v_op IN ('close_opportunity', 'execute_opportunity_reaction') THEN
      v_idemp_ok := nullif(btrim(coalesce(p_opportunity_id, '')), '') IS NULL
        OR coalesce(v_prev->>'opportunityId', '') = btrim(p_opportunity_id);
    ELSIF v_idemp_ok AND v_op IN ('approve_early_reaction', 'deny_early_reaction', 'cancel_early_reaction') THEN
      v_idemp_ok := nullif(btrim(coalesce(p_request_id, '')), '') IS NULL
        OR coalesce(v_prev->>'requestId', '') = btrim(p_request_id);
    ELSIF v_idemp_ok AND v_op IN ('open_opportunity', 'request_early_reaction') THEN
      v_idemp_ok := coalesce(v_prev->>'actionType', '') = v_action_key;
    END IF;
    IF NOT v_idemp_ok THEN
      RAISE EXCEPTION 'Conflito de idempotência: p_op_id (%) já utilizado com payload diferente', v_op_id USING ERRCODE = '22023';
    END IF;
    v_pub := public.obter_combate_publico(p_mesa_id);
    RETURN jsonb_build_object(
      'result', v_prev || jsonb_build_object('idempotentReplay', true),
      'combate', v_pub->'combate',
      'revisao', v_pub->'revisao'
    );
  END IF;

  -- Fallback de idempotência contra evicção na janela de 64 chaves (requests e opportunities)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_reqs) r
    WHERE r->>'opId' = v_op_id OR r->>'resolutionOpId' = v_op_id
  ) THEN
    SELECT r INTO v_req
    FROM jsonb_array_elements(v_reqs) r
    WHERE r->>'opId' = v_op_id OR r->>'resolutionOpId' = v_op_id
    LIMIT 1;
    IF (v_req->>'opId' = v_op_id AND v_op <> 'request_early_reaction')
       OR (v_req->>'resolutionOpId' = v_op_id AND v_op NOT IN ('approve_early_reaction', 'deny_early_reaction', 'cancel_early_reaction')) THEN
      RAISE EXCEPTION 'Conflito de idempotência: p_op_id (%) já utilizado com payload diferente', v_op_id USING ERRCODE = '22023';
    END IF;
    v_pub := public.obter_combate_publico(p_mesa_id);
    RETURN jsonb_build_object(
      'result', jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'evictedFromRecentCache', true,
        'operation', v_op,
        'opId', v_op_id,
        'requestId', v_req->>'requestId',
        'combatantId', v_req->>'combatantId',
        'status', v_req->>'status'
      ),
      'combate', v_pub->'combate',
      'revisao', v_pub->'revisao'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_opps) o
    WHERE o->>'opId' = v_op_id
  ) THEN
    SELECT o INTO v_opp
    FROM jsonb_array_elements(v_opps) o
    WHERE o->>'opId' = v_op_id
    LIMIT 1;
    IF v_op <> 'open_opportunity' THEN
      RAISE EXCEPTION 'Conflito de idempotência: p_op_id (%) já utilizado com payload diferente', v_op_id USING ERRCODE = '22023';
    END IF;
    v_pub := public.obter_combate_publico(p_mesa_id);
    RETURN jsonb_build_object(
      'result', jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'evictedFromRecentCache', true,
        'operation', 'open_opportunity',
        'opId', v_op_id,
        'opportunityId', v_opp->>'opportunityId',
        'combatantId', v_opp->>'combatantId',
        'status', v_opp->>'status'
      ),
      'combate', v_pub->'combate',
      'revisao', v_pub->'revisao'
    );
  END IF;

  -- 2. Controle otimista de versão do combate (PT409 imediato)
  IF p_expected_combat_version IS NOT NULL AND p_expected_combat_version <> v_combat_version THEN
    RAISE EXCEPTION 'Versão do combate desatualizada; recarregue o estado antes de prosseguir' USING ERRCODE = 'PT409';
  END IF;

  -- Resolve combatente alvo (para operações de request/opportunity, p_token_id pode ser conferido contra a entidade)
  IF v_op IN ('approve_early_reaction', 'deny_early_reaction', 'cancel_early_reaction') THEN
    v_req_id := nullif(btrim(coalesce(p_request_id, '')), '');
    IF v_req_id IS NULL THEN
      RAISE EXCEPTION 'Identificador da solicitação (p_request_id) é obrigatório' USING ERRCODE = '22023';
    END IF;
    SELECT (e.n - 1)::integer, e.item
    INTO v_req_pos, v_req
    FROM jsonb_array_elements(v_reqs) WITH ORDINALITY e(item, n)
    WHERE e.item->>'requestId' = v_req_id;

    IF v_req IS NULL THEN
      RAISE EXCEPTION 'Solicitação de reação não encontrada na rodada atual ou já expirada' USING ERRCODE = 'PT409';
    END IF;
    IF p_token_id IS NOT NULL AND v_req->>'combatantId' IS DISTINCT FROM p_token_id::text THEN
      RAISE EXCEPTION 'Solicitação pertence a outro combatente' USING ERRCODE = '22023';
    END IF;
    p_token_id := (v_req->>'combatantId')::uuid;
  ELSIF v_op = 'close_opportunity' THEN
    v_opp_id := nullif(btrim(coalesce(p_opportunity_id, '')), '');
    IF v_opp_id IS NULL THEN
      RAISE EXCEPTION 'Identificador da oportunidade (p_opportunity_id) é obrigatório' USING ERRCODE = '22023';
    END IF;
    SELECT (e.n - 1)::integer, e.item
    INTO v_opp_pos, v_opp
    FROM jsonb_array_elements(v_opps) WITH ORDINALITY e(item, n)
    WHERE e.item->>'opportunityId' = v_opp_id;
    IF v_opp IS NULL THEN
      RAISE EXCEPTION 'Oportunidade não encontrada na rodada atual ou já expirada' USING ERRCODE = 'PT409';
    END IF;
    IF p_token_id IS NULL THEN
      p_token_id := (v_opp->>'combatantId')::uuid;
    END IF;
  END IF;

  IF p_token_id IS NULL THEN
    RAISE EXCEPTION 'Combatente (p_token_id) é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO tok FROM public.mesa_tokens WHERE id = p_token_id AND mesa_id = p_mesa_id;
  IF NOT FOUND OR (estado->>'mapa_id' IS NOT NULL AND tok.mapa_id::text IS DISTINCT FROM estado->>'mapa_id') THEN
    RAISE EXCEPTION 'Combatente não pertence a este combate/mapa' USING ERRCODE = '22023';
  END IF;

  IF NOT v_gm THEN
    IF tok.owner_type <> 'player' OR tok.owner_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Jogador só pode operar reações do próprio personagem' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT (e.n - 1)::integer, e.item
  INTO v_item_pos, v_item
  FROM jsonb_array_elements(lista) WITH ORDINALITY e(item, n)
  WHERE e.item->>'token_id' = p_token_id::text;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Token não participa da ordem de combate' USING ERRCODE = '22023';
  END IF;

  v_as := CASE
    WHEN jsonb_typeof(v_item->'action_state') = 'object'
         AND (v_item->'action_state'->>'round')::integer = v_round
      THEN v_item->'action_state'
    ELSE public.criar_action_state_combate(
      mesa_row,
      NULLIF(estado->>'id', '')::uuid,
      coalesce(NULLIF(estado->>'mapa_id', '')::uuid, tok.mapa_id),
      v_round,
      tok,
      public.normalizar_iniciativa_token(coalesce(v_item->>'current_initiative', v_item->>'iniciativa'))
    )
  END;

  IF p_expected_action_version IS NOT NULL AND p_expected_action_version <> (v_as->>'version')::bigint THEN
    RAISE EXCEPTION 'Versão obsoleta do estado de ações do combatente' USING ERRCODE = 'PT409';
  END IF;

  v_turn_phase := public.calcular_fase_turno_combate(estado, v_item, v_item_pos);
  v_ledger := coalesce(v_as->'ledger', '[]'::jsonb);
  v_audit := coalesce(v_as->'auditLog', '[]'::jsonb);
  v_as_ops := coalesce(v_as->'opResults', '{}'::jsonb);

  SELECT
    coalesce(sum(CASE WHEN e->>'status' = 'committed' THEN (e->>'cost')::integer ELSE 0 END), 0),
    coalesce(sum(CASE WHEN e->>'status' = 'reserved' THEN (e->>'cost')::integer ELSE 0 END), 0)
  INTO v_spent, v_reserved
  FROM jsonb_array_elements(v_ledger) e;
  v_avail := greatest(0, coalesce((v_as->>'initialBudget')::integer, 0) - v_spent - v_reserved);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-11: open_opportunity (exclusivo Xerife)
  -- ═══════════════════════════════════════════════════════════════════════════
  IF v_op = 'open_opportunity' THEN
    IF jsonb_array_length(v_opps) >= 64 THEN
      RAISE EXCEPTION 'Limite de oportunidades de reação por rodada atingido (64)' USING ERRCODE = '22023';
    END IF;
    IF v_action_key NOT IN ('ataque_oportunidade', 'reacao', 'custom') THEN
      RAISE EXCEPTION 'Tipo de ação inválido para oportunidade de reação: %', v_action_key USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce((v_as->>'budgetDefined')::boolean, false) OR (v_as->>'initialBudget') IS NULL THEN
      RAISE EXCEPTION 'Orçamento de ações indefinido para este combatente' USING ERRCODE = '22023';
    END IF;
    v_cost := public.custo_canonico_acao_combate(v_action_key, p_cost, v_gm, v_reason);
    IF v_cost > v_avail THEN
      RAISE EXCEPTION 'Combatente sem ações disponíveis nesta rodada (disponível: %, custo: %)', v_avail, v_cost USING ERRCODE = '22023';
    END IF;

    v_eff_reach := coalesce(p_reach_meters, CASE WHEN v_action_key = 'ataque_oportunidade' THEN 1.5 ELSE NULL END);
    IF p_target_token_id IS NOT NULL THEN
      SELECT * INTO target_tok FROM public.mesa_tokens WHERE id = p_target_token_id AND mesa_id = p_mesa_id;
      IF NOT FOUND OR target_tok.mapa_id IS DISTINCT FROM tok.mapa_id THEN
        RAISE EXCEPTION 'Alvo da oportunidade não está no mapa ativo do combate' USING ERRCODE = '22023';
      END IF;
      IF tok.grid_x IS NOT NULL AND tok.grid_y IS NOT NULL AND target_tok.grid_x IS NOT NULL AND target_tok.grid_y IS NOT NULL THEN
        v_dist_sq := greatest(abs(tok.grid_x - target_tok.grid_x), abs(tok.grid_y - target_tok.grid_y));
        v_dist_m := round((v_dist_sq * 1.5)::numeric, 2);
        IF v_eff_reach IS NOT NULL AND v_dist_m > v_eff_reach THEN
          IF NOT coalesce(p_range_confirmed, false) THEN
            RAISE EXCEPTION 'Alvo fora de alcance (%m > %m)', v_dist_m, v_eff_reach USING ERRCODE = '22023';
          END IF;
          v_range_status := 'confirmed_by_gm';
        ELSE
          v_range_status := 'in_range';
        END IF;
      ELSIF coalesce(p_range_confirmed, false) THEN
        v_range_status := 'confirmed_by_gm';
      ELSE
        RAISE EXCEPTION 'Alcance tático não mensurável automaticamente; confirme o alcance pelo Xerife' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF coalesce(p_range_confirmed, false) OR v_eff_reach IS NULL THEN
        v_range_status := CASE WHEN coalesce(p_range_confirmed, false) THEN 'confirmed_by_gm' ELSE 'not_applicable' END;
      ELSE
        RAISE EXCEPTION 'Informe o alvo no mapa ou confirme manualmente o alcance pelo Xerife' USING ERRCODE = '22023';
      END IF;
    END IF;

    v_passive_req := coalesce(p_passive_skill_required, v_action_key = 'ataque_oportunidade');
    v_passive_skill := CASE WHEN v_passive_req THEN coalesce(nullif(btrim(coalesce(p_passive_skill, '')), ''), 'combate-corpo-a-corpo') ELSE NULL END;

    v_opp_id := coalesce(nullif(btrim(coalesce(p_opportunity_id, '')), ''), 'opp_' || v_op_id);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opps) o WHERE o->>'opportunityId' = v_opp_id) THEN
      RAISE EXCEPTION 'Oportunidade com identificador duplicado: %', v_opp_id USING ERRCODE = '22023';
    END IF;

    v_opp := jsonb_build_object(
      'opportunityId', v_opp_id,
      'opId', v_op_id,
      'mesaId', p_mesa_id,
      'combateId', estado->>'id',
      'mapaId', estado->>'mapa_id',
      'round', v_round,
      'combatantId', p_token_id,
      'combatantName', tok.display_name,
      'targetTokenId', p_target_token_id,
      'targetName', CASE WHEN target_tok.id IS NOT NULL THEN target_tok.display_name ELSE NULL END,
      'actionType', v_action_key,
      'cost', v_cost,
      'reachMeters', v_eff_reach,
      'gridDistanceSquares', v_dist_sq,
      'gridDistanceMeters', v_dist_m,
      'rangeStatus', v_range_status,
      'rangeConfirmedByGm', coalesce(p_range_confirmed, false),
      'passiveSkillRequired', v_passive_req,
      'passiveSkillKey', v_passive_skill,
      'passiveSkillConfirmedByGm', coalesce(p_passive_skill_confirmed, false),
      'triggerLabel', coalesce(v_trigger, CASE WHEN v_action_key = 'ataque_oportunidade' THEN 'Ataque de Oportunidade' ELSE 'Oportunidade de Reação' END),
      'requiresEarlyApproval', (v_turn_phase = 'pre_turn'),
      'turnPhaseAtOpen', v_turn_phase,
      'status', 'open',
      'createdByUserId', auth.uid(),
      'createdAt', v_now,
      'updatedAt', v_now
    );

    v_opps := v_opps || jsonb_build_array(v_opp);
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'open_opportunity',
      'opId', v_op_id,
      'opportunityId', v_opp_id,
      'combatantId', p_token_id,
      'actionType', v_action_key,
      'cost', v_cost,
      'turnPhase', v_turn_phase,
      'requiresEarlyApproval', (v_turn_phase = 'pre_turn'),
      'rangeStatus', v_range_status,
      'gridDistanceMeters', v_dist_m,
      'status', 'open'
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-11: close_opportunity (exclusivo Xerife)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'close_opportunity' THEN
    IF v_opp->>'status' <> 'open' THEN
      RAISE EXCEPTION 'Oportunidade já foi consumida ou encerrada' USING ERRCODE = 'PT409';
    END IF;
    v_opp := v_opp || jsonb_build_object(
      'status', 'closed',
      'closedByUserId', auth.uid(),
      'closedReason', v_reason,
      'updatedAt', v_now
    );
    v_opps := jsonb_set(v_opps, ARRAY[v_opp_pos::text], v_opp, false);
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'close_opportunity',
      'opId', v_op_id,
      'opportunityId', v_opp_id,
      'combatantId', p_token_id,
      'status', 'closed'
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-09 / COM-11: execute_opportunity_reaction (pós-turno ou turno ativo)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'execute_opportunity_reaction' THEN
    v_opp_id := nullif(btrim(coalesce(p_opportunity_id, '')), '');
    IF v_opp_id IS NULL THEN
      RAISE EXCEPTION 'Identificador da oportunidade (p_opportunity_id) é obrigatório' USING ERRCODE = '22023';
    END IF;
    SELECT (e.n - 1)::integer, e.item
    INTO v_opp_pos, v_opp
    FROM jsonb_array_elements(v_opps) WITH ORDINALITY e(item, n)
    WHERE e.item->>'opportunityId' = v_opp_id;

    IF v_opp IS NULL THEN
      RAISE EXCEPTION 'Oportunidade não encontrada na rodada atual ou já expirada' USING ERRCODE = 'PT409';
    END IF;
    IF v_opp->>'combatantId' IS DISTINCT FROM p_token_id::text THEN
      RAISE EXCEPTION 'Oportunidade pertence a outro combatente' USING ERRCODE = '22023';
    END IF;
    IF (v_opp->>'round')::integer <> v_round THEN
      RAISE EXCEPTION 'Oportunidade pertence a uma rodada encerrada' USING ERRCODE = 'PT409';
    END IF;
    IF v_opp->>'status' <> 'open' THEN
      RAISE EXCEPTION 'Oportunidade já foi utilizada ou encerrada' USING ERRCODE = 'PT409';
    END IF;
    IF v_turn_phase = 'pre_turn' THEN
      RAISE EXCEPTION 'Antes da própria vez, a reação exige solicitação e aprovação explícita do Xerife (COM-10)' USING ERRCODE = '42501';
    END IF;
    IF v_turn_phase = 'round_ended' THEN
      RAISE EXCEPTION 'Rodada encerrada: saldo de reação expirado' USING ERRCODE = 'PT409';
    END IF;
    IF NOT coalesce((v_as->>'budgetDefined')::boolean, false) OR (v_as->>'initialBudget') IS NULL THEN
      RAISE EXCEPTION 'Orçamento de ações não definido para este combatente' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_ledger) >= 64 THEN
      RAISE EXCEPTION 'Limite de operações de ação por rodada atingido (64)' USING ERRCODE = '22023';
    END IF;

    v_cost := greatest(1, coalesce((v_opp->>'cost')::integer, 1));
    IF v_cost > v_avail THEN
      RAISE EXCEPTION 'Saldo de ações insuficiente no momento da execução (disponível: %, necessário: %)', v_avail, v_cost USING ERRCODE = 'PT409';
    END IF;

    v_res_id := 'react_' || v_op_id;
    v_ledger := v_ledger || jsonb_build_array(
      jsonb_build_object(
        'opId', v_op_id,
        'finalOpId', v_op_id,
        'finalOperation', 'commit',
        'reservationId', v_res_id,
        'actionType', v_opp->>'actionType',
        'cost', v_cost,
        'isReaction', true,
        'reactionMode', CASE WHEN v_turn_phase = 'post_turn' THEN 'post_turn_opportunity' ELSE 'active_turn_opportunity' END,
        'opportunityId', v_opp_id,
        'authorizedByGm', true,
        'reason', coalesce(v_reason, v_opp->>'triggerLabel'),
        'status', 'committed',
        'resultRevealed', true,
        'actorUserId', auth.uid(),
        'createdAt', v_now,
        'updatedAt', v_now
      )
    );

    v_spent := v_spent + v_cost;
    v_avail := greatest(0, (v_as->>'initialBudget')::integer - v_spent - v_reserved);

    v_next_seq := CASE
      WHEN jsonb_array_length(v_audit) > 0
        THEN coalesce((v_audit->(jsonb_array_length(v_audit) - 1)->>'seq')::integer, jsonb_array_length(v_audit)) + 1
      ELSE 1
    END;
    v_audit := v_audit || jsonb_build_array(
      jsonb_build_object(
        'seq', v_next_seq,
        'opId', v_op_id,
        'operation', 'execute_opportunity_reaction',
        'reservationId', v_res_id,
        'opportunityId', v_opp_id,
        'actionType', v_opp->>'actionType',
        'cost', v_cost,
        'isReaction', true,
        'authorizedByGm', true,
        'statusAfter', 'committed',
        'versionAfter', (v_as->>'version')::bigint + 1,
        'spentActions', v_spent,
        'reservedActions', v_reserved,
        'availableActions', v_avail,
        'timestamp', v_now,
        'actorUserId', auth.uid()
      )
    );

    v_as := v_as || jsonb_build_object(
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'version', (v_as->>'version')::bigint + 1,
      'ledger', v_ledger,
      'auditLog', v_audit
    );
    v_item := jsonb_set(v_item, '{action_state}', v_as, true);
    lista := jsonb_set(lista, ARRAY[v_item_pos::text], v_item, false);

    v_opp := v_opp || jsonb_build_object(
      'status', 'consumed',
      'consumedByUserId', auth.uid(),
      'consumedReservationId', v_res_id,
      'updatedAt', v_now
    );
    v_opps := jsonb_set(v_opps, ARRAY[v_opp_pos::text], v_opp, false);

    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'execute_opportunity_reaction',
      'opId', v_op_id,
      'opportunityId', v_opp_id,
      'reservationId', v_res_id,
      'combatantId', p_token_id,
      'actionType', v_opp->>'actionType',
      'cost', v_cost,
      'turnPhase', v_turn_phase,
      'status', 'committed',
      'version', (v_as->>'version')::bigint,
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'availableActions', v_avail
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-10: request_early_reaction (Jogador dono ou Xerife; pré-turno)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'request_early_reaction' THEN
    IF jsonb_array_length(v_reqs) >= 64 THEN
      RAISE EXCEPTION 'Limite de solicitações de reação por rodada atingido (64)' USING ERRCODE = '22023';
    END IF;
    IF v_action_key NOT IN ('reacao', 'ataque_oportunidade') THEN
      RAISE EXCEPTION 'Tipo de ação inválido para reação antecipada: %', v_action_key USING ERRCODE = '22023';
    END IF;
    IF v_turn_phase <> 'pre_turn' THEN
      RAISE EXCEPTION 'Reação antecipada só se aplica antes da própria vez na rodada (fase atual: %)', v_turn_phase USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce((v_as->>'budgetDefined')::boolean, false) OR (v_as->>'initialBudget') IS NULL THEN
      RAISE EXCEPTION 'Orçamento de ações não definido para este combatente' USING ERRCODE = '22023';
    END IF;
    v_cost := public.custo_canonico_acao_combate(v_action_key, p_cost, v_gm, v_reason);
    IF v_cost > v_avail THEN
      RAISE EXCEPTION 'Saldo de ações insuficiente para solicitar reação antecipada (disponível: %, custo: %)', v_avail, v_cost USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_reqs) r
      WHERE r->>'combatantId' = p_token_id::text
        AND (r->>'round')::integer = v_round
        AND r->>'status' = 'pending'
    ) THEN
      RAISE EXCEPTION 'Já existe uma solicitação de reação antecipada pendente para este combatente' USING ERRCODE = '22023';
    END IF;

    v_opp_id := nullif(btrim(coalesce(p_opportunity_id, '')), '');
    IF v_opp_id IS NOT NULL THEN
      SELECT e.item INTO v_opp
      FROM jsonb_array_elements(v_opps) e(item)
      WHERE e.item->>'opportunityId' = v_opp_id
      LIMIT 1;
      IF v_opp IS NULL OR v_opp->>'status' <> 'open'
         OR v_opp->>'combatantId' IS DISTINCT FROM p_token_id::text
         OR (v_opp->>'round')::integer <> v_round THEN
        RAISE EXCEPTION 'Oportunidade vinculada não está aberta para este combatente na rodada atual' USING ERRCODE = 'PT409';
      END IF;
      v_action_key := v_opp->>'actionType';
      v_cost := greatest(1, coalesce((v_opp->>'cost')::integer, 1));
    END IF;

    v_req_id := coalesce(nullif(btrim(coalesce(p_request_id, '')), ''), 'req_' || v_op_id);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_reqs) r WHERE r->>'requestId' = v_req_id) THEN
      RAISE EXCEPTION 'Solicitação com identificador duplicado: %', v_req_id USING ERRCODE = '22023';
    END IF;

    v_req := jsonb_build_object(
      'requestId', v_req_id,
      'opId', v_op_id,
      'mesaId', p_mesa_id,
      'combateId', estado->>'id',
      'mapaId', estado->>'mapa_id',
      'round', v_round,
      'combatantId', p_token_id,
      'combatantName', tok.display_name,
      'requesterUserId', auth.uid(),
      'actionType', v_action_key,
      'cost', v_cost,
      'opportunityId', v_opp_id,
      'triggerSummary', coalesce(v_trigger, v_reason, CASE WHEN v_opp IS NOT NULL THEN v_opp->>'triggerLabel' ELSE 'Reação antecipada' END),
      'status', 'pending',
      'resolutionOpId', NULL,
      'resolvedByUserId', NULL,
      'resolutionReason', NULL,
      'consumedReservationId', NULL,
      'createdAt', v_now,
      'updatedAt', v_now
    );

    v_reqs := v_reqs || jsonb_build_array(v_req);
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'request_early_reaction',
      'opId', v_op_id,
      'requestId', v_req_id,
      'opportunityId', v_opp_id,
      'combatantId', p_token_id,
      'actionType', v_action_key,
      'cost', v_cost,
      'status', 'pending',
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'availableActions', v_avail
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-10: approve_early_reaction (exclusivo Xerife; consome 1 ação sem alterar iniciativa)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'approve_early_reaction' THEN
    IF (v_req->>'round')::integer <> v_round THEN
      RAISE EXCEPTION 'Solicitação de rodada anterior não pode ser aprovada como atual' USING ERRCODE = 'PT409';
    END IF;
    IF v_req->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'Solicitação não está mais pendente (status atual: %)', v_req->>'status' USING ERRCODE = 'PT409';
    END IF;
    IF v_turn_phase <> 'pre_turn' THEN
      RAISE EXCEPTION 'Não é possível aprovar reação antecipada pois o turno do combatente já iniciou ou encerrou' USING ERRCODE = 'PT409';
    END IF;
    IF NOT coalesce((v_as->>'budgetDefined')::boolean, false) OR (v_as->>'initialBudget') IS NULL THEN
      RAISE EXCEPTION 'Orçamento de ações indefinido para este combatente' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_ledger) >= 64 THEN
      RAISE EXCEPTION 'Limite de operações de ação por rodada atingido (64)' USING ERRCODE = '22023';
    END IF;

    v_opp_id := nullif(btrim(coalesce(v_req->>'opportunityId', '')), '');
    IF v_opp_id IS NOT NULL THEN
      SELECT (e.n - 1)::integer, e.item
      INTO v_opp_pos, v_opp
      FROM jsonb_array_elements(v_opps) WITH ORDINALITY e(item, n)
      WHERE e.item->>'opportunityId' = v_opp_id;
      IF v_opp IS NULL OR v_opp->>'status' <> 'open' THEN
        RAISE EXCEPTION 'Oportunidade vinculada não está mais aberta' USING ERRCODE = 'PT409';
      END IF;
    END IF;

    v_cost := greatest(1, coalesce((v_req->>'cost')::integer, 1));
    IF v_cost > v_avail THEN
      RAISE EXCEPTION 'Conflito de saldo na aprovação: combatente não possui ações suficientes (disponível: %, necessário: %)', v_avail, v_cost USING ERRCODE = 'PT409';
    END IF;

    v_res_id := 'early_' || v_req_id;
    v_ledger := v_ledger || jsonb_build_array(
      jsonb_build_object(
        'opId', v_op_id,
        'finalOpId', v_op_id,
        'finalOperation', 'commit',
        'reservationId', v_res_id,
        'actionType', v_req->>'actionType',
        'cost', v_cost,
        'isReaction', true,
        'reactionMode', 'early_reaction',
        'requestId', v_req_id,
        'opportunityId', v_opp_id,
        'authorizedByGm', true,
        'reason', coalesce(v_reason, v_req->>'triggerSummary'),
        'status', 'committed',
        'resultRevealed', true,
        'actorUserId', auth.uid(),
        'createdAt', v_now,
        'updatedAt', v_now
      )
    );

    v_spent := v_spent + v_cost;
    v_avail := greatest(0, (v_as->>'initialBudget')::integer - v_spent - v_reserved);

    v_next_seq := CASE
      WHEN jsonb_array_length(v_audit) > 0
        THEN coalesce((v_audit->(jsonb_array_length(v_audit) - 1)->>'seq')::integer, jsonb_array_length(v_audit)) + 1
      ELSE 1
    END;
    v_audit := v_audit || jsonb_build_array(
      jsonb_build_object(
        'seq', v_next_seq,
        'opId', v_op_id,
        'operation', 'approve_early_reaction',
        'reservationId', v_res_id,
        'requestId', v_req_id,
        'opportunityId', v_opp_id,
        'actionType', v_req->>'actionType',
        'cost', v_cost,
        'isReaction', true,
        'authorizedByGm', true,
        'statusAfter', 'committed',
        'versionAfter', (v_as->>'version')::bigint + 1,
        'spentActions', v_spent,
        'reservedActions', v_reserved,
        'availableActions', v_avail,
        'timestamp', v_now,
        'actorUserId', auth.uid()
      )
    );

    v_as := v_as || jsonb_build_object(
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'version', (v_as->>'version')::bigint + 1,
      'ledger', v_ledger,
      'auditLog', v_audit
    );
    v_item := jsonb_set(v_item, '{action_state}', v_as, true);
    lista := jsonb_set(lista, ARRAY[v_item_pos::text], v_item, false);

    v_req := v_req || jsonb_build_object(
      'status', 'approved',
      'resolutionOpId', v_op_id,
      'resolvedByUserId', auth.uid(),
      'resolutionReason', v_reason,
      'consumedReservationId', v_res_id,
      'updatedAt', v_now
    );
    v_reqs := jsonb_set(v_reqs, ARRAY[v_req_pos::text], v_req, false);

    IF v_opp IS NOT NULL AND v_opp_pos >= 0 THEN
      v_opp := v_opp || jsonb_build_object(
        'status', 'consumed',
        'consumedByUserId', auth.uid(),
        'consumedByRequestId', v_req_id,
        'consumedReservationId', v_res_id,
        'updatedAt', v_now
      );
      v_opps := jsonb_set(v_opps, ARRAY[v_opp_pos::text], v_opp, false);
    END IF;

    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'approve_early_reaction',
      'opId', v_op_id,
      'requestId', v_req_id,
      'opportunityId', v_opp_id,
      'reservationId', v_res_id,
      'combatantId', p_token_id,
      'actionType', v_req->>'actionType',
      'cost', v_cost,
      'status', 'approved',
      'version', (v_as->>'version')::bigint,
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'availableActions', v_avail
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-10: deny_early_reaction (exclusivo Xerife; zero consumo)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'deny_early_reaction' THEN
    IF (v_req->>'round')::integer <> v_round OR v_req->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'Solicitação não está mais pendente nesta rodada' USING ERRCODE = 'PT409';
    END IF;
    v_req := v_req || jsonb_build_object(
      'status', 'denied',
      'resolutionOpId', v_op_id,
      'resolvedByUserId', auth.uid(),
      'resolutionReason', v_reason,
      'updatedAt', v_now
    );
    v_reqs := jsonb_set(v_reqs, ARRAY[v_req_pos::text], v_req, false);
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'deny_early_reaction',
      'opId', v_op_id,
      'requestId', v_req_id,
      'combatantId', p_token_id,
      'status', 'denied',
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'availableActions', v_avail
    );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COM-10: cancel_early_reaction (Jogador dono ou Xerife; apenas enquanto pending)
  -- ═══════════════════════════════════════════════════════════════════════════
  ELSIF v_op = 'cancel_early_reaction' THEN
    IF (v_req->>'round')::integer <> v_round OR v_req->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'Solicitação já foi decidida ou não pertence mais à rodada atual' USING ERRCODE = 'PT409';
    END IF;
    v_req := v_req || jsonb_build_object(
      'status', 'cancelled',
      'resolutionOpId', v_op_id,
      'resolvedByUserId', auth.uid(),
      'resolutionReason', v_reason,
      'updatedAt', v_now
    );
    v_reqs := jsonb_set(v_reqs, ARRAY[v_req_pos::text], v_req, false);
    v_out := jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'operation', 'cancel_early_reaction',
      'opId', v_op_id,
      'requestId', v_req_id,
      'combatantId', p_token_id,
      'status', 'cancelled',
      'spentActions', v_spent,
      'reservedActions', v_reserved,
      'availableActions', v_avail
    );
  END IF;

  -- Registra resultado para idempotência (janela de 64 entradas recentes)
  v_rop := v_rop || jsonb_build_object(
    v_op_id,
    v_out || jsonb_build_object('combatVersion', v_combat_version + 1)
  );
  IF (SELECT count(*) FROM jsonb_object_keys(v_rop)) > 64 THEN
    SELECT coalesce(jsonb_object_agg(recent.k, recent.val), '{}'::jsonb)
    INTO v_rop
    FROM (
      SELECT kv.key AS k, kv.value AS val
      FROM jsonb_each(v_rop) AS kv
      ORDER BY coalesce((kv.value->>'combatVersion')::bigint, 0) DESC
      LIMIT 64
    ) recent;
  END IF;

  estado := estado || jsonb_build_object(
    'ordem', lista,
    'versao', v_combat_version + 1,
    'oportunidades_reacao', v_opps,
    'solicitacoes_reacao', v_reqs,
    'reaction_op_results', v_rop
  );

  UPDATE public.mesas SET combate_ativo = estado WHERE id = p_mesa_id;
  v_pub := public.obter_combate_publico(p_mesa_id);

  RETURN jsonb_build_object(
    'result', v_out,
    'combate', v_pub->'combate',
    'revisao', v_pub->'revisao'
  );
END $$;
REVOKE ALL ON FUNCTION public.gerenciar_reacao_combate(uuid, uuid, uuid, text, text, text, integer, text, text, uuid, numeric, boolean, text, boolean, boolean, text, uuid, integer, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_reacao_combate(uuid, uuid, uuid, text, text, text, integer, text, text, uuid, numeric, boolean, text, boolean, boolean, text, uuid, integer, bigint, bigint, text) TO authenticated;

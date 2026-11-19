-- PACOTE 5.1 (Correção definitiva de concorrência XER-06):
-- Substitui exclusivamente os erros controlados de conflito de versão de SQLSTATE '40001'
-- (que acionam retries automáticos no PostgREST até 504 timeout) para SQLSTATE 'PT409'
-- (HTTP 409 Conflict imediato conforme especificação oficial PostgREST/Supabase).
-- Não altera tabelas, colunas, constraints, triggers, RLS, grants ou Realtime.

BEGIN;

-- 3. Rolagem inicial autoritativa no servidor (1..15 dados)
CREATE OR REPLACE FUNCTION xerife_6b.rolar_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_orig integer[] := '{}'::integer[];
  v_res integer[];
  v_zerados integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_i integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_versao IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para rolagem inicial' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada nesta mesa' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  v_n := cardinality(v_estado.dados);
  IF v_estado.versao > 0 AND cardinality(v_estado.resultados) = v_n THEN
    RAISE EXCEPTION 'Conjunto já foi rolado; use a renovação após esgotar os dados disponíveis' USING ERRCODE = '0A000';
  END IF;

  IF cardinality(v_estado.bloqueados) >= v_n THEN
    RAISE EXCEPTION 'Todos os dados da instância estão bloqueados por dano' USING ERRCODE = '55000';
  END IF;

  FOR v_i IN 1..v_n LOOP
    IF (v_i - 1) = ANY(v_estado.bloqueados) THEN
      v_orig := array_append(v_orig, 0);
    ELSE
      v_orig := array_append(v_orig, (floor(random() * v_estado.dados[v_i]) + 1)::integer);
    END IF;
  END LOOP;

  SELECT f.out_resultados, f.out_zerados_fadiga
    INTO v_res, v_zerados
    FROM xerife_6b.aplicar_fadiga_cascata(v_orig, v_estado.bloqueados, v_estado.fadiga) f;

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(v_estado.dados, v_res, '{}'::integer[], v_estado.bloqueados, v_zerados) d;

  UPDATE public.mesa_6b_instancia
     SET resultados_originais = v_orig,
         resultados = v_res,
         consumidos = '{}'::integer[],
         zerados_fadiga = v_zerados,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'ROLL_INITIAL', p_versao, v_estado.versao, v_snap
  );
  PERFORM xerife_6b.sincronizar_token_status_instancia(v_estado);
  RETURN v_snap;
END $$;

-- 4. Consumo concorrente de dados disponíveis da instância
CREATE OR REPLACE FUNCTION xerife_6b.consumir_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_indices integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_next_cons integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_consumed_vals integer[] := '{}'::integer[];
  v_consumed_bonus integer := 0;
  v_idx integer;
  v_val integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_versao IS NULL OR p_indices IS NULL OR cardinality(p_indices) = 0 THEN
    RAISE EXCEPTION 'Parâmetros inválidos para consumo de dados' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  v_n := cardinality(v_estado.dados);
  IF v_estado.versao = 0 OR cardinality(v_estado.resultados) <> v_n THEN
    RAISE EXCEPTION 'Conjunto da instância ainda não foi rolado' USING ERRCODE = '55000';
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_indices) x WHERE x IS NULL OR x < 0 OR x >= v_n) THEN
    RAISE EXCEPTION 'Índice de dado fora do intervalo válido' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) <> count(DISTINCT x) FROM unnest(p_indices) x) THEN
    RAISE EXCEPTION 'Índices duplicados na mesma operação de consumo' USING ERRCODE = '22023';
  END IF;

  FOREACH v_idx IN ARRAY p_indices LOOP
    IF v_idx = ANY(v_estado.usados)
       OR v_idx = ANY(v_estado.consumidos)
       OR v_idx = ANY(v_estado.bloqueados)
       OR v_idx = ANY(v_estado.zerados_fadiga)
       OR coalesce(v_estado.resultados[v_idx + 1], 0) <= 0 THEN
      RAISE EXCEPTION 'Dado % indisponível (já consumido, bloqueado por dano ou zerado por fadiga)', v_idx
        USING ERRCODE = '22023';
    END IF;
    v_val := v_estado.resultados[v_idx + 1];
    v_consumed_vals := array_append(v_consumed_vals, v_val);
    v_consumed_bonus := v_consumed_bonus + v_val;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::integer[])
    INTO v_next_cons
    FROM unnest(v_estado.consumidos || p_indices) AS t(x);

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_estado.resultados, v_next_cons, v_estado.bloqueados, v_estado.zerados_fadiga
    ) d;

  UPDATE public.mesa_6b_instancia
     SET consumidos = v_next_cons,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(
    v_estado,
    false,
    jsonb_build_object(
      'consumedIndices', p_indices,
      'consumedValues', v_consumed_vals,
      'consumedBonus', v_consumed_bonus
    )
  );
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'CONSUME', p_versao, v_estado.versao, v_snap
  );
  RETURN v_snap;
END $$;

-- 5. Dano com escolha pelo defensor (bloqueia dados escolhidos sem confundir com fadiga)
CREATE OR REPLACE FUNCTION xerife_6b.aplicar_dano_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_dano integer,
  p_indices_escolhidos integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_intact_count integer;
  v_required integer;
  v_next_bloq integer[];
  v_next_orig integer[];
  v_next_res integer[];
  v_next_zerados integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_idx integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'defensor');

  IF p_instance IS NULL OR p_versao IS NULL OR p_dano IS NULL OR p_dano <= 0 OR p_indices_escolhidos IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para aplicação de dano' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  v_n := cardinality(v_estado.dados);
  v_intact_count := greatest(0, v_n - cardinality(v_estado.bloqueados));
  IF v_intact_count = 0 THEN
    RAISE EXCEPTION 'Todos os dados já estão bloqueados por dano' USING ERRCODE = '55000';
  END IF;

  v_required := least(p_dano, v_intact_count);
  IF cardinality(p_indices_escolhidos) <> v_required THEN
    RAISE EXCEPTION 'O defensor deve escolher exatamente % dado(s) intacto(s) para bloquear', v_required
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) <> count(DISTINCT x) FROM unnest(p_indices_escolhidos) x) THEN
    RAISE EXCEPTION 'Não é permitido escolher duas vezes o mesmo dado' USING ERRCODE = '22023';
  END IF;

  FOREACH v_idx IN ARRAY p_indices_escolhidos LOOP
    IF v_idx IS NULL OR v_idx < 0 OR v_idx >= v_n THEN
      RAISE EXCEPTION 'Índice de dado inválido (%): fora de 0..%', v_idx, v_n - 1 USING ERRCODE = '22023';
    END IF;
    IF v_idx = ANY(v_estado.bloqueados) THEN
      RAISE EXCEPTION 'O dado % já está bloqueado por dano', v_idx USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::integer[])
    INTO v_next_bloq
    FROM unnest(v_estado.bloqueados || p_indices_escolhidos) AS t(x);

  v_next_orig := v_estado.resultados_originais;
  v_next_res := v_estado.resultados;
  IF cardinality(v_next_res) = v_n THEN
    FOREACH v_idx IN ARRAY p_indices_escolhidos LOOP
      v_next_orig[v_idx + 1] := 0;
      v_next_res[v_idx + 1] := 0;
    END LOOP;
  END IF;

  SELECT coalesce(array_agg(x ORDER BY x), '{}'::integer[])
    INTO v_next_zerados
    FROM unnest(v_estado.zerados_fadiga) AS t(x)
    WHERE NOT (x = ANY(v_next_bloq));

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_next_res, v_estado.consumidos, v_next_bloq, v_next_zerados
    ) d;

  UPDATE public.mesa_6b_instancia
     SET bloqueados = v_next_bloq,
         resultados_originais = v_next_orig,
         resultados = v_next_res,
         zerados_fadiga = v_next_zerados,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'APPLY_DAMAGE', p_versao, v_estado.versao, v_snap
  );
  PERFORM xerife_6b.sincronizar_token_status_instancia(v_estado);
  RETURN v_snap;
END $$;

-- 6. Cura / desbloqueio de dados danificados pelo Mestre
CREATE OR REPLACE FUNCTION xerife_6b.curar_dano_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_indices_curados integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_next_bloq integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_idx integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_versao IS NULL OR p_indices_curados IS NULL OR cardinality(p_indices_curados) = 0 THEN
    RAISE EXCEPTION 'Parâmetros inválidos para cura de dano' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  v_n := cardinality(v_estado.dados);
  FOREACH v_idx IN ARRAY p_indices_curados LOOP
    IF v_idx IS NULL OR v_idx < 0 OR v_idx >= v_n OR NOT (v_idx = ANY(v_estado.bloqueados)) THEN
      RAISE EXCEPTION 'O dado % não está bloqueado por dano', v_idx USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(x ORDER BY x), '{}'::integer[])
    INTO v_next_bloq
    FROM unnest(v_estado.bloqueados) AS t(x)
    WHERE NOT (x = ANY(p_indices_curados));

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_estado.resultados, v_estado.consumidos, v_next_bloq, v_estado.zerados_fadiga
    ) d;

  UPDATE public.mesa_6b_instancia
     SET bloqueados = v_next_bloq,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'HEAL_DAMAGE', p_versao, v_estado.versao, v_snap
  );
  PERFORM xerife_6b.sincronizar_token_status_instancia(v_estado);
  RETURN v_snap;
END $$;

-- 7. Ajuste de Fadiga da instância com recálculo automático em cascata nos maiores resultados
CREATE OR REPLACE FUNCTION xerife_6b.ajustar_fadiga_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_nova_fadiga integer,
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_res integer[];
  v_zerados integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_versao IS NULL OR p_nova_fadiga IS NULL OR p_nova_fadiga NOT BETWEEN 0 AND 40 THEN
    RAISE EXCEPTION 'Valor de fadiga inválido (permitido 0..40)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  v_n := cardinality(v_estado.dados);
  v_res := v_estado.resultados;
  v_zerados := v_estado.zerados_fadiga;

  IF cardinality(v_estado.resultados_originais) = v_n THEN
    SELECT f.out_resultados, f.out_zerados_fadiga
      INTO v_res, v_zerados
      FROM xerife_6b.aplicar_fadiga_cascata(v_estado.resultados_originais, v_estado.bloqueados, p_nova_fadiga) f;
  END IF;

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_res, v_estado.consumidos, v_estado.bloqueados, v_zerados
    ) d;

  UPDATE public.mesa_6b_instancia
     SET fadiga = p_nova_fadiga,
         resultados = v_res,
         zerados_fadiga = v_zerados,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'SET_FATIGUE', p_versao, v_estado.versao, v_snap
  );
  RETURN v_snap;
END $$;

-- 8. Renovação atômica (exige esgotamento, preserva bloqueados por dano, aplica +1 fadiga e recalcula em cascata)
CREATE OR REPLACE FUNCTION xerife_6b.renovar_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_op_id text DEFAULT NULL,
  p_aplicar_fadiga boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_op record;
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
  v_n integer;
  v_next_fadiga integer;
  v_orig integer[] := '{}'::integer[];
  v_res integer[];
  v_zerados integer[];
  v_usados integer[];
  v_esgotado boolean;
  v_i integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_versao IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para renovação' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância de 6B não encontrada' USING ERRCODE = '55000';
  END IF;

  IF v_clean_op IS NOT NULL THEN
    SELECT * INTO v_op
    FROM xerife_6b.instancia_operacoes
    WHERE mesa_id = p_mesa AND instance_id = p_instance AND op_id = v_clean_op;
    IF FOUND THEN
      RETURN v_op.response_snapshot || jsonb_build_object('idempotentReplay', true);
    END IF;
  END IF;

  v_n := cardinality(v_estado.dados);
  IF v_estado.versao = 0 OR cardinality(v_estado.resultados) <> v_n THEN
    RAISE EXCEPTION 'Conjunto ainda não foi rolado inicialmente' USING ERRCODE = '55000';
  END IF;

  IF v_estado.versao <> p_versao THEN
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = 'PT409';
  END IF;

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_estado.resultados, v_estado.consumidos, v_estado.bloqueados, v_estado.zerados_fadiga
    ) d;

  IF NOT v_esgotado THEN
    RAISE EXCEPTION 'Renovação permitida somente após esgotar todos os dados disponíveis da instância' USING ERRCODE = '55000';
  END IF;

  IF cardinality(v_estado.bloqueados) >= v_n THEN
    RAISE EXCEPTION 'Todos os dados da instância estão bloqueados por dano' USING ERRCODE = '55000';
  END IF;

  v_next_fadiga := CASE
    WHEN coalesce(p_aplicar_fadiga, true) THEN least(40, v_estado.fadiga + 1)
    ELSE v_estado.fadiga
  END;

  FOR v_i IN 1..v_n LOOP
    IF (v_i - 1) = ANY(v_estado.bloqueados) THEN
      v_orig := array_append(v_orig, 0);
    ELSE
      v_orig := array_append(v_orig, (floor(random() * v_estado.dados[v_i]) + 1)::integer);
    END IF;
  END LOOP;

  SELECT f.out_resultados, f.out_zerados_fadiga
    INTO v_res, v_zerados
    FROM xerife_6b.aplicar_fadiga_cascata(v_orig, v_estado.bloqueados, v_next_fadiga) f;

  SELECT d.out_usados, d.out_esgotado
    INTO v_usados, v_esgotado
    FROM xerife_6b.recalcular_derivados_instancia(
      v_estado.dados, v_res, '{}'::integer[], v_estado.bloqueados, v_zerados
    ) d;

  UPDATE public.mesa_6b_instancia
     SET fadiga = v_next_fadiga,
         resultados_originais = v_orig,
         resultados = v_res,
         consumidos = '{}'::integer[],
         zerados_fadiga = v_zerados,
         usados = v_usados,
         esgotado = v_esgotado,
         versao = v_estado.versao + 1,
         last_op_id = coalesce(v_clean_op, last_op_id),
         updated_at = clock_timestamp()
   WHERE mesa_id = p_mesa AND instance_id = p_instance
   RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(
    p_mesa, p_instance, v_clean_op, 'RENEW', p_versao, v_estado.versao, v_snap
  );
  PERFORM xerife_6b.sincronizar_token_status_instancia(v_estado);
  RETURN v_snap;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

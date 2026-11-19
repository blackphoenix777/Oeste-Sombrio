-- CANDIDATA LOCAL (XER-05 + XER-06): NÃO aplicar remotamente em Produção ou Homologação sem autorização explícita.
-- Estado persistente de 6B próprio por instância de NPC/Boss (1..15 dados d4..d12),
-- consumo concorrente atômico, dano com escolha pelo defensor, fadiga automática em cascata nos maiores dados
-- e renovação idempotente com retenção limitada de operações.

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE puballtables) THEN
    RAISE EXCEPTION 'Publicação FOR ALL TABLES incompatível com dados privados de instâncias';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS xerife_6b;
REVOKE ALL ON SCHEMA xerife_6b FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA xerife_6b TO authenticated;

CREATE TABLE IF NOT EXISTS public.mesa_6b_instancia (
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  mapa_id uuid NULL,
  token_id uuid NULL REFERENCES public.mesa_tokens(id) ON DELETE SET NULL,
  source_id text NULL,
  source_type text NOT NULL DEFAULT 'custom' CHECK (source_type IN ('oficial', 'custom', 'mesa_npc')),
  enabled boolean NOT NULL DEFAULT true,
  versao bigint NOT NULL DEFAULT 0 CHECK (versao >= 0),
  dados integer[] NOT NULL CHECK (
    cardinality(dados) BETWEEN 1 AND 15
    AND dados <@ ARRAY[4, 6, 8, 10, 12]::integer[]
  ),
  resultados_originais integer[] NOT NULL DEFAULT '{}'::integer[],
  resultados integer[] NOT NULL DEFAULT '{}'::integer[],
  consumidos integer[] NOT NULL DEFAULT '{}'::integer[],
  bloqueados integer[] NOT NULL DEFAULT '{}'::integer[],
  zerados_fadiga integer[] NOT NULL DEFAULT '{}'::integer[],
  usados integer[] NOT NULL DEFAULT '{}'::integer[],
  fadiga integer NOT NULL DEFAULT 0 CHECK (fadiga BETWEEN 0 AND 40),
  esgotado boolean NOT NULL DEFAULT false,
  last_op_id text NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (mesa_id, instance_id),
  CHECK (cardinality(resultados) = 0 OR cardinality(resultados) = cardinality(dados)),
  CHECK (cardinality(resultados_originais) = cardinality(resultados)),
  CHECK (cardinality(consumidos) <= cardinality(dados)),
  CHECK (cardinality(bloqueados) <= cardinality(dados)),
  CHECK (cardinality(zerados_fadiga) <= cardinality(dados)),
  CHECK (cardinality(usados) <= cardinality(dados))
);

CREATE INDEX IF NOT EXISTS mesa_6b_instancia_instance_idx
  ON public.mesa_6b_instancia (instance_id);

CREATE INDEX IF NOT EXISTS mesa_6b_instancia_mesa_mapa_idx
  ON public.mesa_6b_instancia (mesa_id, mapa_id);

ALTER TABLE public.mesa_6b_instancia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_6b_instancia FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mesa_6b_instancia TO authenticated;

DROP POLICY IF EXISTS mesa_6b_instancia_leitura ON public.mesa_6b_instancia;
CREATE POLICY mesa_6b_instancia_leitura ON public.mesa_6b_instancia
  FOR SELECT TO authenticated
  USING (
    public.is_mestre_da_mesa(mesa_id)
    OR EXISTS (
      SELECT 1
      FROM public.mesa_tokens t
      JOIN public.membros_mesa m
        ON m.mesa_id = t.mesa_id
       AND m.usuario_id = (SELECT auth.uid())
      WHERE t.mesa_id = mesa_6b_instancia.mesa_id
        AND t.owner_type = 'creature'
        AND t.owner_ref = mesa_6b_instancia.instance_id
        AND t.owner_user_id = (SELECT auth.uid())
    )
  );

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mesa_6b_instancia'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_6b_instancia;
  END IF;
END $$;

-- Ledger estruturado e limitado por retenção (máx. 64 operações / 24h por instância)
CREATE TABLE IF NOT EXISTS xerife_6b.instancia_operacoes (
  mesa_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  op_id text NOT NULL CHECK (char_length(btrim(op_id)) BETWEEN 1 AND 128),
  op_type text NOT NULL CHECK (
    op_type IN (
      'INIT',
      'SYNC_TEMPLATE',
      'ROLL_INITIAL',
      'CONSUME',
      'APPLY_DAMAGE',
      'HEAL_DAMAGE',
      'SET_FATIGUE',
      'RENEW'
    )
  ),
  actor_id uuid NOT NULL,
  version_before bigint NOT NULL,
  version_after bigint NOT NULL,
  response_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (mesa_id, instance_id, op_id),
  FOREIGN KEY (mesa_id, instance_id)
    REFERENCES public.mesa_6b_instancia(mesa_id, instance_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS instancia_operacoes_retention_idx
  ON xerife_6b.instancia_operacoes (mesa_id, instance_id, created_at DESC);

ALTER TABLE xerife_6b.instancia_operacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xerife_6b.instancia_operacoes FROM PUBLIC, anon, authenticated;

-- Autorização por operação:
-- 'mestre': apenas Mestre da mesa.
-- 'defensor' / 'leitura': Mestre da mesa OU membro da mesa explicitamente designado como owner_user_id do token da instância.
CREATE OR REPLACE FUNCTION xerife_6b.autorizar_instancia(
  p_mesa uuid,
  p_instance uuid DEFAULT NULL,
  p_modo text DEFAULT 'mestre'
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_gm boolean;
  v_is_token_defender boolean := false;
BEGIN
  IF v_uid IS NULL OR p_mesa IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  v_is_gm := public.is_mestre_da_mesa(p_mesa);
  IF v_is_gm THEN
    RETURN;
  END IF;

  IF p_modo IN ('defensor', 'leitura') AND p_instance IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.mesa_tokens t
      JOIN public.membros_mesa m
        ON m.mesa_id = t.mesa_id
       AND m.usuario_id = v_uid
      WHERE t.mesa_id = p_mesa
        AND t.owner_type = 'creature'
        AND t.owner_ref = p_instance
        AND t.owner_user_id = v_uid
    ) INTO v_is_token_defender;

    IF v_is_token_defender THEN
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
END $$;

-- Aplica a regra aprovada de Fadiga em cascata nos maiores dados intactos (sentido horário 0..N-1).
CREATE OR REPLACE FUNCTION xerife_6b.aplicar_fadiga_cascata(
  p_originais integer[],
  p_bloqueados integer[],
  p_fadiga integer,
  OUT out_resultados integer[],
  OUT out_zerados_fadiga integer[]
) RETURNS record
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_n integer := coalesce(cardinality(p_originais), 0);
  v_bloq integer[] := coalesce(p_bloqueados, '{}'::integer[]);
  v_rem integer := greatest(0, least(40, coalesce(p_fadiga, 0)));
  v_vals integer[] := '{}'::integer[];
  v_zerados integer[] := '{}'::integer[];
  v_i integer;
  v_high_val integer;
  v_high_idx integer;
  v_red integer;
BEGIN
  IF v_n = 0 THEN
    out_resultados := '{}'::integer[];
    out_zerados_fadiga := '{}'::integer[];
    RETURN;
  END IF;

  FOR v_i IN 1..v_n LOOP
    IF (v_i - 1) = ANY(v_bloq) THEN
      v_vals := array_append(v_vals, 0);
    ELSE
      v_vals := array_append(v_vals, greatest(0, coalesce(p_originais[v_i], 0)));
    END IF;
  END LOOP;

  WHILE v_rem > 0 LOOP
    v_high_val := -1;
    v_high_idx := -1;
    FOR v_i IN 1..v_n LOOP
      IF (v_i - 1) = ANY(v_bloq) THEN
        CONTINUE;
      END IF;
      IF v_vals[v_i] > 0 AND v_vals[v_i] > v_high_val THEN
        v_high_val := v_vals[v_i];
        v_high_idx := v_i;
      END IF;
    END LOOP;

    EXIT WHEN v_high_idx = -1 OR v_high_val <= 0;

    v_red := least(v_rem, v_high_val);
    v_vals[v_high_idx] := v_high_val - v_red;
    v_rem := v_rem - v_red;

    IF v_vals[v_high_idx] = 0 AND NOT ((v_high_idx - 1) = ANY(v_zerados)) THEN
      v_zerados := array_append(v_zerados, v_high_idx - 1);
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(x ORDER BY x), '{}'::integer[])
    INTO out_zerados_fadiga
    FROM unnest(v_zerados) AS t(x);

  out_resultados := v_vals;
END $$;

-- Recalcula usados = consumidos U bloqueados U zerados_fadiga e flag esgotado
CREATE OR REPLACE FUNCTION xerife_6b.recalcular_derivados_instancia(
  p_dados integer[],
  p_resultados integer[],
  p_consumidos integer[],
  p_bloqueados integer[],
  p_zerados_fadiga integer[],
  OUT out_usados integer[],
  OUT out_esgotado boolean
) RETURNS record
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_n integer := coalesce(cardinality(p_dados), 0);
  v_r_len integer := coalesce(cardinality(p_resultados), 0);
  v_i integer;
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x), '{}'::integer[])
    INTO out_usados
    FROM (
      SELECT DISTINCT x
      FROM unnest(
        coalesce(p_consumidos, '{}'::integer[]) ||
        coalesce(p_bloqueados, '{}'::integer[]) ||
        coalesce(p_zerados_fadiga, '{}'::integer[])
      ) AS t(x)
      WHERE x IS NOT NULL AND x >= 0 AND x < v_n
    ) s;

  IF v_n = 0 OR v_r_len <> v_n THEN
    out_esgotado := false;
    RETURN;
  END IF;

  out_esgotado := true;
  FOR v_i IN 1..v_n LOOP
    IF NOT ((v_i - 1) = ANY(coalesce(p_bloqueados, '{}'::integer[])))
       AND NOT ((v_i - 1) = ANY(out_usados))
       AND coalesce(p_resultados[v_i], 0) > 0 THEN
      out_esgotado := false;
      EXIT;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION xerife_6b.serializar_instancia(
  r public.mesa_6b_instancia,
  p_idempotent_replay boolean DEFAULT false,
  p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'mesaId', r.mesa_id,
    'mapaId', r.mapa_id,
    'instanceId', r.instance_id,
    'tokenId', r.token_id,
    'sourceId', r.source_id,
    'sourceType', r.source_type,
    'enabled', r.enabled,
    'versao', r.versao,
    'dados', r.dados,
    'resultadosOriginais', r.resultados_originais,
    'resultados', r.resultados,
    'consumidos', r.consumidos,
    'bloqueados', r.bloqueados,
    'zeradosPorFadiga', r.zerados_fadiga,
    'usados', r.usados,
    'fadiga', r.fadiga,
    'esgotado', r.esgotado,
    'lastOpId', r.last_op_id,
    'idempotentReplay', coalesce(p_idempotent_replay, false),
    'updatedAt', r.updated_at
  ) || coalesce(p_extra, '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION xerife_6b.sincronizar_token_status_instancia(
  r public.mesa_6b_instancia
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record;
BEGIN
  IF to_regclass('public.mesa_token_status') IS NULL THEN
    RETURN;
  END IF;
  FOR t IN
    SELECT id
    FROM public.mesa_tokens
    WHERE mesa_id = r.mesa_id
      AND owner_type = 'creature'
      AND owner_ref = r.instance_id
  LOOP
    UPDATE public.mesa_token_status
       SET six_b_total = greatest(1, cardinality(r.dados)),
           danos_bloqueados = least(cardinality(r.dados), cardinality(r.bloqueados)),
           updated_at = clock_timestamp()
     WHERE token_id = t.id
       AND (six_b_total, danos_bloqueados) IS DISTINCT FROM (
         greatest(1, cardinality(r.dados)),
         least(cardinality(r.dados), cardinality(r.bloqueados))
       );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION xerife_6b.registrar_operacao_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_op_id text,
  p_op_type text,
  p_version_before bigint,
  p_version_after bigint,
  p_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clean_op text := nullif(btrim(coalesce(p_op_id, '')), '');
BEGIN
  IF v_clean_op IS NULL THEN
    RETURN;
  END IF;
  IF char_length(v_clean_op) > 128 THEN
    RAISE EXCEPTION 'Identificador de operação excede 128 caracteres' USING ERRCODE = '22023';
  END IF;

  -- Retenção automática: remove entradas com mais de 24h ou além das 63 mais recentes desta instância
  DELETE FROM xerife_6b.instancia_operacoes
   WHERE mesa_id = p_mesa
     AND instance_id = p_instance
     AND (
       created_at < clock_timestamp() - interval '24 hours'
       OR op_id IN (
         SELECT op_id
         FROM xerife_6b.instancia_operacoes
         WHERE mesa_id = p_mesa
           AND instance_id = p_instance
         ORDER BY created_at DESC, version_after DESC
         OFFSET 63
       )
     );

  INSERT INTO xerife_6b.instancia_operacoes (
    mesa_id, instance_id, op_id, op_type, actor_id, version_before, version_after, response_snapshot
  ) VALUES (
    p_mesa, p_instance, v_clean_op, p_op_type, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    p_version_before, p_version_after, p_snapshot
  )
  ON CONFLICT (mesa_id, instance_id, op_id) DO NOTHING;
END $$;

-- Mantém mapa_id / token_id sincronizados na instância quando um token de criatura é inserido ou muda de mapa
CREATE OR REPLACE FUNCTION xerife_6b.sincronizar_vinculo_token_instancia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.owner_type = 'creature' AND NEW.owner_ref IS NOT NULL THEN
    UPDATE public.mesa_6b_instancia
       SET mapa_id = NEW.mapa_id,
           token_id = NEW.id,
           updated_at = clock_timestamp()
     WHERE mesa_id = NEW.mesa_id
       AND instance_id = NEW.owner_ref
       AND (mapa_id IS DISTINCT FROM NEW.mapa_id OR token_id IS DISTINCT FROM NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mesa_tokens_sync_6b_instancia ON public.mesa_tokens;
CREATE TRIGGER trg_mesa_tokens_sync_6b_instancia
  AFTER INSERT OR UPDATE OF mapa_id, owner_ref, owner_type ON public.mesa_tokens
  FOR EACH ROW EXECUTE FUNCTION xerife_6b.sincronizar_vinculo_token_instancia();

-- 1. Inicializar / Hidratar 6B próprio de uma instância (idempotente por (mesa_id, instance_id))
CREATE OR REPLACE FUNCTION xerife_6b.inicializar_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_dados integer[],
  p_op_id text DEFAULT NULL,
  p_mapa uuid DEFAULT NULL,
  p_token uuid DEFAULT NULL,
  p_source_id text DEFAULT NULL,
  p_source_type text DEFAULT 'custom',
  p_fadiga integer DEFAULT 0,
  p_resultados_iniciais integer[] DEFAULT NULL,
  p_consumidos_iniciais integer[] DEFAULT NULL,
  p_bloqueados_iniciais integer[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_n integer;
  v_source_type text := CASE WHEN p_source_type IN ('oficial', 'custom', 'mesa_npc') THEN p_source_type ELSE 'custom' END;
  v_fadiga integer := greatest(0, least(40, coalesce(p_fadiga, 0)));
  v_orig integer[] := '{}'::integer[];
  v_res integer[] := '{}'::integer[];
  v_zerados integer[] := '{}'::integer[];
  v_cons integer[] := '{}'::integer[];
  v_bloq integer[] := '{}'::integer[];
  v_usados integer[] := '{}'::integer[];
  v_esgotado boolean := false;
  v_versao bigint := 0;
  v_token_id uuid := NULL;
  v_mapa_id uuid := p_mapa;
  v_i integer;
  v_snap jsonb;
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');

  IF p_instance IS NULL OR p_dados IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para inicializar 6B da instância' USING ERRCODE = '22023';
  END IF;

  v_n := cardinality(p_dados);
  IF v_n IS NULL OR v_n NOT BETWEEN 1 AND 15 OR NOT (p_dados <@ ARRAY[4, 6, 8, 10, 12]::integer[]) THEN
    RAISE EXCEPTION 'Composição de dados inválida: permitido de 1 a 15 dados (d4, d6, d8, d10, d12)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_estado
  FROM public.mesa_6b_instancia
  WHERE mesa_id = p_mesa AND instance_id = p_instance
  FOR UPDATE;

  IF FOUND THEN
    RETURN xerife_6b.serializar_instancia(v_estado, true);
  END IF;

  IF p_token IS NOT NULL THEN
    SELECT id, mapa_id INTO v_token_id, v_mapa_id
    FROM public.mesa_tokens
    WHERE id = p_token AND mesa_id = p_mesa AND owner_type = 'creature' AND owner_ref = p_instance;
  ELSE
    SELECT id, mapa_id INTO v_token_id, v_mapa_id
    FROM public.mesa_tokens
    WHERE mesa_id = p_mesa AND owner_type = 'creature' AND owner_ref = p_instance
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  v_mapa_id := coalesce(v_mapa_id, p_mapa);

  IF p_bloqueados_iniciais IS NOT NULL AND cardinality(p_bloqueados_iniciais) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::integer[])
      INTO v_bloq
      FROM unnest(p_bloqueados_iniciais) AS t(x)
      WHERE x IS NOT NULL AND x >= 0 AND x < v_n;
  END IF;

  IF p_resultados_iniciais IS NOT NULL AND cardinality(p_resultados_iniciais) = v_n THEN
    FOR v_i IN 1..v_n LOOP
      IF (v_i - 1) = ANY(v_bloq) THEN
        v_orig := array_append(v_orig, 0);
      ELSE
        v_orig := array_append(
          v_orig,
          greatest(0, least(p_dados[v_i], coalesce(p_resultados_iniciais[v_i], 0)))
        );
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM unnest(v_orig) AS x WHERE x > 0) OR cardinality(v_bloq) > 0 THEN
      SELECT f.out_resultados, f.out_zerados_fadiga
        INTO v_res, v_zerados
        FROM xerife_6b.aplicar_fadiga_cascata(v_orig, v_bloq, v_fadiga) f;

      IF p_consumidos_iniciais IS NOT NULL AND cardinality(p_consumidos_iniciais) > 0 THEN
        SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::integer[])
          INTO v_cons
          FROM unnest(p_consumidos_iniciais) AS t(x)
          WHERE x IS NOT NULL AND x >= 0 AND x < v_n AND NOT (x = ANY(v_bloq));
      END IF;

      SELECT d.out_usados, d.out_esgotado
        INTO v_usados, v_esgotado
        FROM xerife_6b.recalcular_derivados_instancia(p_dados, v_res, v_cons, v_bloq, v_zerados) d;

      v_versao := 1;
    ELSE
      v_orig := '{}'::integer[];
      v_usados := v_bloq;
    END IF;
  ELSE
    v_usados := v_bloq;
  END IF;

  INSERT INTO public.mesa_6b_instancia (
    mesa_id, instance_id, mapa_id, token_id, source_id, source_type,
    enabled, versao, dados, resultados_originais, resultados,
    consumidos, bloqueados, zerados_fadiga, usados, fadiga, esgotado,
    last_op_id, updated_at
  ) VALUES (
    p_mesa, p_instance, v_mapa_id, v_token_id, p_source_id, v_source_type,
    true, v_versao, p_dados, v_orig, v_res,
    v_cons, v_bloq, v_zerados, v_usados, v_fadiga, v_esgotado,
    nullif(btrim(coalesce(p_op_id, '')), ''), clock_timestamp()
  )
  RETURNING * INTO v_estado;

  v_snap := xerife_6b.serializar_instancia(v_estado, false);
  PERFORM xerife_6b.registrar_operacao_instancia(p_mesa, p_instance, p_op_id, 'INIT', 0, v_estado.versao, v_snap);
  PERFORM xerife_6b.sincronizar_token_status_instancia(v_estado);
  RETURN v_snap;
END $$;

-- 2. Leitura autoritativa (uma instância ou todas as instâncias autorizadas da mesa)
CREATE OR REPLACE FUNCTION xerife_6b.ler_instancia(
  p_mesa uuid,
  p_instance uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado public.mesa_6b_instancia;
  v_is_gm boolean;
  v_list jsonb;
BEGIN
  IF p_instance IS NOT NULL THEN
    PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'leitura');
    SELECT * INTO v_estado
    FROM public.mesa_6b_instancia
    WHERE mesa_id = p_mesa AND instance_id = p_instance;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN xerife_6b.serializar_instancia(v_estado, false);
  END IF;

  IF auth.uid() IS NULL OR p_mesa IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  v_is_gm := public.is_mestre_da_mesa(p_mesa);
  IF NOT v_is_gm AND NOT EXISTS (
    SELECT 1 FROM public.membros_mesa m WHERE m.mesa_id = p_mesa AND m.usuario_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(xerife_6b.serializar_instancia(i, false) ORDER BY i.updated_at ASC, i.instance_id ASC), '[]'::jsonb)
    INTO v_list
    FROM public.mesa_6b_instancia i
    WHERE i.mesa_id = p_mesa
      AND (
        v_is_gm
        OR EXISTS (
          SELECT 1
          FROM public.mesa_tokens t
          WHERE t.mesa_id = i.mesa_id
            AND t.owner_type = 'creature'
            AND t.owner_ref = i.instance_id
            AND t.owner_user_id = auth.uid()
        )
      );

  RETURN v_list;
END $$;

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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE = '40001';
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

-- 9. Remoção explícita do estado da instância quando a criatura é removida definitivamente da cena
CREATE OR REPLACE FUNCTION xerife_6b.remover_instancia(
  p_mesa uuid,
  p_instance uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM xerife_6b.autorizar_instancia(p_mesa, p_instance, 'mestre');
  DELETE FROM public.mesa_6b_instancia
   WHERE mesa_id = p_mesa AND instance_id = p_instance;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION
  xerife_6b.autorizar_instancia(uuid, uuid, text),
  xerife_6b.aplicar_fadiga_cascata(integer[], integer[], integer),
  xerife_6b.recalcular_derivados_instancia(integer[], integer[], integer[], integer[], integer[]),
  xerife_6b.serializar_instancia(public.mesa_6b_instancia, boolean, jsonb),
  xerife_6b.sincronizar_token_status_instancia(public.mesa_6b_instancia),
  xerife_6b.registrar_operacao_instancia(uuid, uuid, text, text, bigint, bigint, jsonb),
  xerife_6b.sincronizar_vinculo_token_instancia(),
  xerife_6b.inicializar_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]),
  xerife_6b.ler_instancia(uuid, uuid),
  xerife_6b.rolar_instancia(uuid, uuid, bigint, text),
  xerife_6b.consumir_instancia(uuid, uuid, bigint, integer[], text),
  xerife_6b.aplicar_dano_instancia(uuid, uuid, bigint, integer, integer[], text),
  xerife_6b.curar_dano_instancia(uuid, uuid, bigint, integer[], text),
  xerife_6b.ajustar_fadiga_instancia(uuid, uuid, bigint, integer, text),
  xerife_6b.renovar_instancia(uuid, uuid, bigint, text, boolean),
  xerife_6b.remover_instancia(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  xerife_6b.inicializar_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]),
  xerife_6b.ler_instancia(uuid, uuid),
  xerife_6b.rolar_instancia(uuid, uuid, bigint, text),
  xerife_6b.consumir_instancia(uuid, uuid, bigint, integer[], text),
  xerife_6b.aplicar_dano_instancia(uuid, uuid, bigint, integer, integer[], text),
  xerife_6b.curar_dano_instancia(uuid, uuid, bigint, integer[], text),
  xerife_6b.ajustar_fadiga_instancia(uuid, uuid, bigint, integer, text),
  xerife_6b.renovar_instancia(uuid, uuid, bigint, text, boolean),
  xerife_6b.remover_instancia(uuid, uuid)
TO authenticated;

-- Wrappers públicos SECURITY INVOKER (mesmo padrão da fundação P0-2)
CREATE OR REPLACE FUNCTION public.inicializar_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_dados integer[],
  p_op_id text DEFAULT NULL,
  p_mapa uuid DEFAULT NULL,
  p_token uuid DEFAULT NULL,
  p_source_id text DEFAULT NULL,
  p_source_type text DEFAULT 'custom',
  p_fadiga integer DEFAULT 0,
  p_resultados_iniciais integer[] DEFAULT NULL,
  p_consumidos_iniciais integer[] DEFAULT NULL,
  p_bloqueados_iniciais integer[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.inicializar_instancia(
    p_mesa, p_instance, p_dados, p_op_id, p_mapa, p_token, p_source_id, p_source_type,
    p_fadiga, p_resultados_iniciais, p_consumidos_iniciais, p_bloqueados_iniciais
  );
$$;

CREATE OR REPLACE FUNCTION public.ler_6b_instancia(
  p_mesa uuid,
  p_instance uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.ler_instancia(p_mesa, p_instance);
$$;

CREATE OR REPLACE FUNCTION public.rolar_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.rolar_instancia(p_mesa, p_instance, p_versao, p_op_id);
$$;

CREATE OR REPLACE FUNCTION public.consumir_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_indices integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.consumir_instancia(p_mesa, p_instance, p_versao, p_indices, p_op_id);
$$;

CREATE OR REPLACE FUNCTION public.aplicar_dano_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_dano integer,
  p_indices_escolhidos integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.aplicar_dano_instancia(p_mesa, p_instance, p_versao, p_dano, p_indices_escolhidos, p_op_id);
$$;

CREATE OR REPLACE FUNCTION public.curar_dano_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_indices_curados integer[],
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.curar_dano_instancia(p_mesa, p_instance, p_versao, p_indices_curados, p_op_id);
$$;

CREATE OR REPLACE FUNCTION public.ajustar_fadiga_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_nova_fadiga integer,
  p_op_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.ajustar_fadiga_instancia(p_mesa, p_instance, p_versao, p_nova_fadiga, p_op_id);
$$;

CREATE OR REPLACE FUNCTION public.renovar_6b_instancia(
  p_mesa uuid,
  p_instance uuid,
  p_versao bigint,
  p_op_id text DEFAULT NULL,
  p_aplicar_fadiga boolean DEFAULT true
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.renovar_instancia(p_mesa, p_instance, p_versao, p_op_id, p_aplicar_fadiga);
$$;

CREATE OR REPLACE FUNCTION public.remover_6b_instancia(
  p_mesa uuid,
  p_instance uuid
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT xerife_6b.remover_instancia(p_mesa, p_instance);
$$;

REVOKE ALL ON FUNCTION
  public.inicializar_6b_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]),
  public.ler_6b_instancia(uuid, uuid),
  public.rolar_6b_instancia(uuid, uuid, bigint, text),
  public.consumir_6b_instancia(uuid, uuid, bigint, integer[], text),
  public.aplicar_dano_6b_instancia(uuid, uuid, bigint, integer, integer[], text),
  public.curar_dano_6b_instancia(uuid, uuid, bigint, integer[], text),
  public.ajustar_fadiga_6b_instancia(uuid, uuid, bigint, integer, text),
  public.renovar_6b_instancia(uuid, uuid, bigint, text, boolean),
  public.remover_6b_instancia(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.inicializar_6b_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]),
  public.ler_6b_instancia(uuid, uuid),
  public.rolar_6b_instancia(uuid, uuid, bigint, text),
  public.consumir_6b_instancia(uuid, uuid, bigint, integer[], text),
  public.aplicar_dano_6b_instancia(uuid, uuid, bigint, integer, integer[], text),
  public.curar_dano_6b_instancia(uuid, uuid, bigint, integer[], text),
  public.ajustar_fadiga_6b_instancia(uuid, uuid, bigint, integer, text),
  public.renovar_6b_instancia(uuid, uuid, bigint, text, boolean),
  public.remover_6b_instancia(uuid, uuid)
TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

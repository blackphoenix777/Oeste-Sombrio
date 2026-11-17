-- CANDIDATA: não aplicada remotamente.
-- Regras oficiais (Capítulo 12): Xerife gasta qualquer subconjunto dos dados disponíveis (1, vários ou todos);
-- renova sem custo/fadiga somente após todos os resultados do conjunto serem gastos.
-- Ativo = conectado à mesa (confirmado pelo proprietário); lease de 90 s, renovado a cada 30 s.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE puballtables) THEN
   RAISE EXCEPTION 'Publicação FOR ALL TABLES incompatível com dados secretos';
 END IF;
END $$;
CREATE SCHEMA xerife_6b;
REVOKE ALL ON SCHEMA xerife_6b FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA xerife_6b TO authenticated;

CREATE TABLE xerife_6b.presencas (
 mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
 usuario_id uuid NOT NULL, conexao uuid NOT NULL,
 ficha_id uuid REFERENCES public.fichas(id) ON DELETE SET NULL,
 visto_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(mesa_id,usuario_id,conexao)
);
CREATE INDEX presencas_6b_lease ON xerife_6b.presencas(mesa_id,visto_em);
CREATE TABLE xerife_6b.conjuntos (
 mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
 tipo text NOT NULL CHECK(tipo IN ('aberto','secreto')),
 versao bigint NOT NULL DEFAULT 0 CHECK(versao>=0),
 dados integer[] NOT NULL DEFAULT '{}', resultados integer[] NOT NULL DEFAULT '{}', usados integer[] NOT NULL DEFAULT '{}',
 composicao jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(mesa_id,tipo),
 CHECK(cardinality(dados)=cardinality(resultados)),
 CHECK(cardinality(usados)<=cardinality(dados))
);
ALTER TABLE xerife_6b.presencas ENABLE ROW LEVEL SECURITY;
ALTER TABLE xerife_6b.conjuntos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA xerife_6b FROM PUBLIC,anon,authenticated;
-- Nenhuma política permissiva: acesso aos estados privados somente pelas funções verificadas.

CREATE TABLE public.mesa_6b_aberto (
 mesa_id uuid PRIMARY KEY REFERENCES public.mesas(id) ON DELETE CASCADE,
 versao bigint NOT NULL, dados integer[] NOT NULL, resultados integer[] NOT NULL, usados integer[] NOT NULL
);
ALTER TABLE public.mesa_6b_aberto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_6b_aberto FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.mesa_6b_aberto TO authenticated;
CREATE POLICY mesa_6b_aberto_leitura ON public.mesa_6b_aberto FOR SELECT TO authenticated
 USING(public.is_mestre_da_mesa(mesa_id) OR EXISTS(SELECT 1 FROM public.membros_mesa m WHERE m.mesa_id=mesa_6b_aberto.mesa_id AND m.usuario_id=(SELECT auth.uid())));
-- Só a projeção ABERTA participa de Realtime. Não criar sinais para operações secretas.
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_6b_aberto;

CREATE FUNCTION xerife_6b.autorizar(p_mesa uuid,p_tipo text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('aberto','secreto') OR
 NOT (public.is_mestre_da_mesa(p_mesa) OR (p_tipo='aberto' AND EXISTS(
 SELECT 1 FROM public.membros_mesa m WHERE m.mesa_id=p_mesa AND m.usuario_id=auth.uid())))
 THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION xerife_6b.presenca(p_mesa uuid,p_conexao uuid,p_ficha uuid,p_sair boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM xerife_6b.autorizar(p_mesa,'aberto');
 IF p_conexao IS NULL OR p_sair IS NULL OR NOT EXISTS(SELECT 1 FROM public.membros_mesa m
 WHERE m.mesa_id=p_mesa AND m.usuario_id=auth.uid() AND m.cargo='jogador')
 THEN RAISE EXCEPTION 'Participante inválido' USING ERRCODE='42501'; END IF;
 IF p_sair THEN
   DELETE FROM xerife_6b.presencas WHERE mesa_id=p_mesa AND usuario_id=auth.uid() AND conexao=p_conexao;
   RETURN;
 END IF;
 IF p_ficha IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.fichas f WHERE f.id=p_ficha AND f.mesa_id=p_mesa AND f.usuario_id=auth.uid()
 AND coalesce(f.dados->>'tipo_ficha','jogador') NOT IN ('npc','monstro') AND coalesce(f.dados->>'isBestiaryCustom','false')<>'true')
 THEN RAISE EXCEPTION 'Ficha não vinculada ao participante' USING ERRCODE='42501'; END IF;
 DELETE FROM xerife_6b.presencas WHERE mesa_id=p_mesa AND usuario_id=auth.uid() AND visto_em<clock_timestamp()-interval '90 seconds';
 INSERT INTO xerife_6b.presencas(mesa_id,usuario_id,conexao,ficha_id) VALUES(p_mesa,auth.uid(),p_conexao,p_ficha)
 ON CONFLICT(mesa_id,usuario_id,conexao) DO UPDATE SET ficha_id=excluded.ficha_id,visto_em=clock_timestamp();
END $$;

-- Deriva 6B do jogador pelo nível da ficha (progressao_6b.json); usa config6B/config-6b apenas quando nível não estiver presente.
-- Fichas incompletas são ignoradas individualmente sem derrubar os demais participantes da mesa.
CREATE FUNCTION xerife_6b.composicao(p_mesa uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; cfg jsonb; k text; v jsonb; minimo integer:=12; maximo integer:=4;
 p_min integer; p_max integer; qtd integer:=0; ignoradas integer:=0; validos integer; soma integer;
 elenco jsonb:='[]'; raw_nivel text; v_nivel integer; m text[]; parsed_ok boolean;
BEGIN
 FOR r IN
   SELECT p.usuario_id,f.id,f.dados,to_jsonb(f)->>'nivel' AS col_nivel FROM (
     SELECT DISTINCT ON (usuario_id) usuario_id,ficha_id FROM xerife_6b.presencas
     WHERE mesa_id=p_mesa AND visto_em>statement_timestamp()-interval '90 seconds'
     ORDER BY usuario_id,visto_em DESC,conexao
   ) p JOIN public.fichas f ON f.id=p.ficha_id AND f.mesa_id=p_mesa AND f.usuario_id=p.usuario_id
   JOIN public.membros_mesa m ON m.mesa_id=p_mesa AND m.usuario_id=p.usuario_id AND m.cargo='jogador'
   WHERE coalesce(f.dados->>'tipo_ficha','jogador') NOT IN ('npc','monstro') AND coalesce(f.dados->>'isBestiaryCustom','false')<>'true'
   ORDER BY p.usuario_id
 LOOP
   parsed_ok:=false; p_min:=12; p_max:=4; cfg:=NULL;
   raw_nivel:=coalesce(nullif(btrim(r.dados->>'nivel'),''), nullif(btrim(r.col_nivel),''));
   IF raw_nivel ~ '^[0-9]+$' AND raw_nivel::integer >= 1 THEN
     v_nivel:=raw_nivel::integer;
     IF v_nivel=1 THEN p_min:=6; p_max:=6; cfg:=jsonb_build_object('d6',6);
     ELSIF v_nivel BETWEEN 2 AND 6 THEN p_min:=6; p_max:=8; cfg:=jsonb_build_object('d6',7-v_nivel,'d8',v_nivel-1);
     ELSIF v_nivel=7 THEN p_min:=8; p_max:=8; cfg:=jsonb_build_object('d8',6);
     ELSIF v_nivel BETWEEN 8 AND 12 THEN p_min:=8; p_max:=10; cfg:=jsonb_build_object('d8',13-v_nivel,'d10',v_nivel-7);
     ELSIF v_nivel=13 THEN p_min:=10; p_max:=10; cfg:=jsonb_build_object('d10',6);
     ELSIF v_nivel BETWEEN 14 AND 18 THEN p_min:=10; p_max:=12; cfg:=jsonb_build_object('d10',19-v_nivel,'d12',v_nivel-13);
     ELSE p_min:=12; p_max:=12; cfg:=jsonb_build_object('d12',6);
     END IF;
     parsed_ok:=true;
   ELSE
     cfg:=r.dados->'config6B'; validos:=0; soma:=0;
     IF jsonb_typeof(cfg)='object' THEN
       parsed_ok:=true;
       FOR k,v IN SELECT key,value FROM jsonb_each(cfg) LOOP
         IF k NOT IN ('d4','d6','d8','d10','d12') OR jsonb_typeof(v)<>'number' OR v::text !~ '^[0-9]+$' OR (v::text)::numeric>128 THEN
           parsed_ok:=false; EXIT;
         END IF;
         IF (v::text)::integer>0 THEN
           validos:=validos+1; soma:=soma+(v::text)::integer;
           p_min:=least(p_min,substring(k FROM 2)::integer); p_max:=greatest(p_max,substring(k FROM 2)::integer);
         END IF;
       END LOOP;
       IF NOT parsed_ok OR validos=0 OR soma<6 OR soma>128 THEN parsed_ok:=false; END IF;
     END IF;
     IF NOT parsed_ok AND coalesce(r.dados->>'config-6b','') ~* '^\s*[1-9][0-9]*d(4|6|8|10|12)(\s*\+\s*[1-9][0-9]*d(4|6|8|10|12))*\s*$' THEN
       cfg:='{}'::jsonb; soma:=0; p_min:=12; p_max:=4;
       FOR m IN SELECT regexp_matches(lower(r.dados->>'config-6b'),'([1-9][0-9]*)d(4|6|8|10|12)','g') LOOP
         soma:=soma+m[1]::integer;
         p_min:=least(p_min,m[2]::integer); p_max:=greatest(p_max,m[2]::integer);
         cfg:=jsonb_set(cfg,ARRAY['d'||m[2]],to_jsonb(coalesce((cfg->>('d'||m[2]))::integer,0)+m[1]::integer));
       END LOOP;
       IF soma BETWEEN 6 AND 128 THEN parsed_ok:=true; END IF;
     END IF;
   END IF;

   IF NOT parsed_ok THEN
     ignoradas:=ignoradas+1;
     CONTINUE;
   END IF;

   minimo:=least(minimo,p_min); maximo:=greatest(maximo,p_max);
   qtd:=qtd+1;
   elenco:=elenco||jsonb_build_array(jsonb_build_object('usuario',r.usuario_id,'ficha',r.id,'config',cfg));
 END LOOP;
 RETURN jsonb_build_object('quantidade',qtd,'menor',CASE WHEN qtd>0 THEN minimo END,'maior',CASE WHEN qtd>0 THEN maximo END,'elenco',elenco,'ignoradas',ignoradas);
END $$;

CREATE FUNCTION xerife_6b.ler(p_mesa uuid,p_tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; estado xerife_6b.conjuntos; dados integer[]; n integer; lados integer;
 is_gm boolean:=public.is_mestre_da_mesa(p_mesa); ignoradas integer:=0;
BEGIN
 PERFORM xerife_6b.autorizar(p_mesa,p_tipo);
 c:=xerife_6b.composicao(p_mesa);
 IF is_gm THEN ignoradas:=coalesce((c->>'ignoradas')::integer,0); END IF;
 SELECT * INTO estado FROM xerife_6b.conjuntos WHERE mesa_id=p_mesa AND tipo=p_tipo;
 IF FOUND THEN
   RETURN jsonb_build_object('versao',estado.versao,'dados',estado.dados,'resultados',estado.resultados,'usados',estado.usados,
     'composicao_pendente',estado.composicao IS DISTINCT FROM c->'elenco','fichas_invalidas',ignoradas,'regras','oficiais');
 END IF;
 n:=CASE WHEN (c->>'quantidade')::integer=0 THEN 0 WHEN p_tipo='aberto' THEN 6 ELSE (c->>'quantidade')::integer END;
 lados:=(c->>CASE WHEN p_tipo='aberto' THEN 'menor' ELSE 'maior' END)::integer;
 SELECT coalesce(array_agg(lados),'{}'::integer[]) INTO dados FROM generate_series(1,n);
 RETURN jsonb_build_object('versao',0,'dados',dados,'resultados','[]'::jsonb,'usados','[]'::jsonb,'composicao_pendente',false,'fichas_invalidas',ignoradas,'regras','oficiais');
END $$;

CREATE FUNCTION xerife_6b.rolar(p_mesa uuid,p_tipo text,p_versao bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE estado xerife_6b.conjuntos; c jsonb; v_dados integer[]; v_resultados integer[];
BEGIN
 PERFORM xerife_6b.autorizar(p_mesa,'secreto'); -- todas as mutações exclusivas do dono da mesa
 IF p_tipo IS NULL OR p_tipo NOT IN ('aberto','secreto') OR p_versao IS NULL THEN RAISE EXCEPTION 'Parâmetros inválidos' USING ERRCODE='22023'; END IF;
 INSERT INTO xerife_6b.conjuntos(mesa_id,tipo) VALUES(p_mesa,p_tipo) ON CONFLICT DO NOTHING;
 SELECT * INTO estado FROM xerife_6b.conjuntos WHERE mesa_id=p_mesa AND tipo=p_tipo FOR UPDATE;
 IF estado.versao<>p_versao THEN RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE='40001'; END IF;
 IF estado.versao>0 THEN RAISE EXCEPTION 'Use a renovação após gastar todos os resultados do conjunto' USING ERRCODE='0A000'; END IF;
 c:=xerife_6b.composicao(p_mesa);
 IF (c->>'quantidade')::integer=0 THEN RAISE EXCEPTION 'Sem jogadores ativos com ficha vinculada' USING ERRCODE='55000'; END IF;
 SELECT array_agg((c->>CASE WHEN p_tipo='aberto' THEN 'menor' ELSE 'maior' END)::integer)
 INTO v_dados FROM generate_series(1,CASE WHEN p_tipo='aberto' THEN 6 ELSE (c->>'quantidade')::integer END);
 -- Mesmo sorteio uniforme de generateDiceResult; resultado nasce no servidor, nunca é aceito do cliente.
 SELECT array_agg((floor(random()*d)+1)::integer ORDER BY ord) INTO v_resultados FROM unnest(v_dados) WITH ORDINALITY AS x(d,ord);
 UPDATE xerife_6b.conjuntos SET dados=v_dados,resultados=v_resultados,versao=1,composicao=c->'elenco'
 WHERE mesa_id=p_mesa AND tipo=p_tipo;
 IF p_tipo='aberto' THEN
   INSERT INTO public.mesa_6b_aberto VALUES(p_mesa,1,v_dados,v_resultados,'{}')
   ON CONFLICT(mesa_id) DO UPDATE SET versao=excluded.versao,dados=excluded.dados,resultados=excluded.resultados,usados=excluded.usados;
 END IF;
 RETURN xerife_6b.ler(p_mesa,p_tipo);
END $$;

CREATE FUNCTION xerife_6b.consumir(p_mesa uuid,p_tipo text,p_versao bigint,p_indices integer[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE estado xerife_6b.conjuntos; v_total integer; v_next_usados integer[]; v_next_versao bigint; v_idx integer;
BEGIN
 PERFORM xerife_6b.autorizar(p_mesa,'secreto');
 IF p_tipo IS NULL OR p_tipo NOT IN ('aberto','secreto') OR p_versao IS NULL OR p_indices IS NULL OR cardinality(p_indices)=0 THEN
   RAISE EXCEPTION 'Parâmetros inválidos para consumo' USING ERRCODE='22023';
 END IF;
 SELECT * INTO estado FROM xerife_6b.conjuntos WHERE mesa_id=p_mesa AND tipo=p_tipo FOR UPDATE;
 IF NOT FOUND OR estado.versao=0 OR cardinality(estado.resultados)=0 THEN
   RAISE EXCEPTION 'Conjunto ainda não foi rolado' USING ERRCODE='55000';
 END IF;
 IF estado.versao<>p_versao THEN RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE='40001'; END IF;
 v_total:=cardinality(estado.dados);
 IF EXISTS(SELECT 1 FROM unnest(p_indices) x WHERE x IS NULL OR x<0 OR x>=v_total) THEN
   RAISE EXCEPTION 'Índice de dado inválido' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(*)<>count(DISTINCT x) FROM unnest(p_indices) x) THEN
   RAISE EXCEPTION 'Índices duplicados' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_indices) x WHERE x=ANY(estado.usados)) THEN
   RAISE EXCEPTION 'Dado já consumido' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg(x ORDER BY x),'{}'::integer[]) INTO v_next_usados FROM (
   SELECT DISTINCT x FROM unnest(estado.usados || p_indices) AS t(x)
 ) s;
 v_next_versao:=estado.versao+1;
 UPDATE xerife_6b.conjuntos SET usados=v_next_usados, versao=v_next_versao WHERE mesa_id=p_mesa AND tipo=p_tipo;
 IF p_tipo='aberto' THEN
   INSERT INTO public.mesa_6b_aberto VALUES(p_mesa,v_next_versao,estado.dados,estado.resultados,v_next_usados)
   ON CONFLICT(mesa_id) DO UPDATE SET versao=excluded.versao,dados=excluded.dados,resultados=excluded.resultados,usados=excluded.usados;
 END IF;
 RETURN xerife_6b.ler(p_mesa,p_tipo);
END $$;

CREATE FUNCTION xerife_6b.renovar(p_mesa uuid,p_tipo text,p_versao bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE estado xerife_6b.conjuntos; c jsonb; v_dados integer[]; v_resultados integer[]; v_next_versao bigint;
BEGIN
 PERFORM xerife_6b.autorizar(p_mesa,'secreto');
 IF p_tipo IS NULL OR p_tipo NOT IN ('aberto','secreto') OR p_versao IS NULL THEN
   RAISE EXCEPTION 'Parâmetros inválidos para renovação' USING ERRCODE='22023';
 END IF;
 SELECT * INTO estado FROM xerife_6b.conjuntos WHERE mesa_id=p_mesa AND tipo=p_tipo FOR UPDATE;
 IF NOT FOUND OR estado.versao=0 OR cardinality(estado.resultados)=0 THEN
   RAISE EXCEPTION 'Conjunto ainda não foi rolado' USING ERRCODE='55000';
 END IF;
 IF estado.versao<>p_versao THEN RAISE EXCEPTION 'Versão desatualizada' USING ERRCODE='40001'; END IF;
 IF cardinality(estado.usados)<cardinality(estado.dados) THEN
   RAISE EXCEPTION 'Renovação permitida somente após gastar todos os dados do conjunto' USING ERRCODE='55000';
 END IF;
 c:=xerife_6b.composicao(p_mesa);
 IF (c->>'quantidade')::integer=0 THEN RAISE EXCEPTION 'Sem jogadores ativos com ficha vinculada' USING ERRCODE='55000'; END IF;
 SELECT array_agg((c->>CASE WHEN p_tipo='aberto' THEN 'menor' ELSE 'maior' END)::integer)
 INTO v_dados FROM generate_series(1,CASE WHEN p_tipo='aberto' THEN 6 ELSE (c->>'quantidade')::integer END);
 SELECT array_agg((floor(random()*d)+1)::integer ORDER BY ord) INTO v_resultados FROM unnest(v_dados) WITH ORDINALITY AS x(d,ord);
 v_next_versao:=estado.versao+1;
 UPDATE xerife_6b.conjuntos SET dados=v_dados,resultados=v_resultados,usados='{}',versao=v_next_versao,composicao=c->'elenco'
 WHERE mesa_id=p_mesa AND tipo=p_tipo;
 IF p_tipo='aberto' THEN
   INSERT INTO public.mesa_6b_aberto VALUES(p_mesa,v_next_versao,v_dados,v_resultados,'{}')
   ON CONFLICT(mesa_id) DO UPDATE SET versao=excluded.versao,dados=excluded.dados,resultados=excluded.resultados,usados=excluded.usados;
 END IF;
 RETURN xerife_6b.ler(p_mesa,p_tipo);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xerife_6b FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xerife_6b.presenca(uuid,uuid,uuid,boolean),xerife_6b.ler(uuid,text),xerife_6b.rolar(uuid,text,bigint),xerife_6b.consumir(uuid,text,bigint,integer[]),xerife_6b.renovar(uuid,text,bigint) TO authenticated;
CREATE FUNCTION public.presenca_6b_xerife(p_mesa uuid,p_conexao uuid,p_ficha uuid,p_sair boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT xerife_6b.presenca(p_mesa,p_conexao,p_ficha,p_sair) $$;
CREATE FUNCTION public.ler_6b_xerife(p_mesa uuid,p_tipo text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT xerife_6b.ler(p_mesa,p_tipo) $$;
CREATE FUNCTION public.rolar_6b_xerife(p_mesa uuid,p_tipo text,p_versao bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT xerife_6b.rolar(p_mesa,p_tipo,p_versao) $$;
CREATE FUNCTION public.consumir_6b_xerife(p_mesa uuid,p_tipo text,p_versao bigint,p_indices integer[])
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT xerife_6b.consumir(p_mesa,p_tipo,p_versao,p_indices) $$;
CREATE FUNCTION public.renovar_6b_xerife(p_mesa uuid,p_tipo text,p_versao bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT xerife_6b.renovar(p_mesa,p_tipo,p_versao) $$;
REVOKE ALL ON FUNCTION public.presenca_6b_xerife(uuid,uuid,uuid,boolean),public.ler_6b_xerife(uuid,text),public.rolar_6b_xerife(uuid,text,bigint),public.consumir_6b_xerife(uuid,text,bigint,integer[]),public.renovar_6b_xerife(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.presenca_6b_xerife(uuid,uuid,uuid,boolean),public.ler_6b_xerife(uuid,text),public.rolar_6b_xerife(uuid,text,bigint),public.consumir_6b_xerife(uuid,text,bigint,integer[]),public.renovar_6b_xerife(uuid,text,bigint) TO authenticated;
COMMIT;

\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_it(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.denied(query text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 PERFORM pg_temp.check_it(caught=code,label||' ['||coalesce(caught,'sem erro')||']');
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'dados'='[]','sem jogadores ativos: não inventa dados');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101');
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'dados'='[6,6,6,6,6,6]','um jogador: seis dados do menor tipo');
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000101');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','secreto')->'dados'='[8]','duas conexões do mesmo jogador contam apenas uma vez');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203',NULL,true);
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'dados'='[6,6,6,6,6,6]','fechar uma conexão preserva a outra');
SELECT pg_temp.denied($q$SELECT public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','secreto')$q$,'42501','jogador não lê segredo via RPC');
SELECT pg_temp.denied('SELECT * FROM xerife_6b.conjuntos','42501','jogador não lê tabela secreta diretamente');
SELECT pg_temp.denied($q$SELECT public.rolar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',0)$q$,'42501','jogador não opera o conjunto aberto');
SELECT pg_temp.denied($q$SELECT public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',1,ARRAY[0])$q$,'42501','jogador não consome o conjunto aberto');
SELECT pg_temp.denied($q$SELECT public.renovar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',1)$q$,'42501','jogador não renova o conjunto aberto');
SELECT pg_temp.denied($q$SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000102')$q$,'42501','presença não aceita ficha de outro usuário');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000012';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202',NULL);
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'dados'='[6,6,6,6,6,6]','jogador sem ficha não entra na composição');
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000102');
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'dados'='[4,4,4,4,4,4]','vários jogadores: aberto usa menor tipo global');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','secreto')->'dados'='[12,12]','secreto: um dado por jogador, maior tipo global');
SELECT pg_temp.check_it(jsonb_array_length(public.rolar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',0)->'resultados')=6,'rolagem inicial aberta persistida');
SELECT pg_temp.check_it(jsonb_array_length(public.rolar_6b_xerife('00000000-0000-0000-0000-000000000001','secreto',0)->'resultados')=2,'rolagem inicial secreta persistida');
SELECT pg_temp.denied($q$SELECT public.rolar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',0)$q$,'40001','replay ou versão concorrente rejeitada');
SELECT pg_temp.denied($q$SELECT public.rolar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',1)$q$,'0A000','rolagem inicial não substitui renovação');

-- Consumo oficial pelo Xerife (1, vários ou todos de uma vez) e renovação apenas após zerar
SELECT pg_temp.check_it(public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',1,ARRAY[0,2])->'usados'='[0,2]','Xerife consome múltiplos dados do 6B Aberto');
SELECT pg_temp.check_it((SELECT usados FROM public.mesa_6b_aberto WHERE mesa_id='00000000-0000-0000-0000-000000000001')=ARRAY[0,2],'projeção aberta sincroniza usados no consumo');
SELECT pg_temp.denied($q$SELECT public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',1,ARRAY[1])$q$,'40001','consumo com versão antiga é rejeitado');
SELECT pg_temp.denied($q$SELECT public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',2,ARRAY[0])$q$,'22023','consumo repetido do mesmo índice é rejeitado');
SELECT pg_temp.denied($q$SELECT public.renovar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',2)$q$,'55000','renovação bloqueada enquanto restam dados não gastos no aberto');
SELECT pg_temp.check_it(public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','secreto',1,ARRAY[0,1])->'usados'='[0,1]','Xerife pode gastar todos os dados do 6B Secreto de uma vez');
SELECT pg_temp.check_it(public.renovar_6b_xerife('00000000-0000-0000-0000-000000000001','secreto',2)->'usados'='[]','renovação secreta liberada após gastar todos os resultados');
SELECT pg_temp.check_it(public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',2,ARRAY[1,3,4,5])->'usados'='[0,1,2,3,4,5]','Xerife gasta dados restantes do 6B Aberto');

-- Preservação de resultados e consumo durante reconexão, desconexão e mudança de composição
RESET ROLE;
CREATE TEMP TABLE prior AS SELECT * FROM xerife_6b.conjuntos;
SELECT pg_temp.check_it(NOT EXISTS(SELECT 1 FROM xerife_6b.conjuntos c CROSS JOIN LATERAL unnest(c.dados,c.resultados) v(d,r) WHERE r<1 OR r>d),'resultados dentro dos tipos autorizados');
UPDATE xerife_6b.presencas SET visto_em=now()-interval '91 seconds' WHERE usuario_id='00000000-0000-0000-0000-000000000012';
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it((public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->>'composicao_pendente')::boolean,'desconexão sinaliza composição pendente');
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'usados'='[0,1,2,3,4,5]','dado já consumido não é restaurado pela mudança de composição');
SELECT pg_temp.check_it(public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','secreto')->'dados'='[12,12]','desconexão não recalcula pool durante resolução');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000103');
SELECT pg_temp.check_it((public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->>'composicao_pendente')::boolean,'troca de personagem não sobrescreve estado atual');
SELECT pg_temp.check_it((SELECT count(*) FROM public.mesa_6b_aberto)=1,'jogador lê somente projeção aberta');
SELECT pg_temp.denied('UPDATE public.mesa_6b_aberto SET usados=ARRAY[0]','42501','escrita direta na projeção negada');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000020';
SELECT pg_temp.check_it((SELECT count(*) FROM public.mesa_6b_aberto)=0,'RLS isola outra mesa');
SELECT pg_temp.denied($q$SELECT public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','secreto')$q$,'42501','Xerife de outra mesa não lê segredo');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.denied($q$SELECT public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')$q$,'42501','anônimo não chama RPC');
RESET ROLE;
SELECT pg_temp.check_it(NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE schemaname='xerife_6b'),'nenhuma tabela privada publicada em Realtime');
SELECT pg_temp.check_it(EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename='mesa_6b_aberto'),'somente projeção aberta publicada');
SELECT pg_temp.check_it(NOT EXISTS((SELECT * FROM xerife_6b.conjuntos EXCEPT SELECT * FROM prior) UNION ALL (SELECT * FROM prior EXCEPT SELECT * FROM xerife_6b.conjuntos)),'reload, reconexão e mudanças preservam resultados e consumo');
SELECT pg_temp.check_it((SELECT count(*) FROM xerife_6b.conjuntos WHERE tipo='aberto')=1,'um conjunto aberto por mesa, independente de quantos NPCs');
SELECT pg_temp.check_it(NOT has_function_privilege('authenticated','xerife_6b.composicao(uuid)','EXECUTE'),'elenco/configurações privados não acessíveis por helper');

-- Renovação aplica nova composição após zerar + derivação por nível + ficha inválida ignorada isoladamente
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it(public.renovar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',3)->'dados'='[10,10,10,10,10,10]','renovação aberta adota nova composição após gastar todos os dados');
SELECT pg_temp.check_it((public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'composicao_pendente')::boolean=false,'renovação limpa pendência de composição');
RESET ROLE;
INSERT INTO public.fichas VALUES
 ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','{"nivel":7,"config6B":{}}'),
 ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','{}');
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000012';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000104');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it((public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->>'composicao_pendente')::boolean,'ficha com nivel=7 e config6B vazio deriva d8 pelo nível');
SELECT pg_temp.check_it(public.consumir_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',4,ARRAY[0,1,2,3,4,5])->'usados'='[0,1,2,3,4,5]','zera aberto para validar renovação com derivação por nível');
SELECT pg_temp.check_it(public.renovar_6b_xerife('00000000-0000-0000-0000-000000000001','aberto',5)->'dados'='[8,8,8,8,8,8]','derivação pelo nível 7 garante d8 mesmo com config6B vazio');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000012';
SELECT public.presenca_6b_xerife('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000105');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.check_it((public.ler_6b_xerife('00000000-0000-0000-0000-000000000001','aberto')->'fichas_invalidas')::integer=1,'ficha totalmente sem nível/6B é ignorada isoladamente sem derrubar a mesa');
ROLLBACK;

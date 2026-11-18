CREATE OR REPLACE FUNCTION public.atualizar_status_da_fonte(p_token_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.mesa_tokens; d jsonb; s jsonb;
BEGIN
 SELECT * INTO t FROM public.mesa_tokens WHERE id=p_token_id; IF t.id IS NULL THEN RETURN; END IF;
 IF t.owner_type='player' THEN SELECT dados INTO d FROM public.fichas WHERE id=t.owner_ref;
 ELSE SELECT e->'data' INTO d FROM public.mesas m CROSS JOIN LATERAL jsonb_array_elements(coalesce(m.cena_ativa,'[]')) e WHERE m.id=t.mesa_id AND e->>'instanceId'=t.owner_ref::text; END IF;
 s:=public.resumo_status_dados(coalesce(d,'{}'),CASE WHEN t.owner_type='player' THEN 6 ELSE 1 END);
 INSERT INTO public.mesa_token_status(token_id,mesa_id,mapa_id,owner_type,owner_ref,six_b_total,danos_bloqueados,rem_current,rem_max)
 VALUES(t.id,t.mesa_id,t.mapa_id,t.owner_type,t.owner_ref,(s->>'six_b_total')::integer,(s->>'danos_bloqueados')::integer,(s->>'rem_current')::integer,(s->>'rem_max')::integer)
 ON CONFLICT(token_id) DO UPDATE SET mesa_id=EXCLUDED.mesa_id,mapa_id=EXCLUDED.mapa_id,owner_type=EXCLUDED.owner_type,owner_ref=EXCLUDED.owner_ref,
 six_b_total=EXCLUDED.six_b_total,danos_bloqueados=EXCLUDED.danos_bloqueados,rem_current=EXCLUDED.rem_current,rem_max=EXCLUDED.rem_max,updated_at=now()
 WHERE (mesa_token_status.mesa_id,mesa_token_status.mapa_id,mesa_token_status.owner_type,mesa_token_status.owner_ref,mesa_token_status.six_b_total,mesa_token_status.danos_bloqueados,mesa_token_status.rem_current,mesa_token_status.rem_max)
 IS DISTINCT FROM (EXCLUDED.mesa_id,EXCLUDED.mapa_id,EXCLUDED.owner_type,EXCLUDED.owner_ref,EXCLUDED.six_b_total,EXCLUDED.danos_bloqueados,EXCLUDED.rem_current,EXCLUDED.rem_max);
END $$;
DROP TRIGGER status_ficha_fonte ON public.fichas;
CREATE TRIGGER status_ficha_fonte AFTER INSERT OR UPDATE OF dados ON public.fichas FOR EACH ROW EXECUTE FUNCTION public.atualizar_status_tokens_trigger();


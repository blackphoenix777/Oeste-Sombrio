-- Defesa adicional: mesmo um token reassociado por manutenção não cruza mapas no tracker.
DO $$ DECLARE src text; BEGIN
 SELECT pg_get_functiondef('public.atualizar_resumo_combate(uuid,jsonb)'::regprocedure) INTO src;
 src:=replace(src,'t.mesa_id=room','t.mesa_id=room AND t.mapa_id::text=estado->>''mapa_id''');
 EXECUTE src;
 SELECT pg_get_functiondef('public.obter_combate_publico(uuid)'::regprocedure) INTO src;
 src:=replace(src,'WHERE t.visible_to_players OR t.owner_user_id=auth.uid();',
  'WHERE public.mapa_visivel_ao_usuario(p_mesa_id,t.mapa_id) AND (t.visible_to_players OR t.owner_user_id=auth.uid());');
 EXECUTE src;
END $$;


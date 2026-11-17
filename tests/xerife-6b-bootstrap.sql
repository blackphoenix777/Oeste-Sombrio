-- SOMENTE banco descartável novo: contrato mínimo, sem dados copiados de ambiente remoto.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE public.mesas(id uuid PRIMARY KEY,mestre_id uuid NOT NULL);
CREATE TABLE public.membros_mesa(mesa_id uuid REFERENCES public.mesas,usuario_id uuid,cargo text,PRIMARY KEY(mesa_id,usuario_id));
CREATE TABLE public.fichas(id uuid PRIMARY KEY,mesa_id uuid REFERENCES public.mesas,usuario_id uuid,dados jsonb);
CREATE FUNCTION public.is_mestre_da_mesa(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.mesas WHERE id=p AND mestre_id=auth.uid()) $$;
ALTER TABLE public.membros_mesa ENABLE ROW LEVEL SECURITY;
CREATE POLICY membro ON public.membros_mesa FOR SELECT TO authenticated USING(usuario_id=auth.uid() OR public.is_mestre_da_mesa(mesa_id));
GRANT SELECT ON public.membros_mesa TO authenticated;
CREATE PUBLICATION supabase_realtime;
INSERT INTO public.mesas VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010'),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020');
INSERT INTO public.membros_mesa VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','mestre'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','jogador'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','jogador');
INSERT INTO public.fichas VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','{"config6B":{"d6":5,"d8":1}}'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','{"config6B":{"d4":1,"d12":5}}'),
 ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','{"config6B":{"d10":6}}');

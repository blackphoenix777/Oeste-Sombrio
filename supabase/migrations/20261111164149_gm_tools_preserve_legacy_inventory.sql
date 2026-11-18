CREATE OR REPLACE FUNCTION public.preservar_recibos_inventario() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt text; item jsonb;
BEGIN
 IF jsonb_typeof(OLD.dados->'receivedDeliveryIds') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
 IF jsonb_array_length(OLD.dados->'receivedDeliveryIds')=0 THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.dados->'receivedDeliveryIds') IS DISTINCT FROM 'array' THEN
  NEW.dados:=jsonb_set(NEW.dados,'{receivedDeliveryIds}','[]'); END IF;
 IF jsonb_typeof(NEW.dados->'inventoryItems') IS DISTINCT FROM 'array' THEN
  NEW.dados:=jsonb_set(NEW.dados,'{inventoryItems}','[]'); END IF;
 FOR receipt IN SELECT jsonb_array_elements_text(coalesce(OLD.dados->'receivedDeliveryIds','[]')) LOOP
  IF NOT (NEW.dados->'receivedDeliveryIds' ? receipt) THEN
   SELECT e INTO item FROM jsonb_array_elements(coalesce(OLD.dados->'inventoryItems','[]')) e WHERE e->>'id'=receipt LIMIT 1;
   IF item IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.dados->'inventoryItems') e WHERE e->>'id'=receipt) THEN
    NEW.dados:=jsonb_set(NEW.dados,'{inventoryItems}',NEW.dados->'inventoryItems'||jsonb_build_array(item)); END IF;
   NEW.dados:=jsonb_set(NEW.dados,'{receivedDeliveryIds}',NEW.dados->'receivedDeliveryIds'||to_jsonb(receipt));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Cyber Onda 2 · #23 · Audit log imutável (append-only · retenção 12m)
--
-- BEFORE UPDATE: bloqueia QUALQUER update na audit_log (tampering protection)
-- BEFORE DELETE: só permite delete em registros com mais de 12 meses
--                (cleanup de retenção legítimo)
--
-- Aplicado direto via psql no VPS após schema.prisma sync. Não vai pra
-- migration Prisma pq triggers SQL puro sobrevivem db push.

CREATE OR REPLACE FUNCTION audit_log_block_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable · UPDATE não permitido'
    USING ERRCODE = '0A000', HINT = 'append-only por compliance LGPD/SOC2';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_block_recent_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.created_at >= NOW() - INTERVAL '12 months' THEN
    RAISE EXCEPTION 'audit_log DELETE só permitido em registros > 12 meses · created_at=%', OLD.created_at
      USING ERRCODE = '0A000', HINT = 'retenção mínima 12 meses por compliance';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_block_update();

DROP TRIGGER IF EXISTS trg_audit_log_block_recent_delete ON audit_log;
CREATE TRIGGER trg_audit_log_block_recent_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_block_recent_delete();

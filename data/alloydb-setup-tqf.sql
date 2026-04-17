-- Install Extension to report metrics
CREATE EXTENSION IF NOT EXISTS g_distributed_exec;

-- Table & Helper procedures.
-- Helper procedure that returns the type of the node.
CREATE OR REPLACE FUNCTION g_instance_type() RETURNS TEXT
AS $$
    DECLARE is_replica_inst BOOLEAN;
BEGIN
    SELECT pg_is_in_recovery INTO is_replica_inst FROM pg_is_in_recovery();
    IF is_replica_inst THEN
        RETURN 'ReplicaNode';
    ELSE
        RETURN 'PrimaryNode';
    END IF;
END;
$$
LANGUAGE plpgsql;

-- Reassign ownership from alloydbsuperuser to postgres
ALTER FUNCTION g_instance_type() OWNER TO postgres;
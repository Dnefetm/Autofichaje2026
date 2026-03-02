-- RPC for Safe Job Claiming (Race Condition Prevention)
-- This function allows multiple workers to request jobs simultaneously
-- without colliding. It uses pessimistic locking (SKIP LOCKED).

CREATE OR REPLACE FUNCTION claim_jobs(batch_size_limit INT)
RETURNS SETOF jobs AS $$
DECLARE
    claimed_ids UUID[];
BEGIN
    -- 1. Find and lock the oldest pending jobs that are due
    -- The SKIP LOCKED clause means if Worker A is looking at a row, Worker B will skip it
    SELECT array_agg(id) INTO claimed_ids
    FROM (
        SELECT id
        FROM jobs
        WHERE status = 'pending'
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT batch_size_limit
        FOR UPDATE SKIP LOCKED
    ) limited_jobs;

    -- 2. If nothing to claim, exit
    IF claimed_ids IS NULL OR array_length(claimed_ids, 1) = 0 THEN
        RETURN;
    END IF;

    -- 3. Update their status to 'processing' atomically and return them
    RETURN QUERY
    UPDATE jobs
    SET status = 'processing',
        processed_at = now()
    WHERE id = ANY(claimed_ids)
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

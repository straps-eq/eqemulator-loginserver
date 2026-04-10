-- Fix stale federation endpoint URL on the MASTER node only.
-- Previously this migration had no WHERE is_self=1 guard, which also
-- overwrote node 13's legitimate login.eqemu.dev endpoint.
UPDATE federation_nodes
SET endpoint_url = REPLACE(endpoint_url, 'login.eqemu.dev', 'eqemulator.dev'),
    updated_at = NOW()
WHERE endpoint_url LIKE '%login.eqemu.dev%'
  AND is_self = 1;

-- Fix stale federation endpoint URL: login.eqemu.dev was never a valid endpoint
-- for the master node. The correct URL is eqemulator.dev.
UPDATE federation_nodes
SET endpoint_url = REPLACE(endpoint_url, 'login.eqemu.dev', 'eqemulator.dev'),
    updated_at = NOW()
WHERE endpoint_url LIKE '%login.eqemu.dev%';

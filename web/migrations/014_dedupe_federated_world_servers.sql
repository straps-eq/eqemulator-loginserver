-- Merge duplicate federated world servers, then make (short_name, federation_source_node_id) unique.
-- Two auto-sync loops racing on a peer's first pull inserted every federated world twice.
-- Only rows with federation_source_node_id > 0 are merged: local worlds (NULL source, all of the
-- master's own) are never touched, and a UNIQUE key allows any number of NULLs.
-- Each duplicate is merged into the lowest id of its (short_name, source) pair. Everything keyed on
-- the higher ids moves first: server_claims, federation_server_status, server_profiles (merged,
-- the most recently updated wins and empty fields are filled from the others), and when present
-- world_client_support / world_client_probe_optout. Removed rows are kept in
-- login_world_servers_merged_014 / server_profiles_merged_014 (created only when something merges).
-- Idempotent: a no-op without duplicates, safe to re-run after a partial failure.
-- verify: SELECT COUNT(*) FROM information_schema.STATISTICS WHERE table_schema=DATABASE() AND table_name='login_world_servers' AND index_name='uq_short_name_source'

DROP TABLE IF EXISTS _m014_map, _m014_prof, _m014_win;

-- dup_id -> keep_id (lowest id of the pair)
CREATE TABLE _m014_map (
  dup_id INT UNSIGNED NOT NULL PRIMARY KEY,
  keep_id INT UNSIGNED NOT NULL,
  KEY (keep_id)
) ENGINE=InnoDB;
INSERT INTO _m014_map (dup_id, keep_id)
SELECT d.id, k.keep_id
FROM login_world_servers d
JOIN (SELECT short_name, federation_source_node_id, MIN(id) AS keep_id
      FROM login_world_servers
      WHERE federation_source_node_id > 0
      GROUP BY short_name, federation_source_node_id
      HAVING COUNT(*) > 1) k
  ON k.short_name = d.short_name AND k.federation_source_node_id = d.federation_source_node_id
WHERE d.id <> k.keep_id;

SET @m014_dups := (SELECT COUNT(*) FROM _m014_map);

-- Backup tables, only when there is something to merge
SET @sql := IF(@m014_dups > 0,
  'CREATE TABLE IF NOT EXISTS login_world_servers_merged_014 AS SELECT CAST(0 AS UNSIGNED) AS merged_into_id, NOW() AS merged_at, s.* FROM login_world_servers s WHERE 1 = 0',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
SET @sql := IF(@m014_dups > 0,
  'CREATE TABLE IF NOT EXISTS server_profiles_merged_014 AS SELECT CAST(0 AS UNSIGNED) AS merged_into_id, NOW() AS merged_at, p.* FROM server_profiles p WHERE 1 = 0',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- server_claims: plain move
UPDATE server_claims c JOIN _m014_map m ON m.dup_id = c.world_server_id
SET c.world_server_id = m.keep_id;

-- federation_server_status: live cache rewritten every sync; move when the kept row has none
UPDATE IGNORE federation_server_status f JOIN _m014_map m ON m.dup_id = f.world_server_id
SET f.world_server_id = m.keep_id;
DELETE f FROM federation_server_status f JOIN _m014_map m ON m.dup_id = f.world_server_id;

-- world_client_support (probe results, refreshed by the probe) and world_client_probe_optout
-- (operator setting) only exist on newer installs.
SET @has := (SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = DATABASE() AND table_name = 'world_client_support');
SET @sql := IF(@has > 0 AND @m014_dups > 0,
  'UPDATE IGNORE world_client_support w JOIN _m014_map m ON m.dup_id = w.world_server_id SET w.world_server_id = m.keep_id',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
SET @sql := IF(@has > 0 AND @m014_dups > 0,
  'DELETE w FROM world_client_support w JOIN _m014_map m ON m.dup_id = w.world_server_id',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
SET @has := (SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = DATABASE() AND table_name = 'world_client_probe_optout');
SET @sql := IF(@has > 0 AND @m014_dups > 0,
  'INSERT IGNORE INTO world_client_probe_optout (world_server_id, note, created_at) SELECT m.keep_id, o.note, o.created_at FROM world_client_probe_optout o JOIN _m014_map m ON m.dup_id = o.world_server_id ORDER BY o.created_at',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
SET @sql := IF(@has > 0 AND @m014_dups > 0,
  'DELETE o FROM world_client_probe_optout o JOIN _m014_map m ON m.dup_id = o.world_server_id',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- server_profiles (unique world_server_id): one profile per kept server
CREATE TABLE _m014_prof ENGINE=InnoDB AS
SELECT COALESCE(m.keep_id, p.world_server_id) AS grp, p.*
FROM server_profiles p
LEFT JOIN _m014_map m ON m.dup_id = p.world_server_id
WHERE p.world_server_id IN (SELECT dup_id FROM _m014_map)
   OR p.world_server_id IN (SELECT keep_id FROM _m014_map);

CREATE TABLE _m014_win (grp INT UNSIGNED NOT NULL PRIMARY KEY, win_id INT UNSIGNED NOT NULL) ENGINE=InnoDB;
INSERT INTO _m014_win (grp, win_id)
SELECT grp, id FROM (
  SELECT grp, id, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY updated_at IS NULL, updated_at DESC, id DESC) AS rn
  FROM _m014_prof
) r WHERE rn = 1;

-- Fill the winner's empty fields from the other copies, most recently updated first
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.description = (SELECT x.description FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.description, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.description, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.description, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.website_url = (SELECT x.website_url FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.website_url, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.website_url, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.website_url, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.discord_url = (SELECT x.discord_url FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.discord_url, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.discord_url, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.discord_url, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.banner_image_url = (SELECT x.banner_image_url FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.banner_image_url, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.banner_image_url, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.banner_image_url, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.expansion_era = (SELECT x.expansion_era FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.expansion_era, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.expansion_era, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.expansion_era, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.custom_ruleset = (SELECT x.custom_ruleset FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.custom_ruleset, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.custom_ruleset, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.custom_ruleset, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.tags = (SELECT x.tags FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(JSON_LENGTH(x.tags), 0) > 0 ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(JSON_LENGTH(p.tags), 0) = 0 AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(JSON_LENGTH(x.tags), 0) > 0);
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.display_tier = (SELECT x.display_tier FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.display_tier, '') <> '' ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.display_tier, '') = '' AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.display_tier, '') <> '');
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.login_server_admin_id = (SELECT x.login_server_admin_id FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.login_server_admin_id, 0) > 0 ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.login_server_admin_id, 0) = 0 AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.login_server_admin_id, 0) > 0);
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.claimed_by_admin_id = (SELECT x.claimed_by_admin_id FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.claimed_by_admin_id, 0) > 0 ORDER BY x.updated_at IS NULL, x.updated_at DESC, x.id DESC LIMIT 1)
WHERE COALESCE(p.claimed_by_admin_id, 0) = 0 AND EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.id <> w.win_id AND COALESCE(x.claimed_by_admin_id, 0) > 0);
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.created_at = (SELECT MIN(x.created_at) FROM _m014_prof x WHERE x.grp = w.grp)
WHERE EXISTS (SELECT 1 FROM _m014_prof x WHERE x.grp = w.grp AND x.created_at < p.created_at);

-- Keep the other copies in the backup, then give the winner the kept server id
START TRANSACTION;
SET @sql := IF(@m014_dups > 0,
  'INSERT INTO server_profiles_merged_014 SELECT w.win_id, NOW(), p.* FROM server_profiles p JOIN _m014_prof x ON x.id = p.id JOIN _m014_win w ON w.grp = x.grp WHERE p.id <> w.win_id',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
DELETE p FROM server_profiles p
JOIN _m014_prof x ON x.id = p.id
JOIN _m014_win w ON w.grp = x.grp
WHERE p.id <> w.win_id;
UPDATE server_profiles p JOIN _m014_win w ON w.win_id = p.id
SET p.world_server_id = w.grp
WHERE p.world_server_id <> w.grp;
COMMIT;

-- Carry a claimed admin over when the kept row has none (sync rewrites the rest)
UPDATE login_world_servers k
JOIN (SELECT m.keep_id, MIN(d.login_server_admin_id) AS admin_id
      FROM _m014_map m JOIN login_world_servers d ON d.id = m.dup_id
      WHERE d.login_server_admin_id > 0
      GROUP BY m.keep_id) a ON a.keep_id = k.id
SET k.login_server_admin_id = a.admin_id
WHERE k.login_server_admin_id = 0;

-- Back up and remove the duplicate world rows; nothing references them any more
START TRANSACTION;
SET @sql := IF(@m014_dups > 0,
  'INSERT INTO login_world_servers_merged_014 SELECT m.keep_id, NOW(), s.* FROM login_world_servers s JOIN _m014_map m ON m.dup_id = s.id',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
DELETE s FROM login_world_servers s JOIN _m014_map m ON m.dup_id = s.id;
COMMIT;

DROP TABLE IF EXISTS _m014_map, _m014_prof, _m014_win;

-- The unique key. Only skipped if duplicates remain that this file does not merge (source 0,
-- which nothing writes); the verify line above then reports it as not applied.
SET @left := (SELECT COUNT(*) FROM (SELECT 1 FROM login_world_servers WHERE federation_source_node_id IS NOT NULL
              GROUP BY short_name, federation_source_node_id HAVING COUNT(*) > 1) x);
SET @sql := IF(@left = 0,
  'ALTER TABLE login_world_servers ADD UNIQUE INDEX IF NOT EXISTS uq_short_name_source (short_name, federation_source_node_id)',
  'SELECT ''014: duplicate world servers with source 0 remain; unique key not added'' AS warning');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

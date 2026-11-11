-- Let the loginserver read client probe results, so EverQuest Legends (EQL)
-- clients are only shown worlds the probe found EQL-capable.
-- Grant only: no table or data is changed.
-- verify: SELECT COUNT(*)>0 FROM information_schema.TABLE_PRIVILEGES WHERE table_schema=DATABASE() AND table_name='world_client_support' AND grantee LIKE '%eqemu_ls%' AND privilege_type='SELECT'
GRANT SELECT ON `eqemu_login`.`world_client_support` TO 'eqemu_ls'@'%';
FLUSH PRIVILEGES;

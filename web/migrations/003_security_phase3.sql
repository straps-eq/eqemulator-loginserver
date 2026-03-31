-- Phase 3 security hardening migration
-- Run against eqemu_login database AFTER 002_security_phase2.sql

-- Add TLS certificate pinning column for optional per-peer cert verification
ALTER TABLE `federation_nodes` ADD COLUMN `tls_cert_hash` VARCHAR(128) DEFAULT NULL AFTER `last_heartbeat_at`;

-- Grant permissions (if not already granted)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_origin_map TO 'eqemu_web'@'%';
-- FLUSH PRIVILEGES;

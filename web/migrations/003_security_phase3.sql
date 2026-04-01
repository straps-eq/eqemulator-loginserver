-- Phase 3 security hardening migration
-- Run against eqemu_login database AFTER 002_security_phase2.sql

-- Add TLS certificate pinning column for optional per-peer cert verification
ALTER TABLE `federation_nodes` ADD COLUMN IF NOT EXISTS `tls_cert_hash` VARCHAR(128) DEFAULT NULL AFTER `last_heartbeat_at`;

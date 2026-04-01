-- EQEmu Login Server Schema
-- Source: https://github.com/EQEmu/Server/blob/master/loginserver/login_util/login_schema.sql

CREATE TABLE IF NOT EXISTS `login_accounts` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `account_name` varchar(50) NOT NULL,
  `account_password` text NOT NULL,
  `account_email` varchar(100) NOT NULL DEFAULT '',
  `source_loginserver` varchar(64) DEFAULT 'local',
  `last_ip_address` varchar(80) NOT NULL DEFAULT '',
  `last_login_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `source_loginserver_account_name` (`source_loginserver`,`account_name`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `login_server_admins` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `account_name` varchar(30) NOT NULL,
  `account_password` varchar(255) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `registration_date` datetime NOT NULL,
  `registration_ip_address` varchar(80) NOT NULL,
  `federation_source_node_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `login_server_list_types` (
  `id` int(10) unsigned NOT NULL,
  `description` varchar(60) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `login_world_servers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `long_name` varchar(100) NOT NULL,
  `short_name` varchar(100) NOT NULL,
  `tag_description` varchar(50) NOT NULL DEFAULT '',
  `login_server_list_type_id` int(11) NOT NULL,
  `last_login_date` datetime DEFAULT NULL,
  `last_ip_address` varchar(80) DEFAULT NULL,
  `login_server_admin_id` int(11) NOT NULL,
  `is_server_trusted` int(11) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `federation_source_node_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `login_api_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(200) DEFAULT NULL,
  `can_write` int(11) DEFAULT 0,
  `can_read` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1;

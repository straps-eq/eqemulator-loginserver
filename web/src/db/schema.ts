import {
  mysqlTable,
  int,
  varchar,
  text,
  datetime,
  tinyint,
  bigint,
  mysqlEnum,
  json,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ── EQEmu login tables (read-only from web app) ──

export const loginAccounts = mysqlTable(
  "login_accounts",
  {
    id: int("id").primaryKey().autoincrement(),
    accountName: varchar("account_name", { length: 50 }).notNull(),
    accountPassword: text("account_password").notNull(),
    accountEmail: varchar("account_email", { length: 100 }).notNull().default(""),
    sourceLoginserver: varchar("source_loginserver", { length: 64 }).default("local"),
    lastIpAddress: varchar("last_ip_address", { length: 80 }).notNull().default(""),
    lastLoginDate: datetime("last_login_date").notNull(),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
  }
);

export const loginWorldServers = mysqlTable("login_world_servers", {
  id: int("id").primaryKey().autoincrement(),
  longName: varchar("long_name", { length: 100 }).notNull(),
  shortName: varchar("short_name", { length: 100 }).notNull(),
  tagDescription: varchar("tag_description", { length: 50 }).notNull().default(""),
  loginServerListTypeId: int("login_server_list_type_id").notNull(),
  lastLoginDate: datetime("last_login_date"),
  lastIpAddress: varchar("last_ip_address", { length: 80 }),
  loginServerAdminId: int("login_server_admin_id").notNull(),
  isServerTrusted: int("is_server_trusted").notNull(),
  note: varchar("note", { length: 255 }),
});

export const loginServerAdmins = mysqlTable("login_server_admins", {
  id: int("id").primaryKey().autoincrement(),
  accountName: varchar("account_name", { length: 30 }).notNull(),
  accountPassword: varchar("account_password", { length: 255 }).notNull(),
  firstName: varchar("first_name", { length: 50 }).notNull().default(""),
  lastName: varchar("last_name", { length: 50 }).notNull().default(""),
  email: varchar("email", { length: 100 }).notNull().default(""),
  registrationDate: datetime("registration_date").notNull(),
  registrationIpAddress: varchar("registration_ip_address", { length: 80 }).notNull().default(""),
});

export const loginServerListTypes = mysqlTable("login_server_list_types", {
  id: int("id").primaryKey(),
  description: varchar("description", { length: 60 }).notNull(),
});

// ── Platform tables (read/write from web app) ──

export const platformAccounts = mysqlTable("platform_accounts", {
  id: int("id").primaryKey().autoincrement(),
  username: varchar("username", { length: 50 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: tinyint("email_verified").notNull().default(0),
  verificationToken: varchar("verification_token", { length: 128 }),
  verificationExpiresAt: datetime("verification_expires_at"),
  createdAt: datetime("created_at"),
  updatedAt: datetime("updated_at"),
});

export const accountLoginLinks = mysqlTable(
  "account_login_links",
  {
    id: int("id").primaryKey().autoincrement(),
    platformAccountId: int("platform_account_id").notNull(),
    loginAccountId: int("login_account_id").notNull(),
    linkedAt: datetime("linked_at"),
  },
  (table) => ({
    loginAccountIdx: uniqueIndex("uq_login_account").on(table.loginAccountId),
    platformIdx: index("idx_platform").on(table.platformAccountId),
  })
);

export const platformSessions = mysqlTable(
  "platform_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    loginAccountId: int("login_account_id").notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    accountIdx: index("idx_account").on(table.loginAccountId),
    expiresIdx: index("idx_expires").on(table.expiresAt),
  })
);

export const platformAdmins = mysqlTable(
  "platform_admins",
  {
    id: int("id").primaryKey().autoincrement(),
    loginAccountId: int("login_account_id").notNull(),
    role: mysqlEnum("role", ["admin", "moderator"]).notNull().default("moderator"),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    accountIdx: uniqueIndex("login_account_id").on(table.loginAccountId),
  })
);

export const serverProfiles = mysqlTable(
  "server_profiles",
  {
    id: int("id").primaryKey().autoincrement(),
    worldServerId: int("world_server_id").notNull(),
    loginServerAdminId: int("login_server_admin_id"),
    description: text("description"),
    websiteUrl: varchar("website_url", { length: 255 }),
    discordUrl: varchar("discord_url", { length: 255 }),
    bannerImageUrl: varchar("banner_image_url", { length: 255 }),
    expansionEra: varchar("expansion_era", { length: 50 }),
    customRuleset: text("custom_ruleset"),
    tags: json("tags"),
    claimedByAdminId: int("claimed_by_admin_id"),
    displayTier: mysqlEnum("display_tier", ["high", "medium", "low"]),
    showPlayerCount: tinyint("show_player_count").notNull().default(1),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
  },
  (table) => ({
    serverIdx: uniqueIndex("world_server_id").on(table.worldServerId),
  })
);

// server_stats_history table removed — metrics now stored in Prometheus

export const platformConfig = mysqlTable("platform_config", {
  configKey: varchar("config_key", { length: 100 }).primaryKey(),
  configValue: text("config_value").notNull(),
  updatedAt: datetime("updated_at"),
});

// ── Federation tables ──

export const federationNodes = mysqlTable(
  "federation_nodes",
  {
    id: int("id").primaryKey().autoincrement(),
    name: varchar("name", { length: 100 }).notNull(),
    endpointUrl: varchar("endpoint_url", { length: 255 }).notNull(),
    publicKey: varchar("public_key", { length: 128 }).notNull(),
    privateKey: text("private_key"),
    isSelf: tinyint("is_self").notNull().default(0),
    isMaster: tinyint("is_master").notNull().default(0),
    isApproved: tinyint("is_approved").notNull().default(0),
    status: mysqlEnum("status", ["active", "suspended", "revoked"]).notNull().default("active"),
    nodeTier: mysqlEnum("node_tier", ["official", "mesh"]).notNull().default("mesh"),
    lastSyncSeq: bigint("last_sync_seq", { mode: "number" }).notNull().default(0),
    lastConfigVersion: int("last_config_version").notNull().default(0),
    lastSyncAt: datetime("last_sync_at"),
    lastHeartbeatAt: datetime("last_heartbeat_at"),
    tlsCertHash: varchar("tls_cert_hash", { length: 128 }),
    bootstrapToken: varchar("bootstrap_token", { length: 128 }),
    bootstrapExpiresAt: datetime("bootstrap_expires_at"),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
  },
  (table) => ({
    pubkeyIdx: uniqueIndex("uq_public_key").on(table.publicKey),
  })
);

export const federationConfig = mysqlTable(
  "federation_config",
  {
    id: int("id").primaryKey().autoincrement(),
    configKey: varchar("config_key", { length: 100 }).notNull(),
    configValue: json("config_value").notNull(),
    version: int("version").notNull().default(1),
    updatedAt: datetime("updated_at"),
  },
  (table) => ({
    keyIdx: uniqueIndex("uq_config_key").on(table.configKey),
  })
);

export const federationChangelog = mysqlTable(
  "federation_changelog",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    tableName: varchar("table_name", { length: 64 }).notNull(),
    rowId: int("row_id").notNull(),
    operation: mysqlEnum("operation", ["insert", "update", "delete"]).notNull(),
    originNodeId: int("origin_node_id").notNull(),
    payload: json("payload").notNull(),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    originIdx: index("idx_origin").on(table.originNodeId),
    createdIdx: index("idx_created").on(table.createdAt),
  })
);

export const federationAuditLog = mysqlTable(
  "federation_audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    nodeId: int("node_id"),
    action: varchar("action", { length: 100 }).notNull(),
    detail: json("detail"),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    nodeIdx: index("idx_node").on(table.nodeId),
    createdIdx: index("idx_fed_audit_created").on(table.createdAt),
  })
);

export const federationOriginMap = mysqlTable(
  "federation_origin_map",
  {
    id: int("id").primaryKey().autoincrement(),
    tableName: varchar("table_name", { length: 64 }).notNull(),
    rowId: int("row_id").notNull(),
    originNodeId: int("origin_node_id").notNull(),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    tableRowIdx: uniqueIndex("uq_table_row").on(table.tableName, table.rowId),
    originIdx: index("idx_origin_node").on(table.originNodeId),
  })
);

export const worldServerAdminLinks = mysqlTable(
  "world_server_admin_links",
  {
    id: int("id").primaryKey().autoincrement(),
    platformAccountId: int("platform_account_id").notNull(),
    loginServerAdminId: int("login_server_admin_id").notNull(),
    accountPassword: varchar("account_password", { length: 255 }).notNull().default(""),
    linkedAt: datetime("linked_at"),
  },
  (table) => ({
    adminIdx: uniqueIndex("uq_admin").on(table.loginServerAdminId),
    platformIdx: index("idx_ws_platform").on(table.platformAccountId),
  })
);

export const serverClaims = mysqlTable(
  "server_claims",
  {
    id: int("id").primaryKey().autoincrement(),
    worldServerId: int("world_server_id").notNull(),
    loginAccountId: int("login_account_id").notNull(),
    verificationMethod: mysqlEnum("verification_method", ["tag", "admin_key"]).notNull(),
    verificationToken: varchar("verification_token", { length: 64 }),
    verified: tinyint("verified").notNull().default(0),
    createdAt: datetime("created_at"),
  },
  (table) => ({
    serverIdx: index("idx_server").on(table.worldServerId),
  })
);

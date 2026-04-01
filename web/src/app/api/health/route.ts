import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const issues: string[] = [];
  const passed: string[] = [];

  try {
    // Check required columns exist
    const cols = [
      { table: "login_world_servers", column: "federation_source_node_id" },
      { table: "login_server_admins", column: "federation_source_node_id" },
      { table: "server_profiles", column: "display_tier" },
      { table: "server_profiles", column: "show_player_count" },
    ];
    for (const { table, column } of cols) {
      const [rows]: any = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${table}' AND COLUMN_NAME='${column}'`
      ));
      const cnt = Number(Array.isArray(rows) ? rows[0]?.cnt : rows?.cnt ?? 0);
      if (cnt === 0) {
        issues.push(`Missing column: ${table}.${column}`);
      } else {
        passed.push(`${table}.${column}`);
      }
    }

    // Check required tables
    const requiredTables = [
      "platform_accounts", "platform_config", "server_profiles",
      "federation_nodes", "federation_config",
    ];
    const [tableRows]: any = await db.execute(sql.raw(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`
    ));
    const existing = new Set((Array.isArray(tableRows) ? tableRows : []).map((r: any) => r.TABLE_NAME));
    for (const t of requiredTables) {
      if (!existing.has(t)) {
        issues.push(`Missing table: ${t}`);
      } else {
        passed.push(`table:${t}`);
      }
    }

    // Check write grants on loginserver tables
    const grantTables = ["login_accounts", "login_world_servers", "login_server_admins"];
    for (const t of grantTables) {
      try {
        await db.execute(sql.raw(`DELETE FROM \`${t}\` WHERE 1=0`));
        passed.push(`grant:DELETE:${t}`);
      } catch (e: any) {
        if (e?.message?.includes("command denied")) {
          issues.push(`Missing DELETE grant on ${t}`);
        }
      }
    }

    return NextResponse.json({
      status: issues.length === 0 ? "ok" : "issues",
      passed: passed.length,
      issues,
    });
  } catch (e) {
    return NextResponse.json({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      issues,
    }, { status: 500 });
  }
}

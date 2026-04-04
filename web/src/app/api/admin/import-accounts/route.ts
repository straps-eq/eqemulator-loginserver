import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface ParsedRow {
  lsaccountId: number;
  name: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data } = await request.json();
    if (!data || typeof data !== "string") {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    // Parse TSV/CSV: expect lines with lsaccount_id and name
    const lines = data.trim().split("\n");
    const rows: ParsedRow[] = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip header row
      if (line.toLowerCase().includes("lsaccount_id") || line.toLowerCase().startsWith("id\t")) {
        continue;
      }

      // Split by tab or comma
      const parts = line.split(/[\t,]+/).map((s) => s.trim().replace(/^"|"$/g, ""));
      if (parts.length < 2) {
        errors.push(`Line ${i + 1}: expected at least 2 columns`);
        continue;
      }

      const lsaccountId = parseInt(parts[0], 10);
      const name = parts[1];

      if (!lsaccountId || lsaccountId <= 0) {
        errors.push(`Line ${i + 1}: invalid lsaccount_id "${parts[0]}"`);
        continue;
      }
      if (!name || name.length > 50) {
        errors.push(`Line ${i + 1}: invalid or missing name`);
        continue;
      }

      rows.push({ lsaccountId, name });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found", errors },
        { status: 400 }
      );
    }

    // Deduplicate by lsaccount_id (keep first occurrence)
    const seen = new Set<number>();
    const unique: ParsedRow[] = [];
    for (const row of rows) {
      if (!seen.has(row.lsaccountId)) {
        seen.add(row.lsaccountId);
        unique.push(row);
      }
    }

    // Insert accounts that don't already exist
    let imported = 0;
    let skipped = 0;

    for (const row of unique) {
      const existing = await db
        .select({ id: loginAccounts.id })
        .from(loginAccounts)
        .where(eq(loginAccounts.id, row.lsaccountId))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        await db.insert(loginAccounts).values({
          id: row.lsaccountId,
          accountName: row.name,
          accountPassword: "",
          accountEmail: "",
          sourceLoginserver: "eqemu",
          lastIpAddress: "",
          lastLoginDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: unique.length,
      parseErrors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error("Import accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

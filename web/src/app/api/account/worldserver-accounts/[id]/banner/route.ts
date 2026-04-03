import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { worldServerAdminLinks, serverProfiles, loginWorldServers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import sharp from "sharp";
import { appendChangelog } from "@/lib/federation/changelog";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const BANNER_MAX_WIDTH = 1200;
const BANNER_MAX_HEIGHT = 400;
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "banners");

async function verifyOwnership(adminId: number, platformAccountId: number) {
  const links = await db
    .select()
    .from(worldServerAdminLinks)
    .where(
      and(
        eq(worldServerAdminLinks.loginServerAdminId, adminId),
        eq(worldServerAdminLinks.platformAccountId, platformAccountId)
      )
    );
  return links.length > 0 ? links[0] : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const adminId = parseInt(id, 10);
    if (isNaN(adminId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const link = await verifyOwnership(adminId, session.accountId);
    if (!link) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("banner") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Resize to banner dimensions, convert to webp for efficiency
    let resized: Buffer;
    try {
      resized = await sharp(buffer)
        .resize(BANNER_MAX_WIDTH, BANNER_MAX_HEIGHT, {
          fit: "cover",
          position: "center",
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (err) {
      console.error(`[banner] Image processing failed for admin ${adminId}:`, err);
      return NextResponse.json({ error: "Failed to process image — file may be corrupted or unsupported" }, { status: 400 });
    }

    // Save to disk
    try {
      await mkdir(UPLOAD_DIR, { recursive: true });
    } catch (err) {
      console.error(`[banner] Failed to create upload dir ${UPLOAD_DIR}:`, err);
      return NextResponse.json({ error: "Server storage error — unable to create upload directory" }, { status: 500 });
    }
    const filename = `banner-${adminId}-${Date.now()}.webp`;
    const filepath = path.join(UPLOAD_DIR, filename);
    try {
      await writeFile(filepath, resized);
    } catch (err) {
      console.error(`[banner] Failed to write file ${filepath}:`, err);
      return NextResponse.json({ error: "Server storage error — unable to save file" }, { status: 500 });
    }

    const bannerUrl = `/uploads/banners/${filename}`;

    // Update profile
    const existing = await db
      .select()
      .from(serverProfiles)
      .where(eq(serverProfiles.loginServerAdminId, adminId));

    if (existing.length > 0) {
      await db
        .update(serverProfiles)
        .set({ bannerImageUrl: bannerUrl, updatedAt: new Date() })
        .where(eq(serverProfiles.loginServerAdminId, adminId));

      await appendChangelog("server_profiles", existing[0].id, "update", {
        id: existing[0].id,
        banner_image_url: bannerUrl,
      });
    } else {
      // Look up the actual world server ID for this admin
      const worldServers = await db
        .select({ id: loginWorldServers.id })
        .from(loginWorldServers)
        .where(eq(loginWorldServers.loginServerAdminId, adminId));
      const worldServerId = worldServers.length > 0 ? worldServers[0].id : adminId;

      const [insertResult] = await db.insert(serverProfiles).values({
        worldServerId,
        loginServerAdminId: adminId,
        bannerImageUrl: bannerUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await appendChangelog("server_profiles", Number(insertResult.insertId), "insert", {
        id: Number(insertResult.insertId),
        world_server_id: worldServerId,
        login_server_admin_id: adminId,
        banner_image_url: bannerUrl,
      });
    }

    return NextResponse.json({ bannerUrl });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[banner] Unexpected error:`, error);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { version as APP_VERSION } from "../../../../../package.json";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId) {
    return null;
  }
  const adminCheck = await db
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(eq(platformAdmins.loginAccountId, session.accountId));
  if (adminCheck.length === 0 || (adminCheck[0].role !== "admin" && adminCheck[0].role !== "moderator")) {
    return null;
  }
  return session;
}

function isMasterAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  return session.adminRole === "admin";
}

/** GET — federation status overview for admin panel. */
export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Dynamic imports to avoid webpack chunk splitting issues
    const { db } = await import("@/lib/db");
    const { federationNodes, federationChangelog, federationAuditLog } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const { getSelfNode, getAllConfig } = await import("@/lib/federation/node");
    const { getLatestSeq } = await import("@/lib/federation/changelog");
    const { publicKeyFingerprint } = await import("@/lib/federation/crypto");

    const self = await getSelfNode();
    const nodes = await db.select().from(federationNodes);
    const configs = await getAllConfig();
    const latestSeq = await getLatestSeq();

    // Compute fingerprints for self and all nodes
    const selfFingerprint = self ? await publicKeyFingerprint(self.publicKey) : null;
    const nodeFingerprints: Record<number, string> = {};
    for (const n of nodes) {
      if (n.publicKey && !n.publicKey.startsWith("pending_")) {
        try {
          nodeFingerprints[n.id] = await publicKeyFingerprint(n.publicKey);
        } catch { /* skip invalid keys */ }
      }
    }

    // Recent audit entries
    const recentAudit = await db
      .select()
      .from(federationAuditLog)
      .orderBy(sql`${federationAuditLog.id} DESC`)
      .limit(20);

    // Changelog stats
    const changelogCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(federationChangelog);

    return NextResponse.json({
      initialized: !!self,
      selfVersion: APP_VERSION,
      self: self
        ? {
            id: self.id,
            name: self.name,
            endpointUrl: self.endpointUrl,
            publicKey: self.publicKey,
            fingerprint: selfFingerprint,
            isMaster: self.isMaster,
            nodeTier: self.nodeTier,
          }
        : null,
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        endpointUrl: n.endpointUrl,
        publicKey: n.publicKey,
        fingerprint: nodeFingerprints[n.id] || null,
        isSelf: n.isSelf,
        isMaster: n.isMaster,
        isApproved: n.isApproved,
        status: n.status,
        nodeTier: n.nodeTier,
        softwareVersion: n.softwareVersion,
        lastSyncSeq: n.lastSyncSeq,
        lastSyncAt: n.lastSyncAt,
        lastHeartbeatAt: n.lastHeartbeatAt,
        hasPendingToken: !!n.bootstrapToken,
        bootstrapExpiresAt: n.bootstrapExpiresAt,
        createdAt: n.createdAt,
      })),
      config: configs.map((c) => ({
        key: c.configKey,
        value: c.configValue,
        version: c.version,
      })),
      changelog: {
        latestSeq,
        totalEntries: changelogCount[0]?.count ?? 0,
      },
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        nodeId: a.nodeId,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    console.error("Admin federation GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST — federation actions: initialize, add_peer, update_config, sync, suspend, revoke, etc. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Dynamic imports to avoid webpack chunk splitting issues
    const { db } = await import("@/lib/db");
    const { federationNodes } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const nodeModule = await import("@/lib/federation/node");

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "initialize": {
        if (!isMasterAdmin(session)) {
          return NextResponse.json(
            { error: "Only master admins (role: admin) can create a new federation" },
            { status: 403 }
          );
        }
        const { name, endpoint_url } = body;
        if (!name || !endpoint_url) {
          return NextResponse.json(
            { error: "name and endpoint_url are required" },
            { status: 400 }
          );
        }
        const self = await nodeModule.initializeAsMaster(name, endpoint_url);
        return NextResponse.json({
          success: true,
          node: {
            id: self.id,
            name: self.name,
            publicKey: self.publicKey,
            endpointUrl: self.endpointUrl,
          },
        });
      }

      case "join_federation": {
        const { name, endpoint_url, master_url, bootstrap_token } = body;
        if (!name || !endpoint_url || !master_url || !bootstrap_token) {
          return NextResponse.json(
            { error: "name, endpoint_url, master_url, and bootstrap_token are required" },
            { status: 400 }
          );
        }
        const joined = await nodeModule.initializeAsPeer(name, endpoint_url, master_url, bootstrap_token);
        return NextResponse.json({
          success: true,
          node: {
            id: joined.id,
            name: joined.name,
            publicKey: joined.publicKey,
            endpointUrl: joined.endpointUrl,
          },
        });
      }

      case "add_peer": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can add peers" }, { status: 403 });
        }
        const { name, endpoint_url } = body;
        if (!name || !endpoint_url) {
          return NextResponse.json(
            { error: "name and endpoint_url are required" },
            { status: 400 }
          );
        }
        const invite = await nodeModule.createPeerInvite(name, endpoint_url);
        return NextResponse.json({
          success: true,
          node_id: invite.nodeId,
          bootstrap_token: invite.token,
        });
      }

      case "update_config": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can update config" }, { status: 403 });
        }
        const { key, value } = body;
        if (!key) {
          return NextResponse.json({ error: "key is required" }, { status: 400 });
        }
        await nodeModule.setConfig(key, value);
        await nodeModule.auditLog(self.id, "config_updated", { key, value });
        return NextResponse.json({ success: true });
      }

      case "sync": {
        const self = await nodeModule.getSelfNode();
        if (!self) {
          return NextResponse.json({ error: "Not initialized" }, { status: 400 });
        }
        const { runSyncCycle, clearSyncDataHash } = await import("@/lib/federation/sync");
        clearSyncDataHash(); // Force full re-apply on manual sync
        const result = await runSyncCycle();
        return NextResponse.json({ success: true, ...result });
      }

      case "set_tier": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can change node tiers" }, { status: 403 });
        }
        const { node_id: tierId, tier } = body;
        if (!tierId || typeof tierId !== "number" || tierId <= 0) {
          return NextResponse.json({ error: "Valid node_id is required" }, { status: 400 });
        }
        if (tier !== "official" && tier !== "mesh") {
          return NextResponse.json({ error: "tier must be 'official' or 'mesh'" }, { status: 400 });
        }
        if (tierId === self.id && tier === "mesh") {
          return NextResponse.json({ error: "Cannot demote master node to mesh" }, { status: 400 });
        }
        await db
          .update(federationNodes)
          .set({ nodeTier: tier, updatedAt: new Date() })
          .where(eq(federationNodes.id, tierId));
        await nodeModule.auditLog(self.id, "node_tier_changed", { nodeId: tierId, tier });
        return NextResponse.json({ success: true });
      }

      case "suspend_node": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can suspend nodes" }, { status: 403 });
        }
        const { node_id } = body;
        if (!node_id || typeof node_id !== "number" || node_id <= 0) {
          return NextResponse.json({ error: "Valid node_id is required" }, { status: 400 });
        }
        if (node_id === self.id) {
          return NextResponse.json({ error: "Cannot suspend self" }, { status: 400 });
        }
        await db
          .update(federationNodes)
          .set({ status: "suspended", updatedAt: new Date() })
          .where(eq(federationNodes.id, node_id));
        await nodeModule.auditLog(self.id, "node_suspended", { nodeId: node_id });
        return NextResponse.json({ success: true });
      }

      case "revoke_node": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can revoke nodes" }, { status: 403 });
        }
        const { node_id: revokeId } = body;
        if (!revokeId || typeof revokeId !== "number" || revokeId <= 0) {
          return NextResponse.json({ error: "Valid node_id is required" }, { status: 400 });
        }
        if (revokeId === self.id) {
          return NextResponse.json({ error: "Cannot revoke self" }, { status: 400 });
        }
        await db
          .update(federationNodes)
          .set({ status: "revoked", isApproved: 0, updatedAt: new Date() })
          .where(eq(federationNodes.id, revokeId));
        await nodeModule.auditLog(self.id, "node_revoked", { nodeId: revokeId });
        return NextResponse.json({ success: true });
      }

      case "reactivate_node": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can reactivate nodes" }, { status: 403 });
        }
        const { node_id: reactivateId } = body;
        if (!reactivateId || typeof reactivateId !== "number" || reactivateId <= 0) {
          return NextResponse.json({ error: "Valid node_id is required" }, { status: 400 });
        }
        await db
          .update(federationNodes)
          .set({ status: "active", isApproved: 1, updatedAt: new Date() })
          .where(eq(federationNodes.id, reactivateId));
        await nodeModule.auditLog(self.id, "node_reactivated", { nodeId: reactivateId });
        return NextResponse.json({ success: true });
      }

      case "delete_node": {
        const self = await nodeModule.getSelfNode();
        if (!self?.isMaster) {
          return NextResponse.json({ error: "Only master can delete nodes" }, { status: 403 });
        }
        const { node_id: deleteId } = body;
        if (!deleteId || typeof deleteId !== "number" || deleteId <= 0) {
          return NextResponse.json({ error: "Valid node_id is required" }, { status: 400 });
        }
        if (deleteId === self.id) {
          return NextResponse.json({ error: "Cannot delete self" }, { status: 400 });
        }
        // Also clean up origin map entries for this node
        const { federationOriginMap } = await import("@/db/schema");
        await db
          .delete(federationOriginMap)
          .where(eq(federationOriginMap.originNodeId, deleteId));
        await db
          .delete(federationNodes)
          .where(eq(federationNodes.id, deleteId));
        await nodeModule.auditLog(self.id, "node_deleted", { nodeId: deleteId });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("Admin federation POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

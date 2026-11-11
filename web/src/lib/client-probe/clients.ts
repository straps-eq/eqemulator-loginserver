/**
 * Per-client definitions for the world login handshake.
 *
 * Opcodes come from utils/patches/patch_<client>.conf in the EQEmu server
 * source (Titanium..RoF2 identical on master and develop; TOB from the
 * develop / tob_patch branches). A world identifies a client by the opcode
 * and size of the first app packet (EQStreamIdentifier, signature =
 * OP_SendLoginInfo + sizeof(LoginInfo_Struct)), so these must be exact.
 *
 * LoginInfo_Struct is 464 bytes for every client (the struct comments say
 * 488, but the fields add up to 464 and world checks sizeof exactly):
 *   0   char  login_info[64]   "<loginserver account id>\0<session key>\0"
 *   64  uint8 unknown064[124]  (CustomFilesKey payload on modified clients)
 *   188 uint8 zoning           0 = coming from the login server
 *   189 uint8 unknown189[275]
 */

import { CLIENT_LABELS, type ClientId } from "./labels";

export type { ClientId };

export interface ClientOpcodes {
  sendLoginInfo: number;
  /** Sent by the world after a successful login (0 = not sent for this client). */
  guildsList: number;
  logServer: number;
  approveWorld: number;
  enterWorld: number;
  postEnterWorld: number;
  expansionInfo: number;
  sendMaxCharacters: number;
  sendMembership: number;
  sendMembershipDetails: number;
  /** Character list; also used for the "unsupported client" message. */
  sendCharInfo: number;
}

export interface ClientDef {
  id: ClientId;
  /** Short label for badges. */
  label: string;
  /** Name the server uses for this client (EQ::versions::ClientVersionName). */
  serverName: string;
  loginInfoSize: number;
  opcodes: ClientOpcodes;
}

export const LOGIN_INFO_SIZE = 464;

/** patch_<client>.conf names for the opcodes the probe uses. */
const PATCH_NAMES: Record<keyof ClientOpcodes, string> = {
  sendLoginInfo: "OP_SendLoginInfo",
  guildsList: "OP_GuildsList",
  logServer: "OP_LogServer",
  approveWorld: "OP_ApproveWorld",
  enterWorld: "OP_EnterWorld",
  postEnterWorld: "OP_PostEnterWorld",
  expansionInfo: "OP_ExpansionInfo",
  sendMaxCharacters: "OP_SendMaxCharacters",
  sendMembership: "OP_SendMembership",
  sendMembershipDetails: "OP_SendMembershipDetails",
  sendCharInfo: "OP_SendCharInfo",
};

/**
 * Opcodes in patch file form, "OP_SendLoginInfo=0x1234,OP_LogServer=0x...",
 * separated by commas, spaces or new lines. Unknown names and bad values are
 * ignored; anything not given stays 0 (not sent / not known).
 */
export function parsePatchOpcodes(text: string | undefined): ClientOpcodes {
  const op: ClientOpcodes = {
    sendLoginInfo: 0, guildsList: 0, logServer: 0, approveWorld: 0, enterWorld: 0, postEnterWorld: 0,
    expansionInfo: 0, sendMaxCharacters: 0, sendMembership: 0, sendMembershipDetails: 0, sendCharInfo: 0,
  };
  const byName = new Map(Object.entries(PATCH_NAMES).map(([k, n]) => [n.toLowerCase(), k as keyof ClientOpcodes]));
  for (const part of (text || "").split(/[\s,;]+/)) {
    const m = /^(OP_\w+)=(0x[0-9a-f]{1,4})$/i.exec(part.trim());
    if (!m) continue;
    const key = byName.get(m[1].toLowerCase());
    if (key) op[key] = parseInt(m[2], 16);
  }
  return op;
}

/**
 * World-side opcodes of the EQL patch (utils/patches/patch_EQL.conf on the
 * eql branch; worlds log "Registered patch [EQL]"). OP_ApproveWorld is unused,
 * and OP_GuildsList isn't mapped by the world yet, so the probe doesn't wait
 * for either. CLIENT_PROBE_EQL_OPCODES overrides these if a build changes them.
 */
const EQL_WORLD_OPCODES = [
  "OP_SendLoginInfo=0x0437",
  "OP_LogServer=0x7601",
  "OP_EnterWorld=0x533d",
  "OP_PostEnterWorld=0x08e3",
  "OP_ExpansionInfo=0x3b27",
  "OP_SendMaxCharacters=0x6265",
  "OP_SendMembership=0x1785",
  "OP_SendMembershipDetails=0x684b",
  "OP_SendCharInfo=0x4a0d",
].join(",");

/** EverQuest Legends, probed with the world opcodes above. */
function eqlClient(opcodes: string | undefined): ClientDef {
  return {
    id: "eql",
    label: CLIENT_LABELS.eql,
    serverName: "EQL",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: parsePatchOpcodes(opcodes),
  };
}

export const CLIENTS: ClientDef[] = [
  {
    id: "titanium",
    label: CLIENT_LABELS.titanium,
    serverName: "Titanium",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x4dd0,
      guildsList: 0x6957,
      logServer: 0x0fa6,
      approveWorld: 0x3c25,
      enterWorld: 0x7cba,
      postEnterWorld: 0x52a4,
      expansionInfo: 0x04ec,
      sendMaxCharacters: 0,
      sendMembership: 0,
      sendMembershipDetails: 0,
      sendCharInfo: 0x4513,
    },
  },
  {
    id: "sof",
    label: CLIENT_LABELS.sof,
    serverName: "SoF",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x6c3c,
      guildsList: 0x04fb,
      logServer: 0x129a,
      approveWorld: 0x7fc0,
      enterWorld: 0x1340,
      postEnterWorld: 0x1aee,
      expansionInfo: 0x0a1b,
      sendMaxCharacters: 0,
      sendMembership: 0,
      sendMembershipDetails: 0,
      sendCharInfo: 0x6040,
    },
  },
  {
    id: "sod",
    label: CLIENT_LABELS.sod,
    serverName: "SoD",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x0ff4,
      guildsList: 0x5b0b,
      logServer: 0x4762,
      approveWorld: 0x701f,
      enterWorld: 0x1c20,
      postEnterWorld: 0x7c94,
      expansionInfo: 0x7519,
      sendMaxCharacters: 0,
      sendMembership: 0,
      sendMembershipDetails: 0,
      sendCharInfo: 0x0f14,
    },
  },
  {
    id: "uf",
    label: CLIENT_LABELS.uf,
    serverName: "UF",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x13da,
      guildsList: 0x5b0b,
      logServer: 0x6f79,
      approveWorld: 0x86c7,
      enterWorld: 0x51b9,
      postEnterWorld: 0x5d32,
      expansionInfo: 0x7e4d,
      sendMaxCharacters: 0,
      sendMembership: 0,
      sendMembershipDetails: 0,
      sendCharInfo: 0x4200,
    },
  },
  {
    id: "rof",
    label: CLIENT_LABELS.rof,
    serverName: "RoF",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x11b6,
      guildsList: 0x2d38,
      logServer: 0x19ab,
      approveWorld: 0x7e47,
      enterWorld: 0x57c3,
      postEnterWorld: 0x0c3d,
      expansionInfo: 0x711a,
      sendMaxCharacters: 0x5349,
      sendMembership: 0x03b2,
      sendMembershipDetails: 0x0b1f,
      sendCharInfo: 0x06a2,
    },
  },
  {
    id: "rof2",
    label: CLIENT_LABELS.rof2,
    serverName: "RoF2",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x7a09,
      guildsList: 0x507a,
      logServer: 0x7ceb,
      approveWorld: 0x7499,
      enterWorld: 0x578f,
      postEnterWorld: 0x6259,
      expansionInfo: 0x590d,
      sendMaxCharacters: 0x5475,
      sendMembership: 0x7acc,
      sendMembershipDetails: 0x057b,
      sendCharInfo: 0x00d2,
    },
  },
  {
    // The live client uses the same world protocol, so a ToB result also
    // stands for "live".
    id: "tob",
    label: CLIENT_LABELS.tob,
    serverName: "TOB",
    loginInfoSize: LOGIN_INFO_SIZE,
    opcodes: {
      sendLoginInfo: 0x722a,
      guildsList: 0,
      logServer: 0x2cae,
      approveWorld: 0,
      enterWorld: 0x7fb8,
      postEnterWorld: 0x1945,
      expansionInfo: 0x393a,
      sendMaxCharacters: 0x25eb,
      sendMembership: 0x5789,
      sendMembershipDetails: 0x2373,
      sendCharInfo: 0x5d1a,
    },
  },
  eqlClient(process.env.CLIENT_PROBE_EQL_OPCODES || EQL_WORLD_OPCODES),
];

export const CLIENT_IDS: ClientId[] = CLIENTS.map((c) => c.id);

/** False for a client whose world opcodes aren't known yet: the probe skips it. */
export function isProbeable(c: ClientDef): boolean {
  return c.opcodes.sendLoginInfo !== 0 && c.opcodes.sendCharInfo !== 0;
}

export function getClient(id: string): ClientDef | undefined {
  return CLIENTS.find((c) => c.id === id);
}

export function clientLabel(id: string): string {
  return getClient(id)?.label ?? id;
}

/**
 * The OP_SendLoginInfo payload. `key` is the session key the login server
 * handed the world (ServerOP_LSClientAuth). The world reads at most 18
 * characters of account id and 15 of key and compares the first 10 key
 * characters (ClientListEntry::CheckAuth).
 */
export function encodeLoginInfo(client: ClientDef, loginserverAccountId: number, key: string, zoning = false): Buffer {
  if (!Number.isInteger(loginserverAccountId) || loginserverAccountId <= 0) {
    throw new Error("loginserver account id must be a positive integer");
  }
  if (!/^[A-Za-z0-9]{1,14}$/.test(key)) {
    throw new Error("session key must be 1-14 alphanumeric characters");
  }
  const b = Buffer.alloc(client.loginInfoSize);
  const text = `${loginserverAccountId}\0${key}\0`;
  b.write(text, 0, "latin1");
  b[188] = zoning ? 1 : 0;
  return b;
}

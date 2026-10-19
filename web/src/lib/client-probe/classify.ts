/**
 * Turns what a probe session observed into a support status.
 *
 * What a world does with a login attempt (world/client.cpp,
 * common/eq_stream_ident.cpp):
 *  - no patch matches the first packet's opcode + size: the stream is
 *    released silently. The transport still acks our packet, but no app
 *    packet ever comes back                                 -> unsupported
 *  - identified, key accepted: guild list, log server, approve world, enter
 *    world, post enter world, then either expansion info + character list
 *    (supported) or, when World:SupportedClients excludes the client or
 *    World:CustomFilesKey does not match, a fake character list holding a
 *    message instead of expansion info                       -> supported / blocked
 *  - identified, key rejected: HandleSendLoginInfoPacket returns false and
 *    the world closes the session                            -> error
 *  - no session response at all                              -> unreachable
 */
import type { ClientDef } from "./clients";

export type ProbeStatus = "supported" | "blocked" | "unsupported" | "error" | "unreachable";

export interface ProbeObservation {
  sessionEstablished: boolean;
  loginAcked: boolean;
  /** App opcodes received, in order. */
  appOpcodes: number[];
  /** Payload of the first OP_SendCharInfo received, if any. */
  charInfoPayload?: Buffer | null;
  disconnectedByServer: boolean;
  /** Local failure (socket error, bad address, ...). */
  error?: string | null;
}

export interface ProbeClassification {
  status: ProbeStatus;
  detail: string;
}

const UNSUPPORTED_LIST_TEXT = "Client Not In Supported List";
const MISSING_FILES_TEXT = "Missing Files";

export function classifyProbe(client: ClientDef, obs: ProbeObservation): ProbeClassification {
  if (obs.error) return { status: "error", detail: obs.error };
  if (!obs.sessionEstablished) {
    return { status: "unreachable", detail: "no session response from the world's UDP port" };
  }

  const op = client.opcodes;
  const handshake = new Set(
    [
      op.guildsList,
      op.logServer,
      op.approveWorld,
      op.enterWorld,
      op.postEnterWorld,
      op.expansionInfo,
      op.sendMaxCharacters,
      op.sendMembership,
      op.sendMembershipDetails,
      op.sendCharInfo,
    ].filter((o) => o !== 0)
  );
  const got = (o: number) => o !== 0 && obs.appOpcodes.indexOf(o) !== -1;
  const sawHandshake = obs.appOpcodes.some((o) => handshake.has(o));

  if (got(op.sendCharInfo)) {
    const text = obs.charInfoPayload ? obs.charInfoPayload.toString("latin1") : "";
    if (text.indexOf(UNSUPPORTED_LIST_TEXT) !== -1) {
      return { status: "blocked", detail: "world rule World:SupportedClients does not include this client" };
    }
    if (text.indexOf(MISSING_FILES_TEXT) !== -1) {
      return { status: "blocked", detail: "world requires custom client files (World:CustomFilesKey)" };
    }
    if (!got(op.expansionInfo)) {
      return { status: "blocked", detail: "world sent a rejection entry instead of the character list" };
    }
    return { status: "supported", detail: "character select data received" };
  }

  if (got(op.expansionInfo)) {
    return { status: "supported", detail: "logged in; character list did not arrive before the timeout" };
  }
  if (sawHandshake) {
    return { status: "error", detail: "logged in but no character select data before the timeout" };
  }
  if (obs.appOpcodes.length > 0) {
    const list = obs.appOpcodes.slice(0, 5).map((o) => `0x${o.toString(16).padStart(4, "0")}`).join(", ");
    return { status: "error", detail: `unexpected reply opcodes ${list}` };
  }
  if (obs.disconnectedByServer) {
    return { status: "error", detail: "world closed the session after the login packet (session key not accepted)" };
  }
  if (obs.loginAcked) {
    return { status: "unsupported", detail: "world acknowledged the login packet but did not recognize the client" };
  }
  return { status: "error", detail: "login packet was never acknowledged" };
}

import Link from "next/link";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { getGuide } from "@/lib/guides";

const guide = getGuide("eq-clients");

export const metadata = guideMetadata(guide);

export default function EqClientsPage() {
  return (
    <GuidePage
      guide={guide}
      intro={
        <p>
          Every EQEmu world is built for one or more versions of the EQ client. Pick the world first, then use
          the client it asks for. If you&apos;re unsure, <strong>RoF2</strong> is the one most worlds use.
        </p>
      }
    >
      <h2>The short answer</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Who uses it</th>
            <th scope="col">Port</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>RoF2</strong> (also SoD, Underfoot, RoF)</td>
            <td>Most EQEmu worlds. The safe default.</td>
            <td><code>5999</code></td>
          </tr>
          <tr>
            <td><strong>Titanium</strong></td>
            <td>Some classic-era worlds.</td>
            <td><code>5998</code></td>
          </tr>
          <tr>
            <td><strong>The Outer Brood (ToB)</strong></td>
            <td>Worlds that have added ToB support.</td>
            <td><code>15900</code></td>
          </tr>
          <tr>
            <td><strong>Current client</strong></td>
            <td>A few worlds that ship their own patcher.</td>
            <td><code>15901</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        The port goes in <Link href="/guides/eqhost-txt">eqhost.txt</Link> after{" "}
        <code>login.eqemulator.dev:</code>. All four connect to the same login, so your account works no
        matter which client you use.
      </p>

      <h2>RoF2</h2>
      <p>
        Rain of Fear 2 is the most widely supported EQEmu client. It has the modern interface most players
        expect, and nearly every world accepts it. Older clients from the same family (Seeds of Destruction,
        Underfoot and Rain of Fear) use the same port.
      </p>

      <h2>Titanium</h2>
      <p>
        Titanium is the classic client from 2006. Some worlds that recreate the early game still use it.
        Only pick Titanium if your world asks for it.
      </p>

      <h2>The Outer Brood (ToB)</h2>
      <p>
        ToB is a much newer client, and support for it is growing. A ToB client sees every world in the
        list, but can only enter worlds that support it. If you pick a world that doesn&apos;t, the game
        stops at world entry. You can{" "}
        <Link href="/servers?client=tob">see which worlds support ToB</Link> in the server list.
      </p>

      <h2>The current client</h2>
      <p>
        A small number of worlds support the current EQ client. Those worlds provide their own patcher that
        sets everything up for you, including eqhost.txt. Follow the instructions on that world&apos;s site
        or Discord.
      </p>

      <h2>How do I know which client a world supports?</h2>
      <p>
        Every world in our <Link href="/servers">EQEmu server list</Link> shows the clients that have
        actually logged in successfully. We test each world with each client every few hours, so the badges
        reflect what works right now. You can also filter the list by client.
      </p>
      <p>
        When in doubt, ask in the world&apos;s Discord. Operators are almost always happy to help new
        players get set up, including where to get the right client.
      </p>
    </GuidePage>
  );
}

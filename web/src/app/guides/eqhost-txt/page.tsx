import Link from "next/link";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { getGuide } from "@/lib/guides";

const guide = getGuide("eqhost-txt");

export const metadata = guideMetadata(guide);

export default function EqhostTxtPage() {
  return (
    <GuidePage
      guide={guide}
      intro={
        <p>
          <code>eqhost.txt</code> is a tiny text file in your EQ folder that tells the game which login
          server to connect to. Changing it is the one setup step every EQEmu player does, and it takes
          about a minute.
        </p>
      }
    >
      <h2>Where is eqhost.txt?</h2>
      <p>
        It sits in your EQ game folder, next to <code>eqgame.exe</code>. If you&apos;re not sure where the
        game is installed, right-click your EQ shortcut and choose <strong>Open file location</strong>.
      </p>
      <p>
        Windows hides file extensions by default, so the file may show up as just <code>eqhost</code>. If
        there&apos;s no file at all, create one: right-click in the folder, choose{" "}
        <strong>New &gt; Text Document</strong>, and name it <code>eqhost.txt</code>.
      </p>

      <h2>What to put in it</h2>
      <p>Open the file in Notepad, delete everything in it, and paste this for RoF2 (most worlds):</p>
      <pre><code>{`[LoginServer]
Host=login.eqemulator.dev:5999`}</code></pre>
      <p>If your world uses a different client, only the number at the end changes:</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Host line</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>RoF2, SoD, Underfoot, RoF</td>
            <td><code>Host=login.eqemulator.dev:5999</code></td>
          </tr>
          <tr>
            <td>Titanium</td>
            <td><code>Host=login.eqemulator.dev:5998</code></td>
          </tr>
          <tr>
            <td>The Outer Brood (ToB)</td>
            <td><code>Host=login.eqemulator.dev:15900</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Save the file and start the game. Not sure which client you have? See{" "}
        <Link href="/guides/eq-clients">which EQ client you need</Link>.
      </p>

      <h2>Logging in</h2>
      <p>
        At the login screen, use your EQEmulator.dev login or the one you already have from the EQEmulator
        forums. No login yet? <Link href="/register">Make one here</Link>. After you log in you&apos;ll see the
        full list of worlds. Pick one and create your character.
      </p>

      <h2>Common problems</h2>
      <h3>The game still connects to the old server</h3>
      <p>
        Make sure you edited the eqhost.txt in the folder you actually launch the game from, and that the
        file isn&apos;t named <code>eqhost.txt.txt</code>. Some worlds use a launcher or patcher that rewrites
        eqhost.txt each time it runs. If yours does, follow that world&apos;s instructions instead.
      </p>
      <h3>I can&apos;t save the file</h3>
      <p>
        If the game is installed under <code>Program Files</code>, Windows may block the save. Open Notepad
        with <strong>Run as administrator</strong>, or copy the game to a folder like{" "}
        <code>C:\EQ</code> and play from there.
      </p>
      <h3>The login screen hangs or times out</h3>
      <p>
        Check that the port matches your client. A RoF2 client pointed at the Titanium port, or the other
        way round, will not connect. You can also check the <Link href="/status">login server status</Link>.
      </p>
      <h3>I see the world but can&apos;t get in</h3>
      <p>
        The world doesn&apos;t support your client. The <Link href="/servers">server list</Link> shows which
        clients each world accepts.
      </p>
    </GuidePage>
  );
}

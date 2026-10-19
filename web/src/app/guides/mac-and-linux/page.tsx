import Link from "next/link";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { getGuide } from "@/lib/guides";

const guide = getGuide("mac-and-linux");

export const metadata = guideMetadata(guide);

export default function MacAndLinuxPage() {
  return (
    <GuidePage
      guide={guide}
      intro={
        <p>
          The EQ client is a Windows program, but you don&apos;t need Windows to play on an EQEmu server.
          Wine-based tools run it well on Linux, the Steam Deck and Mac, and plenty of players do just that.
        </p>
      }
    >
      <h2>Linux</h2>
      <p>The easiest route is <strong>Lutris</strong>, which manages Wine for you:</p>
      <ol>
        <li>Install Lutris from your distribution&apos;s software store.</li>
        <li>
          Add a new game, choose <strong>Add locally installed game</strong>, set the runner to Wine, and
          point it at <code>eqgame.exe</code> in your EQ folder.
        </li>
        <li>
          Edit <Link href="/guides/eqhost-txt">eqhost.txt</Link> in that same folder, exactly as you would on
          Windows.
        </li>
        <li>Launch the game from Lutris and log in.</li>
      </ol>
      <p>
        Plain Wine works too: run <code>wine eqgame.exe patchme</code> from the EQ folder. If the game runs
        slowly or the screen is black, turn on DXVK in Lutris (or install it into your Wine prefix), which
        fixes most graphics problems.
      </p>

      <h2>Steam Deck</h2>
      <ol>
        <li>Switch to Desktop Mode and copy your EQ folder onto the Deck.</li>
        <li>
          In Steam, choose <strong>Add a Non-Steam Game</strong> and select <code>eqgame.exe</code>.
        </li>
        <li>
          In the game&apos;s properties, add <code>patchme</code> to the launch options and pick a Proton version
          under Compatibility.
        </li>
        <li>Edit eqhost.txt, then launch from Game Mode or Desktop Mode.</li>
      </ol>
      <p>
        EQ leans on keyboard and mouse, so a community controller layout or a small keyboard makes a big
        difference.
      </p>

      <h2>Mac</h2>
      <p>
        On a Mac, <strong>CrossOver</strong> is the most polished option and runs the EQ client on both Intel
        and Apple Silicon Macs. Create a new Windows bottle, copy your EQ folder into it, and run{" "}
        <code>eqgame.exe</code> with <code>patchme</code> as the argument. Free Wine builds also work if
        you&apos;re comfortable with a bit more setup.
      </p>
      <p>
        Your eqhost.txt lives in the EQ folder inside the bottle. Edit it the same way as on Windows.
      </p>

      <h2>Tips</h2>
      <ul>
        <li>
          Use the client your world asks for. Most worlds use RoF2, which runs well under Wine. See{" "}
          <Link href="/guides/eq-clients">which EQ client you need</Link>.
        </li>
        <li>Run the game in windowed mode first. Once it works, switch to full screen.</li>
        <li>
          Many worlds have players on Linux and Mac. Their Discord is the best place to ask for
          tested settings.
        </li>
      </ul>
    </GuidePage>
  );
}

import Link from "next/link";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { getGuide } from "@/lib/guides";

const guide = getGuide("choosing-a-server");

export const metadata = guideMetadata(guide);

export default function ChoosingAServerPage() {
  return (
    <GuidePage
      guide={guide}
      intro={
        <p>
          There&apos;s no single best EQEmu server, only the one that fits how you like to play. A few quick
          questions narrow it down fast.
        </p>
      }
    >
      <h2>1. Classic, progression or custom?</h2>
      <ul>
        <li>
          <strong>Classic</strong> worlds stay close to the original game. Pick one if you want the EQ you
          remember, slow corpse runs and all.
        </li>
        <li>
          <strong>Progression</strong> worlds start in the early eras and open new expansions over time, so
          everyone moves through the game together.
        </li>
        <li>
          <strong>Custom</strong> worlds add their own zones, items, classes or systems. Pick one if
          you&apos;ve seen classic EQ and want something new.
        </li>
      </ul>

      <h2>2. Alone, with friends, or in a big guild?</h2>
      <p>
        Many EQEmu worlds tune the game so a single player or a small group can go a long way. Some allow
        <strong> boxing</strong>, which means running several characters at once, and others limit you to one.
        A world&apos;s description or Discord will say which.
      </p>

      <h2>3. How many people are playing?</h2>
      <p>
        A busy world means groups, trading and raids. A quieter world can be relaxed and friendly, and
        often suits solo or boxed play. Every world in our <Link href="/servers">EQEmu server list</Link>{" "}
        shows players online right now, and each server page has population history so you can see when
        people play.
      </p>

      <h2>4. Which client do you have?</h2>
      <p>
        Most worlds use RoF2. Some use Titanium, and a growing number accept The Outer Brood (ToB). Filter
        the server list by client, or read{" "}
        <Link href="/guides/eq-clients">which EQ client you need</Link>.
      </p>

      <h2>5. Visit the community</h2>
      <p>
        Before you commit, open the world&apos;s website and Discord. A friendly, active Discord is one of
        the best signs of a world you&apos;ll enjoy. Read the rules too: boxing, multi-account and conduct
        rules differ a lot between worlds.
      </p>

      <h2>Try more than one</h2>
      <p>
        Your login works on every world in the list, so it&apos;s easy to try a few. Make a
        character on two or three, play an evening on each, and stay where it feels like home.
      </p>
      <p>
        <Link href="/servers">Browse the EQEmu server list</Link> or, if you haven&apos;t set up the game yet,
        start with the <Link href="/getting-started">Getting Started guide</Link>.
      </p>
    </GuidePage>
  );
}

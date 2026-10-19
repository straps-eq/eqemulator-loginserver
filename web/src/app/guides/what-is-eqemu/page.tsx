import Link from "next/link";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { getGuide } from "@/lib/guides";

const guide = getGuide("what-is-eqemu");

export const metadata = guideMetadata(guide);

export default function WhatIsEqemuPage() {
  return (
    <GuidePage
      guide={guide}
      intro={
        <p>
          <strong>EQEmu</strong>, short for <strong>EQ Emulator</strong>, is an open-source server for
          EQ, built by volunteers for over twenty years. Because anyone can run it, there are dozens of
          community-run EQEmu worlds today: classic, progression and fully custom, each with its own rules
          and its own crowd.
        </p>
      }
    >
      <h2>How EQEmu works</h2>
      <p>Playing on an EQEmu server takes three pieces:</p>
      <ol>
        <li>
          <strong>The game client</strong> on your computer. This is your own copy of EQ. EQEmu does not
          replace the game; it replaces the servers the game talks to.
        </li>
        <li>
          <strong>A login server.</strong> It checks your username and password and shows you the list of
          worlds. EQEmulator.dev runs one, and so do the EQEmulator forums.
        </li>
        <li>
          <strong>A world server.</strong> This is where you actually play. Each world is run by its own
          community, with its own rules, content and characters.
        </li>
      </ol>
      <p>
        One small text file, <Link href="/guides/eqhost-txt">eqhost.txt</Link>, tells your client which
        login server to use. Point it at <code>login.eqemulator.dev</code> and you will see every world in
        our <Link href="/servers">EQEmu server list</Link>.
      </p>

      <h2>Is it the same as the official EQ servers?</h2>
      <p>
        No. EQEmu worlds are separate, community-run servers. They are not run by Daybreak, and characters
        from the official servers don&apos;t carry over. Many worlds recreate an era of the game you
        remember; others add new zones, classes or rules you won&apos;t find anywhere else.
      </p>

      <h2>What kinds of EQEmu servers are there?</h2>
      <ul>
        <li><strong>Classic</strong> worlds stay close to the original game, often locked to an early era.</li>
        <li><strong>Progression</strong> worlds start early and unlock expansions over time.</li>
        <li><strong>Custom</strong> worlds add their own content, items and systems on top of EQ.</li>
        <li>
          <strong>Solo and group friendly</strong> worlds tune the game so you can play alone or with a
          few friends, and many allow boxing more than one character.
        </li>
      </ul>
      <p>
        Not sure which fits you? Our guide to{" "}
        <Link href="/guides/choosing-a-server">choosing an EQEmu server</Link> walks through it.
      </p>

      <h2>What do I need to play?</h2>
      <ol>
        <li>
          A copy of EQ installed, using the client your world supports. Most worlds use RoF2. See{" "}
          <Link href="/guides/eq-clients">which EQ client you need</Link>.
        </li>
        <li>
          A login. You can <Link href="/register">make one here</Link> in a minute, or use the one you
          already have from the EQEmulator forums.
        </li>
        <li>
          One line in <Link href="/guides/eqhost-txt">eqhost.txt</Link> so the game connects to our login
          server.
        </li>
      </ol>
      <p>
        That&apos;s it. The <Link href="/getting-started">Getting Started guide</Link> takes you through
        each step.
      </p>

      <h2>EQEmu, eqemulator.org and EQEmulator.dev</h2>
      <p>
        <strong>EQEmu</strong> is the open-source project itself. Its code lives on{" "}
        <a href="https://github.com/EQEmu" target="_blank" rel="noopener noreferrer">GitHub</a>, its
        documentation for server builders is at{" "}
        <a href="https://docs.eqemu.dev/" target="_blank" rel="noopener noreferrer">docs.eqemu.dev</a>, and
        its long-running forums are at{" "}
        <a href="https://www.eqemulator.org/" target="_blank" rel="noopener noreferrer">eqemulator.org</a>.
      </p>
      <p>
        <strong>EQEmulator.dev</strong> is a player hub for EQEmu worlds: a live server list with player
        counts and population history, plain-English guides, and a community login server that works with
        every client from Titanium to the current one. It is an independent community site, separate from eqemulator.org. Game logins from the EQEmulator forums work at the game&apos;s login screen; we never ask for your forum password on a web page.
      </p>

      <h2>Can I run my own EQEmu server?</h2>
      <p>
        Yes. That&apos;s how every world on the list started. The{" "}
        <a href="https://docs.eqemu.dev/" target="_blank" rel="noopener noreferrer">EQEmu docs</a> cover
        installing the server, and once your world is up, our{" "}
        <Link href="/server-operators">server operator guide</Link> shows how to list it here with one
        config line.
      </p>
    </GuidePage>
  );
}

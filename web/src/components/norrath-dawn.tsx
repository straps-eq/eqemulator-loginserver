/**
 * Hero backdrop: first morning in a fantasy world. A dawn sky over rolling
 * hills with a walled city on the ridge and lights still on in its windows.
 * Original vector art drawn for this site; no game assets.
 */
export function NorrathDawn() {
  const windows = [
    [688, 262], [702, 262], [741, 236], [741, 252], [783, 270], [812, 248], [826, 248], [870, 268], [904, 256],
  ];
  const stars = [
    [120, 40], [260, 90], [340, 28], [470, 70], [980, 48], [1090, 96], [1210, 36], [1330, 82], [610, 22], [860, 30],
  ];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1440 520"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b2350" />
          <stop offset="38%" stopColor="#3b3f7e" />
          <stop offset="62%" stopColor="#8e5f8f" />
          <stop offset="80%" stopColor="#e08a73" />
          <stop offset="100%" stopColor="#f7c46c" />
        </linearGradient>
        <radialGradient id="nd-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="35%" stopColor="#ffd77a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffb25a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="nd-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2140" stopOpacity="0" />
          <stop offset="100%" stopColor="#1a2140" stopOpacity="1" />
        </linearGradient>
      </defs>

      <rect width="1440" height="520" fill="url(#nd-sky)" />
      {stars.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="#fdf6e3" opacity="0.7" />
      ))}

      {/* Sun rising behind the ridge */}
      <circle cx="1150" cy="330" r="200" fill="url(#nd-sun)" />
      <circle cx="1150" cy="330" r="46" fill="#fff0bf" opacity="0.95" />

      {/* Distant mountains */}
      <path d="M0 330 L120 260 L210 300 L330 220 L430 290 L560 240 L650 300 L1000 300 L1080 230 L1180 290 L1300 210 L1440 280 L1440 520 L0 520 Z" fill="#6a5d8f" opacity="0.55" />

      {/* Far hills */}
      <path d="M0 360 C180 320 320 330 480 345 C640 360 760 300 960 315 C1140 330 1300 345 1440 330 L1440 520 L0 520 Z" fill="#4f6f7d" />

      {/* Walled city on the ridge, set to the right so the headline sits in open sky */}
      <g transform="translate(390 20)">
      <g fill="#2f4a5c">
        <rect x="660" y="270" width="270" height="50" />
        <rect x="676" y="250" width="40" height="70" />
        <polygon points="672,250 696,222 720,250" />
        <rect x="730" y="226" width="24" height="94" />
        <polygon points="726,226 742,196 758,226" />
        <rect x="770" y="258" width="30" height="62" />
        <rect x="800" y="236" width="40" height="84" />
        <polygon points="796,236 820,206 844,236" />
        <rect x="856" y="256" width="28" height="64" />
        <rect x="892" y="244" width="26" height="76" />
        <polygon points="888,244 905,218 922,244" />
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x={662 + i * 21} y="262" width="11" height="9" />
        ))}
      </g>
      {windows.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="1" fill="#ffd27a" opacity="0.9" />
      ))}
      </g>

      {/* Mid hills */}
      <path d="M0 400 C160 370 300 350 470 372 C620 392 720 340 900 352 C1080 364 1250 392 1440 370 L1440 520 L0 520 Z" fill="#3a5f5a" />

      {/* Near hills with a road winding to the gate */}
      <path d="M0 448 C200 420 380 410 560 430 C720 448 880 410 1060 420 C1220 430 1340 450 1440 440 L1440 520 L0 520 Z" fill="#284544" />
      <path d="M1100 520 C1110 480 1140 460 1170 448 C1180 444 1186 440 1180 432" stroke="#e8c88a" strokeOpacity="0.35" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* Birds */}
      <path d="M1040 150 q8 -8 16 0 q8 -8 16 0" stroke="#2a2f55" strokeWidth="2" fill="none" />
      <path d="M1090 128 q6 -6 12 0 q6 -6 12 0" stroke="#2a2f55" strokeWidth="2" fill="none" />

      <rect y="420" width="1440" height="100" fill="url(#nd-fade)" />
    </svg>
  );
}

/**
 * Client ids and display labels, safe to import from client components
 * (no Node.js dependencies).
 */
export type ClientId = "titanium" | "sof" | "sod" | "uf" | "rof" | "rof2" | "tob";

/** Release order, used for badge order. */
export const CLIENT_ORDER: ClientId[] = ["titanium", "sof", "sod", "uf", "rof", "rof2", "tob"];

export const CLIENT_LABELS: Record<ClientId, string> = {
  titanium: "Titanium",
  sof: "SoF",
  sod: "SoD",
  uf: "UF",
  rof: "RoF",
  rof2: "RoF2",
  tob: "ToB",
};

/** Longer names for tooltips. */
export const CLIENT_TITLES: Record<ClientId, string> = {
  titanium: "Titanium",
  sof: "Secrets of Faydwer",
  sod: "Seeds of Destruction",
  uf: "Underfoot",
  rof: "Rain of Fear",
  rof2: "Rain of Fear 2",
  tob: "The Outer Brood (also the current live client)",
};

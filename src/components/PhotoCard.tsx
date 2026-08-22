// "Moment" photos Meera shares. Primary source: her 89-photo tagged library
// (public/moments/<tag>.jpg) — the model picks the exact tag, so the photo
// always matches the story.
//
// Fallback: a photo seed CAN still arrive without a catalog tag — brain.ts's
// `[photo: ...]` / `[shared a photo: ...]` markers store whatever free text
// the model wrote as the seed verbatim (see src/engine/brain.ts ~L361-370,
// ~L464-470), and old saved messages predate the tag catalog entirely.
// tagFromSeed() returns null for those, so this file regex-matches the seed
// against scene keywords the way it always did (audit finding #6, checked:
// grep for every out.photo assignment in brain.ts — none guarantee a tag).
// The images themselves used to be 13 statically-imported 900x900 JPEGs
// (~1.5 MB, always in the bundle, almost never fetched). They're gone: every
// fallback keyword now maps onto the closest-fitting tag in the SAME
// public/moments/ library the primary path already serves, so this is a
// runtime string built the same way tagFromSeed's hits are, not an import.
import { Capacitor } from "@capacitor/core";
import { tagFromSeed } from "../engine/photoCatalog";

interface Props {
  seed: string;
}

const MOMENTS_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
const momentUrl = (tag: string) => `${MOMENTS_BASE}/moments/${tag}.jpg`;

const SELFIE_TAGS = ["selfie_mirror_black", "selfie_car", "selfie_pink_kurta"];

// Photos with her in them come first — a person shares moments of herself,
// not stock scenery, so these win whenever the caption fits.
const SCENES: Array<{ match: RegExp; tag: string }> = [
  { match: /(beach|samundar|sea|goa|waves|lehr|coconut|nariyal)/i, tag: "selfie_beach_sunset" },
  { match: /(book|reading|padh|novel|kitab|john green|library)/i, tag: "selfie_bed_reading" },
  { match: /(sketch|draw|paint|art|doodle|journal|diary)/i, tag: "painting_easel" },
  { match: /(walk|ghum|sair|stroll|white dress|garden|palm)/i, tag: "street_totebag" },
  { match: /(sunset|sky|evening|shaam|badal|cloud|dusk)/i, tag: "pov_sunset_street" },
  { match: /(chai|coffee|tea|cup|cozy|maggi|khana|food|nashta|breakfast|cafe)/i, tag: "pov_book_chai_bed" },
  { match: /(night|raat|moon|chand|star|taare|sitare)/i, tag: "selfie_night_fairylights" },
  { match: /(rain|baarish|monsoon|window|khidki)/i, tag: "train_window_moody" },
  { match: /(diya|diwali|candle|puja)/i, tag: "pov_desk_candle" },
  { match: /(light|fairy|lamp|glow)/i, tag: "pov_lamp_night" },
];

const ALL_TAGS = [
  "street_totebag",
  "selfie_beach_sunset",
  "selfie_bed_reading",
  "painting_easel",
  "pov_sunset_street",
  "pov_book_chai_bed",
  "selfie_night_fairylights",
  "train_window_moody",
  "pov_lamp_night",
  "pov_desk_candle",
];

function imageFor(seed: string): string {
  // exact catalog tag from the model — the intended path
  const tag = tagFromSeed(seed);
  if (tag) return momentUrl(tag);
  if (/(selfie|meri photo|mera face|mirror|apni pic|my face)/i.test(seed)) {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return momentUrl(SELFIE_TAGS[h % SELFIE_TAGS.length]);
  }
  for (const s of SCENES) if (s.match.test(seed)) return momentUrl(s.tag);
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return momentUrl(ALL_TAGS[h % ALL_TAGS.length]);
}

export default function PhotoCard({ seed }: Props) {
  return <img src={imageFor(seed)} alt="" loading="lazy" draggable={false} />;
}

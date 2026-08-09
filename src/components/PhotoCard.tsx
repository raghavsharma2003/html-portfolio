// "Moment" photos Meera shares — real photographs bundled with the app
// (CC-licensed; see docs/PHOTO-CREDITS.md). Scene is chosen from the seed
// text so her caption always matches what's in the frame. Swap for live
// image generation later without touching the chat code.

import sunsetImg from "../assets/moments/sunset.jpg";
import selfie1 from "../assets/moments/selfie1.jpg";
import selfie2 from "../assets/moments/selfie2.jpg";
import selfie3 from "../assets/moments/selfie3.jpg";
import chaiImg from "../assets/moments/chai.jpg";
import nightImg from "../assets/moments/night.jpg";
import rainImg from "../assets/moments/rain.jpg";
import lightsImg from "../assets/moments/lights.jpg";
import diyaImg from "../assets/moments/diya.jpg";
import meeraWalk from "../assets/moments/meera-walk.jpg";
import meeraBeach from "../assets/moments/meera-beach.jpg";
import meeraReading from "../assets/moments/meera-reading.jpg";
import meeraSketch from "../assets/moments/meera-sketch.jpg";

interface Props {
  seed: string;
}

const SELFIES = [selfie1, selfie2, selfie3];

// Photos with her in them come first — a person shares moments of herself,
// not stock scenery, so these win whenever the caption fits.
const SCENES: Array<{ match: RegExp; img: string }> = [
  { match: /(beach|samundar|sea|goa|waves|lehr|coconut|nariyal)/i, img: meeraBeach },
  { match: /(book|reading|padh|novel|kitab|john green|library)/i, img: meeraReading },
  { match: /(sketch|draw|paint|art|doodle|journal|diary)/i, img: meeraSketch },
  { match: /(walk|ghum|sair|stroll|white dress|garden|palm)/i, img: meeraWalk },
  { match: /(sunset|sky|evening|shaam|badal|cloud|dusk)/i, img: sunsetImg },
  { match: /(chai|coffee|tea|cup|cozy|maggi|khana|food|nashta|breakfast|cafe)/i, img: chaiImg },
  { match: /(night|raat|moon|chand|star|taare|sitare)/i, img: nightImg },
  { match: /(rain|baarish|monsoon|window|khidki)/i, img: rainImg },
  { match: /(diya|diwali|candle|puja)/i, img: diyaImg },
  { match: /(light|fairy|lamp|glow)/i, img: lightsImg },
];

const ALL = [meeraWalk, meeraBeach, meeraReading, meeraSketch, sunsetImg, chaiImg, nightImg, rainImg, lightsImg, diyaImg];

function imageFor(seed: string): string {
  if (/(selfie|meri photo|mera face|mirror|apni pic|my face)/i.test(seed)) {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return SELFIES[h % SELFIES.length];
  }
  for (const s of SCENES) if (s.match.test(seed)) return s.img;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ALL[h % ALL.length];
}

export default function PhotoCard({ seed }: Props) {
  return <img src={imageFor(seed)} alt="" loading="lazy" draggable={false} />;
}

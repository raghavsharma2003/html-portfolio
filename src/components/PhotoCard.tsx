// "Moment" photos Meera shares — real photographs bundled with the app
// (CC-licensed; see docs/PHOTO-CREDITS.md). Scene is chosen from the seed
// text so her caption always matches what's in the frame. Swap for live
// image generation later without touching the chat code.

import sunsetImg from "../assets/moments/sunset.jpg";
import chaiImg from "../assets/moments/chai.jpg";
import nightImg from "../assets/moments/night.jpg";
import rainImg from "../assets/moments/rain.jpg";
import lightsImg from "../assets/moments/lights.jpg";
import diyaImg from "../assets/moments/diya.jpg";

interface Props {
  seed: string;
}

const SCENES: Array<{ match: RegExp; img: string }> = [
  { match: /(sunset|sky|evening|shaam|badal|cloud|dusk)/i, img: sunsetImg },
  { match: /(chai|coffee|tea|cup|cozy|maggi|khana|food|nashta|breakfast|cafe)/i, img: chaiImg },
  { match: /(night|raat|moon|chand|star|taare|sitare)/i, img: nightImg },
  { match: /(rain|baarish|monsoon|window|khidki)/i, img: rainImg },
  { match: /(diya|diwali|candle|puja)/i, img: diyaImg },
  { match: /(light|fairy|lamp|glow)/i, img: lightsImg },
];

const ALL = [sunsetImg, chaiImg, nightImg, rainImg, lightsImg, diyaImg];

function imageFor(seed: string): string {
  for (const s of SCENES) if (s.match.test(seed)) return s.img;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ALL[h % ALL.length];
}

export default function PhotoCard({ seed }: Props) {
  return <img src={imageFor(seed)} alt="" loading="lazy" draggable={false} />;
}

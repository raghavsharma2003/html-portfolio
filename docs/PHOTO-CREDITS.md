# Photo credits

"Moment" photos Meera shares in chat are CC-licensed photographs via Openverse/Flickr:

| File | License | Source |
| --- | --- | --- |
| sunset.jpg | CC BY (skyseeker) | https://live.staticflickr.com/7613/16832764371_e778d848dd_b.jpg |
| chai.jpg | CC BY-SA | https://live.staticflickr.com/2275/2311645075_7354acd5c6_b.jpg |
| night.jpg | CC BY (mypubliclands) | https://live.staticflickr.com/7376/16358792937_4d68693e8d_b.jpg |
| rain.jpg | CC BY (mripp) | https://live.staticflickr.com/3907/14455303790_68d5f0cfcd_b.jpg |
| lights.jpg | CC BY (joncutrer) | https://live.staticflickr.com/1963/44084093015_08f935976d_b.jpg |
| diya.jpg | CC BY | https://live.staticflickr.com/3182/3099958017_92a7164e87_b.jpg |

The avatar is an AI-generated face (StyleGAN, thispersondoesnotexist) — not a real person.

## Chess piece art

The chess set is **cburnett** — the lichess default — by **Colin M.L. Burnett**.
It is not a photo, but it is the one other third-party visual asset in the app
and its licence carries an attribution obligation, so it lives here too.

| Asset | Author | License | Source |
| --- | --- | --- | --- |
| the 12 piece glyphs, inlined in `src/components/chess/pieces.tsx` | Colin M.L. Burnett | CC BY-SA 3.0 (also GPLv2+; used here under CC BY-SA 3.0) | https://github.com/lichess-org/lila/tree/master/public/piece/cburnett — originally https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces |

Modifications, as CC BY-SA requires be stated:

- transcribed from twelve standalone SVG files into one React component over a
  shared 45x45 viewBox; the path data itself is unchanged
- **recoloured via CSS custom properties** — upstream's hardcoded `#fff` / `#000`
  fills, `#000` strokes and `#ececec` detail strokes now resolve from the
  `--cb-*` token block in `src/styles/chess.css`, so the set re-inks itself for
  the paper board, the app's dark theme and the live-call ground
- the black queen's five jewels, drawn `stroke="none"` upstream, are given the
  same rim as every other part (they would otherwise be holes in the crown on
  the night board, where the black rim token goes light)
- the king's cross gains a halo stroke in the piece's own fill colour, for the
  same reason
- a soft contact shadow is drawn under each piece; that layer is this repo's,
  not Burnett's

CC BY-SA 3.0 is share-alike, and this is what that means in practice here: the
art and any modified art stays under CC BY-SA 3.0 and stays credited. It does
not reach the rest of the app — the licence covers the work, and inlining a
drawing into a source file does not relicense the file's own code.

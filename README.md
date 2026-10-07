# Wanderlit
Light up the world you've travelled. Static site — no build step needed to play.

Run locally: `python3 -m http.server 8000` in this folder, open http://localhost:8000
Deploy: drop the folder on Netlify / Vercel / GitHub Pages / Cloudflare Pages.

Rules (see top of game.js): city +10, country +100 (all cities if ≤3, else 60% capped at 5), continent +1000 (75% of its countries).
Cities live in build/cities.txt; run `cd build && npm i && node build.js` to regenerate data/.
Share links encode progress in the URL hash (`#s=...`), so no backend is required.

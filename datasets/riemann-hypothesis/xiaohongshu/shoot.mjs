// Screenshot each card of cards.html to a 1080 x 1440 PNG with headless Chromium.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = [
  'cover',
  'what',
  'timeline-1',
  'timeline-2',
  'timeline-3',
  'proportion',
  '2026',
  'people',
  'end',
];
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1080, height: 1440 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(path.join(here, 'cards.html')).href);
await page.evaluate(() => document.fonts.ready);
const cards = await page.$$('section.card');
for (const [i, card] of cards.entries()) {
  const file = path.join(here, `${String(i + 1).padStart(2, '0')}-${names[i]}.png`);
  await card.screenshot({ path: file });
  console.log(file);
}
await browser.close();

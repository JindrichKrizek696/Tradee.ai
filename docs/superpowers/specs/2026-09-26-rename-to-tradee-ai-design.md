# Přejmenování Northstar na Tradee.ai

Datum: 26. 9. 2026

## Cíl
Aplikace se místo "Northstar" jmenuje "Tradee.ai". Přejmenování jde až do kódu, aby název byl konzistentní ve viditelném textu, souborech i CSS.

## Rozhodnutí
- Zápis: `TRADEE.AI` v hlavičce a patičce (verzálky jako dosud), `Tradee.ai` v titulku a textech.
- Soubor `app/northstar.tsx` se přejmenuje na `app/tradee.tsx`, komponenta `Northstar` na `Tradee`, CSS třída `.northstar` na `.tradee`.
- Favicon zůstává modrý čtverec, písmeno N nahradí bílé T.
- `FUNDAMENTALS.md` a `README.md` jen aktualizují název a cestu, smysl instrukcí se nemění.
- User-Agent v `scripts/refresh-expanded-data.py` se změní na `Mozilla/5.0 Tradee.ai Research`.
- Název balíčku v `package.json` a data v `data/` se nemění.

## Ověření
- `npx tsc --noEmit` projde.
- `grep -ri northstar` mimo `node_modules`, `.wrangler` a `.git` nic nenajde.
- Dev server zobrazí nový název v hlavičce, patičce a titulku okna.

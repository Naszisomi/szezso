# szezso

Saját chart- és indikátoroldal tabletre (böngészőben fut, szerver nélkül).

- Adat: OKX nyilvános piaci adatok (REST + WebSocket), API-kulcs nélkül.
- Chart: [Lightweight Charts™](https://github.com/tradingview/lightweight-charts) (© TradingView, Apache 2.0).
- Az indikátorok a TradingView-on futó szezsoT / milána Pine Script kódok átiratai.

## Állapot

1. lépés – kapcsolatteszt: `teszt/index.html` (kész)
2. lépés – alap chart: `index.html` (élő HYPE + BTC/ETH, idősíkok, magyar idő, számlafülek)
3. lépés – rajzoló réteg: `js/draw.js` (doboz, vonal, felirat, tört vonal nyíllal)
4. lépés – indikátorok: `js/ind/` – kész: Milana (True Opens + első FVG)

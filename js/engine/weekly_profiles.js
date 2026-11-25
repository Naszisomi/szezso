// Heti ICT-profilok (a kapott ábra alapján). Minden nap: [nyitó, záró, max, min] a heti tartomány
// 1–100 skáláján (100 = a hét csúcsa, 1 = a hét alja). H–P (New York-i kereskedési napok).
// A 6. szakaszban (narratíva) a motor ehhez méri a futó hetet; a napi profil ebből kap irányt.
// Megjegyzés: az ábrán három pár alakra azonos – ezeket a környezet (tartomány mérete, hírek) választja szét.
export const WEEKLY_PROFILES = [
  { id: "TUE_LOW",   name: "Classic Tuesday Low of the Week",        dir: 1,  days: [[60,30,70,20],[40,10,50,1],[30,70,80,20],[50,90,100,40],[70,40,80,30]] },
  { id: "TUE_HIGH",  name: "Classic Tuesday High of the Week",       dir: -1, days: [[40,70,80,30],[60,90,100,50],[70,30,80,20],[50,10,60,1],[30,60,70,20]] },
  { id: "WED_LOW",   name: "Wednesday Low of the Week",              dir: 1,  days: [[30,60,70,20],[50,80,90,40],[50,10,60,1],[30,60,70,20],[50,90,100,40]], same: "WWR_BULL" },
  { id: "WED_HIGH",  name: "Wednesday High of the Week",             dir: -1, days: [[70,40,80,30],[50,20,60,10],[50,90,100,40],[70,40,80,30],[50,10,60,1]], same: "WWR_BEAR" },
  { id: "CTR_BULL",  name: "Consolidation Thursday Reversal Bullish", dir: 1, days: [[70,40,80,30],[50,20,60,10],[50,80,90,40],[50,10,60,1],[50,90,100,40]], same: "SD_BULL" },
  { id: "CTR_BEAR",  name: "Consolidation Thursday Reversal Bearish", dir: -1, days: [[30,60,70,20],[50,80,90,40],[50,20,60,10],[50,90,100,40],[50,10,60,1]], same: "SD_BEAR" },
  { id: "CMR_BULL",  name: "Consolidation Midweek Rally Bullish",    dir: 1,  days: [[10,50,60,1],[30,60,70,20],[50,20,60,10],[30,70,80,20],[50,90,100,40]] },
  { id: "CMR_BEAR",  name: "Consolidation Midweek Rally Bearish",    dir: -1, days: [[90,50,100,40],[70,40,80,30],[50,80,90,40],[70,30,80,20],[50,10,60,1]] },
  { id: "WWR_BULL",  name: "Wednesday Weekly Reversal Bullish",      dir: 1,  days: [[30,60,70,20],[50,80,90,40],[50,10,60,1],[30,60,70,20],[50,90,100,40]], same: "WED_LOW" },
  { id: "WWR_BEAR",  name: "Wednesday Weekly Reversal Bearish",      dir: -1, days: [[70,40,80,30],[50,20,60,10],[50,90,100,40],[70,40,80,30],[50,10,60,1]], same: "WED_HIGH" },
  { id: "SD_BULL",   name: "Seek & Destroy Bullish Friday",          dir: 1,  days: [[70,40,80,30],[50,20,60,10],[50,80,90,40],[50,10,60,1],[50,90,100,40]], same: "CTR_BULL" },
  { id: "SD_BEAR",   name: "Seek & Destroy Bearish Friday",          dir: -1, days: [[30,60,70,20],[50,80,90,40],[50,20,60,10],[50,90,100,40],[50,10,60,1]], same: "CTR_BEAR" },
];

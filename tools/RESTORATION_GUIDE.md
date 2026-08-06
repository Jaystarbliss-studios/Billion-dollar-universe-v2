#!/usr/bin/env node

/**
 * CITIES RESTORATION GUIDE
 * 
 * Step-by-step instructions for restoring your cities collection
 */

console.log(`
╔═══════════════════════════════════════════════════════════════════════════┐
║                   CITIES COLLECTION RESTORATION GUIDE                     ║
╚═══════════════════════════════════════════════════════════════════════════┘

Your cities collection was successfully recreated! ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 TO REGENERATE YOUR CITIES:

Run each of these commands in a terminal from the project root:

  1️⃣  Lagos, Nigeria:
      node tools/generateCityData.js --city="Lagos" --country="Nigeria" --basePrice=1000

  2️⃣  New York, USA:
      node tools/generateCityData.js --city="New York" --country="USA" --basePrice=5000

  3️⃣  London, United Kingdom:
      node tools/generateCityData.js --city="London" --country="United Kingdom" --basePrice=4500

  4️⃣  Tokyo, Japan:
      node tools/generateCityData.js --city="Tokyo" --country="Japan" --basePrice=6000

  5️⃣  Dubai, United Arab Emirates:
      node tools/generateCityData.js --city="Dubai" --country="United Arab Emirates" --basePrice=5500

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️  BEFORE RUNNING:

Make sure GOOGLE_APPLICATION_CREDENTIALS is set:
  \$env:GOOGLE_APPLICATION_CREDENTIALS = "serviceAccountKey.json"

Each city takes 2-5 minutes to process depending on city size.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ CUSTOM CITIES:

You can also generate custom cities using any city name and country:

  node tools/generateCityData.js --city="Paris" --country="France" --basePrice=4200
  node tools/generateCityData.js --city="Singapore" --country="Singapore" --basePrice=5800

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 VERIFY RESTORATION:

After running the above commands, verify your cities:
  node tools/check-cities.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

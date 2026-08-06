#!/usr/bin/env node

/**
 * BULK CITY RESTORATION
 * 
 * Automatically regenerates multiple cities to your Firestore database.
 * Runs generateCityData.js for each city in sequence.
 */

const { spawn } = require('child_process');
const path = require('path');

// Define cities to restore
const CITIES_TO_RESTORE = [
  { city: 'Lagos', country: 'Nigeria', basePrice: 1000 },
  { city: 'New York', country: 'USA', basePrice: 5000 },
  { city: 'London', country: 'United Kingdom', basePrice: 4500 },
];

function runScript(city, country, basePrice) {
  return new Promise((resolve, reject) => {
    console.log(`\n🏙️  Starting: ${city}, ${country} (basePrice: ${basePrice})`);
    console.log('─'.repeat(60));

    const scriptPath = path.join(__dirname, 'generateCityData.js');
    const args = [
      scriptPath,
      `--city="${city}"`,
      `--country="${country}"`,
      `--basePrice=${basePrice}`
    ];

    const process = spawn('node', args, {
      stdio: 'inherit',
      shell: true,
      cwd: __dirname
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${city} completed successfully\n`);
        resolve();
      } else {
        console.error(`❌ ${city} failed with exit code ${code}\n`);
        reject(new Error(`Script failed for ${city}`));
      }
    });

    process.on('error', (err) => {
      console.error(`❌ Error running script for ${city}:`, err.message);
      reject(err);
    });
  });
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       BULK CITY RESTORATION — AUTO REGENERATION               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\nRestoring ${CITIES_TO_RESTORE.length} cities...\n`);

  let successful = 0;
  let failed = 0;

  for (const cityConfig of CITIES_TO_RESTORE) {
    try {
      await runScript(cityConfig.city, cityConfig.country, cityConfig.basePrice);
      successful++;
    } catch (err) {
      console.error(`⚠️  Failed to restore ${cityConfig.city}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESTORATION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📍 Total: ${successful + failed}\n`);

  if (failed === 0) {
    console.log('🎉 All cities restored successfully!');
    console.log('Your cities collection is now populated.\n');
  } else {
    console.log('⚠️  Some cities failed. Check the output above for details.\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

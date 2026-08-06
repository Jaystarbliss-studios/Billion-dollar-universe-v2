#!/usr/bin/env node

/**
 * RESTORE CITIES — Recovery script for deleted cities collection
 * 
 * This script regenerates cities in Firebase Firestore.
 * Cities can be defined as a list or generated interactively.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const readline = require('readline');

// Initialize Firebase Admin
let db;
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'billion-dollar-universe'
  });
  db = admin.firestore();
  console.log('✓ Firebase Admin initialized\n');
} catch (err) {
  console.error('ERROR: Failed to initialize Firebase Admin.');
  console.error('Ensure GOOGLE_APPLICATION_CREDENTIALS is set to a valid service account key.');
  process.exit(1);
}

// Default cities to restore
const PRESET_CITIES = [
  { city: 'Lagos', country: 'Nigeria', basePrice: 1000 },
  { city: 'New York', country: 'USA', basePrice: 5000 },
  { city: 'London', country: 'United Kingdom', basePrice: 4500 },
  { city: 'Tokyo', country: 'Japan', basePrice: 6000 },
  { city: 'Dubai', country: 'United Arab Emirates', basePrice: 5500 }
];

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║         CITIES COLLECTION — RECOVERY TOOL                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('Choose restore option:');
  console.log('1. Restore preset cities (recommended)');
  console.log('2. Restore a single custom city');
  console.log('3. Check current cities collection status\n');

  const choice = await question('Enter choice (1-3): ');

  if (choice === '1') {
    console.log('\n📦 Restoring preset cities...\n');
    for (const cityConfig of PRESET_CITIES) {
      await generateCity(cityConfig.city, cityConfig.country, cityConfig.basePrice);
    }
    console.log('\n✅ All preset cities restored!');
  } else if (choice === '2') {
    const city = await question('\nEnter city name: ');
    const country = await question('Enter country name: ');
    const basePrice = await question('Enter base price (default 1000): ') || '1000';
    
    await generateCity(city, country, parseInt(basePrice));
    console.log('\n✅ City restored!');
  } else if (choice === '3') {
    await checkCitiesStatus();
  }

  rl.close();
  process.exit(0);
}

async function generateCity(city, country, basePrice) {
  console.log(`\n🏙️  Generating ${city}, ${country}...`);
  console.log(`   Run this command in another terminal:`);
  console.log(`   node tools/generateCityData.js --city="${city}" --country="${country}" --basePrice=${basePrice}\n`);
}

async function checkCitiesStatus() {
  console.log('\n📊 Checking cities collection status...\n');
  
  try {
    const citiesSnapshot = await db.collection('cities').get();
    
    if (citiesSnapshot.empty) {
      console.log('⚠️  Cities collection is EMPTY');
      console.log('\nTo restore, run:');
      console.log('  node tools/generateCityData.js --city="Lagos" --country="Nigeria" --basePrice=1000\n');
    } else {
      console.log(`✅ Found ${citiesSnapshot.size} cities:\n`);
      
      for (const doc of citiesSnapshot.docs) {
        const data = doc.data();
        const parcelCount = await db.collection(`cities/${doc.id}/parcels`).count().get();
        
        console.log(`  • ${data.name}, ${data.country}`);
        console.log(`    Status: ${data.status}`);
        console.log(`    Parcels: ${parcelCount.data().count}`);
        console.log(`    Created: ${data.createdAt?.toDate().toLocaleDateString()}\n`);
      }
    }
  } catch (err) {
    console.error('ERROR checking collection:', err.message);
  }
}

// Run main if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { PRESET_CITIES };

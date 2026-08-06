#!/usr/bin/env node

/**
 * Check Cities Collection Status
 */

const admin = require('firebase-admin');

async function checkStatus() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'billion-dollar-universe'
    });

    const db = admin.firestore();
    const citiesSnapshot = await db.collection('cities').get();

    if (citiesSnapshot.empty) {
      console.log('❌ Cities collection is EMPTY - needs restoration\n');
      console.log('To restore, run commands like:');
      console.log('  node tools/generateCityData.js --city="Lagos" --country="Nigeria" --basePrice=1000');
      console.log('  node tools/generateCityData.js --city="New York" --country="USA" --basePrice=5000');
    } else {
      console.log(`✅ Cities collection contains ${citiesSnapshot.size} cities:\n`);
      
      for (const doc of citiesSnapshot.docs) {
        const data = doc.data();
        console.log(`  • ${data.name}, ${data.country} (ID: ${doc.id})`);
        console.log(`    Status: ${data.status}`);
        console.log(`    Parcels: ${data.parcelCount || 'N/A'}`);
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

checkStatus();

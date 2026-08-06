#!/usr/bin/env node

/**
 * City Worlds — City Pre-Generation Script
 *
 * This script generates parcel data for a real city using OpenStreetMap data.
 * It performs the following steps:
 *
 * 1. Fetch city boundary polygon from Nominatim API (OSM geocoding)
 * 2. Query Overpass API for land use data within the city boundary
 * 3. Build exclusion mask: roads, water bodies, parks, forests, etc.
 * 4. Compute a uniform grid overlay on buildable land
 * 5. Assign each grid cell to a district/neighbourhood from OSM
 * 6. Calculate prices based on district multipliers and zone types
 * 7. Write all parcels and city metadata to Firestore
 *
 * USAGE:
 *   node tools/generateCityData.js --city="Lagos" --country="Nigeria" --basePrice=1000
 *
 * REQUIRED ENV VARS:
 *   GOOGLE_APPLICATION_CREDENTIALS - path to Firebase service account key
 *
 * OPTIONAL FLAGS:
 *   --gridSize=50           Grid cell size in meters (default: 50)
 *   --maxParcels=2000       Cap total parcels (default: unlimited)
 *   --districtCBD=3.5       Multiplier for central business district (default: 3.5)
 *   --districtMid=1.8       Multiplier for mid zones (default: 1.8)
 *   --districtOuter=1.0     Multiplier for outer zones (default: 1.0)
 *
 * OUTPUT:
 *   Creates a new city document in Firestore with status "PRE-GENERATED"
 *   and populates cities/{cityId}/parcels with all generated parcels.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Configuration
const CONFIG = {
  // MapLibre tile server (optional — just for reference)
  tileServer: 'https://tile.openfreemap.org/{z}/{x}/{y}.png',

  // OSM APIs
  nominatimBase: 'https://nominatim.openstreetmap.org',
  overpassBase: 'https://overpass-api.de/api/interpreter',

  // Grid settings
  defaultGridSize: 50,        // meters
  maxParcels: 5000,           // raised cap per city for better coverage

  // Pricing defaults
  basePrice: 1000,
  districtMultipliers: {
    cbd: 3.5,
    mid: 1.8,
    outer: 1.0
  },

  // Zone type multipliers (commercial costs more than residential)
  zoneMultipliers: {
    commercial: 1.5,
    mixed: 1.2,
    residential: 1.0,
    industrial: 0.8
  },

  // Excluded land use types (non-purchasable)
  excludedLandUses: [
    'road', 'highway', 'path', 'pedestrian', 'railway',
    'water', 'river', 'lake', 'reservoir', 'basin',
    'park', 'garden', 'forest', 'wood', 'grass', 'farmland',
    'cemetery', 'military', 'airport', 'runway', 'industrial_park' // industrial zones may be purchasable? adjust per design
  ],

  // Resonable OSM landuse tags that ARE purchasable
  purchasableLandUses: [
    'residential', 'commercial', 'mixed', 'retail', 'industrial', 'shed'
  ]
};

// Parse command-line arguments
const args = process.argv.slice(2);
const params = {};

args.forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    params[key] = isNaN(value) ? value : parseFloat(value);
  }
});

if (!params.city || !params.country) {
  console.error('ERROR: Required parameters: --city and --country');
  console.error('Example: node generateCityData.js --city="Lagos" --country="Nigeria" --basePrice=1000');
  process.exit(1);
}

// Initialize Firebase Admin
let db;
try {
  admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'billion-dollar-universe'
});
  db = admin.firestore();
  console.log('✓ Firebase Admin initialized');
} catch (err) {
  console.error('ERROR: Failed to initialize Firebase Admin.');
  console.error('Ensure GOOGLE_APPLICATION_CREDENTIALS is set to a valid service account key.');
  console.error(err.message);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
//  API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.body ? 'POST' : 'GET',   // 🔥 FIX
      headers: {
        'User-Agent': 'CityWorlds-Generator/1.0 (contact: johnrufai242@gmail.com)',
        'Accept': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error("Raw response:", data.slice(0, 500));
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          console.error("Raw response:", data.slice(0, 500));
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 1: Fetch city boundary from Nominatim
// ═══════════════════════════════════════════════════════════════════════════

async function getCityBoundary(cityName, country) {
  console.log(`\n[1/5] Fetching boundary for ${cityName}, ${country} from Nominatim...`);

  const query = `${cityName}, ${country}`;
  const url = `${CONFIG.nominatimBase}/search?format=json&q=${encodeURIComponent(query)}&limit=1&polygon_geojson=1`;

  try {
    const results = await fetchJSON(url);
    if (!results || results.length === 0) {
      throw new Error(`No results found for ${query}`);
    }

    const place = results[0];
    console.log(`Found: ${place.display_name}`);
    console.log(`Boundary type: ${place.geojson.type}`);
    console.log(`Bounding box: ${place.boundingbox.join(', ')}`);

    // Handle edge case: Nominatim sometimes returns Point instead of Polygon
    // If we get a Point, expand the bounding box slightly for the grid
    let geojson = place.geojson;
    let bounds = {
      south: parseFloat(place.boundingbox[0]),
      north: parseFloat(place.boundingbox[1]),
      west: parseFloat(place.boundingbox[2]),
      east: parseFloat(place.boundingbox[3])
    };

    if (place.geojson.type === 'Point') {
      console.log(`⚠️  Note: Nominatim returned Point geometry, using bounding box for grid`);
      // Create a simple Polygon from the bounding box
      const [south, north, west, east] = place.boundingbox;
      geojson = {
        type: 'Polygon',
        coordinates: [[
          [parseFloat(west), parseFloat(south)],
          [parseFloat(east), parseFloat(south)],
          [parseFloat(east), parseFloat(north)],
          [parseFloat(west), parseFloat(north)],
          [parseFloat(west), parseFloat(south)]
        ]]
      };
    } else if ((place.boundingbox[3] - place.boundingbox[2]) < 0.1) {
      // Bounding box looks too small, expand it
      console.log(`ℹ️  Expanding small bounding box for better coverage`);
      const buffer = 0.15; // ~15km buffer at equator
      bounds = {
        south: Math.max(-90, parseFloat(place.boundingbox[0]) - buffer),
        north: Math.min(90, parseFloat(place.boundingbox[1]) + buffer),
        west: Math.max(-180, parseFloat(place.boundingbox[2]) - buffer),
        east: Math.min(180, parseFloat(place.boundingbox[3]) + buffer)
      };
      geojson = {
        type: 'Polygon',
        coordinates: [[
          [bounds.west, bounds.south],
          [bounds.east, bounds.south],
          [bounds.east, bounds.north],
          [bounds.west, bounds.north],
          [bounds.west, bounds.south]
        ]]
      };
    }

    // Return GeoJSON polygon and metadata
    return {
      cityId: place.osm_id.toString(), // Use OSM ID as unique city identifier
      name: place.name || cityName,
      country: country,
      geojson: geojson,
      bounds: bounds,
      lat: parseFloat(place.lat),
      lon: parseFloat(place.lon)
    };
  } catch (err) {
    console.error('ERROR fetching city boundary:', err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════f═════════════
//  STEP 2: Fetch land use data from Overpass API
// ═══════════════════════════════════════════════════════════════════════════

async function getLandUseData(cityGeojson) {
  console.log('\n[2/5] Skipping Overpass API (using simplified zone assignment)...');
  return []; // Zone types assigned randomly in Step 5 anyway

  // Build Overpass QL query to fetch land use polygons within the city boundary
  // We need: landuse, building, leisure, natural tags
  const bbox = `${cityGeojson.bounds.south},${cityGeojson.bounds.west},${cityGeojson.bounds.north},${cityGeojson.bounds.east}`;

  const query = `
    [out:json][timeout:300];
    (
      way["landuse"](${bbox});
      way["leisure"](${bbox});
      way["natural"](${bbox});
      way["building"](${bbox});
      relation["landuse"](${bbox});
      relation["leisure"](${bbox});
      relation["natural"](${bbox});
      relation["building"](${bbox});
    );
    out body;
    >;
    out skel qt;
  `.replace(/\s+/g, ' ').trim();

  try {
    const data = await fetchJSON(CONFIG.overpassBase, {
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log(`Fetched ${data.elements.length} OSM elements`);
    return data.elements;
  } catch (err) {
    console.error('ERROR fetching Overpass data:', err.message);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 3: Build exclusion mask from OSM data
// ═══════════════════════════════════════════════════════════════════════════

function buildExclusionMask(osmElements, cityBounds) {
  console.log('\n[3/5] Building exclusion mask from OSM land use data...');

  // Convert OSM elements to a set of polygons representing excluded zones.
  // For simplicity in this MVP, we'll work with bounding boxes of excluded features.
  // In a production version, you'd parse actual polygons for pixel-perfect exclusion.

  const excludedPolygons = []; // Array of [minLat, minLon, maxLat, maxLon]

  osmElements.forEach(el => {
    const tags = el.tags || {};
    const landuse = tags.landuse || '';
    const leisure = tags.leisure || '';
    const natural = tags.natural || '';
    const building = tags.building || '';

    // Determine if this element should be excluded
    const isExcluded = (() => {
      // Check landuse
      if (landuse && CONFIG.excludedLandUses.includes(landuse)) {
        return true;
      }
      // Check leisure (parks, gardens, etc.)
      if (leisure && ['park', 'garden', 'playground', 'pitch', 'recreation_ground'].includes(leisure)) {
        return true;
      }
      // Check natural (water bodies, forests)
      if (natural && ['water', 'river', 'lake', 'reservoir', 'basin', 'wood', 'forest', 'scrub', 'heath'].includes(natural)) {
        return true;
      }
      // Highways and railways are always excluded
      if (landuse === 'railway' || building === 'yes' && tags.railway) {
        return true; // railway lines
      }
      // Building footprints? Actually buildings ARE purchasable (you buy land and build on it). So footprint itself is not excluded.
      // However, roads that run through land should be excluded. Here we're simplifying.
      return false;
    })();

    if (isExcluded && el.bounds) {
      excludedPolygons.push([
        el.bounds[1], // min lat (south)
        el.bounds[0], // min lon (west)
        el.bounds[3], // max lat (north)
        el.bounds[2]  // max lon (east)
      ]);
    }
  });

  console.log(`Collected ${excludedPolygons.length} exclusion zones.`);
  return excludedPolygons;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 4: Compute parcel grid
// ═══════════════════════════════════════════════════════════════════════════

function haversineDistance(lat1, lon1, lat2, lon2) {
  // Returns distance in meters between two lat/lon points
  const R = 6371000; // Earth radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*toRad) * Math.cos(lat2*toRad) *
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function generateParcelGrid(cityBounds, gridSizeMeters, excludedPolygons) {
  console.log(`\n[4/5] Generating ${gridSizeMeters}m × ${gridSizeMeters}m parcel grid...`);

  // Convert gridSizeMeters to approximate degrees at this latitude
  // 1 degree latitude ≈ 111,111 meters
  // 1 degree longitude ≈ 111,111 * cos(latitude)
  const avgLat = (cityBounds.north + cityBounds.south) / 2;
  const degPerMeterLat = 1 / 111111;
  const degPerMeterLon = 1 / (111111 * Math.cos(avgLat * Math.PI/180));

  const cellLatDegrees = gridSizeMeters * degPerMeterLat;
  const cellLonDegrees = gridSizeMeters * degPerMeterLon;

  const parcels = [];

  // Iterate over bounding box in grid steps
  for (let lat = cityBounds.south; lat < cityBounds.north; lat += cellLatDegrees) {
    for (let lon = cityBounds.west; lon < cityBounds.east; lon += cellLonDegrees) {
      const cell = {
        north: lat + cellLatDegrees,
        south: lat,
        east: lon + cellLonDegrees,
        west: lon,
        centerLat: lat + cellLatDegrees / 2,
        centerLon: lon + cellLonDegrees / 2
      };

      // Check if cell center is inside city boundary (skip if only a Point)
      const polygon = cityGeojsonToPolygon(cityBounds.geojson);
      if (polygon.length > 0 && !pointInPolygon(cell.centerLat, cell.centerLon, polygon)) {
        continue;
      }

      // Check if cell overlaps with any exclusion zone
      let excluded = false;
      for (const excl of excludedPolygons) {
        if (rectanglesOverlap(
          cell.south, cell.west, cell.north, cell.east,
          excl[0], excl[1], excl[2], excl[3]
        )) {
          excluded = true;
          break;
        }
      }

      if (!excluded) {
        parcels.push(cell);
      }
    }
  }

  console.log(`Generated ${parcels.length} candidate parcels.`);
  return parcels;
}

// Helper: Convert OSM GeoJSON to array of [lat, lon] points
function cityGeojsonToPolygon(geojson) {
  if (geojson.type === 'Polygon') {
    return geojson.coordinates[0].map(coord => [coord[1], coord[0]]);
  } else if (geojson.type === 'MultiPolygon') {
    // Take the largest polygon or first
    const largest = geojson.coordinates.reduce((a, b) => a.length > b.length ? a : b);
    return largest[0].map(coord => [coord[1], coord[0]]);
  }
  return [];
}

// Ray casting algorithm for point-in-polygon
function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function rectanglesOverlap(a_s, a_w, a_n, a_e, b_s, b_w, b_n, b_e) {
  return !(a_e < b_w || a_w > b_e || a_n < b_s || a_s > b_n);
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 5: Assign district names and zone types
// ═══════════════════════════════════════════════════════════════════════════

async function assignDistrictsAndZones(parcels, osmElements, cityGeojson) {
  console.log('\n[5/5] Assigning district names and zone types to parcels...');

  // Build district lookup from OSM data
  // OSM 'place' tags (city, town, village, suburb, neighbourhood) define districts.
  // We'll fetch these via Overpass separately, but for now we'll use simplified logic:
  // - Use a reverseNominatim lookup to get the nearest place name for each parcel center.
  // This would be slow for 1000+ parcels, so in production you'd batch geospatial queries.

  // For this MVP, assign default district "Central" and zone type based on nearby landuse.
  // We'll improve this later with batch reverse geocoding.

  const batchSize = 50;
  const parcelsWithMetadata = [];

  for (let i = 0; i < parcels.length; i++) {
    const parcel = parcels[i];

    // Determine zone type by checking nearby land use from osmElements
    const zoneType = inferZoneType(parcel.centerLat, parcel.centerLon, osmElements);

    // Determine district (simplified: assign numeric districts based on lat/lon quadrants)
    const districtName = assignDistrict(parcel.centerLat, parcel.centerLon, cityGeojson);

    // Compute price: basePrice * districtMultiplier * zoneMultiplier
    const districtMultiplier = getDistrictMultiplier(districtName);
    const zoneMultiplier = CONFIG.zoneMultipliers[zoneType] || 1.0;
    const basePrice = params.basePrice || CONFIG.basePrice;
    const finalPrice = Math.round(basePrice * districtMultiplier * zoneMultiplier);

    parcelsWithMetadata.push({
      ...parcel,
      districtName,
      zoneType,
      basePrice,
      pricePaid: 0, // not yet purchased
      finalPrice
    });

    if ((i+1) % batchSize === 0) {
      console.log(`  Processed ${i+1}/${parcels.length} parcels...`);
    }
  }

  console.log(`Assigned metadata to all ${parcelsWithMetadata.length} parcels.`);
  return parcelsWithMetadata;
}

function inferZoneType(lat, lon, osmElements) {
  // Check if there's commercial/residential landuse near this point
  // In a real implementation, you'd index osmElements into an R-tree for fast lookup.
  // Here we do a simple linear search over elements that contain the point.

  // For speed, skip actual check and just assign random distribution based on city density
  // Real implementation: check tags.landuse of the polygon containing (lat, lon)
  const rand = Math.random();
  if (rand < 0.4) return 'residential';
  if (rand < 0.7) return 'commercial';
  if (rand < 0.9) return 'mixed';
  return 'industrial';
}

function assignDistrict(lat, lon, cityGeojson) {
  // Simplistic district assignment: divide city into 3 zones based on distance from city center
  const centerLat = cityGeojson.lat;
  const centerLon = cityGeojson.lon;

  const distance = haversineDistance(lat, lon, centerLat, centerLon);

  if (distance < 3000) return 'CBD';      // Central Business District (within 3km)
  if (distance < 8000) return 'Midtown';  // Mid zone (3-8km)
  return 'Outskirts';                     // Outer zone (>8km)
}

function getDistrictMultiplier(districtName) {
  if (districtName === 'CBD') return params.districtCBD || CONFIG.districtMultipliers.cbd;
  if (districtName === 'Midtown') return params.districtMid || CONFIG.districtMultipliers.mid;
  return params.districtOuter || CONFIG.districtMultipliers.outer;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 6: Write to Firestore
// ═══════════════════════════════════════════════════════════════════════════

async function writeCityToFirestore(cityData, parcels) {
  console.log('\n[6/6] Writing city and parcels to Firestore...');

  const cityId = cityData.cityId;
  const cityRef = db.collection('cities').doc(cityId);
  const parcelsRef = cityRef.collection('parcels');
  const queueRef = db.collection('cityQueue');

  // Batch write parcels (max 500 per batch)
  const batchSize = 500;
  const batches = Math.ceil(parcels.length / batchSize);

  for (let b = 0; b < batches; b++) {
    const batch = db.batch();
    const start = b * batchSize;
    const end = Math.min(start + batchSize, parcels.length);

    for (let i = start; i < end; i++) {
      const parcel = parcels[i];
      const parcelId = `parcel_${b * 500 + i}`;
      const parcelRef = parcelsRef.doc(parcelId);

      batch.set(parcelRef, {
        parcelId: parcelId,
        ownerId: null,
        ownerType: null,
        districtName: parcel.districtName,
        zoneType: parcel.zoneType,
        bounds: {
          north: parcel.north,
          south: parcel.south,
          east: parcel.east,
          west: parcel.west
        },
        centerLat: parcel.centerLat,
        centerLon: parcel.centerLon,
        basePrice: parcel.basePrice,
        pricePaid: 0,
        purchasedAt: null,
        buildingType: null,
        buildingTier: 0,
        buildingBuiltAt: null,
        pointsPerDay: 0
      });
    }

    await batch.commit();
    console.log(`  Batch ${b+1}/${batches} committed (${end-start} parcels)`);
  }

  // Write city document
  await cityRef.set({
    name: cityData.name,
    country: cityData.country,
    status: 'PRE-GENERATED',
    parcelCount: parcels.length,
    soldCount: 0,
    releaseDate: admin.firestore.FieldValue.serverTimestamp(),
    archiveDate: null,
    bounds: cityData.bounds,
    thumbnailURL: null, // TODO: Generate thumbnail
    landmarkAuctionOpen: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    basePrice: params.basePrice || CONFIG.basePrice,
    districtMultipliers: {
      cbd: params.districtCBD || CONFIG.districtMultipliers.cbd,
      mid: params.districtMid || CONFIG.districtMultipliers.mid,
      outer: params.districtOuter || CONFIG.districtMultipliers.outer
    }
  });

  console.log(`  City document created: cities/${cityId}`);

  // Add to city queue (at the end, admin can reorder)
  const queueSnapshot = await queueRef.orderBy('order', 'desc').limit(1).get();
  const nextOrder = queueSnapshot.empty ? 1 : queueSnapshot.docs[0].data().order + 1;

  await queueRef.add({
    cityId: cityId,
    releaseDate: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // 1 week from now
    unlockTrigger: 'both', // fill + time
    order: nextOrder
  });

  console.log(`  Added to queue with order ${nextOrder}`);

  console.log('\n✓ CITY PRE-GENERATION COMPLETE');
  console.log(`City: ${cityData.name}, ${cityData.country}`);
  console.log(`City ID: ${cityId}`);
  console.log(`Total parcels: ${parcels.length}`);
  console.log(`Estimated fill at ${Math.floor(parcels.length * 0.8)} parcels (80%)`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
  try {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║        CITY WORLDS — PRE-GENERATION PIPELINE                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');

    // Override config with CLI params
    if (params.gridSize) CONFIG.defaultGridSize = params.gridSize;
    if (params.maxParcels) CONFIG.maxParcels = params.maxParcels;
    if (params.districtCBD) CONFIG.districtMultipliers.cbd = params.districtCBD;
    if (params.districtMid) CONFIG.districtMultipliers.mid = params.districtMid;
    if (params.districtOuter) CONFIG.districtMultipliers.outer = params.districtOuter;

    // STEP 1: Get city boundary
    const cityData = await getCityBoundary(params.city, params.country);

    // Global var for later use
    global.cityGeojson = cityData.geojson;

    // STEP 2: Get land use data
    const osmElements = await getLandUseData(cityData);

    // STEP 3: Build exclusion mask
    const excludedPolygons = buildExclusionMask(osmElements, cityData);

    // STEP 4: Generate initial grid
    let parcels = generateParcelGrid({...cityData.bounds, geojson: cityData.geojson}, CONFIG.defaultGridSize, excludedPolygons);
    
    if (parcels.length > CONFIG.maxParcels) {
      console.log(`\n⚠️  Parcel count (${parcels.length}) exceeds max (${CONFIG.maxParcels}).`);
      console.log('Increasing grid resolution to hit target...');

      // Increase grid size until we're under the cap
      let adjustedGridSize = CONFIG.defaultGridSize;
      while (parcels.length > CONFIG.maxParcels && adjustedGridSize < 200) {
        adjustedGridSize += 10;
       parcels = generateParcelGrid({...cityData.bounds, geojson: cityData.geojson}, adjustedGridSize, excludedPolygons);
      }
      console.log(`Adjusted grid size to ${adjustedGridSize}m → ${parcels.length} parcels`);
      parcels = parcels.slice(0, CONFIG.maxParcels);
      console.log(`Capped to ${parcels.length} parcels.`);
    }

    if (parcels.length < 100) {
      console.warn(`\n⚠️  WARNING: Only ${parcels.length} parcels generated. This may be too few for a viable city.`);
      console.warn('Consider choosing a different city or adjusting grid size.');
    }

    // STEP 5: Assign district and zone metadata
    const parcelsWithMetadata = await assignDistrictsAndZones(parcels, osmElements, cityData);

    // STEP 6: Write to Firestore
    await writeCityToFirestore(cityData, parcelsWithMetadata);

    console.log('\n✅ ALL DONE! City ready for preview in admin dashboard.');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();

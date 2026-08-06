/**
 * City Worlds — Map Renderer
 *
 * Integrates MapLibre GL JS with Three.js to render real-geography city maps
 * with purchasable parcel grids and 3D buildings.
 *
 * Architecture:
 *   • MapLibre renders the base OSM map (streets, labels, terrain)
 *   • Custom Three.js layer overlays parcels and buildings
 *   • Parcel data loaded from Firestore cities/{cityId}/parcels
 *   • Buildings are anchored to real lat/lon via WebMercator projection
 *   • LOD: parcels always visible; buildings only at zoom >= 13
 *
 * Usage:
 *   const renderer = new CityWorldsRenderer(cityId, userId);
 *   await renderer.initMap('map-container');
 *
 * Events:
 *   - onParcelClick(parcelId, parcelData)
 *   - onBuildingClick(parcelId, buildingData)
 *
 * References:
 *   https://maplibre.org/maplibre-gl-js-docs/api/history/maplibregl.ICustomLayerInterface/
 */

const db = firebase.firestore();

class CityWorldsRenderer {
  /**
   * @param {string} cityId - Firestore city document ID
   * @param {string} userId - Current user or brand ID
   * @param {string} userType - 'user' or 'brand'
   * @param {string} brandColor - Hex color for owned parcels (optional)
   */
  constructor(cityId, userId, userType = 'user', brandColor = 0xC6A85E) {
    this.cityId = cityId;
    this.userId = userId;
    this.userType = userType;
    this.brandColor = new THREE.Color(brandColor);

    this.map = null;
    this.threeRenderer = null;
    this.scene = null;
    this.camera = null;
    this.parcelsLayer = new THREE.Group();
    this.buildingsLayer = new THREE.Group();
    this.parcelMeshes = new Map(); // parcelId -> THREE.Mesh
    this.buildingMeshes = new Map(); // parcelId -> THREE.Mesh
    this.parcelsData = new Map(); // parcelId -> parcel data
    this.cityData = null;

    // Callbacks
    this.onParcelClick = null;
    this.onBuildingClick = null;

    // Raycaster for click detection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // LOD settings
    this.buildingZoomThreshold = 13;

    // Style constants
    this.parcelColors = {
      available: new THREE.Color(0xFFD700), // gold
      owned: new THREE.Color(0xC6A85E),     // brand gold/yellow
      full: new THREE.Color(0x00FFFF)       // cyan
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /** Initialize MapLibre map in the given container element */
  async initMap(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element #${containerId} not found`);
    }

    // MapLibre style with OSM raster tiles (free, no API key)
    const style = {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.openfreemap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
      },
      layers: [{
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm-tiles'
      }]
    };

    // Create MapLibre map instance
    this.map = new maplibregl.Map({
      container,
      style,
      center: [0, 0], // will be set after city loads
      zoom: 10,
      pitch: 0,
      bearing: 0,
      antialias: true // important for WebGL
    });

    // Add navigation controls (optional)
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Wait for map to load
    await new Promise((resolve, reject) => {
      this.map.on('load', resolve);
      this.map.on('error', reject);
    });

    console.log('MapLibre map loaded');

    // Register the custom Three.js layer
    this._registerThreeLayer();

    // Load city data and parcels
    await this._loadCityAndParcels();

    // Fit bounds to city
    this._fitMapToCity();

    // Add click handler for parcel selection
    this._setupClickHandler();

    return this.map;
  }

  /** Refresh parcels display (e.g. after purchase) */
  refreshParcels() {
    // In real app, would re-fetch from Firestore
    // For now, assume parcelsData already contains latest
  }

  /** Update a single parcel color (called after purchase) */
  updateParcelColor(parcelId, ownerId, ownerType) {
    const mesh = this.parcelMeshes.get(parcelId);
    if (mesh) {
      const color = (ownerId) ? this.parcelColors.owned : this.parcelColors.available;
      mesh.material.color = color;
    }
  }

  /** Add a building to an owned parcel */
  addBuilding(parcelId, buildingType, buildingTier, modelUrl = null) {
    // Remove existing building if any
    const existing = this.buildingMeshes.get(parcelId);
    if (existing) {
      this.buildingsLayer.remove(existing);
      this.buildingMeshes.delete(parcelId);
    }

    if (!buildingType || buildingTier === 0) return;

    // Create a simple 3D representation based on tier
    const geometry = this._getBuildingGeometry(buildingTier);
    const material = new THREE.MeshPhongMaterial({
      color: this._getBuildingColor(buildingTier),
      flatShading: true
    });
    const building = new THREE.Mesh(geometry, material);

    // Position at parcel center
    const parcelData = this.parcelsData.get(parcelId);
    if (parcelData) {
      const pos = this._latLonToWorld(parcelData.centerLon, parcelData.centerLat);
      building.position.set(pos.x, 0, pos.y); // y is up in Three.js
      // Scale to parcel size approximately (parcel is ~50m wide)
      const widthMeters = this._approxMercatorDistance(
        parcelData.bounds.west, parcelData.centerLat,
        parcelData.bounds.east, parcelData.centerLat
      );
      const heightMeters = this._approxMercatorDistance(
        parcelData.centerLon, parcelData.bounds.south,
        parcelData.centerLon, parcelData.bounds.north
      );
      building.scale.set(widthMeters/50, 1, heightMeters/50); // base 50m size
    }

    this.buildingsLayer.add(building);
    this.buildingMeshes.set(parcelId, building);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE IMPLEMENTATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Register the Three.js custom layer with MapLibre */
  _registerThreeLayer() {
    const threeLayer = {
      id: 'three-layer',
      type: 'custom',
      renderingMode: '3d',
      onAdd: this._onAddThreeLayer.bind(this),
      onRemove: this._onRemoveThreeLayer.bind(this),
      render: this._renderThreeLayer.bind(this)
    };

    this.map.on('render', () => {
      if (!this.map.isStyleLoaded()) return;
      if (!this.map.getLayer('three-layer')) {
        this.map.addLayer(threeLayer);
      }
    });

    // Also try adding immediately if style already loaded
    if (this.map.isStyleLoaded()) {
      this.map.addLayer(threeLayer);
    }
  }

  /** Called by MapLibre when the Three.js layer is added */
  _onAddThreeLayer(map, glContext) {
    console.log('Three.js layer onAdd');

    // Create Three.js renderer sharing WebGL context
    this.threeRenderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: glContext,
      alpha: true,
      antialias: true
    });
    this.threeRenderer.autoClear = false; // important: don't clear MapLibre's buffer

    // Create scene and cameras
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 100);
    this.scene.add(dirLight);

    // Add parcels and buildings groups
    this.scene.add(this.parcelsLayer);
    this.scene.add(this.buildingsLayer);

    // Handle map resizing
    map.on('resize', () => {
      this.threeRenderer.setSize(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
    });
  }

  /** Called by MapLibre when the Three.js layer is removed */
  _onRemoveThreeLayer(map) {
    console.log('Three.js layer onRemove');
    this.parcelMeshes.clear();
    this.threeRenderer.dispose();
    this.threeRenderer = null;
  }

  /** Called each frame by MapLibre */
  _renderThreeLayer(uniforms, matrix) {
    if (!this.threeRenderer) return;

    // Sync camera: use the provided matrix as the camera projection
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

    // Optional: also sync camera position from freeCameraOptions?
    // But actually the matrix already encodes both view and projection.
    // So we can leave camera at identity. Important: set camera.matrixWorld to identity.
    this.camera.updateMatrixWorld(true);

    // LOD: toggle buildings visibility based on zoom
    const zoom = this.map.getZoom();
    if (this.buildingsLayer) {
      this.buildingsLayer.visible = zoom >= this.buildingZoomThreshold;
    }

    // Render
    this.threeRenderer.resetState();
    this.threeRenderer.render(this.scene, this.camera);

    // Request next frame
    this.map.triggerRepaint();
  }

  /** Load city metadata and parcels from Firestore */
  async _loadCityAndParcels() {
    console.log(`Loading city ${this.cityId} and parcels...`);

    // Get city document
    const cityRef = this.cityId.includes('/') ? // if full path?
      db.doc(this.cityId) :
      db.collection('cities').doc(this.cityId);

    const citySnap = await cityRef.get();
    if (!citySnap.exists) {
      throw new Error(`City ${this.cityId} not found in Firestore`);
    }
    this.cityData = citySnap.data();
    console.log('City data loaded:', this.cityData.name);

    // Load all parcels for this city
    const parcelsSnap = await cityRef.collection('parcels').get();
    console.log(`Loaded ${parcelsSnap.size} parcels`);

    parcelsSnap.forEach(doc => {
      const data = doc.data();
      this.parcelsData.set(doc.id, data);
    });

    // Render parcels on the map
    this._renderAllParcels();

    // Render existing buildings
    this._renderAllBuildings();
  }

  /** Render every parcel as a semi-transparent box on the ground */
  _renderAllParcels() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // Move geometry so it sits on ground (y from 0 to 1)
    geometry.translate(0, 0.5, 0);

    this.parcelsData.forEach((data, parcelId) => {
      const bounds = data.bounds;
      if (!bounds) return;

      // Compute parcel's world width/height in meters
      const width = this._approxMercatorDistance(
        bounds.west, (bounds.north + bounds.south)/2,
        bounds.east, (bounds.north + bounds.south)/2
      );
      const height = this._approxMercatorDistance(
        (bounds.east + bounds.west)/2, bounds.south,
        (bounds.east + bounds.west)/2, bounds.north
      );

      // Center world position
      const centerLon = (bounds.east + bounds.west) / 2;
      const centerLat = (bounds.north + bounds.south) / 2;
      const pos = this._latLonToWorld(centerLon, centerLat);

      // Choose color based on ownership
      let color;
      if (data.ownerId) {
        color = this.parcelColors.owned;
      } else {
        color = this.parcelColors.available;
      }

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(pos.x, 0, pos.y);
      mesh.scale.set(width, 1, height);
      mesh.userData.parcelId = parcelId;
      mesh.userData.parcelData = data;

      this.parcelsLayer.add(mesh);
      this.parcelMeshes.set(parcelId, mesh);
    });
  }

  /** Render all existing buildings */
  _renderAllBuildings() {
    this.parcelsData.forEach((data, parcelId) => {
      if (data.buildingType && data.buildingTier > 0) {
        this.addBuilding(parcelId, data.buildingType, data.buildingTier);
      }
    });
  }

  /** Convert lng/lat to Three.js world coordinates (Mercator meters) */
  _latLonToWorld(lng, lat) {
    // WebMercator: x = R * λ, y = R * ln(tan(π/4 + φ/2))
    const R = 6378137; // Earth radius in meters
    const x = R * lng * Math.PI / 180;
    const y = R * Math.log(Math.tan(Math.PI/4 + lat * Math.PI/360));
    // In Three.js, Y is up, Z is depth? Typically we use X and Z for ground plane, Y up.
    // We'll map: x -> X, y -> Z (so that north is -Z or +Z depending on orientation)
    // MapLibre's Mercator: X east, Y north. We'll use: X east, Z north (or north = -Z). Need to match camera orientation.
    // In typical MapLibre custom layer examples, they set mesh.position.set(x, 0, y) or set z to y with sign.
    // Let's test: If we set position.z = y, then north is positive Z. That seems fine.
    return new THREE.Vector3(x, 0, y);
  }

  /** Approximate distance between two lat/lon points along a horizontal/vertical line (in meters) */
  _approxMercatorDistance(lng1, lat, lng2, lat2) {
    // Since the grid cells are small (~50m), we can approximate using Haversine or simpler:
    // At given latitude, 1 degree longitude = cos(lat)*111319m, 1 degree latitude = 111319m
    const latRad = lat * Math.PI/180;
    const metersPerDegLon = 111319 * Math.cos(latRad);
    const metersPerDegLat = 111319;
    const dLat = Math.abs(lat2 - lat);
    const dLon = Math.abs(lng2 - lng1);
    return Math.sqrt(
      (dLat * metersPerDegLat) ** 2 +
      (dLon * metersPerDegLon) ** 2
    );
  }

  /** Get Three.js geometry for a given building tier */
  _getBuildingGeometry(tier) {
    switch(tier) {
      case 1: // Billboard / Kiosk: flat box, low height
        return new THREE.BoxGeometry(1, 0.5, 1);
      case 2: // Mid: two-storey or retail
        return new THREE.BoxGeometry(1, 2, 1);
      case 3: // Premium: tower
        return new THREE.BoxGeometry(0.8, 4, 0.8);
      case 4: // Elite: landmark
        return new THREE.ConeGeometry(1, 6, 4); // 4-sided pyramid
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  _getBuildingColor(tier) {
    const colors = [0xFFFFFF, 0xAAAAAA, 0x4A90E2, 0xE94E77, 0xFFD700];
    return colors[tier] || 0xFFFFFF;
  }

  /** Fit map view to city bounds with padding */
  _fitMapToCity() {
    if (!this.cityData?.bounds) return;
    const b = this.cityData.bounds;
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]], {
      padding: 50,
      duration: 2000
    });
  }

  /** Setup click raycasting to detect parcel selections */
  _setupClickHandler() {
    this.map.on('click', (e) => {
      if (!this.parcelsLayer) return;

      const rect = this.map.getCanvas().getBoundingClientRect();
      this.mouse.x = ((e.point.x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.point.y - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.parcelsLayer.children, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const parcelId = hit.object.userData.parcelId;
        const parcelData = hit.object.userData.parcelData;
        if (this.onParcelClick) {
          this.onParcelClick(parcelId, parcelData);
        }
      }
    });
  }
}

// Make globally available
if (typeof window !== 'undefined') {
  window.CityWorldsRenderer = CityWorldsRenderer;
}

/**
 * Building Manager — Handles building construction on owned parcels.
 *
 * Calls the 'onBuildingConstruct' Cloud Function.
 * Updates the coin balance and triggers 3D building rendering.
 */

import { getBalance, optimisticDebit, confirmDebit, rollbackDebit } from "../economy/currency.js";

/**
 * @param {string} cityId - City document ID
 * @param {string} userId - Current user/brand ID
 * @param {import('./mapRenderer.js').CityWorldsRenderer} renderer - Map renderer instance
 */
export class BuildingManager {
  constructor(cityId, userId, renderer) {
    this.cityId = cityId;
    this.userId = userId;
    this.renderer = renderer;
    this.functions = firebase.functions();
  }

  /**
   * Construct a building on a parcel.
   * @param {string} parcelId - Parcel document ID
   * @param {string} buildingType - Type identifier (e.g., 'billboard')
   * @param {number} tier - Building tier (1-4)
   * @param {number} cost - Coin cost
   * @param {number} pointsPerDay - Points generated per day
   */
  async construct(parcelId, buildingType, tier, cost, pointsPerDay) {
    const balance = getBalance();
    if (balance < cost) {
      throw new Error("Insufficient coin balance");
    }

    optimisticDebit(cost);

    try {
      const constructFn = httpsCallable(this.functions, 'onBuildingConstruct');
      const result = await constructFn({
        cityId: this.cityId,
        parcelId,
        buildingType,
        buildingTier: tier,
        cost,
        pointsPerDay
      });

      if (result.data?.success) {
        confirmDebit(cost);
        // Render the building 3D model on the map
        this.renderer.addBuilding(parcelId, buildingType, tier);
        window.dispatchEvent(new Event('bdu:cityBuildingConstructed'));
        return result.data;
      } else {
        throw new Error('Construction failed on server');
      }
    } catch (error) {
      rollbackDebit(cost);
      console.error('Building construction error:', error);
      throw error;
    }
  }
}

/**
 * Purchase Manager — Handles parcel purchases in City Worlds.
 *
 * Uses the 'onParcelPurchase' Cloud Function for atomic transactions.
 * Optimistically updates the currency balance and notifies UI on success.
 */

import { getBalance, optimisticDebit, confirmDebit, rollbackDebit } from "../economy/currency.js";

/**
 * @param {string} cityId - The city document ID
 * @param {string} userId - Current user/brand ID
 * @param {'user'|'brand'} userType - Type of owner
 * @param {import('./mapRenderer.js').CityWorldsRenderer} renderer - Map renderer instance
 */
export class PurchaseManager {
  constructor(cityId, userId, userType, renderer) {
    this.cityId = cityId;
    this.userId = userId;
    this.userType = userType;
    this.renderer = renderer;
    this.functions = firebase.functions();
  }

  /**
   * Purchase a parcel.
   * @param {string} parcelId - Parcel document ID
   * @param {number} price - Price in coins
   */
  async purchaseParcel(parcelId, price) {
    // Client-side balance check
    const balance = getBalance();
    if (balance < price) {
      throw new Error("Insufficient coin balance");
    }

    // Optimistic UI: show coin deduction immediately
    optimisticDebit(price);

    try {
      const buyFn = httpsCallable(this.functions, 'onParcelPurchase');
      const result = await buyFn({
        cityId: this.cityId,
        parcelId,
        price,
        ownerType: this.userType
      });

      if (result.data?.success) {
        // Confirm the debit
        confirmDebit(price);
        // Update parcel visual on map
        this.renderer.updateParcelColor(parcelId, this.userId, this.userType);
        // Dispatch global event for other UI components
        window.dispatchEvent(new Event('bdu:cityParcelPurchased'));
        return result.data;
      } else {
        throw new Error('Purchase failed on server');
      }
    } catch (error) {
      // Rollback optimistic UI
      rollbackDebit(price);
      console.error('Parcel purchase error:', error);
      throw error;
    }
  }
}

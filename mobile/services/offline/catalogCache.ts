/**
 * Offline catalog cache for field-sales capture.
 *
 * The product catalog and the rep's outlets are fetched from the network, but a
 * rep often opens the capture screen with no signal. We mirror the last good
 * response here so the screen can render (and barcodes can match) on a cold
 * start offline; the network refresh, when it succeeds, overwrites the cache.
 *
 * Keyed per company + rep so one device switching employers never shows another
 * company's products. Backed by AsyncStorage (JSON) — small, read-mostly data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CatalogProduct, FieldOutlet } from '@/api/fieldSales';

export interface CachedCatalog {
  products: CatalogProduct[];
  outlets: FieldOutlet[];
  savedAt: number;
}

const cacheKey = (companyId: number, repId: number) => `field_sales:catalog:${companyId}:${repId}`;

export const catalogCache = {
  async get(companyId: number, repId: number): Promise<CachedCatalog | null> {
    try {
      const raw = await AsyncStorage.getItem(cacheKey(companyId, repId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedCatalog;
      if (!Array.isArray(parsed?.products) || !Array.isArray(parsed?.outlets)) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  async set(companyId: number, repId: number, products: CatalogProduct[], outlets: FieldOutlet[]): Promise<void> {
    try {
      const entry: CachedCatalog = { products, outlets, savedAt: Date.now() };
      await AsyncStorage.setItem(cacheKey(companyId, repId), JSON.stringify(entry));
    } catch {
      // Cache writes are best-effort — never block capture on a storage failure.
    }
  },
};

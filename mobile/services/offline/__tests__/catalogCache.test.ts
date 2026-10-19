/**
 * Offline catalog cache — the last-good catalog/outlets mirror used so a rep can
 * build a sale on a cold offline start. These tests pin the guarantees the
 * capture screen relies on: a missing/corrupt entry is a miss (never a throw),
 * entries are keyed per company+rep, and a round-trip preserves the payload.
 */

import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CatalogProduct, FieldOutlet } from "../../../api/fieldSales";
import { catalogCache } from "../catalogCache";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

const products: CatalogProduct[] = [
  { id: 1, name: "Water 500ml", category: "Beverages", status: "active", variants: [] },
];
const outlets: FieldOutlet[] = [
  { id: 5, name: "Corner Shop", code: "CS-1", address: null, latitude: null, longitude: null, radius_meters: 150 },
];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("catalogCache", () => {
  it("is a miss when nothing has been cached", async () => {
    expect(await catalogCache.get(1, 2)).toBeNull();
  });

  it("round-trips the catalog and stamps savedAt", async () => {
    await catalogCache.set(1, 2, products, outlets);
    const got = await catalogCache.get(1, 2);
    expect(got?.products).toEqual(products);
    expect(got?.outlets).toEqual(outlets);
    expect(typeof got?.savedAt).toBe("number");
  });

  it("isolates entries per company and rep", async () => {
    await catalogCache.set(1, 2, products, outlets);
    expect(await catalogCache.get(1, 3)).toBeNull();
    expect(await catalogCache.get(3, 2)).toBeNull();
  });

  it("treats corrupt JSON as a miss", async () => {
    await AsyncStorage.setItem("field_sales:catalog:1:2", "{not json");
    expect(await catalogCache.get(1, 2)).toBeNull();
  });

  it("treats a malformed shape as a miss", async () => {
    await AsyncStorage.setItem("field_sales:catalog:1:2", JSON.stringify({ products: "nope" }));
    expect(await catalogCache.get(1, 2)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { YotoService, type ReadOnlyYotoSdk } from "./yoto-service.js";

const sdk: ReadOnlyYotoSdk = {
  devices: {
    getMyDevices: async () => [
      { id: "player-1", name: "Bedroom", type: "mini", status: "online" }
    ]
  },
  content: {
    getMyCards: async () => [{ cardId: "card-1", title: "Stories" }],
    getCard: async (cardId) => ({
      content: { chapters: [], requestedCardId: cardId },
      metadata: {}
    })
  }
};

describe("YotoService", () => {
  it("lists devices without mutating them", async () => {
    const service = new YotoService(sdk);

    await expect(service.listDevices()).resolves.toEqual([
      { id: "player-1", name: "Bedroom", type: "mini", status: "online" }
    ]);
  });

  it("fails explicitly when a requested device is absent", async () => {
    const service = new YotoService(sdk);

    await expect(service.getDevice("unknown")).rejects.toThrow(/not found/i);
  });

  it("reads a specific library card", async () => {
    const service = new YotoService(sdk);

    await expect(service.getCard("card-1")).resolves.toMatchObject({
      content: { requestedCardId: "card-1" }
    });
  });
});


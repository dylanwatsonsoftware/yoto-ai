import type { Device, UserCard, YotoJson } from "@yotoplay/yoto-sdk";

export interface ReadOnlyYotoSdk {
  devices: {
    getMyDevices(): Promise<Device[]>;
  };
  content: {
    getMyCards(): Promise<UserCard[]>;
    getCard(cardId: string): Promise<YotoJson>;
  };
}

export class YotoService {
  constructor(private readonly sdk: ReadOnlyYotoSdk) {}

  listDevices(): Promise<Device[]> {
    return this.sdk.devices.getMyDevices();
  }

  async getDevice(deviceId: string): Promise<Device> {
    const device = (await this.listDevices()).find((candidate) => candidate.id === deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return device;
  }

  listCards(): Promise<UserCard[]> {
    return this.sdk.content.getMyCards();
  }

  getCard(cardId: string): Promise<YotoJson> {
    return this.sdk.content.getCard(cardId);
  }
}


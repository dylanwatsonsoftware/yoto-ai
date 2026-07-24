import type { TokenStore } from "./auth.js";
import { validatePlaylistDraft } from "./playlist.js";
import type { YotoService } from "./yoto-service.js";

interface AuthCommands {
  login(): Promise<unknown>;
  status(): Promise<unknown>;
  logout(): Promise<unknown>;
}

interface CommandDependencies {
  auth: AuthCommands;
  service: YotoService;
  readFile(path: string): Promise<string>;
  tokenStore: TokenStore;
}

export class UnsupportedOperationError extends Error {}
export class UsageError extends Error {}

function optionValue(args: string[], option: string): string {
  const index = args.indexOf(option);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${option} is required`);
  }
  return value;
}

export async function executeCommand(
  args: string[],
  dependencies: CommandDependencies
): Promise<unknown> {
  const [group, action, identifier] = args;

  if (group === "auth" && action === "login") {
    return dependencies.auth.login();
  }
  if (group === "auth" && action === "status") {
    return dependencies.auth.status();
  }
  if (group === "auth" && action === "logout") {
    return dependencies.auth.logout();
  }
  if (group === "devices" && action === "list") {
    return { devices: await dependencies.service.listDevices() };
  }
  if (group === "devices" && action === "status" && identifier) {
    return { device: await dependencies.service.getDevice(identifier) };
  }
  if (group === "library" && action === "list") {
    return { cards: await dependencies.service.listCards() };
  }
  if (group === "library" && action === "show" && identifier) {
    return { card: await dependencies.service.getCard(identifier) };
  }
  if (group === "playlist" && action === "draft") {
    const inputPath = optionValue(args, "--input");
    const draft = validatePlaylistDraft(JSON.parse(await dependencies.readFile(inputPath)));
    return { published: false, draft };
  }

  if (
    group === "devices" ||
    group === "playlist" ||
    group === "content" ||
    group === "library"
  ) {
    throw new UnsupportedOperationError(
      "This safe MVP does not publish content or control players."
    );
  }
  throw new UsageError("Unknown command");
}


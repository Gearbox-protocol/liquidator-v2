import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import type { INotifier, INotifierMessage } from "./types.js";

export default class ConsoleNotifier implements INotifier {
  @Logger("ConsoleNotifier")
  log!: ILogger;

  public alert(message: INotifierMessage): void {
    this.log.warn(message.plain);
  }

  public notify(message: INotifierMessage): void {
    this.log.info(message.plain);
  }
}

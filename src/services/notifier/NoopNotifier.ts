import type { INotifier, INotifierMessage } from "./types.js";

export default class NoopNotifier implements INotifier {
  public alert(message: INotifierMessage): void {}
  public notify(message: INotifierMessage): void {}
}

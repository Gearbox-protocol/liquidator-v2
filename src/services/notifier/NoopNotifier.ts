import type { INotifier } from "./types";

export default class NoopNotifier implements INotifier {
  public alert(message: string): void {}
  public notify(message: string): void {}
}

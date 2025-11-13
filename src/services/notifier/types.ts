export interface INotifierMessage {
  markdown: string;
  plain: string;
  /**
   * If it's on cooldown, the message will not be sent
   */
  key?: string;
}

export interface INotifier {
  alert: (message: INotifierMessage) => void;
  notify: (message: INotifierMessage) => void;
  /**
   * Silence the notifier for a given key
   * @param key
   * @returns
   */
  setCooldown: (key: string) => void;
}

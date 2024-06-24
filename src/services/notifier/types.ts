export interface INotifierMessage {
  markdown: string;
  plain: string;
}

export interface INotifier {
  alert: (message: INotifierMessage) => void;
  notify: (message: INotifierMessage) => void;
}

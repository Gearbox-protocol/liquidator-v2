export interface INotifier {
  alert: (message: string) => void;
  notify: (message: string) => void;
}

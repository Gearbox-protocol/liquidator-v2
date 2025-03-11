import type { INotifier } from "./types.js";

export class AlertBucket {
  #intervals;
  #defaultInterval;
  #nextAlert;

  constructor(intervals: number[], defaultInterval = 60 * 60 * 1000) {
    this.#nextAlert = Date.now();
    this.#intervals = intervals;
    this.#defaultInterval = defaultInterval;
  }

  public chooseSeverity(): keyof INotifier {
    const now = Date.now();
    if (now >= this.#nextAlert) {
      let nextIncrement = this.#defaultInterval;
      if (this.#intervals.length > 0) {
        nextIncrement = this.#intervals.shift()!;
      }
      this.#nextAlert = now + nextIncrement;
      return "alert";
    }
    return "notify";
  }
}

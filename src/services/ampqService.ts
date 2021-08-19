import * as Amqp from "amqp-ts";
import { Service } from "typedi";
import config from "../config";

@Service()
export class AMPQService {
  static delay = 600;

  protected exchange: Amqp.Exchange;

  protected sentMessages: Record<string, number> = {};

  async launch() {
    try {
      const connection = new Amqp.Connection(config.ampqUrl);
      this.exchange = connection.declareExchange("TelegramBot");
      await connection.completeConfiguration();
    } catch (e) {
      console.log("Cant connect AMPQ");
      process.exit(2);
    }
  }

  sendMessage(text: string) {
    const lastTime = this.sentMessages[text];
    if (lastTime && lastTime < Date.now() / 1000 + AMPQService.delay) {
      return;
    }

    const msg = new Amqp.Message(text);

    this.sentMessages[text] = Date.now() / 1000;

    this.exchange.send(msg);
  }
}

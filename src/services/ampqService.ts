import { GOERLI_NETWORK, MAINNET_NETWORK } from "@gearbox-protocol/sdk";
import * as Amqp from "amqp-ts";
import { Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";

@Service()
export class AMPQService {
  @Logger("AMPQService")
  log: LoggerInterface;

  static delay = 600;

  protected exchange: Amqp.Exchange | undefined;
  protected sentMessages: Record<string, number> = {};
  protected routingKey: string | undefined;

  /**
   * Launches AMPQService
   */
  async launch(chainId: number) {
    switch (chainId) {
      case MAINNET_NETWORK:
        this.routingKey = "MAINNET";
        break;
      case GOERLI_NETWORK:
        this.routingKey = "GOERLI";
    }

    if (config.ampqUrl && config.ampqExchange && this.routingKey) {
      try {
        const connection = new Amqp.Connection(config.ampqUrl);
        this.exchange = connection.declareExchange(config.ampqExchange);
        await connection.completeConfiguration();
      } catch (e) {
        console.log("Cant connect AMPQ");
        process.exit(2);
      }
    } else {
      this.log.warn("AMPQ service is disabled");
    }
  }

  info(text: string) {
    this.send(`[INFO]:${text}`);
    this.log.info(text);
  }

  error(text: string) {
    this.send(`[ERROR]:${text}`);
    this.log.error(text);
  }

  protected send(text: string) {
    if (this.exchange && this.routingKey) {
      const lastTime = this.sentMessages[text];
      if (lastTime && lastTime < Date.now() / 1000 + AMPQService.delay) {
        return;
      }

      const msg = new Amqp.Message(
        `[${this.routingKey}]${config.appName}:${text}`,
      );

      this.sentMessages[text] = Date.now() / 1000;

      this.exchange.send(msg, this.routingKey);
    }
  }
}

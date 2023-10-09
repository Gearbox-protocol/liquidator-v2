import { GOERLI_NETWORK, MAINNET_NETWORK } from "@gearbox-protocol/sdk";
import type { Channel } from "amqplib";
import { connect } from "amqplib";
import { Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";

@Service()
export class AMPQService {
  @Logger("AMPQService")
  log: LoggerInterface;

  static delay = 600;

  protected channel: Channel;
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
        const conn = await connect(config.ampqUrl);
        this.channel = await conn.createChannel();
      } catch (e) {
        console.log("Cant connect AMPQ");
        process.exit(2);
      }
    } else {
      this.log.warn("AMPQ service is disabled");
    }
  }

  info(text: string) {
    if (!config.optimisticLiquidations) {
      this.send(`[INFO]:${text}`);
    }
    this.log.info(text);
  }

  error(text: string) {
    if (!config.optimisticLiquidations) {
      this.send(`[ERROR]:${text}`, true);
    }
    this.log.error(text);
  }

  protected send(text: string, important = false) {
    if (this.channel && this.routingKey) {
      const lastTime = this.sentMessages[text];
      if (lastTime && lastTime < Date.now() / 1000 + AMPQService.delay) {
        return;
      }
      this.sentMessages[text] = Date.now() / 1000;

      this.channel.publish(
        config.ampqExchange!,
        this.routingKey,
        Buffer.from(text),
        {
          appId: config.appName,
          headers: {
            important,
          },
          persistent: important,
          contentType: "text/plain",
          priority: important ? 9 : 4,
        },
      );
    }
  }
}

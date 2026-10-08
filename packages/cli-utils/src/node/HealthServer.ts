import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { type ILogger, json_stringify } from "@gearbox-protocol/sdk/onchain";
import {
  formatPrometheus,
  type PrometheusGauge,
  type PrometheusLabels,
} from "../health/formatPrometheus.js";
import type { HealthPayload, IBaseHealthResponse } from "../health/types.js";

/**
 * Options of {@link HealthServer}.
 *
 * @typeParam H - Full health response of the service
 */
export interface HealthServerOptions<
  H extends IBaseHealthResponse = IBaseHealthResponse,
> {
  /**
   * Port to listen on
   */
  port: number;
  /**
   * Host to listen on, defaults to `0.0.0.0`
   */
  host?: string;
  /**
   * Version of the service, reported in the health response and as a metric label
   */
  version: string;
  /**
   * Labels added to every metric, after `instance_id` and before `version`.
   *
   * Single-chain services pass `{ network: network.toLowerCase() }` here.
   */
  labels?: PrometheusLabels;
  /**
   * Logger for server lifecycle events and errors
   */
  logger: ILogger;
  /**
   * When true, the server does not keep the process alive on its own
   */
  unref?: boolean;
  /**
   * Returns the current health of the service. `undefined` means the service has not initialized yet,
   * then the health response contains only `startTime` and `version`.
   */
  status: () => HealthPayload<H> | undefined;
  /**
   * Returns service-specific gauges (e.g. `block_number`), emitted after `start_time` and `service_up`
   */
  gauges?: () => PrometheusGauge[];
}

/**
 * HTTP server that exposes service health.
 *
 * Routes:
 * - `GET /`: JSON health response, i.e. the result of {@link HealthServerOptions.status}
 *   with `startTime` and `version` filled in. Serialized with sdk `json_stringify`, so bigints survive a round trip through sdk `json_parse`.
 * - `GET /metrics`: Prometheus metrics: `start_time`, `service_up` and {@link HealthServerOptions.gauges}.
 *   Every sample is labeled with a random `instance_id`, {@link HealthServerOptions.labels} and `version`.
 * - anything else: 404
 *
 * @typeParam H - Full health response of the service
 */
export class HealthServer<H extends IBaseHealthResponse = IBaseHealthResponse> {
  readonly #opts: HealthServerOptions<H>;
  readonly #startTime = Math.round(Date.now() / 1000);
  readonly #instanceId = randomBytes(4).toString("hex");
  #server?: Server;

  constructor(opts: HealthServerOptions<H>) {
    this.#opts = opts;
  }

  /**
   * Time when the server was created, in unix seconds
   */
  public get startTime(): number {
    return this.#startTime;
  }

  /**
   * Starts listening. Errors are logged, not thrown.
   */
  public launch(): void {
    const { port, host = "0.0.0.0", unref, logger } = this.#opts;
    const server = createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json_stringify(this.#health()));
      } else if (req.url === "/metrics") {
        try {
          const metrics = this.#metrics();
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(metrics);
        } catch (e) {
          logger.error(e, "failed to collect metrics");
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("error");
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      }
    });
    server.on("error", e => {
      logger.error(e, "health server error");
    });
    server.listen({ host, port }, () => {
      logger.debug(`health server listening on ${host}:${port}`);
    });
    if (unref) {
      server.unref();
    }
    this.#server = server;
    logger.info("health server launched");
  }

  /**
   * Stops listening. Resolves immediately if the server was not launched.
   */
  public async stop(): Promise<void> {
    this.#opts.logger.info("health server stopping");
    return new Promise(resolve => {
      if (!this.#server) {
        resolve();
        return;
      }
      this.#server.close(() => resolve());
    });
  }

  #health(): Partial<H> {
    return {
      startTime: this.#startTime,
      version: this.#opts.version,
      ...this.#opts.status(),
    } as Partial<H>;
  }

  #metrics(): string {
    const { labels, version, gauges } = this.#opts;
    return formatPrometheus(
      [
        {
          name: "start_time",
          help: "Start time, in unixtime",
          samples: [{ value: this.#startTime }],
        },
        {
          name: "service_up",
          help: "Simple binary flag to indicate being alive",
          samples: [{ value: 1 }],
        },
        ...(gauges?.() ?? []),
      ],
      { instance_id: this.#instanceId, ...labels, version },
    );
  }
}

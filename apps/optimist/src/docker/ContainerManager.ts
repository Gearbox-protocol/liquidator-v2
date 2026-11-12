import { setTimeout } from "node:timers/promises";

import { uncensorMap } from "@gearbox-protocol/cli-utils";
import type { NetworkType } from "@gearbox-protocol/sdk/onchain";
import type {
  Container,
  ContainerCreateOptions,
  HostConfig,
  ImageInspectInfo,
} from "dockerode";
import Docker from "dockerode";
import retry from "p-retry";
import type { Logger as ILogger } from "pino";

import type { Config, LiquidatorConfig } from "../config";
import DI from "../di";
import { Logger } from "../logger";
import {
  CONTAINER_OUTPUT_DIR,
  EXECUTION_ID_LABEL,
  OPTIMISTIC_LABEL,
  PIPELINE_STAGES,
} from "./constants";
import docker from "./docker";
import type { AnvilOptions, ContainerInfo, ContainerResult } from "./types";

const PREFIX: Record<NetworkType, string> = {
  Arbitrum: "arb",
  Mainnet: "eth",
  Optimism: "opt",
  Base: "base",
  Sonic: "sonic",
  MegaETH: "mega",
  Monad: "monad",
  Berachain: "bera",
  Avalanche: "avax",
  BNB: "bnb",
  WorldChain: "world",
  Etherlink: "tez",
  Hemi: "hemi",
  Lisk: "lisk",
  Plasma: "plasma",
  Somnia: "somnia",
};

interface PullProgress {
  status: "Downloading" | "Extracting";
  progressDetail: { current: number; total: number };
  progress: string; // '[================================================>  ]  31.78MB/32.76MB'
  id: string;
}

@DI.Injectable(DI.Docker)
export class ContainerManager {
  @DI.Inject(DI.Config)
  public readonly config!: Config;

  @Logger("ContainerManager")
  public readonly logger!: ILogger;

  #docker = new Docker({
    socketPath: "/var/run/docker.sock",
    timeout: 30_000, // in ms
  });
  #images: Record<string, Promise<ImageInspectInfo>> = {};

  public async init(): Promise<void> {
    await this.#docker.ping();
    if (this.config.loki) {
      this.logger.debug("checking loki status");
      await retry(async () => {
        const plugins = await this.#docker.listPlugins();
        const loki = plugins.find(p => p.Name === "loki:latest");
        this.logger.debug(`Loki enabled: ${loki?.Enabled}`);
        if (!loki?.Enabled) {
          throw new Error("loki disabled or not found");
        }
      });
    }

    const networks = await this.#docker.listNetworks();
    const exists = networks.some(n => n.Name === this.#dockerNetwork);
    if (!exists) {
      throw new Error(`docker network ${this.#dockerNetwork} does not exist`);
    }
  }

  public async wait(
    containerId: string,
    pollInterval = 10_000,
  ): Promise<ContainerResult> {
    // this has stopped working for some reason
    // `docker wait <container id>` succeeds, but this just hangs forever:
    // const status = await container.wait();
    let running = true;
    let exitCode = -1;
    let error: unknown;
    const container = this.#docker.getContainer(containerId);
    while (running) {
      try {
        const info = await container.inspect();
        // "created" "running" "paused" "restarting" "removing" "exited" "dead"
        running = ["created", "running"].includes(info?.State?.Status);
        exitCode = info?.State?.ExitCode ?? -1;
      } catch (e) {
        running = false;
        error = e;
      }
      await setTimeout(running ? pollInterval : 0);
    }
    return { exitCode, error };
  }

  public async cleanup(executionId: string): Promise<void> {
    const containers = await this.#listOptimisticContainers(executionId);
    const names = containers.map(c => `${c.Names[0]} (${c.Id})`).join(", ");
    this.logger.debug(`cleanup ${names.length} containers: ${names}`);
    await Promise.allSettled(
      containers.map(async c => {
        const container = docker.getContainer(c.Id);
        try {
          // print stats to diagnose why we have stuck container
          const stats = await container.stats({
            stream: false,
            "one-shot": true,
          });
          this.logger.debug(stats, `stats for ${c.Names[0]} (${c.Id})`);
        } catch (e) {
          this.logger.error(
            `failed to get stats for ${c.Names[0]} (${c.Id}): ${e}`,
          );
        }
        await container.stop();
      }),
    );
  }

  public async stop(containerIds: string[]): Promise<void> {
    if (containerIds.length === 0) {
      return;
    }
    await Promise.allSettled(
      containerIds.map(id => docker.getContainer(id).stop()),
    );
  }

  public getAnvilURL(
    trackId: string,
    protocol: "http" | "ws" = "http",
  ): string {
    return `${protocol}://${this.#getAnvilName(trackId)}:8545`;
  }

  public async anvil(opts: AnvilOptions): Promise<ContainerInfo> {
    const {
      trackId,
      blockNumber,
      forkURL,
      image,
      disableRateLimit,
      anvilMemoryLimit,
    } = opts;
    const rateLimit = disableRateLimit
      ? ["--no-rate-limit"]
      : ["--compute-units-per-second", "600"];
    const memoryLimit = anvilMemoryLimit
      ? ["--memory-limit", (anvilMemoryLimit * 1024 * 1024).toString(10)]
      : [];
    return this.#run({
      name: this.#getAnvilName(trackId),
      Image: image,
      Entrypoint: [
        "timeout",
        this.config.timeout,
        "anvil",
        "--host",
        "0.0.0.0",
        "--fork-url",
        forkURL,
        "--fork-block-number",
        blockNumber.toString(10),
        "--timeout",
        "240000",
        "--retries",
        "20",
        "--disable-block-gas-limit",
        "--no-request-size-limit",
        ...rateLimit,
        ...memoryLimit,
        // "--prune-history",
      ],
      HostConfig: this.#getHostConfig(),
    });
  }

  public async liquidator(cfg: LiquidatorConfig): Promise<ContainerInfo> {
    const { id, env = {}, secrets = {}, imageTag } = cfg;
    const image = cfg.image || "ghcr.io/gearbox-protocol/liquidator-v2";
    return this.#run({
      forcePull: this.config.forcePullLiquidators,
      name: this.#getLiquidatorContainerName(id),
      Image: `${image}:${imageTag}`,
      Env: this.#getLiquidatorContainerEnv(`${image}:${imageTag}`, {
        APP_NAME: `optimistic_${id}`,
        OPTIMISTIC: "true",
        JSON_RPC_PROVIDERS: this.getAnvilURL(id),
        NETWORK: this.config.network,
        NODE_ENV: "production",
        LOG_LEVEL: this.config.logLevel,
        CAST_BIN: "/app/cast",

        OUT_DIR: CONTAINER_OUTPUT_DIR,
        OUT_FILE_NAME: `${id}.json`,

        ...env,
        ...uncensorMap(secrets),
      }),
      HostConfig: {
        ...this.#getHostConfig(),
        ...this.#logConfig(id),
      },
    });
  }

  async #run(
    options: ContainerCreateOptions & { forcePull?: boolean },
  ): Promise<ContainerInfo> {
    let imageVersion: string;
    if (!options.Image) {
      throw new Error("image not specified");
    }
    try {
      const image = await this.#ensureImage(options.Image, options.forcePull);
      this.logger.debug(`will use ${image.Id} for ${image.RepoTags}`);
      imageVersion = getImageVersion(image);
    } catch (e) {
      throw new Error(`failed to pull docker image ${options.Image}: ${e}`);
    }
    let container: Container;
    try {
      container = await retry(() =>
        this.#docker.createContainer({
          ...options,
          Labels: {
            ...options.Labels,
            [OPTIMISTIC_LABEL]: "1",
            [EXECUTION_ID_LABEL]: this.config.executionId,
          },
        }),
      );
    } catch (e) {
      throw new Error(`failed to create ${options.name}: ${e}`);
    }
    try {
      await container.start();
      this.logger.debug(
        { name: options.name, version: imageVersion },
        "started container",
      );
    } catch (e) {
      throw new Error(`failed to start ${options.name}: ${e}`);
    }
    return { imageVersion, id: container.id };
  }

  #logConfig(trackId: string): Pick<HostConfig, "LogConfig"> {
    const labels = Object.entries({
      execution_id: this.config.executionId,
      track: trackId,
      job: "optimist",
    })
      .filter(([_, v]) => !!v)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return {
      LogConfig: this.config.loki
        ? {
            Type: "loki",
            Config: {
              "loki-url": this.config.loki.url.value,
              "loki-external-labels": labels,
              "loki-pipeline-stages": PIPELINE_STAGES,
            },
          }
        : undefined,
    };
  }

  #getLiquidatorContainerEnv(
    image: string,
    env: Record<string, string>,
  ): string[] {
    const { addressProvider, marketConfigurators, rwaFactories } = this.config;
    const combinedEnv = {
      ADDRESS_PROVIDER: addressProvider,
      MARKET_CONFIGURATORS: marketConfigurators?.join(","),
      RWA_FACTORIES: rwaFactories?.join(","),
      // common env from config
      ...this.config.env,
      ...uncensorMap(this.config.secrets),
      // explicit env from liquidator config
      ...env,
    };
    const envKeys = Object.entries(combinedEnv)
      .filter(([_, v]) => !!v)
      .map(([k]) => k);
    this.logger.debug({ env: envKeys }, `env keys for ${image}`);
    return Object.entries(combinedEnv)
      .filter(([_, v]) => !!v)
      .map(([k, v]) => `${k}=${v}`);
  }

  async #listOptimisticContainers(
    executionId: string,
  ): Promise<Docker.ContainerInfo[]> {
    const containers = await docker.listContainers({
      filters: {
        label: [OPTIMISTIC_LABEL, `${EXECUTION_ID_LABEL}=${executionId}`],
      },
    });
    return containers;
  }

  async #ensureImage(
    imageTag: string,
    forcePull = false,
  ): Promise<ImageInspectInfo> {
    // to facilitate parallel pulls, cache promises
    if (imageTag in this.#images) {
      this.logger.debug(`${imageTag} image is already being pulled`);
      return this.#images[imageTag];
    }
    const promise = this.#pull(imageTag, forcePull);
    this.#images[imageTag] = promise;
    return promise;
  }

  async #pull(imageTag: string, force = false): Promise<ImageInspectInfo> {
    const image = this.#docker.getImage(imageTag);
    let info: ImageInspectInfo;
    try {
      info = await image.inspect();
      this.logger.debug(`found ${imageTag} v${getImageVersion(info)} locally`);
      if (force) {
        try {
          info = await this.#forcePull(imageTag);
        } catch (e) {
          this.logger.error(`force pull failed, but got local version: ${e}`);
        }
      }
    } catch {
      info = await this.#forcePull(imageTag);
    }
    this.logger.debug(`pulled ${imageTag} v${getImageVersion(info)} locally`);
    return info;
  }

  async #forcePull(imageTag: string): Promise<ImageInspectInfo> {
    this.logger.debug({ imageTag }, "pulling");
    const pullStream = await this.#docker.pull(imageTag);
    // Wait for pull to finish
    await new Promise(res => {
      this.#docker.modem.followProgress(
        pullStream,
        res,
        (prog: PullProgress) => {
          this.logger.debug(`${prog.status} ${imageTag} ${prog.progress}`);
        },
      );
    });
    return this.#docker.getImage(imageTag).inspect();
  }

  #getAnvilName(trackId: string): string {
    return [
      this.config.executionId,
      "anv",
      PREFIX[this.config.network],
      trackId,
    ]
      .filter(Boolean)
      .join("_")
      .toLowerCase();
  }

  #getLiquidatorContainerName(trackId: string): string {
    return [
      this.config.executionId,
      "liq",
      PREFIX[this.config.network],
      trackId,
    ]
      .filter(Boolean)
      .join("_")
      .toLowerCase();
  }

  #getHostConfig(): HostConfig {
    return {
      AutoRemove: true,
      NetworkMode: this.#dockerNetwork,
      Binds: [`${this.config.hostOutDir}:${CONTAINER_OUTPUT_DIR}`],
      ExtraHosts: ["host.docker.internal:host-gateway"],
    };
  }

  get #dockerNetwork(): string {
    if (!this.config.dockerNetwork) {
      return `optimist_${this.config.network}`.toLowerCase();
    }
    return this.config.dockerNetwork;
  }
}

function getImageVersion(image: ImageInspectInfo): string {
  return image.Config.Labels["org.opencontainers.image.version"] ?? "";
}

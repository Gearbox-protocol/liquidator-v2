import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addressLike,
  clientWhitelistItemSchema,
} from "@gearbox-protocol/cli-utils";
import type {
  AccountLabels,
  ExecutionReport,
  TrackReport,
  WhitelistEntry,
} from "@gearbox-protocol/liquidator-v2-config";
import {
  AddressSet,
  type Curator,
  json_stringify,
} from "@gearbox-protocol/sdk";
import axios, { isAxiosError } from "axios";
import parseDuration from "parse-duration";
import type { Logger as ILogger } from "pino";
import { z } from "zod/v4";
import { ExecutionAnalyzer, getSummary } from "./analysis";
import type { Config } from "./config";
import type { TaskCallback } from "./config/schema";
import DI from "./di";
import type { ContainerManager } from "./docker";
import { Logger } from "./logger";
import { Notifier } from "./notifier";
import Track from "./Track";
import type { ITrack, TypedSDK } from "./types";
import { marketsForCurator, timeout } from "./utils";

/**
 * Labels file is an array for convenience of editing, but is used as a lookup map
 */
const accountLabelsFileSchema = z
  .array(
    z.object({
      creditAccount: addressLike(),
      label: z.string(),
    }),
  )
  .transform(
    (entries): AccountLabels =>
      Object.fromEntries(entries.map(e => [e.creditAccount, e.label])),
  );

export default class Optimist {
  @DI.Inject(DI.Config)
  public readonly config!: Config;

  @DI.Inject(DI.Docker)
  public readonly docker!: ContainerManager;

  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  @Logger("Optimist")
  public readonly logger!: ILogger;

  #s3Client?: S3Client;

  #start = new Date();
  #tracks: ITrack[] = [];

  public async run(): Promise<void> {
    let exitCode = 0;
    try {
      const timeoutMs = parseDuration(this.config.timeout);
      if (!timeoutMs) {
        throw new Error(`invalid timeout expression: ${this.config.timeout}`);
      }

      await Promise.race([this.#run(), timeout(timeoutMs)]);
    } catch (e) {
      this.#reportError(e);
      exitCode = 1;
    } finally {
      await this.cleanup();
    }
    this.logger.flush(() => {
      process.exit(exitCode);
    });
  }

  public async cleanup(): Promise<void> {
    await this.docker.cleanup(this.config.executionId);
  }

  async #run(): Promise<void> {
    const executionReport: ExecutionReport = {
      id: this.config.executionId,
      start: this.#start,
      end: new Date(),
      tracks: [],
      results: [],
      sdkState: this.sdk.state,
      gasPrice: 0n,
    };
    try {
      await this.#init();
      executionReport.sdkState = this.sdk.state;
      executionReport.gasPrice = await this.sdk.client.getGasPrice();
      executionReport.whitelist = await this.#loadWhitelist();
      executionReport.accountLabels = await this.#loadAccountLabels();

      const delta = Math.ceil(Date.now() / 1000) - Number(this.sdk.timestamp);
      const blockTime = new Date(Number(this.sdk.timestamp) * 1000);

      this.logger.info(
        `Starting optimistic liquidation cycle on block ${this.sdk.currentBlock} @ ${blockTime} (delta ${delta}s)`,
      );
      const results = await Promise.all(
        this.#tracks.map(async t => {
          const result = await t.run(this.sdk.currentBlock);
          this.#reportProgress();
          return result;
        }),
      );
      executionReport.results = results.flatMap(t => t.results);
      executionReport.tracks = results.map(
        (t): TrackReport => ({
          id: t.id,
          name: t.name,
          emergency: !!this.config.liquidators[t.id]?.setup.emergencyMode,
          version: t.version,
          start: t.start,
          end: t.end,
        }),
      );
      this.logger.info("finished");
    } catch (e) {
      this.logger.error(e);
      executionReport.error = `${e}`;
    }
    executionReport.end = new Date();
    // output.json is conventional name for main output file of any testnet task
    const exFile = resolve(this.config.containerOutDir, "output.json");
    await writeFile(exFile, json_stringify(executionReport), "utf-8");
    this.logger.info(`saved execution result to ${exFile}`);
    await this.#analyze(executionReport);
    await this.#uploadArtifacts();
    await this.#notifyAnvilManager(executionReport);
    this.logger.info(`Execution ${this.config.executionId} finished`);
  }

  async #init(): Promise<void> {
    await mkdir(this.config.containerOutDir, { recursive: true });
    this.logger.debug(
      {
        containerOutDir: this.config.containerOutDir,
        hostOutDir: this.config.hostOutDir,
      },
      "created output dir",
    );
    await this.docker.init();

    const optimisticTimestamp = this.#getOptimisticTimestamp();

    this.#tracks = Object.values(this.config.liquidators).map(
      t => new Track({ ...t, optimisticTimestamp }),
    );
    this.logger.debug({ tracks: this.#tracks.length }, "created tracks");
    this.#callback({ progress: { completed: 0, total: this.#tracks.length } });
  }

  /**
   * Upload artifacts to s3
   * Do it here, because liquidators can produce arbitrary artifacts (e.g. transaction traces)
   * @returns
   */
  async #uploadArtifacts(): Promise<void> {
    if (!this.config.s3) {
      return;
    }
    let artifacts: string[] = [];
    try {
      artifacts = await readdir(this.config.containerOutDir);
    } catch (e) {
      this.logger.warn(e);
    }
    this.logger.debug(`uploading ${artifacts.length} artifacts to s3`);
    for (let i = 0; i < artifacts.length; i++) {
      const artifact = artifacts[i];
      this.logger.debug(`uploading ${artifact} ${i}/${artifacts.length}`);
      const key = await this.#uploadArtifact(artifact);
      this.logger.debug(
        `uploaded ${artifact} ${i + 1}/${artifacts.length} to ${key}`,
      );
    }
    this.logger.debug("uploaded all artifacts");
  }

  async #uploadArtifact(artifact: string): Promise<string | undefined> {
    const {
      bucket,
      prefix,
      artifactsDir,
      endpoint,
      accessKey,
      region,
      secretKey,
      forcePathStyle,
    } = this.config.s3!;
    const Key = [prefix, this.config.executionId, artifactsDir, artifact]
      .filter(Boolean)
      .join("/");
    try {
      if (!this.#s3Client) {
        const cfg: S3ClientConfig = { endpoint, region, forcePathStyle };
        if (secretKey && accessKey) {
          cfg.credentials = {
            accessKeyId: accessKey.value,
            secretAccessKey: secretKey.value,
          };
        }
        this.#s3Client = new S3Client(cfg);
      }
      const stream = createReadStream(
        resolve(this.config.containerOutDir, artifact),
      );
      const command: PutObjectCommand = new PutObjectCommand({
        Bucket: bucket,
        Key,
        Body: stream,
      });
      await this.#s3Client.send(command);
      return Key;
    } catch (e) {
      this.logger.warn(e);
    }
  }

  async #analyze(executionReport: ExecutionReport): Promise<void> {
    // should cache results shared by curators
    const analyzer = new ExecutionAnalyzer();
    for (const n of this.config.notifications) {
      const report = this.#filterExecutionReport(
        executionReport,
        n.curator as Curator,
      );
      if (!report) {
        this.logger.warn(
          `nothing to report for ${n.curator} on ${this.config.network}`,
        );
        continue;
      }
      const notifier = new Notifier(n);
      const fails = await analyzer.check(report, n.curator as Curator);
      await notifier.notify(report, fails);
    }
  }

  async #loadWhitelist(): Promise<WhitelistEntry[]> {
    const { anvilManagerApiURL, network } = this.config;
    if (!anvilManagerApiURL) {
      return [];
    }
    const endpoint = `${anvilManagerApiURL}/whitelist/liquidator/${network}`;
    try {
      const resp = await axios.get(endpoint);
      const result = z.array(clientWhitelistItemSchema).parse(resp.data);
      this.logger.info(
        `loaded ${result.length} whitelist entries for ${network}`,
      );
      return result;
    } catch (e) {
      this.logger.warn(e);
      return [];
    }
  }

  /**
   * Loads credit account labels from json file, if it's configured
   * Unreadable or malformed file is not fatal, execution continues without labels
   */
  async #loadAccountLabels(): Promise<AccountLabels> {
    const { accountLabelsFile } = this.config;
    if (!accountLabelsFile) {
      return {};
    }
    try {
      const content = await readFile(accountLabelsFile, "utf-8");
      const result = accountLabelsFileSchema.parse(JSON.parse(content));
      this.logger.info(
        `loaded ${Object.keys(result).length} account labels from ${accountLabelsFile}`,
      );
      return result;
    } catch (e) {
      this.logger.warn(
        `failed to load account labels from '${accountLabelsFile}': ${e}`,
      );
      return {};
    }
  }

  #filterExecutionReport(
    executionReport: ExecutionReport,
    curator?: Curator,
  ): ExecutionReport | undefined {
    // default to all curators (aka Gearbox internal)
    if (!curator) {
      return executionReport;
    }
    const markets = marketsForCurator(this.sdk, curator);
    const managers = new AddressSet(
      markets?.flatMap(m => m.creditManagers.map(c => c.creditManager.address)),
    );
    if (managers.size === 0) {
      this.logger.warn(`no credit managers found for curator ${curator}`);
      return undefined;
    }
    return {
      ...executionReport,
      results: executionReport.results.filter(r =>
        managers.has(r.creditManager),
      ),
    };
  }

  async #notifyAnvilManager(report: ExecutionReport): Promise<void> {
    if (!this.config.anvilManagerApiURL) {
      return;
    }
    const endpoint = `${this.config.anvilManagerApiURL}/scheduled-optimist`;
    const auth: Record<string, string> = this.config.anvilManagerAPIKey
      ? { Authorization: `Bearer ${this.config.anvilManagerAPIKey.value}` }
      : {};
    this.logger.debug(
      { auth: !!this.config.anvilManagerAPIKey },
      `notifying anvil-manager at ${endpoint}`,
    );
    try {
      const summary = getSummary(report);
      const resp = await axios.post(endpoint, summary, {
        headers: auth,
        timeout: 10_000,
      });
      if (resp.status === 200) {
        this.logger.info(summary, "notified anvil-manager");
      } else {
        this.logger.error(
          `failed to notify anvil-manager: ${resp.status} ${resp.statusText}`,
        );
      }
    } catch (e) {
      if (isAxiosError(e)) {
        this.logger.error(`failed to notify anvil-manager: ${e.message}`);
      } else {
        this.logger.error(`failed to notify anvil-manager: ${e}`);
      }
    }
  }

  #getOptimisticTimestamp(): number {
    // https://github.com/redstone-finance/redstone-oracles-monorepo/blob/c7569a8eb7da1d3ad6209dfcf59c7ca508ea947b/packages/sdk/src/request-data-packages.ts#L82
    // we round the timestamp to full minutes for being compatible with
    // oracle-nodes, which usually work with rounded 10s and 60s intervals
    //
    // Also, when forking anvil->anvil (when running on testnets) block.timestamp can be in future because min ts for block is 1 seconds,
    // and scripts can take dozens of blocks (hundreds for faucet). So we take min value;
    const nowMs = Date.now();
    const redstoneIntervalMs = 60_000;
    const anvilTsMs =
      redstoneIntervalMs *
      Math.floor((Number(this.sdk.timestamp) * 1000) / redstoneIntervalMs);
    const fromNowTsMs =
      redstoneIntervalMs * Math.floor(nowMs / redstoneIntervalMs - 1);
    const optimisticTimestamp = Math.min(anvilTsMs, fromNowTsMs);
    const deltaS = Math.floor((nowMs - optimisticTimestamp) / 1000);
    this.logger.info(
      { tag: "timing" },
      `will use optimistic timestamp: ${new Date(optimisticTimestamp)} (${optimisticTimestamp}, delta: ${deltaS}s)`,
    );
    return optimisticTimestamp;
  }

  #reportError(e: unknown): void {
    this.logger.error(e);
    this.#callback({ error: `${e}` });
  }

  #reportProgress(): void {
    const progress: Array<{ id: string; status: string }> = [];
    let completed = 0;
    for (const t of this.#tracks) {
      progress.push({ id: t.id, status: t.status });
      completed += t.completed ? 1 : 0;
    }
    this.logger.info({ progress }, "tracks progress");
    this.#callback({ progress: { completed, total: this.#tracks.length } });
  }

  #callback(payload: TaskCallback): void {
    if (!this.config.taskCallbackURL) {
      return;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.taskToken) {
      headers.Authorization = `Bearer ${this.config.taskToken.value}`;
    }
    fetch(this.config.taskCallbackURL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })
      .then(() => {
        this.logger.debug(payload, "task callback sent");
      })
      .catch(e => {
        this.logger.error(`failed to call task callback: ${e}`);
      });
  }
}

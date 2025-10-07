# Gearbox Liquidator

Liquidator designed for V3.1 version. 

## Liquidations mode

Set via `--liquidation-mode` cli flag or `LIQUIDATION_MODE` env var.

Possible values:

- `full` - accounts are liquidated fully 
- `partial` - some assets are sold to bring account's health factor above 1
- `batch` - similar to `full`, but many accounts can be liquidated with single transaction (discontinued)
- `deleverage` - similar to `partial`, but triggered when HF drops below certain minimum, and tries to bring it close to certain maximum. (not yet implemented fully)

## Optimistic Liquidations

Liqudator has special optimitic (`--optimistic` cli flag, or `OPTIMISTIC=true` env variable) mode which is designed to predict potential problem with liqudation. To run optimistic liquidations, you'll need to use anvil form as json rpc provider. For full/batch mode you'll need to run script to bring LTs of collateral tokens to zero, thus bringing HF of all accounts to zero and making them liquidatable. For partial/deleverage mode liquidator will simulate LT changes that trigger HF drop below 1. Then liquidator makes network state snapshot and liquidation account one by one, reverting to saved snapshot each time liquidation was done.

After testing all liquidation, it exists and save json file or uploads it to S3.

This mode increases protocol security showing potential problems with liquidations before they happened.

## How to launch

The liquidator is distributed as [docker image](https://github.com/Gearbox-protocol/liquidator-v2/pkgs/container/liquidator-v2)

To pass options you can use env variables, cli flags as docker command, or create `config.yaml` file and pass `--config config.yaml` cli flag

For example, write some options to .env file, and pass some more via cli flags

```bash
docker run --env-file .env ghcr.io/gearbox-protocol/liquidator-v2:latest --optimistic --slippage 100
```

## Configuration options

### RPC providers

Following cli flags/env variables are used to configure RPC providers:

```
--json-rpc-providers <urls...>               RPC providers to use, comma separated full http urls (env variable JSON_RPC_PROVIDERS)
--enabled-providers <providers...>           Keyed RPC providers to use, comma separated, order matters (env variable ENABLED_PROVIDERS)
--alchemy-keys <keys...>                     Alchemy API keys to use, comma separated (env variable ALCHEMY_KEYS)
--drpc-keys <keys...>                        DRPC API keys to use, comma separated (env variable DRPC_KEYS)
--ankr-keys <keys...>                        Ankr API keys to use, comma separated (env variable ANKR_KEYS)
--thirdweb-keys <keys...>                    Thirdweb API keys to use, comma separated (env variable THIRDWEB_KEYS)
```

For example `--json-rpc-providers http://127.0.0.1:8545 --alchemy-keys xxx,yyy --drpc-keys zzz --enabled-providers alchemy,drpc,custom` will use alchemy as preferred provider, if it fails, will try to switch to drpc, and as a last resort will try to use local rpc. 

### General config

```
--network <network>                          Gearbox-supported network (env variable NETWORK)
--address-provider <address>                 Address provider override, uses default value from SDK otherwise (env variable ADDRESS_PROVIDER)
--market-configurators <addresses...>        Market configurators to use for the process, comma separated. Uses default value from SDK if not specified (env variable MARKET_CONFIGURATORS)
--app-name <name>                            App name used in various messages to distinguish instances (env variable APP_NAME)
--port <port>                                Port to expose some vital signals and metrics (env variable PORT)
--ignore-accounts <addresses...>             These accounts will not be liquidated (env variable IGNORE_ACCOUNTS)
--debug-account <address>                    Only check this account during local debug session (env variable DEBUG_ACCOUNT)
--debug-manager <address>                    Only check this credit manager during local debug session (env variable DEBUG_MANAGER)
--stale-block-threshold <threshold>          Stale block threshold in seconds, to notify and try to rotate rpc provider. 0 means no monitoring (env variable STALE_BLOCK_THRESHOLD)
--logs-page-size <size>                      Max block range size for eth_getLogs (env variable LOGS_PAGE_SIZE)
--polling-interval <interval>                Polling interval in milliseconds, default to what's default in viem (env variable POLLING_INTERVAL)
--private-key <key>                          Private key used to send liquidation transactions (env variable PRIVATE_KEY)
--min-balance <balance>                      Minimum balance to liquidate (env variable MIN_BALANCE)
--hf-threshold <threshold>                   Filter out all accounts with HF >= threshold during scan stage (env variable HF_THRESHOLD)
--num-splits <splits>                        Default numSplits for router v3.1 contract (env variable NUM_SPLITS)
--liquidation-mode <mode>                    Liquidator mode (full/partial/batch/deleverage) (env variable LIQUIDATION_MODE)
--ignore-missing-feeds                       Ignore missing feeds (redstone/pyth) (env variable IGNORE_MISSING_FEEDS)
--dry-run                                    Do not send transactions in non-optimistic mode, just log them (env variable DRY_RUN)
--redstone-gateways <urls...>                Redstone gateways to use, comma separated (env variable REDSTONE_GATEWAYS)
--compressor-batch-size <size>               Limit number of accounts to load from compressor. 0 = unlimited, let compressor decide (env variable COMPRESSOR_BATCH_SIZE)
--slippage <value>                           Slippage value for pathfinder (env variable SLIPPAGE)
--update-reserve-prices                      Update reserve prices (env variable UPDATE_RESERVE_PRICES)
--restaking-workaround                       Flag to enable less eager liquidations for LRT tokens (env variable RESTAKING_WORKAROUND)
--lsk-eth-workaround                         Flag to enable lsk workaround (env variable LSKETH_WORKAROUND)
--keep-assets <assets...>                    List of assets to keep on account after liquidation (env variable KEEP_ASSETS)
--telegram-bot-token <token>                 Telegram bot token used to send notifications (env variable TELEGRAM_BOT_TOKEN)
--telegram-alerts-channel <channel>          Telegram channel where bot will post critical notifications (env variable TELEGRAM_ALERTS_CHANNEL)
--telegram-notifications-channel <channel>   Telegram channel where bot will post non-critical notifications (env variable TELEGRAM_NOTIFICATIONS_CHANNEL)
--aave-partial-liquidator-address <address>  Address of deployed partial liquidator contract for all credit managers except for GHO- and DOLA- based (env variable AAVE_PARTIAL_LIQUIDATOR_ADDRESS)
--gho-partial-liquidator-address <address>   Address of deployed partial liquidator contract for GHO credit managers (env variable GHO_PARTIAL_LIQUIDATOR_ADDRESS)
--dola-partial-liquidator-address <address>  Address of deployed partial liquidator contract for DOLA credit managers (env variable DOLA_PARTIAL_LIQUIDATOR_ADDRESS)
--nexo-partial-liquidator-address <address>  Address of deployed partial liquidator contract for Nexo credit managers (env variable NEXO_PARTIAL_LIQUIDATOR_ADDRESS)
--silo-partial-liquidator-address <address>  Address of deployed partial liquidator contract for Silo credit managers (env variable SILO_PARTIAL_LIQUIDATOR_ADDRESS)
--partial-fallback                           Fallback to use full liquidator when partial liquidator fails (env variable PARTIAL_FALLBACK)
--target-partial-hf <hf>                     Desired HF after partial liquidation, with 4 decimals (100% = 10000) (env variable TARGET_PARTIAL_HF)
--calculate-partial-hf <tokens>              Optimal HF for partial liquidation will be calculated for accounts with following underlying tokens (env variable CALCULATE_PARTIAL_HF)
--batch-size <size>                          Number of accounts to liquidate at once using batch liquidator (env variable BATCH_SIZE)
--batch-liquidator-address <address>         Address of deployed batch liquidator contract (env variable BATCH_LIQUIDATOR_ADDRESS)
--partial-liquidation-bot <address>          Address of the partial liquidation bot (for deleverage) (env variable PARTIAL_LIQUIDATION_BOT)
--config [file]                              config file
```

### Optimistic mode

```
--optimistic                                 Enable optimistic liquidations (env variable OPTIMISTIC)
--optimistic-timestamp <timestamp>           Optimistic timestamp to pass from external runner, in ms (env variable OPTIMISTIC_TIMESTAMP)
--out-dir <dir>                              Directory to save json with optimistic liquidation results (env variable OUT_DIR)
--out-endpoint <url>                         REST endpoint to POST json with optimistic liquidation results (env variable OUT_ENDPOINT)
--out-headers <headers>                      Headers for REST endpoint (env variable OUT_HEADERS)
--out-s3-bucket <bucket>                     S3 bucket to upload json with optimistic liquidation results (env variable OUT_S3_BUCKET)
--out-s3-prefix <prefix>                     S3 bucket path prefix (env variable OUT_S3_PREFIX)
--out-file-name <name>                       Filename of json with optimistic liquidation results for s3 or dir output (env variable OUT_FILE_NAME)
--cast-bin <path>                            Path to foundry/cast binary, so that we can create tree-like traces in case of errors (env variable CAST_BIN)
```

## Important information for contributors

As a contributor to the Gearbox Protocol GitHub repository, your pull requests indicate acceptance of our Gearbox Contribution Agreement. This agreement outlines that you assign the Intellectual Property Rights of your contributions to the Gearbox Foundation. This helps safeguard the Gearbox protocol and ensure the accumulation of its intellectual property. Contributions become part of the repository and may be used for various purposes, including commercial. As recognition for your expertise and work, you receive the opportunity to participate in the protocol's development and the potential to see your work integrated within it. The full Gearbox Contribution Agreement is accessible within the [repository](/ContributionAgreement) for comprehensive understanding. [Let's innovate together!]

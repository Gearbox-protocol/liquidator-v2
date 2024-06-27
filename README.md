# Gearbox Liquidation node V2

Liquidation node designed for V2 version. Liquidador uses Gearbox Smart Router to find optimal ways how to sell all assets into underlying one.

## Optimistic Liquidations

Liqudator has special "OPTIMITIC" mode which is designed to predict potential problem with liqudation. Liquidation is run in this mode on fork net only, after running script which set all liquidation threshold to zero, what makes all credit account liquidatable. Then liquidator makes network state snapshot and liquidation account one by one, revetrting to saved snapshot each time liquidation was done.

After testing all liquidation, it exists and save json file or send it on server via POST request.

This mode increases protocol security showing potential problems with liquidations before they happened.

## How to configure

Use environment variables to configure bot

| Environment Variable Name              | Description                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- |
| ADDRESS_PROVIDER                       | Address provider address override (optional)                                |
| APP_NAME                               | Application name, for logging                                               |
| DEBUG_ACCOUNTS                         | Debug accounts (optional)                                                   |
| DEBUG_MANAGERS                         | Debug managers (optional)                                                   |
| CAST_BIN                               | Path to foundry/cast binary (optional)                                      |
| DEPLOY_PARTIAL_LIQUIDATOR              | Deploy partial liquidator contracts (optional)                              |
| JSON_RPC_PROVIDERS / JSON_RPC_PROVIDER | Ethereum provider RPCs (optional)                                           |
| HF_TRESHOLD                            | HF threshold, default is 65536                                              |
| RESTAKING_WORKAROUND                   | Restaking workaround (optional)                                             |
| MIN_BALANCE                            | Minimum balance for notification, default is 500000000000000000n (optional) |
| ONE_INCH_API_KEY                       | 1inch API key (optional)                                                    |
| OPTIMISTIC                             | Optimistic liquidations (optional)                                          |
| OUT_DIR                                | Output directory, default is "."                                            |
| OUT_ENDPOINT                           | Output endpoint URL (optional)                                              |
| OUT_HEADERS                            | Output headers, default is "{}"                                             |
| OUT_FILE_NAME                          | Output file name for optimistic liquidator                                  |
| OUT_S3_BUCKET                          | Output S3 bucket (optional)                                                 |
| OUT_S3_PREFIX                          | Output S3 prefix, default is ""                                             |
| PARTIAL_LIQUIDATOR_ADDRESS             | Partial liquidator address (optional)                                       |
| PRIVATE_KEY                            | Private key                                                                 |
| PORT                                   | Port number, default is 4000                                                |
| SLIPPAGE                               | Slippage, default is 50                                                     |
| SWAP_TO_ETH                            | Swap to ETH method, can be "1inch" or "uniswap" (optional)                  |
| TELEGRAM_BOT_TOKEN                     | Telegram bot token (optional)                                               |
| TELEGRAM_NOTIFICATIONS_CHANNEL         | Telegram notifications channel, must start with "-" (optional)              |
| TELEGRAM_ALERTS_CHANNEL                | Telegram alerts channel, must start with "-" (optional)                     |

## How to launch

The liquidator is distributed as [docker image](https://github.com/Gearbox-protocol/liquidator-v2/pkgs/container/liquidator-v2)

For example, write your config into `.env` file and then run:

```bash
docker run --env-file .env ghcr.io/gearbox-protocol/liquidator-v2:latest
```

### In normal mode

Set required env variables. Do not enable `OPTIMISTIC_LIQUIDATIONS`, `OUT_*` variables are not required.

### In optimistic mode

Set required env variables. Set `OPTIMISTIC_LIQUIDATIONS` to `true`, configure `OUT_*` variables for your desired output format.

### Important information for contributors

As a contributor to the Gearbox Protocol GitHub repository, your pull requests indicate acceptance of our Gearbox Contribution Agreement. This agreement outlines that you assign the Intellectual Property Rights of your contributions to the Gearbox Foundation. This helps safeguard the Gearbox protocol and ensure the accumulation of its intellectual property. Contributions become part of the repository and may be used for various purposes, including commercial. As recognition for your expertise and work, you receive the opportunity to participate in the protocol's development and the potential to see your work integrated within it. The full Gearbox Contribution Agreement is accessible within the [repository](/ContributionAgreement) for comprehensive understanding. [Let's innovate together!]

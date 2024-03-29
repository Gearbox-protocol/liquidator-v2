# Gearbox Liquidation node V2

Liquidation node designed for V2 version. Liquidador uses Gearbox Smart Router to find optimal ways how to sell all assets into underlying one.

## Optimistic Liquidations

Liqudator has special "OPTIMITIC" mode which is designed to predict potential problem with liqudation. Liquidation is run in this mode on fork net only, after running script which set all liquidation threshold to zero, what makes all credit account liquidatable. Then liquidator makes network state snapshot and liquidation account one by one, revetrting to saved snapshot each time liquidation was done.

After testing all liquidation, it exists and save json file or send it on server via POST request.

This mode increases protocol security showing potential problems with liquidations before they happened.

## How to configure

Use environment variables to configure bot

| Variable                | Required | Example                                      | Description                                                                                                                                                                       |
| ----------------------- | -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APP_NAME                |          | `Terminator2`                                | App name to use in logs                                                                                                                                                           |
| PORT                    |          | `4000`                                       | Healthcheck endpoint port                                                                                                                                                         |
| ADDRESS_PROVIDER        | ✅       | `0x95f4cea53121b8A2Cb783C6BFB0915cEc44827D3` | Override address provider address (defaults to address from SDK)                                                                                                                  |
| JSON_RPC_PROVIDERS      | ✅       | `https://goerli.infura.io/v3/<key>`          | Comma-separated list of ethereum JSON RPC endpoints                                                                                                                               |
| FLASHBOTS_RPC           |          | `https://rpc.flashbots.net`                  | Optional flashbots RPC endpoint for frontrunning protection (https://docs.flashbots.net/flashbots-protect/overview)                                                               |
| JSON_RPC_TIMEOUT        |          | `240000`                                     | JSONRPC calls timeout With freshly started fork first requests often fail with default ethers.js timeout of 120 seconds. In this case, increase this timeout (the value is in ms) |
| PRIVATE_KEY             | ✅       | `<private_key>`                              | Private key for core wallet                                                                                                                                                       |
| WALLET_PASSWORD         | ✅       | `<password>`                                 | Password for keys storage                                                                                                                                                         |
| HF_TRESHOLD             |          | `9950`                                       | Health factor threshold for liquidations                                                                                                                                          |
| UNDERLYING              |          | `DAI`                                        | If set, liquidator will only work with credit manager for this underlying token symbol                                                                                            |
| CLOUDAMQP_URL           |          | `amqps://host:port`                          | AMQP instance to send logs to                                                                                                                                                     |
| AMPQ_EXCHANGE           |          | `GOERLI`                                     | AMQP exchange to send logs to                                                                                                                                                     |
| SKIP_BLOCKS             |          | `3`                                          | How many block should be skipped before next check in normal mode                                                                                                                 |
| MULTICALL_CHUNK         |          | `30`                                         | Multicall chunk size used when getting accounts data                                                                                                                              |
| KEY_PATH                | ✅       | `/foo/bar`                                   | Directory with wallet keys. Either this or `KEY_SECRET` is required.                                                                                                              |
| KEY_SECRET              |          | `<secret-id>`                                | AWS Secrets Manager secret id for wallet keys                                                                                                                                     |
| OPTIMISTIC_LIQUIDATIONS |          | `true`                                       | Set to `true` to enable optimistic mode                                                                                                                                           |
| EXECUTORS_QTY           |          | `3`                                          | How many executors who send liquidation transactions in parallel                                                                                                                  |
| SWAP_TO_ETH             |          | `uniswap`/`1inch`                            | If set, will try to swap underlying token to ETH after liquidation (only in optimistic mode)                                                                                      |
| BALANCE_TO_NOTIFY       |          | `0`                                          | Minimum ETH balance, when signer has less, it will send notifications in AMPQ                                                                                                     |
| SLIPPAGE                |          | `0`                                          | Slippage for finding path [0;1] represents 0-100%                                                                                                                                 |
| LOG_LEVEL               |          | `debug`                                      | Min log level                                                                                                                                                                     |
| OUT_SUFFIX              |          | `ts`                                         | Output suffix to distinguish outputs of different liquidators                                                                                                                     |
| OUT_DIR                 |          | `/foo/bar`                                   | Directory to output logs, leave empty if you don't need file output. Only one of `OUT_DIR`, `OUT_ENDPOINT`, `OUT_S3_BUCKET` will be used                                          |
| OUT_ENDPOINT            |          | `https://dump.logs.io/here`                  | Endpoint to send POST-request with output                                                                                                                                         |
| OUT_HEADERS             |          | `{"Authorization": "Bearer XXX"}`            | HTTP headers to send with POST request. Serialized as JSON: `{"header1": "value1", "header2": "value2"}`                                                                          |
| OUT_S3_BUCKET           |          | `my_bucket`                                  | S3 bucket to upload result to                                                                                                                                                     |
| OUT_S3_PREFIX           |          | `optimistc`                                  | S3 path prefix                                                                                                                                                                    |

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

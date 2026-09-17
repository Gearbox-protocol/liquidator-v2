//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AaveFLTaker
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aaveFlTakerAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_aavePool", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "aavePool",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "allowedFLReceiver",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "receiver", internalType: "address", type: "address" },
      { name: "status", internalType: "bool", type: "bool" },
    ],
    name: "setAllowedFLReceiver",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "asset", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "takeFlashLoan",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "consumer",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      { name: "status", internalType: "bool", type: "bool", indexed: false },
    ],
    name: "SetAllowedFLReceiver",
  },
  { type: "error", inputs: [], name: "CallerNotAllowedReceiverException" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AaveFrxUSDLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aaveFrxUsdLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_aavePool", internalType: "address", type: "address" },
      { name: "_aaveFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "FRXUSD",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "FRXUSD_CUSTODIAN",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "USDC",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aaveFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aavePool",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "assets", internalType: "address[]", type: "address[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
      { name: "premiums", internalType: "uint256[]", type: "uint256[]" },
      { name: "initiator", internalType: "address", type: "address" },
      { name: "params", internalType: "bytes", type: "bytes" },
    ],
    name: "executeOperation",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AaveFrxUSDUnwinder
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aaveFrxUsdUnwinderAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_aavePool", internalType: "address", type: "address" },
      { name: "_aaveFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "FRXUSD",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "FRXUSD_CUSTODIAN",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "USDC",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aaveFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aavePool",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "assets", internalType: "address[]", type: "address[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
      { name: "premiums", internalType: "uint256[]", type: "uint256[]" },
      { name: "initiator", internalType: "address", type: "address" },
      { name: "params", internalType: "bytes", type: "bytes" },
    ],
    name: "executeOperation",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AaveLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aaveLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_aavePool", internalType: "address", type: "address" },
      { name: "_aaveFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "aaveFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aavePool",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "assets", internalType: "address[]", type: "address[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
      { name: "premiums", internalType: "uint256[]", type: "uint256[]" },
      { name: "initiator", internalType: "address", type: "address" },
      { name: "params", internalType: "bytes", type: "bytes" },
    ],
    name: "executeOperation",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AaveUnwinder
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aaveUnwinderAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_aavePool", internalType: "address", type: "address" },
      { name: "_aaveFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "aaveFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "aavePool",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "assets", internalType: "address[]", type: "address[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
      { name: "premiums", internalType: "uint256[]", type: "uint256[]" },
      { name: "initiator", internalType: "address", type: "address" },
      { name: "params", internalType: "bytes", type: "bytes" },
    ],
    name: "executeOperation",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// BatchLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const batchLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [{ name: "_owner", internalType: "address", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {
        name: "params",
        internalType: "struct RouterLiqParams[]",
        type: "tuple[]",
        components: [
          { name: "creditAccount", internalType: "address", type: "address" },
          {
            name: "tData",
            internalType: "struct TokenData[]",
            type: "tuple[]",
            components: [
              { name: "token", internalType: "address", type: "address" },
              { name: "balance", internalType: "uint256", type: "uint256" },
              {
                name: "leftoverBalance",
                internalType: "uint256",
                type: "uint256",
              },
              { name: "numSplits", internalType: "uint256", type: "uint256" },
              { name: "claimRewards", internalType: "bool", type: "bool" },
            ],
          },
          { name: "slippage", internalType: "uint256", type: "uint256" },
          {
            name: "priceUpdates",
            internalType: "struct PriceUpdate[]",
            type: "tuple[]",
            components: [
              { name: "priceFeed", internalType: "address", type: "address" },
              { name: "data", internalType: "bytes", type: "bytes" },
            ],
          },
        ],
      },
    ],
    name: "estimateBatch",
    outputs: [
      {
        name: "results",
        internalType: "struct LiquidationResult[]",
        type: "tuple[]",
        components: [
          { name: "creditAccount", internalType: "address", type: "address" },
          { name: "pathFound", internalType: "bool", type: "bool" },
          { name: "executed", internalType: "bool", type: "bool" },
          { name: "profit", internalType: "uint256", type: "uint256" },
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "isWhitelisted",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {
        name: "params",
        internalType: "struct LiqParams[]",
        type: "tuple[]",
        components: [
          { name: "creditFacade", internalType: "address", type: "address" },
          { name: "creditAccount", internalType: "address", type: "address" },
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
        ],
      },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "liquidateBatch",
    outputs: [{ name: "success", internalType: "bool[]", type: "bool[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "account", internalType: "address", type: "address" },
      { name: "status", internalType: "bool", type: "bool" },
    ],
    name: "setWhitelistedStatus",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      { name: "status", internalType: "bool", type: "bool", indexed: false },
    ],
    name: "SetWhitelistedStatus",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GhoFMTaker
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ghoFmTakerAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_ghoFlashMinter", internalType: "address", type: "address" },
      { name: "_gho", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "allowedFMReceiver",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "gho",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "ghoFlashMinter",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "receiver", internalType: "address", type: "address" },
      { name: "status", internalType: "bool", type: "bool" },
    ],
    name: "setAllowedFMReceiver",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "takeFlashMint",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "consumer",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      { name: "status", internalType: "bool", type: "bool", indexed: false },
    ],
    name: "SetAllowedFMReceiver",
  },
  { type: "error", inputs: [], name: "CallerNotAllowedReceiverException" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GhoLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ghoLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_ghoFlashMinter", internalType: "address", type: "address" },
      { name: "_ghoFMTaker", internalType: "address", type: "address" },
      { name: "_gho", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "CALLBACK_SUCCESS",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "gho",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "ghoFMTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "ghoFlashMinter",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "initiator", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "fee", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onFlashLoan",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GhoUnwinder
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ghoUnwinderAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_ghoFlashMinter", internalType: "address", type: "address" },
      { name: "_ghoFMTaker", internalType: "address", type: "address" },
      { name: "_gho", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "CALLBACK_SUCCESS",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "gho",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "ghoFMTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "ghoFlashMinter",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "initiator", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "fee", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onFlashLoan",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IGhoFlashMinter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iGhoFlashMinterAbi = [
  {
    type: "function",
    inputs: [
      { name: "receiver", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "flashLoan",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IMorphoFlashLoan
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iMorphoFlashLoanAbi = [
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "assets", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "flashLoan",
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IPartialLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iPartialLiquidatorAbi = [
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmount", internalType: "uint256", type: "uint256" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "amountOut", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "amountOut", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ISiloFlashLoan
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iSiloFlashLoanAbi = [
  {
    type: "function",
    inputs: [
      { name: "receiver", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "flashLoan",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MorphoLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const morphoLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_morpho", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "morpho",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onMorphoFlashLoan",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MorphoUnwinder
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const morphoUnwinderAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_morpho", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "morpho",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onMorphoFlashLoan",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SecuritizeLiquidatorHelper
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const securitizeLiquidatorHelperAbi = [
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "redemptionGateway", internalType: "address", type: "address" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "canLiquidateViaStablecoins",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "redemptionGateway", internalType: "address", type: "address" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "liquidateViaStablecoins",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "redemptionGateway", internalType: "address", type: "address" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "previewLiquidatePendingRedemption",
    outputs: [
      {
        name: "result",
        internalType: "struct PreviewResult",
        type: "tuple",
        components: [
          { name: "canLiquidate", internalType: "bool", type: "bool" },
          {
            name: "requiredUnderlying",
            internalType: "uint256",
            type: "uint256",
          },
          { name: "dsTokenReceived", internalType: "uint256", type: "uint256" },
          {
            name: "redeemersReceived",
            internalType: "struct RedeemerInfo[]",
            type: "tuple[]",
            components: [
              { name: "redeemer", internalType: "address", type: "address" },
              {
                name: "redemptionValue",
                internalType: "uint256",
                type: "uint256",
              },
              {
                name: "redemptionStart",
                internalType: "uint256",
                type: "uint256",
              },
            ],
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  { type: "error", inputs: [], name: "CreditAccountNotLiquidatableException" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SiloFLTaker
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const siloFlTakerAbi = [
  {
    type: "constructor",
    inputs: [{ name: "_owner", internalType: "address", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "allowedFLReceiver",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "receiver", internalType: "address", type: "address" },
      { name: "status", internalType: "bool", type: "bool" },
    ],
    name: "setAllowedFLReceiver",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "silo", internalType: "address", type: "address" },
    ],
    name: "setTokenToSilo",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "takeFlashLoan",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "tokenToSilo",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "consumer",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      { name: "status", internalType: "bool", type: "bool", indexed: false },
    ],
    name: "SetAllowedFLReceiver",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      { name: "silo", internalType: "address", type: "address", indexed: true },
    ],
    name: "SetTokenToSilo",
  },
  { type: "error", inputs: [], name: "CallerNotAllowedReceiverException" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SiloLiquidator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const siloLiquidatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_siloFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "CALLBACK_SUCCESS",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "initiator", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "fee", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onFlashLoan",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "siloFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SiloUnwinder
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const siloUnwinderAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", internalType: "address", type: "address" },
      { name: "_siloFLTaker", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "CALLBACK_SUCCESS",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "cmToCA",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "hfOptimal", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "getOptimalLiquidation",
    outputs: [
      { name: "tokenOut", internalType: "address", type: "address" },
      { name: "optimalAmountIn", internalType: "uint256", type: "uint256" },
      { name: "optimalRepaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      { name: "isOptimalRepayable", internalType: "bool", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "initiator", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "fee", internalType: "uint256", type: "uint256" },
      { name: "data", internalType: "bytes", type: "bytes" },
    ],
    name: "onFlashLoan",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      {
        name: "conversionCalls",
        internalType: "struct MultiCall[]",
        type: "tuple[]",
        components: [
          { name: "target", internalType: "address", type: "address" },
          { name: "callData", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "partialLiquidateAndConvert",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
      { name: "creditAccount", internalType: "address", type: "address" },
      { name: "assetOut", internalType: "address", type: "address" },
      { name: "repaidAmount", internalType: "uint256", type: "uint256" },
      { name: "flashLoanAmount", internalType: "uint256", type: "uint256" },
      {
        name: "priceUpdates",
        internalType: "struct PriceUpdate[]",
        type: "tuple[]",
        components: [
          { name: "priceFeed", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
      { name: "slippage", internalType: "uint256", type: "uint256" },
      { name: "splits", internalType: "uint256", type: "uint256" },
      { name: "extraData", internalType: "bytes", type: "bytes" },
    ],
    name: "previewPartialLiquidation",
    outputs: [
      {
        name: "res",
        internalType: "struct LiquidationResult",
        type: "tuple",
        components: [
          {
            name: "calls",
            internalType: "struct MultiCall[]",
            type: "tuple[]",
            components: [
              { name: "target", internalType: "address", type: "address" },
              { name: "callData", internalType: "bytes", type: "bytes" },
            ],
          },
          { name: "profit", internalType: "int256", type: "int256" },
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "creditManager", internalType: "address", type: "address" },
    ],
    name: "registerCM",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "router",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newRouter", internalType: "address", type: "address" }],
    name: "setRouter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "siloFLTaker",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "token", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "to", internalType: "address", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "newRouter",
        internalType: "address",
        type: "address",
        indexed: true,
      },
    ],
    name: "SetRouter",
  },
  { type: "error", inputs: [], name: "ForceApproveFailed" },
  { type: "error", inputs: [], name: "SafeTransferFailed" },
] as const;

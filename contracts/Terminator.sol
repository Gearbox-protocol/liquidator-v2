// SPDX-License-Identifier: MIT
pragma solidity ^0.7.4;
pragma abicoder v2;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {Constants} from "./Constants.sol";
import {IUniswapV2Router02} from "./integrations/IUniswapV2Router02.sol";

import {ICreditManager} from "./interfaces/ICreditManager.sol";
import {ICreditFilter} from "./interfaces/ICreditFilter.sol";

import "hardhat/console.sol";

contract Terminator is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public wethToken;

    mapping(address => bool) public executors;

    struct UniV2Params {
        address[] path;
        uint256 amountOutMin;
    }

    modifier executorOnly() {
        require(executors[msg.sender], "For executors only");
        _;
    }

    constructor(address _wethToken) {
        wethToken = _wethToken;
    }

    function allowExecutor(address _executor) external onlyOwner {
        executors[_executor] = true;
    }

    function forbidExecutor(address _executor) external onlyOwner {
        executors[_executor] = false;
    }

    function liquidateAndSellOnV2(
        address _creditManager,
        address _borrower,
        address _router,
        UniV2Params[] calldata _paths
    ) external executorOnly {
        // Getting creditManager, creditFilter and underlyingToken
        ICreditManager creditManager = ICreditManager(_creditManager);
        ICreditFilter creditFilter = ICreditFilter(
            creditManager.creditFilter()
        );
        address underlyingToken = creditManager.underlyingToken();

        // Provides address of credit account of reverts. It'll revert if someone already liquidate it
        address creditAccount = creditManager.getCreditAccountOrRevert(
            _borrower
        );

        uint256 allowedTokenQty = creditFilter.allowedTokensCount();

        // Storing balances, they will not be available after liquidation
        uint256[] memory caBalances = new uint256[](allowedTokenQty);

        // Getting enabledTokens - token mask which represents non-zero balances
        uint256 enabledTokens = creditFilter.enabledTokens(creditAccount);

        uint256 tokenMask;

        require(_paths.length == allowedTokenQty);

        for (uint256 i = 1; i < allowedTokenQty; i++) {
            tokenMask = 1 << i;
            if (enabledTokens & tokenMask > 0) {
                (, uint256 amount, , ) = creditFilter.getCreditAccountTokenById(
                    creditAccount,
                    i
                );
                caBalances[i] = amount;
            }
        }
        // Providing allowance for creditManager to withdraw liquidation amount
        _provideAllowance(address(creditManager), underlyingToken);
        creditManager.liquidateCreditAccount(_borrower, address(this), false);
        console.log("acc is liquidated");

        for (uint256 i = 1; i < allowedTokenQty; i++) {
            address tokenAddress = creditFilter.allowedTokens(i);

            if (caBalances[i] > 0) {
                {
                    uint256 balance = ERC20(tokenAddress).balanceOf(
                        address(this)
                    );

                    console.log(tokenAddress);
                    console.log(_router);
                    console.log("balance");
                    console.log(balance);
                    console.log(caBalances[i].sub(1));
                    console.log(_paths[i].amountOutMin);
                    _provideAllowance(_router, tokenAddress);
                }

                require(tokenAddress == _paths[i].path[0], "incorrect path");

                if (tokenAddress == wethToken) {
                    IUniswapV2Router02(_router).swapExactETHForTokens{
                        value: caBalances[i].sub(1)
                    }(
                        _paths[i].amountOutMin,
                        _paths[i].path,
                        address(this),
                        block.timestamp
                    );
                } else {
                    IUniswapV2Router02(_router).swapExactTokensForTokens(
                        caBalances[i].sub(1),
                        _paths[i].amountOutMin,
                        _paths[i].path,
                        address(this),
                        block.timestamp
                    );
                }
            }
        }
    }

    // @dev sends tokens back
    function transferToOwner(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function _provideAllowance(address externalContract, address token)
        internal
    {
        console.log(ERC20(token).allowance(address(this), externalContract));
        if (
            ERC20(token).allowance(address(this), externalContract) <
            Constants.MAX_INT_4
        ) {
            ERC20(token).approve(externalContract, Constants.MAX_INT);
        }
    }

    receive() external payable {}
}

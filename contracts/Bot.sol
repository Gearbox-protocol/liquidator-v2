// SPDX-License-Identifier: MIT
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Constants} from "./libraries/Constants.sol";
import {IUniswapV2Router02} from "./integrations/uniswap/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "./integrations/uniswap/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "./integrations/uniswap/IUniswapV2Pair.sol";
import {PriceOracle} from "./oracles/PriceOracle.sol";
import {Math} from "./libraries/Math.sol";
import "hardhat/console.sol";

contract ArbBot is Ownable {
    PriceOracle public priceOracle;
    using SafeMath for uint256;
    mapping(address => bool) allowedRouters;

    constructor(address _priceOracle) {
        priceOracle = PriceOracle(_priceOracle);
    }

    function allowRouter(address router) external onlyOwner {
        allowedRouters[router] = true;
    }

    function checkUniV2(
        address _router,
        address tokenA,
        address tokenB
    )
        public
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        IUniswapV2Router02 router = IUniswapV2Router02(_router);
        IUniswapV2Factory factory = IUniswapV2Factory(router.factory());
        IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token0, token1));
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        uint256 reserve1chainlink = priceOracle.convert(
            uint256(reserve0),
            token0,
            token1
        );
        return (uint256(reserve0), uint256(reserve1), reserve1chainlink);
    }

//    function calcDr(
//        uint256 reserve0,
//        uint256 reserve1,
//        uint256 reserve1CL
//    ) external view returns (uint256) {
//        if (reserve1 > reserve1CL) {
//            return
//                Math
//                    .sqrt(reserve0.mul(reserve0).mul(reserve1).div(reserve1CL))
//                    .sub(reserve0);
//        } else {
//            return Math.sqrt(reserve1.mul(reserve1CL)).sub(reserve1);
//        }
//    }

    function updatePrice(
        address _router,
        address tokenA,
        address tokenB
    ) external {
        require(allowedRouters[_router], "Router is not allowed");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        IUniswapV2Router02 router = IUniswapV2Router02(_router);
        (uint256 reserve0, uint256 reserve1, uint256 reserve1CL) = checkUniV2(
            _router,
            token0,
            token1
        );

        uint256 chi = reserve1.mul(100).div(reserve1CL);

        require(chi < 99 || chi > 101, "Too small deviation");

        address[] memory path = new address[](2);
        uint256 dr;
        if (reserve1 > reserve1CL) {
            path[0] = token0;
            path[1] = token1;

            dr = Math
                .sqrt(reserve0.mul(reserve0).mul(reserve1).div(reserve1CL))
                .sub(reserve0);
        } else {
            path[0] = token1;
            path[1] = token0;

            dr = Math.sqrt(reserve1.mul(reserve1CL)).sub(reserve1);
        }

        _provideAllowance(_router, path[0]);

        router.swapExactTokensForTokens(
            dr.mul(1000).div(997),
            0,
            path,
            address(this),
            block.timestamp + 1
        );
    }

    function _provideAllowance(address _router, address token) internal {
        if (
            ERC20(token).allowance(address(this), _router) < Constants.MAX_INT_4
        ) {
            ERC20(token).approve(_router, Constants.MAX_INT);
        }
    }
}

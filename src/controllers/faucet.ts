import { Body, Get, JsonController, Param, Post } from "routing-controllers";
import { Container } from "typedi";
import { FaucetService } from "../services/faucetService";
import { FaucetRequest } from "../payloads/faucet";

@JsonController("/api/faucet")
export class FaucetController {
  faucetService: FaucetService;

  constructor() {
    this.faucetService = Container.get(FaucetService);
  }

  @Get("/token/:address")
  getTokenList(@Param("address") address: string) {
    console.log(address);
    return this.faucetService.getTokenList(address);
  }

  @Get("/eth/:address")
  getEthDelay(@Param("address") address: string) {
    console.log(address);
    return this.faucetService.getEthDelay(address);
  }

  @Post("/token/")
  sendTokens(@Body() faucetReq: FaucetRequest) {
    console.log(faucetReq);
    return this.faucetService.sendTokens(faucetReq.address, faucetReq.token);
  }

  @Post("/eth/")
  sendEth(@Body() faucetReq: FaucetRequest) {
    console.log(faucetReq);
    return this.faucetService.sendETH(faucetReq.address);
  }
}

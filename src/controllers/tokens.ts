import { Controller, Param, Body, Get, Post } from "routing-controllers";
import { Container, Inject } from "typedi";
import { BotService } from "../services/arbitrageService";
import { FaucetPayload } from "../payloads/faucet";

@Controller("/api/tokens")
export class TokenController {
  botService: BotService;

  constructor() {
    this.botService = Container.get(BotService);
  }

  @Get("/")
  getAll() {
    return this.botService.pairList();
  }

  @Get("/:address")
  getByAddress(@Param("address") address: string) {
    console.log(address);
    return "ok";
  }

  @Post("/")
  faucetTokens(@Body() faucetPayload: FaucetPayload) {
    console.log(faucetPayload);
    return "ok"
  }
}

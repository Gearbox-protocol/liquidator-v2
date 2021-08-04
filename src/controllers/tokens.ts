import { Body, Get, JsonController, Param, Post } from "routing-controllers";
import { Container } from "typedi";
import { BotService } from "../services/arbitrageService";
import { FaucetRequest } from "../payloads/faucet";

@JsonController("/api/tokens")
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
  faucetTokens(@Body() faucetPayload: FaucetRequest) {
    console.log(faucetPayload);
    return "ok"
  }
}

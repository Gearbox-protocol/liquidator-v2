import { Controller, Param, Body, Get, Post } from "routing-controllers";
import { Container, Inject } from "typedi";
import { BotService } from "../services/arbitrageService";

@Controller("/tokens")
export class TokenController {
  botService: BotService;

  constructor() {
    this.botService = Container.get(BotService);
  }

  @Get("/")
  getAll() {
    return this.botService.pairList();
  }
}

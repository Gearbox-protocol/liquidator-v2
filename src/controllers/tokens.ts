import { Get, JsonController } from "routing-controllers";
import { Container } from "typedi";
import { TerminatorService } from "../services/terminatorService";

@JsonController("/api/tokens")
export class TokenController {
  botService: TerminatorService;

  constructor() {
    this.botService = Container.get(TerminatorService);
  }

  @Get("/")
  getAll() {
    return "Ok";
  }

}

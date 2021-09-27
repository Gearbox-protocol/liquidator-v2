import { Get, JsonController } from "routing-controllers";
import { Container } from "typedi";
import { TerminatorService } from "../services/terminatorService";

@JsonController("/api/executors")
export class TokenController {
  botService: TerminatorService;

  constructor() {
    this.botService = Container.get(TerminatorService);
  }

  @Get("/")
  getAll() {
    return this.botService.executorService.getExecutorAddress()
  }

}
